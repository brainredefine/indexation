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
        }>
      >("res.partner", "read", [[partnerId], ["name", "commercial_partner_id"]]);

      const partnerRec = partners?.[0];
      if (partnerRec) {
        let commercialId: number | null = null;
        if (partnerRec.commercial_partner_id && Array.isArray(partnerRec.commercial_partner_id)) {
          commercialId = partnerRec.commercial_partner_id[0];
        } else {
          commercialId = partnerRec.id;
        }

        if (commercialId) {
          const commercial = await odoo.executeKw<
            Array<{
              id: number;
              name?: string | null;
              street?: string | null;
              street2?: string | null;
              zip?: string | null;
              city?: string | null;
              country_id?: [number, string] | false | null;
            }>
          >("res.partner", "read", [
            [commercialId],
            ["name", "street", "street2", "zip", "city", "country_id"],
          ]);

          const comm = commercial?.[0];
          if (comm) {
            tenantName = comm.name ?? null;

            const countryName =
              comm.country_id && Array.isArray(comm.country_id) ? comm.country_id[1] : null;

            const addrParts = [
              comm.street,
              comm.street2,
              comm.zip,
              comm.city,
              countryName,
            ]
              .filter((v) => typeof v === "string" && v.trim() !== "")
              .join(", ");

            if (addrParts) tenantAddress = addrParts;
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // 4) Label pour PDF
    // ------------------------------------------------------------------
    let propertyLabelForPdf: string | null = null;
    if (tenancyRec.main_property_id && Array.isArray(tenancyRec.main_property_id)) {
      propertyLabelForPdf = String(tenancyRec.main_property_id[1] ?? tenancyRec.main_property_id[0]);
    }

    // ------------------------------------------------------------------
    // 5) TVA Loyer
    // ------------------------------------------------------------------
    let isGross19 = false;

    if (tenancyRec.rent_product_id && Array.isArray(tenancyRec.rent_product_id)) {
      const rentProdId = tenancyRec.rent_product_id[0];

      const rentProds = await odoo.executeKw<
        Array<{
          id: number;
          taxes_id?: number[] | false | null;
        }>
      >("product.product", "read", [[rentProdId], ["taxes_id"]]);

      const rentProd = rentProds?.[0];
      if (rentProd) {
        const taxIds = rentProd.taxes_id;
        if (Array.isArray(taxIds) && taxIds.length > 0) {
          const taxes = await odoo.executeKw<
            Array<{
              id: number;
              amount_type?: string | null;
              amount?: number | null;
            }>
          >("account.tax", "read", [taxIds, ["amount_type", "amount"]]);

          const tax19 = taxes.find(
            (t) => t.amount_type === "percent" && Math.abs((t.amount ?? 0) - 19) < 0.01
          );
          if (tax19) isGross19 = true;
        }
      }
    }

    // ------------------------------------------------------------------
    // 6) Ancillary costs
    // ------------------------------------------------------------------
    const ancillary_current =
      typeof tenancyRec.current_ancillary_costs === "number"
        ? tenancyRec.current_ancillary_costs
        : null;

    let ancillary_vat_rate: 0 | 19 | null = null;
    
    // On lit directement le nom du M2O ancillary_cost_type_id
    if (tenancyRec.ancillary_cost_type_id && Array.isArray(tenancyRec.ancillary_cost_type_id)) {
      const ancTypeName = String(tenancyRec.ancillary_cost_type_id[1] || "").toLowerCase();
      
      // On cherche "19" ou "0" dans le nom
      if (ancTypeName.includes("19")) {
        ancillary_vat_rate = 19;
      } else if (ancTypeName.includes("0") || ancTypeName.includes("zero")) {
        ancillary_vat_rate = 0;
      }
    }

    // ------------------------------------------------------------------
    // 7) Génération UUID de la tenancy
    // ------------------------------------------------------------------
    const tenancy_uuid = `${tenancy_id}`;

    const tenancyType = "residential";

    const last_index_date = monthKeyToDate(
      (ui_row?.adjustment_month_key as string | null) ??
        (ui_row?.adjustment_year_key as string | null) ??
        null
    );

    const current_index_date = monthKeyToDate(
      (ui_row?.current_month_key as string | null) ??
        (ui_row?.current_year_key as string | null) ??
        null
    );

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
    // 11) Générer + upload PDF (STORAGE) - ON NE BLOQUE PLUS SI ÇA FAIL
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

    // ⚠️ CHANGEMENT ICI : on tente l'upload mais on ne bloque plus
    let pdfUploadOk = false;
    let pdfUploadError: string | null = null;

    try {
      const { error: uploadErr } = await storageSupabase.storage
        .from("inbox")
        .upload(fileName, pdfBytes, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadErr) {
        console.error("Storage upload error:", uploadErr);
        pdfUploadError = uploadErr.message;
      } else {
        pdfUploadOk = true;
      }
    } catch (uploadCatchErr: any) {
      console.error("Storage upload exception:", uploadCatchErr);
      pdfUploadError = uploadCatchErr.message || String(uploadCatchErr);
    }

    // ------------------------------------------------------------------
    // 12) Odoo : update rent + adjustment_date (ON CONTINUE QUOI QU'IL ARRIVE)
    // ------------------------------------------------------------------
    let odooUpdateStatus = {
      rent_record_id: null as number | null,
      wrote_rent: false,
      wrote_adjustment_date: false,
      error: null as string | null,
    };

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
    }

    // ------------------------------------------------------------------
    // 13) Retour final avec tous les statuts
    // ------------------------------------------------------------------
    return NextResponse.json({
      ok: true,
      indexation_row_id: inserted.id,
      ind,
      pdf_upload_ok: pdfUploadOk,
      pdf_upload_error: pdfUploadError,
      pdf_file_name: fileName,
      payload_used: payload,
      property_data: propDebug,
      pdf_base64,
      odoo_update: odooUpdateStatus,
    });

  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}