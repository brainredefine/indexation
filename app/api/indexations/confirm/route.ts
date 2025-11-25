// app/api/indexations/confirm/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { OdooClient } from "@/lib/odoo";
import {
  generateIndexationPdf,
  IndexationPdfParams,
} from "@/lib/indexationPdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UiRow = Record<string, any> | null;

type Body = {
  tenancy_id?: number;
  old_rent?: number;
  new_rent?: number;
  applied_pct?: number | null;   // décimal
  effective_date?: string;       // "YYYY-MM-DD"
  comment?: string | null;
  ui_row?: UiRow;
  return_pdf?: boolean;
};

function getDataSupabase() {
  const url = process.env.SUPABASE_URL_DATA!;
  const key = process.env.SUPABASE_API_KEY_DATA!;
  if (!url || !key) {
    throw new Error("SUPABASE_URL_DATA / SUPABASE_API_KEY_DATA manquants");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function getStorageSupabase() {
  const url = process.env.SUPABASE_URL_STORAGE!;
  const key = process.env.SUPABASE_API_KEY_STORAGE!;
  if (!url || !key) {
    throw new Error("SUPABASE_URL_STORAGE / SUPABASE_API_KEY_STORAGE manquants");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function monthKeyToDate(mk?: string | null): string | null {
  if (!mk) return null;
  const [m, y] = mk.split("/");
  if (!m || !y) return null;
  if (!/^\d{2}$/.test(m) || !/^\d{4}$/.test(y)) return null;
  return `${y}-${m}-01`;
}

function addMonthsToFirstOfMonth(dateStr: string, months: number): string | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const base = new Date(Date.UTC(y, m, 1));
  base.setUTCMonth(base.getUTCMonth() + months);
  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

/** "AC01 - 09 - Deichmann" -> "9" */
function extractTenantNo(name?: string | null): string | null {
  if (!name) return null;
  const parts = name.split(" - ");
  if (parts.length < 2) return null;
  const raw = parts[1].trim();
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return String(num);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;

    const tenancy_id = Number(body.tenancy_id);
    const old_rent = Number(body.old_rent);
    const new_rent = Number(body.new_rent);
    const applied_pct = body.applied_pct ?? null;
    const effective_date = body.effective_date;
    const comment = body.comment ?? null;
    const ui_row = (body.ui_row ?? null) as UiRow;

    if (!Number.isFinite(tenancy_id) || tenancy_id <= 0) {
      return NextResponse.json({ ok: false, error: "tenancy_id invalide" }, { status: 400 });
    }
    if (!Number.isFinite(old_rent)) {
      return NextResponse.json({ ok: false, error: "old_rent invalide" }, { status: 400 });
    }
    if (!Number.isFinite(new_rent)) {
      return NextResponse.json({ ok: false, error: "new_rent invalide" }, { status: 400 });
    }
    if (!effective_date) {
      return NextResponse.json({ ok: false, error: "effective_date manquante" }, { status: 400 });
    }

    const dataSupabase = getDataSupabase();
    const storageSupabase = getStorageSupabase();
    const odoo = new OdooClient();

    const effDateObj = new Date(effective_date);
    const year = Number.isFinite(effDateObj.getTime())
      ? effDateObj.getUTCFullYear()
      : new Date().getUTCFullYear();

    // ------------------------------------------------------------------
    // 1) Lire property.tenancy (pour property, partner, vat rent, ancillary)
    // ------------------------------------------------------------------
    const tenancies = await odoo.executeKw<
      Array<{
        id: number;
        main_property_id?: [number, string] | false | null;
        partner_id?: [number, string] | false | null;
        rent_product_id?: [number, string] | false | null;
        name?: string | null;

        current_ancillary_costs?: number | null;
        ancillary_cost_type_id?: [number, string] | false | null;
      }>
    >("property.tenancy", "read", [
      [tenancy_id],
      [
        "main_property_id",
        "partner_id",
        "rent_product_id",
        "name",
        "current_ancillary_costs",
        "ancillary_cost_type_id",
      ],
    ]);

    const tenancyRec = tenancies?.[0];
    if (!tenancyRec) {
      return NextResponse.json({ ok: false, error: "Tenancy introuvable dans Odoo" }, { status: 404 });
    }

    const tenancyNameForTenantNo: string | null =
      tenancyRec.name ??
      (typeof ui_row?.name === "string" ? ui_row.name : null);

    let propertyId: number | null = null;
    if (tenancyRec.main_property_id && Array.isArray(tenancyRec.main_property_id)) {
      propertyId = tenancyRec.main_property_id[0];
    }

    // ------------------------------------------------------------------
    // 2) Lire property.property (fund, entity, slate_id, address asset)
    // ------------------------------------------------------------------
    let fund: string | null = null;
    let companyIdForInd: string | null = null;
    let entity: string | null = null;
    let slate_id: string | null = null;
    let property_id: string | null = null;
    let propertyAddress: string | null = null;
    let propDebug: any = null;

    if (propertyId != null) {
      const props = await odoo.executeKw<
        Array<{
          id: number;
          company_id?: [number, string] | false | null;
          entity_id?: [number, string] | false | null;
          reference_id?: string | null;
          internal_label?: string | null;
          street?: string | null;
          zip?: string | null;
          city?: string | null;
          country_id?: [number, string] | false | null;
        }>
      >("property.property", "read", [
        [propertyId],
        [
          "company_id",
          "entity_id",
          "reference_id",
          "internal_label",
          "street",
          "zip",
          "city",
          "country_id",
        ],
      ]);

      const p = props?.[0];
      if (p) {
        propDebug = p;
        property_id = String(p.id);

        if (p.company_id && Array.isArray(p.company_id)) {
          companyIdForInd = String(p.company_id[0]);
          fund = String(p.company_id[1] ?? p.company_id[0]);
        }

        if (p.entity_id && Array.isArray(p.entity_id)) {
          entity = String(p.entity_id[1] ?? p.entity_id[0]);
        }

        if (typeof p.reference_id === "string") {
          slate_id = p.reference_id;
        } else if (typeof p.internal_label === "string") {
          slate_id = p.internal_label;
        }

        const countryName =
          p.country_id && Array.isArray(p.country_id) ? p.country_id[1] : null;
        const parts = [p.street, p.zip, p.city, countryName]
          .filter((v) => typeof v === "string" && v.trim() !== "")
          .join(", ");
        if (parts) propertyAddress = parts;
      }
    }

    // ------------------------------------------------------------------
    // 3) Bridge locataire: partner_id -> res.partner -> commercial_partner
    // ------------------------------------------------------------------
    let tenantName: string | null = null;
    let tenantAddress: string | null = null;

    let partnerId: number | null = null;
    if (tenancyRec.partner_id && Array.isArray(tenancyRec.partner_id)) {
      partnerId = tenancyRec.partner_id[0];
    }

    if (partnerId != null) {
      const partners = await odoo.executeKw<
        Array<{
          id: number;
          name: string;
          commercial_partner_id?: [number, string] | false | null;
          street?: string | null;
          zip?: string | null;
          city?: string | null;
          country_id?: [number, string] | false | null;
        }>
      >("res.partner", "read", [
        [partnerId],
        [
          "name",
          "commercial_partner_id",
          "street",
          "zip",
          "city",
          "country_id",
        ],
      ]);

      const p = partners?.[0];
      if (p) {
        let cpId = p.id;
        let cpName: string | null = p.name;

        if (p.commercial_partner_id && Array.isArray(p.commercial_partner_id)) {
          cpId = p.commercial_partner_id[0];
          cpName = String(p.commercial_partner_id[1] ?? p.name);
        }

        const cpRes = await odoo.executeKw<
          Array<{
            id: number;
            name: string;
            street?: string | null;
            zip?: string | null;
            city?: string | null;
            country_id?: [number, string] | false | null;
          }>
        >("res.partner", "read", [
          [cpId],
          ["name", "street", "zip", "city", "country_id"],
        ]);

        const cp = cpRes?.[0];
        if (cp) {
          tenantName = cp.name ?? cpName ?? null;

          const cpCountry =
            cp.country_id && Array.isArray(cp.country_id)
              ? cp.country_id[1]
              : null;

          // Adresse multi-lignes naturelle
          const addrLines: string[] = [];
          if (cp.street && cp.street.trim()) addrLines.push(cp.street.trim());

          const zipCity = `${cp.zip ?? ""} ${cp.city ?? ""}`.trim();
          if (zipCity) addrLines.push(zipCity);

          if (cpCountry && cpCountry.trim()) addrLines.push(cpCountry.trim());

          if (addrLines.length > 0) {
            tenantAddress = addrLines.join("\n");
          }
        } else {
          tenantName = cpName;
        }
      }
    }

    // fallback tenantName si besoin
    if (!tenantName) {
      if (typeof ui_row?.tenant_name === "string") tenantName = ui_row.tenant_name;
      else if (typeof ui_row?.tenant === "string") tenantName = ui_row.tenant;
      else if (typeof ui_row?.name === "string") tenantName = ui_row.name;
      else tenantName = tenancyNameForTenantNo;
    }

    // ------------------------------------------------------------------
    // 4) Type d'index + labels PDF
    // ------------------------------------------------------------------
    let tenancyType: string | null = null;
    if (typeof ui_row?.index_name === "string") tenancyType = ui_row.index_name;

    let propertyLabelForPdf: string | null = null;
    if (Array.isArray(ui_row?.main_property_id)) {
      propertyLabelForPdf = `${ui_row!.main_property_id[0]} — ${ui_row!.main_property_id[1]}`;
    } else if (tenancyRec.main_property_id && Array.isArray(tenancyRec.main_property_id)) {
      propertyLabelForPdf = `${tenancyRec.main_property_id[0]} — ${tenancyRec.main_property_id[1]}`;
    }

    // ------------------------------------------------------------------
    // 5) VAT rent brutto condition
    // ------------------------------------------------------------------
    let isGross19 = false;
    if (tenancyRec.rent_product_id && Array.isArray(tenancyRec.rent_product_id)) {
      const label = tenancyRec.rent_product_id[1];
      if (label === "Miete Gewerblich 19%") isGross19 = true;
    }

    // ------------------------------------------------------------------
    // 6) Ancillary costs (services charges)
    // ------------------------------------------------------------------
    const ancillary_current =
      typeof tenancyRec.current_ancillary_costs === "number"
        ? tenancyRec.current_ancillary_costs
        : null;

    let ancillary_vat_rate: 19 | 0 | null = null;
    if (tenancyRec.ancillary_cost_type_id && Array.isArray(tenancyRec.ancillary_cost_type_id)) {
      const label = tenancyRec.ancillary_cost_type_id[1] ?? "";
      if (label.includes("19%")) ancillary_vat_rate = 19;
      else if (label.includes("0%")) ancillary_vat_rate = 0;
    }

    // ------------------------------------------------------------------
    // 7) Champs temps / seuil / next date / fin contrat (depuis ui_row)
    // ------------------------------------------------------------------
    const tenancy_uuid =
      (ui_row && typeof ui_row.uuid === "string" && ui_row.uuid) ||
      String(tenancy_id);

    const last_index_date =
      (ui_row?.adjustment_date as string | null) ?? null;

    const current_index_date =
      monthKeyToDate((ui_row?.adjustment_month_key as string | null) ?? null) ??
      (ui_row?.current_year_key ? `${ui_row.current_year_key}-01-01` : null);

    const pause_between_indexation =
      typeof ui_row?.waiting_time === "number" ? ui_row.waiting_time : null;

    let next_possible_indexation_date: string | null = null;
    if (effective_date && pause_between_indexation != null && Number.isFinite(pause_between_indexation)) {
      next_possible_indexation_date = addMonthsToFirstOfMonth(effective_date, pause_between_indexation);
    } else {
      next_possible_indexation_date = (ui_row?.next_wait_date as string | null) ?? null;
    }

    const end_of_contract =
      (ui_row?.date_end_display as string | null) ?? null;

    // ------------------------------------------------------------------
    // 8) Insert DATA Supabase (pas d'upload Odoo)
    // ------------------------------------------------------------------
    const payload = {
      tenancy_uuid,
      fund,
      entity,
      slate_id,
      property_id,
      address: propertyAddress ?? null, // adresse du bien pour DATA
      tenant: tenantName,
      type: tenancyType,

      rent_before_indexation: old_rent,
      rent_after_indexation: new_rent,

      last_index_date,
      last_index_score:
        typeof ui_row?.adjustment_index === "number" ? ui_row.adjustment_index : null,
      current_index_date,
      current_index_score:
        typeof ui_row?.current_index === "number" ? ui_row.current_index : null,

      indexation_trigger: ui_row?.reason ?? null,
      threshold: typeof ui_row?.threshold === "number" ? ui_row.threshold : null,
      pause_between_indexation,
      percent_increase: typeof ui_row?.delta === "number" ? ui_row.delta : null,
      percent_applied: applied_pct,
      adjustment_period: ui_row?.adjustment_period ?? null,

      next_possible_indexation_date,
      end_of_contract,
      indexation_comment: comment,
      effective_date,

      company_id: companyIdForInd,
      year,
    };

    const { data: inserted, error: insErr } = await dataSupabase
      .from("indexations")
      .insert(payload)
      .select("*")
      .single();

    if (insErr) {
      console.error("DATA insert error:", insErr);
      return NextResponse.json({ ok: false, error: "insert indexations échoué" }, { status: 500 });
    }

    const ind = (inserted as any).ind as string | null;

    // ------------------------------------------------------------------
    // 9) Nom fichier PDF
    // ------------------------------------------------------------------
    const tenantNo = extractTenantNo(tenancyNameForTenantNo ?? null) ?? "0";
    const ttype = `1.7.6.${tenantNo}`;
    const tasset = slate_id ?? "UNKNOWN";
    const tname = "Indexation%20Letter";
    const tscope = "asset";
    const tdate = effective_date;
    const tmail = "automatic";

    const fileName =
      `m(ttype=${ttype})` +
      `(tasset=${encodeURIComponent(tasset)})` +
      `(tname=${tname})` +
      `(tscope=${tscope})` +
      `(tdate=${tdate})` +
      `(tmail=${tmail}).pdf`;

    // ------------------------------------------------------------------
    // 10) Données index pour le PDF
    // ------------------------------------------------------------------
    const index_prev_value =
      typeof ui_row?.adjustment_index === "number" ? ui_row.adjustment_index : null;
    const index_cur_value =
      typeof ui_row?.current_index === "number" ? ui_row.current_index : null;

    const index_prev_label =
      (ui_row?.adjustment_month_key as string | null) ??
      (ui_row?.adjustment_year_key as string | null) ??
      null;

    const index_cur_label =
      (ui_row?.current_month_key as string | null) ??
      (ui_row?.current_year_key as string | null) ??
      null;

    const index_delta =
      typeof ui_row?.delta === "number" ? ui_row.delta : null;

    // ------------------------------------------------------------------
    // 11) Générer + upload PDF (STORAGE)
    // ------------------------------------------------------------------
    const pdfParams: IndexationPdfParams = {
      ind,
      tenancy_id,
      tenant: tenantName,
      property_label: propertyLabelForPdf,
      address: tenantAddress, // adresse locataire
      old_rent,
      new_rent,
      applied_pct: applied_pct as number | null,
      effective_date,

      index_prev_value,
      index_prev_label,
      index_cur_value,
      index_cur_label,
      index_delta,

      is_gross_19: isGross19,

      ancillary_current,
      ancillary_vat_rate,
    };

    const pdfBytes = await generateIndexationPdf(pdfParams);

    // ✅ si on veut renvoyer le pdf au client
    const wantPdf = Boolean(body.return_pdf);

    let pdf_base64: string | null = null;
    if (wantPdf) {
    // Node runtime: Buffer dispo
    pdf_base64 = Buffer.from(pdfBytes).toString("base64");
    }

    const { error: uploadErr } = await storageSupabase.storage
      .from("inbox")
      .upload(fileName, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    
    // Définition des variables de résultat Odoo ici pour qu'elles existent même si l'upload PDF fail
    let odooUpdateStatus = {
        rent_record_id: null as number | null,
        wrote_rent: false,
        wrote_adjustment_date: false,
        error: null as string | null
    };

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      // On retourne erreur PDF mais on ne fait pas l'update Odoo si PDF fail ? 
      // Ou on tente quand meme ? Généralement si le PDF fail, mieux vaut ne pas toucher à Odoo pour retenter
      return NextResponse.json({
        ok: true,
        indexation_row_id: inserted.id,
        ind,
        pdf_upload_ok: false,
        pdf_upload_error: uploadErr.message,
        pdf_file_name: fileName,
        payload_used: payload,
        property_data: propDebug,
        pdf_base64,
        ...odooUpdateStatus // pas d'update odoo
      });
    }

    // ------------------------------------------------------------------
    // 12) Odoo : update rent + adjustment_date (PARTIE AJOUTÉE)
    // ------------------------------------------------------------------
    try {
        const rentIds = await odoo.executeKw<number[]>(
            "property.rent",
            "search",
            [[["tenancy_id", "=", tenancy_id]]],
            { order: "id desc", limit: 1 }
        );

        if (Array.isArray(rentIds) && rentIds.length > 0) {
            const rentId = rentIds[0];
            odooUpdateStatus.rent_record_id = rentId;

            odooUpdateStatus.wrote_rent = await odoo.executeKw<boolean>(
                "property.rent",
                "write",
                [[rentId], { rent: new_rent }]
            );
        } else {
            console.warn(`Odoo: property.rent introuvable pour tenancy_id ${tenancy_id}`);
        }

        odooUpdateStatus.wrote_adjustment_date = await odoo.executeKw<boolean>(
            "property.tenancy",
            "write",
            [[tenancy_id], { adjustment_date: effective_date }]
        );

    } catch (err: any) {
        console.error("Erreur lors de la mise à jour Odoo:", err);
        odooUpdateStatus.error = err.message || String(err);
        // On ne bloque pas le retour "ok: true" car le PDF et la BDD sont OK, 
        // mais le front saura qu'il y a eu un souci Odoo
    }

    return NextResponse.json({
      ok: true,
      indexation_row_id: inserted.id,
      ind,
      pdf_upload_ok: true,
      pdf_file_name: fileName,
      payload_used: payload,
      property_data: propDebug,
      pdf_base64,
      // Infos Odoo ajoutées à la réponse
      odoo_update: odooUpdateStatus
    });

  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}