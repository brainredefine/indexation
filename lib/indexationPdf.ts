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
  address: string | null;

  old_rent: number;       // total ancien loyer
  new_rent: number;       // total nouveau loyer (inclut partie non indexée)
  applied_pct: number | null; // % appliqué (sur la portion indexable si split)
  effective_date: string;

  index_prev_value: number | null;
  index_prev_label: string | null;
  index_cur_value: number | null;
  index_cur_label: string | null;
  index_delta: number | null;

  is_gross_19: boolean;

  ancillary_current: number | null;
  ancillary_vat_rate: 19 | 0 | null;

  // Split rent (rare case)
  split_rent: boolean;
  indexable_rent: number | null;     // portion indexée
  non_indexable_rent: number | null; // portion non indexée

  // Nebenkosten indexation
  index_nebenkosten: boolean;
  ancillary_new: number | null;
  ancillary_applied_pct: number | null;

  // Heizkosten
  heating_current: number | null;
  index_heating: boolean;
  heating_new: number | null;
  heating_applied_pct: number | null;
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

// ---------------------------------------------------------------------------
// Contact / signataire selon le préfixe de l'asset (main_property_id[1])
//   - commence par "AD"  → Andrea Goldhahn
//   - "AC" + tout le reste → Nadine Köhler (défaut)
// Le bloc expéditeur en haut à droite est imprimé en dur dans le letterhead
// (sur Nadine), donc on le recouvre d'un rectangle blanc et on le réécrit
// systématiquement avec le bon contact (nom + e-mail + téléphone).
// ---------------------------------------------------------------------------
type Contact = {
  name: string;
  email: string;
  phone: string;
};

function resolveContact(propertyLabel: string | null): Contact {
  const label = (propertyLabel ?? "").trim().toUpperCase();

  if (label.startsWith("AD")) {
    return {
      name: "Andrea Goldhahn",
      email: "goldhahn@redefine.group",
      phone: "0178 5314151",
    };
  }

  // Assets "AC" + défaut → Nadine
  return {
    name: "Nadine Köhler",
    email: "koehler@redefine.group",
    phone: "0151 46303254",
  };
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
    split_rent,
    indexable_rent,
    non_indexable_rent,
    index_nebenkosten,
    ancillary_new,
    ancillary_applied_pct,
    heating_current,
    index_heating,
    heating_new,
    heating_applied_pct,
  } = params;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  let page: PDFPage;
  let secondTemplatePage: PDFPage | null = null;
  let secondTemplateUsed = false;
  let templateLoaded = false;

  let width = 595.28;
  let height = 841.89;

  try {
    const templatePath = path.join(
      process.cwd(),
      "lib",
      "20251125_PM_Vorlage.pdf"
    );
    const templateBytes = fs.readFileSync(templatePath);
    const templateDoc = await PDFDocument.load(templateBytes);

    const [templatePage1] = await pdfDoc.copyPages(templateDoc, [0]);
    page = pdfDoc.addPage(templatePage1);

    const [templatePage2] = await pdfDoc.copyPages(templateDoc, [0]);

    const boxX = width - 230;
    const boxY = height - 260;
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

    templateLoaded = true;
  } catch {
    page = pdfDoc.addPage([width, height]);
  }

  const regularPath = path.join(process.cwd(), "lib", "fonts", "TitilliumWeb-Regular.ttf");
  const boldPath = path.join(process.cwd(), "lib", "fonts", "TitilliumWeb-Bold.ttf");

  const fontRegularBytes = fs.readFileSync(regularPath);
  const fontBoldBytes = fs.readFileSync(boldPath);

  const font = await pdfDoc.embedFont(fontRegularBytes);
  const fontBold = await pdfDoc.embedFont(fontBoldBytes);

  // ---------------------------------------------------------------------------
  // Bloc expéditeur (haut droite) : on recouvre le contact imprimé dans le
  // letterhead (Nadine) et on réécrit le bon contact selon l'asset.
  // ---------------------------------------------------------------------------
  const contact = resolveContact(property_label);

  if (templateLoaded) {
    // Recouvre le bloc "Es schreibt Ihnen: / Nadine Köhler / E-Mail: ..."
    page.drawRectangle({
      x: 403,
      y: height - 270,
      width: 153,
      height: 73,
      color: rgb(1, 1, 1),
    });

    const sx = 410.9;
    page.drawText("Es schreibt Ihnen:", { x: sx, y: height - 220, size: 10, font: fontBold });
    page.drawText(contact.name, { x: sx, y: height - 234, size: 10, font });
    page.drawText(`E-Mail: ${contact.email}`, { x: sx, y: height - 248, size: 9, font });
    page.drawText(`Tel.: ${contact.phone}`, { x: sx, y: height - 261, size: 9, font });
  }

  const leftMargin = 60;
  const maxWidth = width - leftMargin * 2;

  const dateStr = formatDateGerman(effective_date);

  const contentTopYFirst = height - 134 - 50;
  const contentTopYOther = contentTopYFirst;

  let y = contentTopYFirst;

  type Line = { label: string; value: string; bold: boolean; lineAbove?: boolean };

  function newPage() {
    if (secondTemplatePage && !secondTemplateUsed) {
      page = pdfDoc.addPage(secondTemplatePage);
      secondTemplateUsed = true;
      y = contentTopYOther;
    } else {
      page = pdfDoc.addPage([width, height]);
      y = contentTopYOther;
    }
  }

  function ensureSpace(minBottomY: number) {
    if (y < minBottomY) {
      newPage();
    }
  }

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
        page.drawText(lineText, { x: leftMargin, y: yLine, size: fontSize, font });
      } else {
        const wordsWidths = lineWords.map((w) => font.widthOfTextAtSize(w, fontSize));
        const textWidth = wordsWidths.reduce((a, b) => a + b, 0);
        const baseSpacesWidth = spaceWidth * (lineWords.length - 1);
        const missing = maxWidth - (textWidth + baseSpacesWidth);
        const extraPerSpace = lineWords.length > 1 ? missing / (lineWords.length - 1) : 0;

        let xx = leftMargin;
        for (let i = 0; i < lineWords.length; i++) {
          const word = lineWords[i];
          const wWidth = wordsWidths[i];
          page.drawText(word, { x: xx, y: yLine, size: fontSize, font });
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
  // Tenant address
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
  // Berlin + date
  // ---------------------------------------------------------------------------
  ensureSpace(120);

  const today = new Date();
  const todayStr = formatDateGerman(today.toISOString().slice(0, 10));
  const dateText = `Berlin, ${todayStr}`;
  const dateX = leftMargin;

  page.drawText(dateText, { x: dateX, y, size: 9, font });
  y -= 15;

  // ---------------------------------------------------------------------------
  // Subject
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
  // Body intro
  // ---------------------------------------------------------------------------
  ensureSpace(120);
  page.drawText("Sehr geehrte Damen und Herren,", { x: leftMargin, y, size: 10, font });
  y -= 18;

  const indexingNk = index_nebenkosten && ancillary_new != null;
  const indexingHeat = index_heating && heating_new != null;

  let extraSentence = "";
  if (indexingNk && indexingHeat) {
    extraSentence =
      " Die Nebenkosten und Heizkosten werden ebenfalls gemäß den vertraglichen Regelungen entsprechend angepasst.";
  } else if (indexingNk) {
    extraSentence = " Die Nebenkosten werden ebenfalls gemäß den vertraglichen Regelungen entsprechend angepasst.";
  } else if (indexingHeat) {
    extraSentence = " Die Heizkosten werden ebenfalls gemäß den vertraglichen Regelungen entsprechend angepasst.";
  }

  const splitNote =
    split_rent && indexable_rent != null && non_indexable_rent != null
      ? ` Die Indexierung erfolgt vertragsgemäß ausschließlich auf einen Teilbetrag der Gesamtmiete in Höhe von ${formatCurrencyDE(
          indexable_rent
        )}.`
      : "";

  const introParagraph =
    "gemäß den Regelungen Ihres Mietvertrages wird die Miete an die Entwicklung des Verbraucherpreisindexes (VPI) angepasst. " +
    "Grundlage der Anpassung ist die Veränderung des Indexstandes gegenüber dem zuletzt berücksichtigten Index. " +
    "Auf Basis der nachstehenden Berechnung ergibt sich eine Anpassung Ihrer Miete." +
    splitNote +
    extraSentence;

  drawJustifiedParagraph(introParagraph, 10);
  y -= 10;

  // ---------------------------------------------------------------------------
  // Index block (VPI)
  // ---------------------------------------------------------------------------
  const hasIndexBlock = index_prev_value != null && index_cur_value != null;

  if (hasIndexBlock) {
    ensureSpace(180);

    const idxPrevLabel = index_prev_label ?? "bisher";
    const idxCurLabel = index_cur_label ?? "neu";

    const idxDelta =
      index_delta ??
      (index_prev_value && index_cur_value ? index_cur_value / index_prev_value - 1 : null);

    page.drawText("Indexentwicklung (VPI):", { x: leftMargin, y, size: 10, font: fontBold });
    y -= 18;

    const labelWidth = 260;

    const idxLines: Array<[string, string]> = [
      [
        `Indexstand bisher (${idxPrevLabel})`,
        index_prev_value!.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      ],
      [
        `Indexstand neu (${idxCurLabel})`,
        index_cur_value!.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      ],
    ];

    if (idxDelta != null) {
      idxLines.push(["Veränderung", formatPercentDE1(idxDelta)]);
    }

    for (const [label, value] of idxLines) {
      ensureSpace(140);
      page.drawText(label, { x: leftMargin, y, size: 10, font });
      page.drawText(value, { x: leftMargin + labelWidth, y, size: 10, font });
      y -= 16;
    }

    y -= 10;

    if (idxDelta != null && applied_pct != null && idxDelta > 0) {
      const totalPct = idxDelta * 100;
      const appliedPctValue = applied_pct * 100;
      const passThroughPct = (applied_pct / idxDelta) * 100;

      const totalStr = totalPct.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const appliedStr = appliedPctValue.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const passThroughStr = passThroughPct.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

      const explanation =
        `Die Veränderung des Index beträgt ${totalStr} %. ` +
        `Laut Ihrem Mietvertrag werden davon ${passThroughStr} % auf die Miete übertragen, ` +
        `woraus sich eine Mietanpassung von ${appliedStr} % ergibt.`;

      drawJustifiedParagraph(explanation, 10);
      y -= 10;
    }
  }

  // ---------------------------------------------------------------------------
  // Rent block
  // ---------------------------------------------------------------------------
  const pctStr = formatPercentDE1(applied_pct);
  const oldStr = formatCurrencyDE(old_rent);
  const newStr = formatCurrencyDE(new_rent);

  const newRentBrutto = is_gross_19 ? new_rent * 1.19 : null;
  const newBruttoStr = newRentBrutto != null ? formatCurrencyDE(newRentBrutto) : null;

  y -= 10;
  ensureSpace(220);

  page.drawText(
    `Die Miete für Ihre Mietfläche setzt sich ab dem ${dateStr} wie folgt zusammen:`,
    { x: leftMargin, y, size: 10, font: fontBold, maxWidth }
  );
  y -= 20;

  const labelWidthRent = 260;

  const rentLines: Line[] = [];

  if (split_rent && indexable_rent != null && non_indexable_rent != null) {
    // Split-rent layout (Option A)
    const indexedDeltaAbs = +(indexable_rent * (applied_pct ?? 0)).toFixed(2);
    const indexedNewAbs = +(indexable_rent + indexedDeltaAbs).toFixed(2);

    rentLines.push({ label: "derzeitige Miete netto (gesamt)", value: oldStr, bold: true });
    rentLines.push({
      label: "  davon indexierbar",
      value: formatCurrencyDE(indexable_rent),
      bold: false,
    });
    rentLines.push({
      label: "  davon nicht indexierbar",
      value: formatCurrencyDE(non_indexable_rent),
      bold: false,
    });
    rentLines.push({
      label: `zzgl. Indexanpassung ${pctStr} (auf indexierbaren Teil)`,
      value: formatCurrencyDE(indexedDeltaAbs),
      bold: false,
    });
    rentLines.push({
      label: "indexierbarer Teil neu",
      value: formatCurrencyDE(indexedNewAbs),
      bold: false,
    });
    rentLines.push({
      label: "nicht indexierbarer Teil (unverändert)",
      value: formatCurrencyDE(non_indexable_rent),
      bold: false,
    });
    rentLines.push({
      label: "neue Miete netto (gesamt)",
      value: newStr,
      bold: true,
      lineAbove: true,
    });
  } else {
    // Standard layout
    const rentDeltaAbs = new_rent - old_rent;
    const deltaStr = formatCurrencyDE(rentDeltaAbs);

    rentLines.push({ label: "derzeitige Miete netto", value: oldStr, bold: true });
    rentLines.push({ label: `zzgl. Indexanpassung ${pctStr}`, value: deltaStr, bold: false });
    rentLines.push({ label: "neue Miete netto", value: newStr, bold: true });
  }

  if (newBruttoStr) {
    rentLines.push({ label: "MwSt", value: "19,0 %", bold: false });
    rentLines.push({
      label: "neue Miete brutto (19 % USt.)",
      value: newBruttoStr,
      bold: true,
      lineAbove: true,
    });
  }

  const lineEndX = leftMargin + width - leftMargin * 2 - 150;

  for (const { label, value, bold, lineAbove } of rentLines) {
    ensureSpace(140);
    if (lineAbove) {
      page.drawLine({
        start: { x: leftMargin, y: y + 12 },
        end: { x: lineEndX, y: y + 12 },
        thickness: 0.75,
        color: rgb(0, 0, 0),
      });
    }
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
  // Nebenkosten block
  // ---------------------------------------------------------------------------
  let ancNet: number | null = null;
  let ancGross: number | null = null;

  if (ancillary_current != null && Number.isFinite(ancillary_current)) {
    const finalAncNet =
      index_nebenkosten && ancillary_new != null && Number.isFinite(ancillary_new)
        ? ancillary_new
        : ancillary_current;

    const ancHas19 = is_gross_19 || ancillary_vat_rate === 19;

    ancNet = finalAncNet;
    ancGross = ancHas19 ? finalAncNet * 1.19 : finalAncNet;

    y -= 12;
    ensureSpace(180);

    page.drawText("Nebenkosten / Betriebskosten:", { x: leftMargin, y, size: 10, font: fontBold });
    y -= 18;

    const ancLines: Line[] = [];

    if (index_nebenkosten && ancillary_new != null && Number.isFinite(ancillary_new)) {
      const ancOldStr = formatCurrencyDE(ancillary_current);
      const ancDeltaAbs = ancillary_new - ancillary_current;
      const ancDeltaStr = formatCurrencyDE(ancDeltaAbs);
      const ancNewStr = formatCurrencyDE(ancillary_new);
      const ancPctStr = formatPercentDE1(ancillary_applied_pct);

      ancLines.push({ label: "derzeitige Nebenkosten netto", value: ancOldStr, bold: true });
      ancLines.push({ label: `zzgl. Indexanpassung ${ancPctStr}`, value: ancDeltaStr, bold: false });
      ancLines.push({ label: "neue Nebenkosten netto", value: ancNewStr, bold: true });

      if (ancHas19) {
        const ancNewBruttoStr = formatCurrencyDE(ancillary_new * 1.19);
        ancLines.push({ label: "MwSt", value: "19,0 %", bold: false });
        ancLines.push({
          label: "neue Nebenkosten brutto (19 % USt.)",
          value: ancNewBruttoStr,
          bold: true,
          lineAbove: true,
        });
      }
    } else {
      const ancNetStr = formatCurrencyDE(ancillary_current);
      ancLines.push({ label: "derzeitige Nebenkosten netto", value: ancNetStr, bold: true });

      if (ancHas19) {
        const ancBruttoStr = formatCurrencyDE(ancillary_current * 1.19);
        ancLines.push({ label: "MwSt", value: "19,0 %", bold: false });
        ancLines.push({
          label: "derzeitige Nebenkosten brutto (19 % USt.)",
          value: ancBruttoStr,
          bold: true,
          lineAbove: true,
        });
      }
    }

    for (const { label, value, bold, lineAbove } of ancLines) {
      ensureSpace(140);
      if (lineAbove) {
        page.drawLine({
          start: { x: leftMargin, y: y + 12 },
          end: { x: lineEndX, y: y + 12 },
          thickness: 0.75,
          color: rgb(0, 0, 0),
        });
      }
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
  // Heizkosten block
  // ---------------------------------------------------------------------------
  let heatNet: number | null = null;
  let heatGross: number | null = null;

  if (heating_current != null && Number.isFinite(heating_current)) {
    const finalHeatNet =
      index_heating && heating_new != null && Number.isFinite(heating_new)
        ? heating_new
        : heating_current;

    const heatHas19 = is_gross_19;

    heatNet = finalHeatNet;
    heatGross = heatHas19 ? finalHeatNet * 1.19 : finalHeatNet;

    y -= 12;
    ensureSpace(180);

    page.drawText("Heizkosten:", { x: leftMargin, y, size: 10, font: fontBold });
    y -= 18;

    const heatLines: Line[] = [];

    if (index_heating && heating_new != null && Number.isFinite(heating_new)) {
      const heatOldStr = formatCurrencyDE(heating_current);
      const heatDeltaAbs = heating_new - heating_current;
      const heatDeltaStr = formatCurrencyDE(heatDeltaAbs);
      const heatNewStr = formatCurrencyDE(heating_new);
      const heatPctStr = formatPercentDE1(heating_applied_pct);

      heatLines.push({ label: "derzeitige Heizkosten netto", value: heatOldStr, bold: true });
      heatLines.push({ label: `zzgl. Indexanpassung ${heatPctStr}`, value: heatDeltaStr, bold: false });
      heatLines.push({ label: "neue Heizkosten netto", value: heatNewStr, bold: true });

      if (heatHas19) {
        const heatNewBruttoStr = formatCurrencyDE(heating_new * 1.19);
        heatLines.push({ label: "MwSt", value: "19,0 %", bold: false });
        heatLines.push({
          label: "neue Heizkosten brutto (19 % USt.)",
          value: heatNewBruttoStr,
          bold: true,
          lineAbove: true,
        });
      }
    } else {
      const heatNetStr = formatCurrencyDE(heating_current);
      heatLines.push({ label: "derzeitige Heizkosten netto", value: heatNetStr, bold: true });

      if (heatHas19) {
        const heatBruttoStr = formatCurrencyDE(heating_current * 1.19);
        heatLines.push({ label: "MwSt", value: "19,0 %", bold: false });
        heatLines.push({
          label: "derzeitige Heizkosten brutto (19 % USt.)",
          value: heatBruttoStr,
          bold: true,
          lineAbove: true,
        });
      }
    }

    for (const { label, value, bold, lineAbove } of heatLines) {
      ensureSpace(140);
      if (lineAbove) {
        page.drawLine({
          start: { x: leftMargin, y: y + 12 },
          end: { x: lineEndX, y: y + 12 },
          thickness: 0.75,
          color: rgb(0, 0, 0),
        });
      }
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
  // TOTAL BOX
  // ---------------------------------------------------------------------------
  {
    const totalNet = new_rent + (ancNet ?? 0) + (heatNet ?? 0);
    const hasAny19 = is_gross_19 || ancillary_vat_rate === 19;
    const totalGross = hasAny19
      ? (newRentBrutto ?? new_rent) + (ancGross ?? 0) + (heatGross ?? 0)
      : null;

    const hasNK = ancNet != null;
    const hasHeat = heatNet != null;
    let totalLabel = "Gesamtmiete netto (Miete";
    if (hasNK) totalLabel += " + Nebenkosten";
    if (hasHeat) totalLabel += " + Heizkosten";
    totalLabel += ")";

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

    page.drawText(totalLabel, { x: boxLeftX + 10, y: yy, size: 10, font });
    page.drawText(formatCurrencyDE(totalNet), {
      x: boxLeftX + labelWidthRent,
      y: yy,
      size: 10,
      font: fontBold,
    });

    yy -= lineHeight;

    if (totalGross != null) {
      page.drawText("Gesamtmiete brutto", { x: boxLeftX + 10, y: yy, size: 10, font });
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
  // Closing
  // ---------------------------------------------------------------------------
  const closingLines = [
    "Für Rückfragen stehen wir Ihnen selbstverständlich gern zur Verfügung.",
    "",
    "Mit freundlichen Grüßen",
    "",
    `i.A. ${contact.name}`,
    "",
    "Dieses Schreiben wurde elektronisch erstellt und ist daher ohne Unterschrift gültig.",
  ];

  for (const line of closingLines) {
    ensureSpace(120);
    page.drawText(line, { x: leftMargin, y, size: 10, font });
    y -= 14;
  }

  return await pdfDoc.save();
}
