// app/api/update-rent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { OdooClient } from "@/lib/odoo";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Renvoie "YYYY-MM-01" du mois suivant la date "now" (UTC) */
function firstDayOfNextMonthUTC(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0..11
  const next = new Date(Date.UTC(y, m + 1, 1)); // 1er du mois suivant en UTC
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenancy_id = Number(body?.tenancy_id);
    const new_rent = Number(body?.new_rent);
    const ui_row = body?.ui_row ?? null; // on logge tout

    if (!tenancy_id || !Number.isFinite(tenancy_id)) {
      return NextResponse.json({ ok: false, error: "tenancy_id invalide" }, { status: 400 });
    }
    if (!Number.isFinite(new_rent) || new_rent < 0) {
      return NextResponse.json({ ok: false, error: "new_rent invalide" }, { status: 400 });
    }

    const odoo = new OdooClient();

    // ---- 0) Lire l'ancienne adjustment_date sur la tenancy
    const tenRead = await odoo.executeKw<Array<{ id: number; adjustment_date: string | null }>>(
      "property.tenancy",
      "read",
      [[tenancy_id], ["adjustment_date"]]
    );
    const last_adjustment_prev: string | null = tenRead?.[0]?.adjustment_date ?? null;

    // ---- 1) Trouver le dernier property.rent lié à cette tenancy
    const rentIds = await odoo.executeKw<number[]>(
      "property.rent",
      "search",
      [[["tenancy_id", "=", tenancy_id]]],
      { order: "id desc", limit: 1 }
    );
    if (!Array.isArray(rentIds) || rentIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "property.rent introuvable pour cette tenancy" },
        { status: 404 }
      );
    }
    const rentId = rentIds[0];

    // ---- 2) Lire l'ancien rent pour tracker
    const rentRec = await odoo.executeKw<Array<{ id: number; rent: number | null }>>(
      "property.rent",
      "read",
      [[rentId], ["rent"]]
    );
    const old_rent = rentRec?.[0]?.rent ?? null;

    // ---- 3) Write du nouveau rent
    const wroteRent = await odoo.executeKw<boolean>(
      "property.rent",
      "write",
      [[rentId], { rent: new_rent }]
    );

    // ---- 4) Mettre à jour la last_adjustment_date = 1er du mois suivant
    const last_adjustment_new = firstDayOfNextMonthUTC();
    const wroteAdj = await odoo.executeKw<boolean>(
      "property.tenancy",
      "write",
      [[tenancy_id], { adjustment_date: last_adjustment_new }]
    );

    // ---- 5) Tracker Supabase (avec AM + opérateur + payload complet + dates prev/new)
    const supabase = getServerSupabase();

    const am_id = ui_row?.sales_person_id?.[0] ?? null;
    const am_name = ui_row?.sales_person_id?.[1] ?? null;

    const delta_abs =
      Number.isFinite(old_rent) && old_rent != null ? +(new_rent - Number(old_rent)).toFixed(2) : null;
    const delta_pct =
      Number.isFinite(old_rent) && old_rent != null && Number(old_rent) > 0
        ? +((new_rent / Number(old_rent)) - 1).toFixed(6)
        : null;

    const by_user_email = process.env.ODOO_USER ?? null;
    const by_user_uuid = process.env.ODOO_USER_UUID ?? null;

    const payload = {
      ...ui_row,
      tracker_meta: {
        at: new Date().toISOString(),
        am_id,
        am_name,
        by_user_email,
        by_user_uuid,
        last_adjustment_prev,
        last_adjustment_new,
      },
    };

    const { error: insErr } = await supabase.from("rent_updates").insert({
      tenancy_id,
      rent_record_id: rentId,
      old_rent,
      new_rent,
      delta_abs,
      delta_pct,
      am_id,
      am_name,
      by_user_email,
      by_user_uuid,
      payload, // 👈 contient last_adjustment_prev/new + row UI complète
    });
    if (insErr) console.error("Supabase insert error:", insErr);

    return NextResponse.json({
      ok: true,
      tenancy_id,
      rent_record_id: rentId,
      wrote_rent: wroteRent,
      wrote_adjustment_date: wroteAdj,
      old_rent,
      new_rent,
      delta_abs,
      delta_pct,
      last_adjustment_prev,
      last_adjustment_new, // 👈 renvoyé aussi dans la réponse
      am_id,
      am_name,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
