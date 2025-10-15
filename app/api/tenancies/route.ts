// app/api/tenancies/route.ts
import { NextResponse } from "next/server";
import { OdooClient, OdooM2O, m2oId } from "@/lib/odoo";
import { germanIndexMonthly,germanIndexYearly } from "@/lib/indexationData";
import { parseToMonthKey, prevMonthKey, addMonths } from "@/lib/dateKeys";

type TenancyRec = {
  id: number;
  name?: string | null;
  main_property_id?: OdooM2O | false | null;
  indexing_rent?: number | null;
  current_rent?: number | null;  
  index_id?: OdooM2O | false | null;
  lock_date?: string | null;
  adjustment_period?: string | number | null;
  adjustment_date?: string | null;
  threshold?: number | null;                // décimal (ex 0.02)
  partially_passing_on?: number | boolean | null; // décimal ou bool
  maximal_percentage?: number | null;       // décimal (0 = pas de plafond)
  waiting_time?: number | null;             // en mois
};

type PropertySales = {
  id: number;
  sales_person_id?: OdooM2O | false | null;
};

type IndexKind = "VPI" | "VPI - Annual" | "VPI Automatic" | "VPI Automatic - Annual" | "Other";

export const dynamic = "force-dynamic";

// ---- helpers index ----
function detectIndexKind(name?: string | null): IndexKind {
  const n = (name || "").toLowerCase().trim();
  if (n === "vpi") return "VPI";
  if (n === "vpi - annual") return "VPI - Annual";
  if (n === "vpi automatic") return "VPI Automatic";
  if (n === "vpi automatic - annual") return "VPI Automatic - Annual";
  return "Other";
}

function getMonthlyIndex(key: string | null): number | null {
  if (!key) return null;
  return Number.isFinite(germanIndexMonthly[key]) ? germanIndexMonthly[key] : null;
}

function getAnnualIndex(yearStr: string | null): number | null {
  if (!yearStr) return null;
  return Number.isFinite(germanIndexYearly[yearStr]) ? germanIndexYearly[yearStr] : null;
}

function adjustmentYearKeyFromDateStr(d: string | null | undefined): string | null {
  if (!d) return null;
  const t = Date.parse(d);
  if (!Number.isNaN(t)) return String(new Date(t).getFullYear());
  // fallback si c'est déjà "MM/YYYY"
  const mk = parseToMonthKey(d);
  if (mk) return mk.split("/")[1] || null;
  return null;
}

function currentAnnualKey(now = new Date()): string {
  // on prend l'année du mois précédent
  const prev = new Date(now.getTime());
  prev.setMonth(prev.getMonth() - 1);
  return String(prev.getFullYear());
}

function toISODateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function coercePPP(v: number | boolean | null | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 1; // défaut
}

function capIncrease(val: number, cap?: number | null): number {
  if (!cap || cap <= 0) return val;
  return Math.min(val, cap);
}

export async function GET() {
  const odoo = new OdooClient();

  const fields = [
    "name",
    "main_property_id",
    "indexing_rent",
    "current_rent",
    "index_id",
    "lock_date",
    "adjustment_period",
    "adjustment_date",
    "threshold",
    "partially_passing_on",
    "maximal_percentage",
    "waiting_time",
  ] as const;

  const tenancies = await odoo.searchRead<TenancyRec>(
    "property.tenancy",
    [],
    fields as unknown as string[],
    20000
  );

  // Join sales_person_id
  const propIds = Array.from(
    new Set(tenancies.map((t) => m2oId(t.main_property_id)).filter((x): x is number => !!x))
  );

 // types utiles
type OdooM2O = [number, string];
interface PropertySales {
  id: number;
  sales_person_id?: OdooM2O | false | null;
}

const salesByProp = new Map<number, OdooM2O | null>(); // ← const OK (on mute la Map, pas la ref)
if (propIds.length > 0) {
  const props = await odoo.executeKw<PropertySales[]>(
    "property.property",
    "read",
    [propIds, ["sales_person_id"]]
  );
  for (const p of props) {
    const m2o = (p.sales_person_id ?? null) as OdooM2O | null;
    salesByProp.set(p.id, m2o);
  }
}


  // Contexte temps
  const now = new Date(); // Europe/Paris côté runtime
  const currentMonthKey = prevMonthKey(now);
  const currentAnnual = currentAnnualKey(now);
  const currentMonthlyIndex = getMonthlyIndex(currentMonthKey);
  const currentYearlyIndex = getAnnualIndex(currentAnnual);

  const items = tenancies.map((t) => {
    const mpId = m2oId(t.main_property_id);
    const sales = mpId ? salesByProp.get(mpId) ?? null : null;

    // 1) LOCK FILTER
    const lock = t.lock_date ? new Date(String(t.lock_date)) : null;
    const blockedByLock = !!(lock && lock >= now);
    if (blockedByLock) {
      return {
        ...baseOut(t, sales),
        blocked_by_lock: true,
        eligible_now: false,
        reason: "locked (lock_date >= today)",
      };
    }

    // 2) Quel index utiliser ?
    const indexName = Array.isArray(t.index_id) ? String(t.index_id[1]) : null;
    const kind = detectIndexKind(indexName);

    // 3) Récup indices (ajustement + courant) selon kind
    const adjMonthKey = parseToMonthKey(String(t.adjustment_date || "")); // pour logs
    const adjYearKey = adjustmentYearKeyFromDateStr(t.adjustment_date || null);

    let I_adj: number | null = null;
    let I_cur: number | null = null;

    if (kind === "VPI" || kind === "VPI Automatic") {
      I_adj = getMonthlyIndex(adjMonthKey);
      I_cur = currentMonthlyIndex;
    } else if (kind === "VPI - Annual" || kind === "VPI Automatic - Annual") {
      I_adj = getAnnualIndex(adjYearKey);
      I_cur = currentYearlyIndex;
    } else {
      // autres index -> pas de logique d’indexation gérée ici
      return {
        ...baseOut(t, sales),
        index_kind: "Other",
        adjustment_month_key: adjMonthKey,
        adjustment_year_key: adjYearKey,
        current_month_key: currentMonthKey,
        current_year_key: currentAnnual,
        eligible_now: false,
        reason: "index kind not handled",
      };
    }

    // 4) Pré-requis: adjustment_date
    const hasAdjDate = Boolean(t.adjustment_date);
    const waiting = Number(t.waiting_time ?? 0) || 0;
    const threshold = Number(t.threshold ?? 0) || 0;
    const ppp = coercePPP(t.partially_passing_on);
    const cap = t.maximal_percentage ?? 0;

    // Date d’échéance (adjustment_date + waiting_time mois)
    const adjDateObj = hasAdjDate ? new Date(String(t.adjustment_date)) : null;
    const waitUntil = adjDateObj ? addMonths(adjDateObj, waiting) : null;
    const waitReached = !!(waitUntil && waitUntil <= now);

    // 5) Delta
    const delta = I_adj && I_cur ? I_cur / I_adj - 1 : null;

    // 6) Logique Non-Automatic
    if (kind === "VPI" || kind === "VPI - Annual") {
      if (!hasAdjDate) {
        return {
          ...baseOut(t, sales),
          index_kind: kind,
          adjustment_month_key: adjMonthKey,
          adjustment_year_key: adjYearKey,
          current_month_key: currentMonthKey,
          current_year_key: currentAnnual,
          adjustment_index: I_adj,
          current_index: I_cur,
          eligible_now: false,
          reason: "no adjustment_date",
        };
      }
      if (!I_adj || !I_cur) {
        return {
          ...baseOut(t, sales),
          index_kind: kind,
          adjustment_month_key: adjMonthKey,
          adjustment_year_key: adjYearKey,
          current_month_key: currentMonthKey,
          current_year_key: currentAnnual,
          adjustment_index: I_adj,
          current_index: I_cur,
          eligible_now: false,
          reason: "missing index data",
        };
      }
      if (!waitReached) {
        return {
          ...baseOut(t, sales),
          index_kind: kind,
          adjustment_month_key: adjMonthKey,
          adjustment_year_key: adjYearKey,
          current_month_key: currentMonthKey,
          current_year_key: currentAnnual,
          adjustment_index: I_adj,
          current_index: I_cur,
          delta,
          eligible_now: false,
          next_wait_date: toISODateOnly(waitUntil),
          reason: "waiting_time not reached",
        };
      }
      // seuil
      if ((delta ?? 0) < threshold) {
        return {
          ...baseOut(t, sales),
          index_kind: kind,
          adjustment_month_key: adjMonthKey,
          adjustment_year_key: adjYearKey,
          current_month_key: currentMonthKey,
          current_year_key: currentAnnual,
          adjustment_index: I_adj,
          current_index: I_cur,
          delta,
          eligible_now: false,
          reason: "delta below threshold",
        };
      }
      // appliquer PPP + cap
      const applied = capIncrease((delta ?? 0) * ppp, cap);
      return {
        ...baseOut(t, sales),
        index_kind: kind,
        adjustment_month_key: adjMonthKey,
        adjustment_year_key: adjYearKey,
        current_month_key: currentMonthKey,
        current_year_key: currentAnnual,
        adjustment_index: I_adj,
        current_index: I_cur,
        delta,
        eligible_now: applied > 0,
        applied_percentage: applied,
      };
    }

    // 7) Logique Automatic
    if (!I_adj || !I_cur || !hasAdjDate) {
      return {
        ...baseOut(t, sales),
        index_kind: kind,
        adjustment_month_key: adjMonthKey,
        adjustment_year_key: adjYearKey,
        current_month_key: currentMonthKey,
        current_year_key: currentAnnual,
        adjustment_index: I_adj,
        current_index: I_cur,
        eligible_now: false,
        reason: "missing adjustment date or index",
      };
    }

    const thresholdHit = (delta ?? 0) >= threshold;
    let trigger = false;
    if (threshold === 0) {
      // purement par waiting time
      trigger = waitReached;
    } else {
      // premier des deux: attente OU seuil atteint
      trigger = waitReached || thresholdHit;
    }

    if (!trigger) {
      return {
        ...baseOut(t, sales),
        index_kind: kind,
        adjustment_month_key: adjMonthKey,
        adjustment_year_key: adjYearKey,
        current_month_key: currentMonthKey,
        current_year_key: currentAnnual,
        adjustment_index: I_adj,
        current_index: I_cur,
        delta,
        eligible_now: false,
        next_wait_date: toISODateOnly(waitUntil),
        reason: "automatic: neither wait nor threshold reached",
      };
    }

    const applied = capIncrease((delta ?? 0) * ppp, cap);
    return {
      ...baseOut(t, sales),
      index_kind: kind,
      adjustment_month_key: adjMonthKey,
      adjustment_year_key: adjYearKey,
      current_month_key: currentMonthKey,
      current_year_key: currentAnnual,
      adjustment_index: I_adj,
      current_index: I_cur,
      delta,
      eligible_now: applied > 0,
      applied_percentage: applied,
    };
  });

  return NextResponse.json({ count: items.length, items });

  function baseOut(t: TenancyRec, sales: OdooM2O | null) {
    const index_name = Array.isArray(t.index_id) ? String(t.index_id[1]) : null;
    return {
      id: t.id,
      name: t.name ?? null,
      main_property_id: t.main_property_id ?? null,
      sales_person_id: sales,
      indexing_rent: t.indexing_rent ?? null,
      current_rent: t.current_rent ?? null, 
      index_id: t.index_id ?? null,
      index_name,
      lock_date: t.lock_date ?? null,
      adjustment_period: t.adjustment_period ?? null,
      adjustment_date: t.adjustment_date ?? null,
      threshold: t.threshold ?? null,
      partially_passing_on: typeof t.partially_passing_on === "boolean"
        ? (t.partially_passing_on ? 1 : 0)
        : (t.partially_passing_on ?? 1),
      maximal_percentage: t.maximal_percentage ?? 0,
      waiting_time: t.waiting_time ?? 0,
      blocked_by_lock: false,
    };
  }
}
