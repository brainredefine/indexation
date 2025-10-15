// app/api/update-rent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { OdooClient } from "@/lib/odoo";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Renvoie "YYYY-MM-01" du mois suivant (UTC) */
function firstDayOfNextMonthUTC(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0..11
  const next = new Date(Date.UTC(y, m + 1, 1));
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

type UiRow = Record<string, unknown> | null;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      tenancy_id?: unknown;
      new_rent?: unknown;
      ui_row?: UiRow;
    };

    const tenancy_id = Number(body?.tenancy_id);
    const new_rent = Number(body?.new_rent);
    const ui_row: UiRow = body?.ui_row ?? null;

    if (!Number.isFinite(tenancy_id) || tenancy_id <= 0) {
      return NextResponse.json({ ok: false, error: "tenancy_id invalide" }, { status: 400 });
    }
    if (!Number.isFinite(new_rent) || new_rent < 0) {
      return NextResponse.json({ ok: false, error: "new_rent invalide" }, { status: 400 });
    }

    const odoo = new OdooClient();

    // 0) Lire l’ancienne adjustment_date
    const tenRead = await odoo.executeKw<Array<{ id: number; adjustment_date: string | null }>>(
      "property.tenancy",
      "read",
      [[tenancy_id], ["adjustment_date"]]
    );
    const last_adjustment_prev: string | null = tenRead?.[0]?.adjustment_date ?? null;

    // 1) Dernier property.rent de la tenancy
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

    // 2) Lire ancien rent
    const rentRec = await odoo.executeKw<Array<{ id: number; rent: number | null }>>(
      "property.rent",
      "read",
      [[rentId], ["rent"]]
    );
    const old_rent = rentRec?.[0]?.rent ?? null;

    // 3) Write nouveau rent
    const wrote_rent = await odoo.executeKw<boolean>(
      "property.rent",
      "write",
      [[rentId], { rent: new_rent }]
    );

    // 4) MAJ last_adjustment_date -> 1er du mois suivant
    const last_adjustment_new = firstDayOfNextMonthUTC();
    const wrote_adjustment_date = await odoo.executeKw<boolean>(
      "property.tenancy",
      "write",
      [[tenancy_id], { adjustment_date: last_adjustment_new }]
    );

    // 5) Tracker Supabase
    const supabase = getServerSupabase();

    // AM depuis la ligne UI si disponible
    const am_id =
      ui_row && Array.isArray((ui_row as Record<string, unknown>)["sales_person_id"])
        ? (ui_row as Record<string, [number, string]>)["sales_person_id"]?.[0] ?? null
        : null;
    const am_name =
      ui_row && Array.isArray((ui_row as Record<string, unknown>)["sales_person_id"])
        ? (ui_row as Record<string, [number, string]>)["sales_person_id"]?.[1] ?? null
        : null;

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
      payload,
    });
    if (insErr) {
      // on loggue mais on ne fail pas l’opération principale
      // eslint-disable-next-line no-console
      console.error("Supabase insert error:", insErr);
    }

    return NextResponse.json({
      ok: true,
      tenancy_id,
      rent_record_id: rentId,
      wrote_rent,
      wrote_adjustment_date,
      old_rent,
      new_rent,
      delta_abs,
      delta_pct,
      last_adjustment_prev,
      last_adjustment_new,
      am_id,
      am_name,
    });
  } catch (e: unknown) {
    // eslint-disable-next-line no-console
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
