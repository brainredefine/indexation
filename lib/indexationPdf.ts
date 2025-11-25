// lib/indexationPdf.ts
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import path from "path";

export type IndexationPdfParams = {
  ind: string | null;
  tenancy_id: number;

  tenant: string | null;
  property_label: string | null;
  address: string | null; // multiligne avec \n

  old_rent: number;
  new_rent: number;
  applied_pct: number | null;
  effective_date: string;

  index_prev_value: number | null;
  index_prev_label: string | null;
  index_cur_value: number | null;
  index_cur_label: string | null;
  index_delta: number | null;

  is_gross_19: boolean;

  ancillary_current: number | null; // netto
  ancillary_vat_rate: 19 | 0 | null;
};

function formatDateGerman(d: string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  const day = String(dt.getDate()).padStart(2, "0");
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}.${month}.${year}`;
}

function formatPercentDE1(v: number | null): string {
  if (v == null) return "—";
  const pct = v * 100;
  return (
    pct.toLocaleString("de-DE", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + " %"
  );
}

function formatCurrencyDE(v: number): string {
  return (
    v.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

export async function generateIndexationPdf(
  params: IndexationPdfParams
): Promise<Uint8Array> {
  const {
    ind,
    tenancy_id,
    tenant,
    property_label,
    address,
    old_rent,
    new_rent,
    applied_pct,
    effective_date,
    index_prev_value,
    index_prev_label,
    index_cur_value,
    index_cur_label,
    index_delta,
    is_gross_19,
    ancillary_current,
    ancillary_vat_rate,
  } = params;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  let page: PDFPage;
  let secondTemplatePage: PDFPage | null = null;
  let secondTemplateUsed = false;

  // Taille par défaut A4
  let width = 595.28;
  let height = 841.89;

  // -------- 1) Charger le modèle PDF (Word exporté) --------
  try {
    const templatePath = path.join(
      process.cwd(),
      "lib",
      "20251125_PM_Vorlage.pdf"
    );
    const templateBytes = fs.readFileSync(templatePath);
    const templateDoc = await PDFDocument.load(templateBytes);

    // Page 1 du template → page 1 du PDF
    const [templatePage1] = await pdfDoc.copyPages(templateDoc, [0]);
    page = pdfDoc.addPage(templatePage1);

    // Page 2 du template = même base, mais on masque la box "Es schreibt Ihnen"
    const [templatePage2] = await pdfDoc.copyPages(templateDoc, [0]);

    // Rectangle blanc qui recouvre la zone de la box "Es schreibt Ihnen"
    // (coordonnées approximatives, à ajuster si besoin)
    const boxX = width - 230; // proche du bord droit
    const boxY = height - 260; // zone haute
    const boxWidthRect = 210;
    const boxHeightRect = 140;

    templatePage2.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxWidthRect,
      height: boxHeightRect,
      color: rgb(1, 1, 1),
    });

    secondTemplatePage = templatePage2;

    const size = page.getSize();
    width = size.width;
    height = size.height;
  } catch {
    // fallback si le template n'est pas dispo
    page = pdfDoc.addPage([width, height]);
  }

  // -------- 2) Polices Titillium Web --------
  const regularPath = path.join(
    process.cwd(),
    "lib",
    "fonts",
    "TitilliumWeb-Regular.ttf"
  );
  const boldPath = path.join(
    process.cwd(),
    "lib",
    "fonts",
    "TitilliumWeb-Bold.ttf"
  );

  const fontRegularBytes = fs.readFileSync(regularPath);
  const fontBoldBytes = fs.readFileSync(boldPath);

  const font = await pdfDoc.embedFont(fontRegularBytes);
  const fontBold = await pdfDoc.embedFont(fontBoldBytes);

  const leftMargin = 60;
  const maxWidth = width - leftMargin * 2;
  const dateStr = formatDateGerman(effective_date);

  // Top de la zone de texte :
  //  - page 1 : un peu plus haut
  //  - page 2+ : légèrement plus bas pour laisser de la marge sous le header
  const contentTopYFirst = height - 134 - 50;
  const contentTopYOther = contentTopYFirst;

  let y = contentTopYFirst;

  type Line = { label: string; value: string; bold: boolean };

  function newPage() {
    if (secondTemplatePage && !secondTemplateUsed) {
      // 2e page : template avec box masquée
      page = pdfDoc.addPage(secondTemplatePage);
      secondTemplateUsed = true;
      y = contentTopYOther;
    } else {
      // 3e page+ : page A4 blanche
      page = pdfDoc.addPage([width, height]);
      y = contentTopYOther;
    }
  }

  function ensureSpace(minBottomY: number) {
    if (y < minBottomY) {
      newPage();
    }
  }

  // Helper pour paragraphe justifié
  function drawJustifiedParagraph(text: string, fontSize: number) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const lineHeight = fontSize + 4;
    let currentWords: string[] = [];

    const spaceWidth = font.widthOfTextAtSize(" ", fontSize);

    function drawLine(lineWords: string[], isLast: boolean) {
      if (lineWords.length === 0) return;

      ensureSpace(120);
      const yLine = y;

      if (isLast || lineWords.length === 1) {
        const lineText = lineWords.join(" ");
        page.drawText(lineText, {
          x: leftMargin,
          y: yLine,
          size: fontSize,
          font,
        });
      } else {
        const wordsWidths = lineWords.map((w) =>
          font.widthOfTextAtSize(w, fontSize)
        );
        const textWidth = wordsWidths.reduce((a, b) => a + b, 0);
        const baseSpacesWidth = spaceWidth * (lineWords.length - 1);
        const missing = maxWidth - (textWidth + baseSpacesWidth);
        const extraPerSpace =
          lineWords.length > 1 ? missing / (lineWords.length - 1) : 0;

        let xx = leftMargin;
        for (let i = 0; i < lineWords.length; i++) {
          const word = lineWords[i];
          const wWidth = wordsWidths[i];
          page.drawText(word, {
            x: xx,
            y: yLine,
            size: fontSize,
            font,
          });
          xx += wWidth;
          if (i < lineWords.length - 1) {
            xx += spaceWidth + extraPerSpace;
          }
        }
      }

      y -= lineHeight;
    }

    for (const w of words) {
      const testWords = [...currentWords, w];
      const testLine = testWords.join(" ");
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth > maxWidth && currentWords.length > 0) {
        drawLine(currentWords, false);
        currentWords = [w];
      } else {
        currentWords = testWords;
      }
    }

    if (currentWords.length > 0) {
      drawLine(currentWords, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Adresse locataire – police 10, un peu plus bas
  // ---------------------------------------------------------------------------
  const addrLines: string[] = [];
  if (tenant) addrLines.push(tenant);

  if (address) {
    for (const l of address.split("\n")) {
      if (l.trim()) addrLines.push(l.trim());
    }
  }

  for (const line of addrLines) {
    ensureSpace(80);
    page.drawText(line, { x: leftMargin, y, size: 10, font });
    y -= 14;
  }
  y -= 40;

  // ---------------------------------------------------------------------------
  // Berlin + date – plus bas, plus à gauche, Titillium 9
  // ---------------------------------------------------------------------------
  ensureSpace(120);
  const dateText = `Berlin, ${dateStr}`;
  const dateWidth = font.widthOfTextAtSize(dateText, 9);
  const dateX = width - leftMargin - dateWidth - 54;

  page.drawText(dateText, {
    x: dateX,
    y,
    size: 9,
    font,
  });
  y -= 15;

  // ---------------------------------------------------------------------------
  // Sujet – une seule ligne Hier + Gültig ab ...
  // ---------------------------------------------------------------------------
  const subjLines: string[] = [
    "Hier: Mietanpassung gem. Indexierung Ihres Mietvertrages",
    `Gültig ab ${dateStr}`,
    `Mietverhältnis: ${tenancy_id}`,
  ];
  if (property_label) subjLines.push(`Objekt: ${property_label}`);
  if (ind) subjLines.push(`Indexation ID: ${ind}`);

  for (const line of subjLines) {
    ensureSpace(120);
    page.drawText(line, { x: leftMargin, y, size: 10, font: fontBold });
    y -= 14;
  }
  y -= 20;

  // ---------------------------------------------------------------------------
  // Corps – salutation + paragraphe justifié
  // ---------------------------------------------------------------------------
  ensureSpace(120);
  page.drawText("Sehr geehrte Damen und Herren,", {
    x: leftMargin,
    y,
    size: 10,
    font,
  });
  y -= 18;

  const introParagraph =
    "gemäß den Regelungen Ihres Mietvertrages wird die Miete an die Entwicklung des Verbraucherpreisindexes (VPI) angepasst. " +
    "Grundlage der Anpassung ist die Veränderung des Indexstandes gegenüber dem zuletzt berücksichtigten Index. " +
    "Auf Basis der nachstehenden Berechnung ergibt sich eine Anpassung Ihrer Miete.";

  drawJustifiedParagraph(introParagraph, 10);
  y -= 10;

  // ---------------------------------------------------------------------------
  // Bloc index – titre, tableau, explication justifiée
  // ---------------------------------------------------------------------------
  const hasIndexBlock = index_prev_value != null && index_cur_value != null;

  if (hasIndexBlock) {
    ensureSpace(180);

    const idxPrevLabel = index_prev_label ?? "bisher";
    const idxCurLabel = index_cur_label ?? "neu";
    const idxDelta =
      index_delta ??
      (index_prev_value && index_cur_value
        ? index_cur_value / index_prev_value - 1
        : null);

    page.drawText("Indexentwicklung (VPI):", {
      x: leftMargin,
      y,
      size: 10,
      font: fontBold,
    });
    y -= 18;

    const labelWidth = 260;
    const idxLines: Array<[string, string]> = [
      [
        `Indexstand bisher (${idxPrevLabel})`,
        index_prev_value!.toLocaleString("de-DE", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      ],
      [
        `Indexstand neu (${idxCurLabel})`,
        index_cur_value!.toLocaleString("de-DE", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      ],
    ];
    if (idxDelta != null) {
      idxLines.push(["Veränderung", formatPercentDE1(idxDelta)]);
    }

    for (const [label, value] of idxLines) {
      ensureSpace(140);
      page.drawText(label, { x: leftMargin, y, size: 10, font });
      page.drawText(value, {
        x: leftMargin + labelWidth,
        y,
        size: 10,
        font,
      });
      y -= 16;
    }

    y -= 10;

    if (idxDelta != null && applied_pct != null && idxDelta > 0) {
      const totalPct = idxDelta * 100;
      const appliedPctValue = applied_pct * 100;
      const passThroughPct = (applied_pct / idxDelta) * 100;

      const totalStr = totalPct.toLocaleString("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      const appliedStr = appliedPctValue.toLocaleString("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      const passThroughStr = passThroughPct.toLocaleString("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });

      const explanation =
        `Die Veränderung des Index beträgt ${totalStr} %. ` +
        `Laut Ihrem Mietvertrag werden davon ${passThroughStr} % auf die Miete übertragen, ` +
        `woraus sich eine Mietanpassung von ${appliedStr} % ergibt.`;

      drawJustifiedParagraph(explanation, 10);
      y -= 10;
    }
  }

  // ---------------------------------------------------------------------------
  // Bloc loyer – police 10
  // ---------------------------------------------------------------------------
  const rentDeltaAbs = new_rent - old_rent;
  const pctStr = formatPercentDE1(applied_pct);
  const oldStr = formatCurrencyDE(old_rent);
  const deltaStr = formatCurrencyDE(rentDeltaAbs);
  const newStr = formatCurrencyDE(new_rent);
  const newRentBrutto = is_gross_19 ? new_rent * 1.19 : null;
  const newBruttoStr =
    newRentBrutto != null ? formatCurrencyDE(newRentBrutto) : null;

  y -= 10;

  ensureSpace(180);
  page.drawText(
    `Die Miete für Ihre Mietfläche setzt sich ab dem ${dateStr} wie folgt zusammen:`,
    { x: leftMargin, y, size: 10, font: fontBold, maxWidth }
  );
  y -= 20;

  const labelWidthRent = 260;

  const rentLines: Line[] = [
    { label: "derzeitige Miete netto", value: oldStr, bold: true },
    { label: `zzgl. Indexanpassung ${pctStr}`, value: deltaStr, bold: false },
    { label: "neue Miete netto", value: newStr, bold: true },
  ];

  if (newBruttoStr) {
    rentLines.push({ label: "MwSt", value: "19,0 %", bold: false });
    rentLines.push({
      label: "neue Miete brutto (19 % USt.)",
      value: newBruttoStr,
      bold: true,
    });
  }

  for (const { label, value, bold } of rentLines) {
    ensureSpace(140);
    page.drawText(label, { x: leftMargin, y, size: 10, font });
    page.drawText(value, {
      x: leftMargin + labelWidthRent,
      y,
      size: 10,
      font: bold ? fontBold : font,
    });
    y -= 16;
  }

  // ---------------------------------------------------------------------------
  // Bloc Nebenkosten – police 10
  // ---------------------------------------------------------------------------
  let ancNet: number | null = null;
  let ancGross: number | null = null;

  if (ancillary_current != null && Number.isFinite(ancillary_current)) {
    ancNet = ancillary_current;
    ancGross =
      ancillary_vat_rate === 19 ? ancillary_current * 1.19 : ancillary_current;

    const ancNetStr = formatCurrencyDE(ancillary_current);
    const ancBruttoStr =
      ancillary_vat_rate === 19
        ? formatCurrencyDE(ancillary_current * 1.19)
        : null;

    y -= 12;

    ensureSpace(180);
    page.drawText("Nebenkosten / Betriebskosten:", {
      x: leftMargin,
      y,
      size: 10,
      font: fontBold,
    });
    y -= 18;

    const ancLines: Line[] = [
      {
        label: "derzeitige Nebenkosten netto",
        value: ancNetStr,
        bold: true,
      },
    ];

    if (ancillary_vat_rate === 19 && ancBruttoStr) {
      ancLines.push({ label: "MwSt", value: "19,0 %", bold: false });
      ancLines.push({
        label: "derzeitige Nebenkosten brutto (19 % USt.)",
        value: ancBruttoStr,
        bold: true,
      });
    }

    for (const { label, value, bold } of ancLines) {
      ensureSpace(140);
      page.drawText(label, { x: leftMargin, y, size: 10, font });
      page.drawText(value, {
        x: leftMargin + labelWidthRent,
        y,
        size: 10,
        font: bold ? fontBold : font,
      });
      y -= 16;
    }
  }

  // ---------------------------------------------------------------------------
  // TOTAL BOX – toujours police 10, en bas de page
  // ---------------------------------------------------------------------------
  {
    const totalNet = new_rent + (ancNet ?? 0);
    const hasAny19 = is_gross_19 || ancillary_vat_rate === 19;
    const totalGross = hasAny19
      ? (newRentBrutto ?? new_rent) + (ancGross ?? 0)
      : null;

    const linesInside = totalGross != null ? 2 : 1;
    const lineHeight = 16;
    const paddingBox = 10;
    const boxHeight = paddingBox * 2 + linesInside * lineHeight - 20;

    const neededBottom = 120 + boxHeight;
    if (y < neededBottom) {
      newPage();
    }

    const boxTopY = y;
    const boxLeftX = leftMargin;
    const boxWidth = width - leftMargin * 2 - 150;

    page.drawRectangle({
      x: boxLeftX,
      y: boxTopY - boxHeight,
      width: boxWidth,
      height: boxHeight,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
    });

    let yy = boxTopY - paddingBox - 2;

    page.drawText("Gesamtmiete netto (Miete + Nebenkosten)", {
      x: boxLeftX + 10,
      y: yy,
      size: 10,
      font,
    });
    page.drawText(formatCurrencyDE(totalNet), {
      x: boxLeftX + labelWidthRent,
      y: yy,
      size: 10,
      font: fontBold,
    });

    yy -= lineHeight;

    if (totalGross != null) {
      page.drawText("Gesamtmiete brutto", {
        x: boxLeftX + 10,
        y: yy,
        size: 10,
        font,
      });
      page.drawText(formatCurrencyDE(totalGross), {
        x: boxLeftX + labelWidthRent,
        y: yy,
        size: 10,
        font: fontBold,
      });
    }

    y = boxTopY - boxHeight - 30;
  }

  // ---------------------------------------------------------------------------
  // Closing / signature – police 10
  // ---------------------------------------------------------------------------
  const closingLines = [
    "Für Rückfragen stehen wir Ihnen selbstverständlich gern zur Verfügung.",
    "",
    "Mit freundlichen Grüßen",
    "",
    "i.A. Jakob Webb",
  ];

  for (const line of closingLines) {
    ensureSpace(120);
    page.drawText(line, { x: leftMargin, y, size: 10, font });
    y -= 14;
  }

  return await pdfDoc.save();
}
