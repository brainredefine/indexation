// app/[am]/ClientTable.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";

type M2O = [number, string] | null;

type TenancyRow = {
  id: number;
  name: string | null;
  main_property_id: M2O;
  sales_person_id: M2O;
  indexing_rent: number | null;
  current_rent: number | null; // OLD RENT
  index_id: M2O;
  index_name: string | null;
  lock_date: string | null;
  adjustment_period: string | number | null;
  adjustment_date: string | null;
  threshold: number | null;
  partially_passing_on: number;
  maximal_percentage: number;
  waiting_time: number;

  adjustment_month_key?: string | null;
  adjustment_year_key?: string | null;
  current_month_key?: string | null;
  current_year_key?: string | null;
  adjustment_index?: number | null;
  current_index?: number | null;
  delta?: number | null;
  eligible_now?: boolean;
  applied_percentage?: number | null;
  next_wait_date?: string | null;
  blocked_by_lock?: boolean;
  reason?: string;
  index_kind?: string;
};

type ApiPayload = {
  count: number;
  items: TenancyRow[];
  ref_month?: string;
  ref_year?: string;
};

const AM_UID: Record<string, number> = { BKO: 8, CFR: 12, FKE: 7, MSC: 9 };

const cls = (...s: (string | false | undefined)[]) => s.filter(Boolean).join(" ");

const fmtPct = (x: number | null | undefined, decimals: number = 2) =>
  x == null ? "\u2014" : `${(x * 100).toFixed(decimals)}%`;

const m2oName = (v: M2O) => (v && v[1]) || "\u2014";

const fmtMoney = (n: number | null | undefined) =>
  n == null
    ? "\u2014"
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 2,
      }).format(n);

// ---- Build month options from 01/2020 to now ----
function buildMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1; // 1-based

  for (let y = 2020; y <= endYear; y++) {
    const mMax = y === endYear ? endMonth : 12;
    for (let m = 1; m <= mMax; m++) {
      const mm = String(m).padStart(2, "0");
      const key = `${mm}/${y}`;
      const label = `${mm}/${y}`;
      options.push({ value: key, label });
    }
  }
  return options.reverse(); // most recent first
}

const MONTH_OPTIONS = buildMonthOptions();

/** Default ref month = previous month */
function defaultRefMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mm = String(prev.getMonth() + 1).padStart(2, "0");
  return `${mm}/${prev.getFullYear()}`;
}

export default function ClientTable({ amSlug }: { amSlug: string }) {
  const isNoAM = amSlug === "NO-AM";

  const [data, setData] = useState<TenancyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // ---- Reference month selector ----
  const [refMonth, setRefMonth] = useState<string>(defaultRefMonth);
  // Track what the API actually used (echoed back)
  const [activeRefMonth, setActiveRefMonth] = useState<string>("");

  const refresh = useCallback(async (monthKey?: string) => {
    const params = new URLSearchParams();
    const mk = monthKey ?? refMonth;
    if (mk) {
      params.set("refMonth", mk);
      const yearPart = mk.split("/")[1];
      if (yearPart) params.set("refYear", yearPart);
    }
    const qs = params.toString();
    const url = `/api/tenancies${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    const json: ApiPayload = await res.json();
    setData(json.items || []);
    if (json.ref_month) setActiveRefMonth(json.ref_month);
  }, [refMonth]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch (e: unknown) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when refMonth changes (after initial load)
  const handleRefMonthChange = async (newMonth: string) => {
    setRefMonth(newMonth);
    setLoading(true);
    try {
      await refresh(newMonth);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const rows = useMemo(() => {
    const byAM = isNoAM
      ? data
      : data.filter((r) => r.sales_person_id && r.sales_person_id[0] === AM_UID[amSlug]);
    const filtered = onlyEligible ? byAM.filter((r) => r.eligible_now) : byAM;
    return [...filtered].sort((a, b) => {
      const ea = a.eligible_now ? 1 : 0;
      const eb = b.eligible_now ? 1 : 0;
      if (eb - ea !== 0) return eb - ea;
      const da = a.delta ?? -Infinity;
      const db = b.delta ?? -Infinity;
      return db - da;
    });
  }, [data, amSlug, isNoAM, onlyEligible]);

  const eligibleCount = useMemo(() => data.filter((r) => r.eligible_now).length, [data]);

  const calcNewRent = (r: TenancyRow) => {
    if (r.current_rent == null || r.applied_percentage == null) return null;
    return +(r.current_rent * (1 + r.applied_percentage)).toFixed(2);
  };

  const canUpdate = (r: TenancyRow) =>
    Boolean(
      r.eligible_now &&
        r.current_rent != null &&
        r.applied_percentage != null &&
        calcNewRent(r) != null
    );

  const handleOpenIndexation = (r: TenancyRow) => {
    if (!canUpdate(r)) return;
    setBusyId(r.id);

    const base = `/indexations/${r.id}`;
    const params = new URLSearchParams();
    if (amSlug) params.set("am", amSlug);
    if (refMonth) params.set("refMonth", refMonth);
    const qs = params.toString();
    const url = qs ? `${base}?${qs}` : base;

    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => setBusyId(null), 1500);
  };

  // Spinner SVG
  const Spinner = () => (
    <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );

  return (
    <main className="min-h-screen w-full bg-[#f5f6f8]">
      {/* ── Sticky top bar ── */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-200">
        <div className="max-w-[1800px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Left: title + stats */}
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-900">
              Indexations
            </h1>
            <div className="h-4 w-px bg-gray-200" />
            <span className="text-xs text-gray-500 font-medium">
              {isNoAM ? "All tenancies" : amSlug}
            </span>
            {!loading && (
              <>
                <div className="h-4 w-px bg-gray-200" />
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                  {rows.length} shown
                </span>
                {eligibleCount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    {eligibleCount} eligible
                  </span>
                )}
              </>
            )}
          </div>

          {/* Right: controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Reference month */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400 uppercase tracking-wide font-medium">Ref</span>
              <select
                value={refMonth}
                onChange={(e) => handleRefMonthChange(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition shadow-sm"
              >
                {MONTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {activeRefMonth && activeRefMonth !== refMonth && (
                <span className="text-[10px] text-amber-600 font-mono">
                  API: {activeRefMonth}
                </span>
              )}
            </div>

            <div className="h-4 w-px bg-gray-200" />

            {/* Eligible filter toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-[11px] text-gray-500">Only indexable</span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={onlyEligible}
                  onChange={(e) => setOnlyEligible(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-8 h-[18px] bg-gray-200 rounded-full peer-checked:bg-gray-900 transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-[14px] h-[14px] bg-white rounded-full shadow-sm peer-checked:translate-x-[14px] transition-transform" />
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-[1800px] mx-auto px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-sm text-gray-400">
            <Spinner />
            Loading tenancies…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="mb-3 text-gray-300">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-sm">No tenancies to display.</p>
            {onlyEligible && (
              <button
                onClick={() => setOnlyEligible(false)}
                className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
              >
                Show all tenancies
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
            <table
              className="w-full text-sm tabular-nums"
              style={{ borderCollapse: "separate", borderSpacing: 0 }}
            >
              <thead>
                <tr>
                  {[
                    { label: "", w: "w-[52px]" },          // status dot
                    { label: "Asset", w: "min-w-[220px]" },
                    { label: "Tenant", w: "min-w-[160px]" },
                    { label: "Index", w: "" },
                    { label: "Threshold", w: "" },
                    { label: "Lock", w: "" },
                    { label: "Last Adj.", w: "min-w-[100px]" },
                    { label: "Wait", w: "w-[50px]" },
                    { label: "Idx prev", w: "" },
                    { label: "Idx curr", w: "" },
                    { label: "\u0394", w: "w-[70px]" },
                    { label: "Pass-Thru", w: "" },
                    { label: "Cap", w: "" },
                    { label: "Applied", w: "" },
                    { label: "Old rent", w: "" },
                    { label: "New rent", w: "" },
                    { label: "", w: "min-w-[140px]" },     // action
                    { label: "Reason", w: "min-w-[240px]" },
                  ].map(({ label, w }, i) => (
                    <th
                      key={i}
                      className={cls(
                        "sticky top-0 z-10 text-left text-[10px] font-semibold uppercase tracking-wider py-2.5 px-2.5",
                        "bg-gray-50 text-gray-400 border-b border-gray-200",
                        w
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {rows.map((r, idx) => {
                  const newRent = calcNewRent(r);
                  const eligible = !!r.eligible_now;

                  return (
                    <tr
                      key={r.id}
                      className={cls(
                        "group border-b border-gray-100 last:border-b-0 transition-colors",
                        eligible
                          ? "hover:bg-emerald-50/40"
                          : "hover:bg-gray-50/60"
                      )}
                    >
                      {/* Status dot */}
                      <td className="py-2.5 px-2.5 text-center">
                        <span
                          className={cls(
                            "inline-block w-2 h-2 rounded-full",
                            eligible ? "bg-emerald-500" : "bg-gray-300"
                          )}
                          title={eligible ? "Eligible" : "Not eligible"}
                        />
                      </td>

                      {/* Asset */}
                      <td
                        className="py-2.5 px-2.5 text-[12px] text-gray-700 max-w-[280px] truncate"
                        title={m2oName(r.main_property_id)}
                      >
                        {m2oName(r.main_property_id)}
                      </td>

                      {/* Tenant */}
                      <td
                        className="py-2.5 px-2.5 text-[12px] text-gray-900 font-medium max-w-[180px] truncate"
                        title={r.name || undefined}
                      >
                        {r.name ?? "\u2014"}
                      </td>

                      {/* Index */}
                      <td className="py-2.5 px-2.5 text-[12px] text-gray-500 whitespace-nowrap">
                        {r.index_name ?? "\u2014"}
                      </td>

                      {/* Threshold */}
                      <td className="py-2.5 px-2.5 text-[12px] text-gray-500">
                        {fmtPct(r.threshold ?? null, 0)}
                      </td>

                      {/* Lock */}
                      <td className="py-2.5 px-2.5 text-[12px] text-gray-500">
                        {r.lock_date ?? "\u2014"}
                      </td>

                      {/* Last adj */}
                      <td
                        className="py-2.5 px-2.5 text-[12px] text-gray-500 whitespace-nowrap font-mono"
                        title={r.adjustment_month_key || r.adjustment_year_key || r.adjustment_date || undefined}
                      >
                        {r.adjustment_month_key || r.adjustment_year_key || "\u2014"}
                      </td>

                      {/* Wait */}
                      <td className="py-2.5 px-2.5 text-[12px] text-gray-500 text-center">
                        {r.waiting_time ?? 0}
                      </td>

                      {/* Idx prev */}
                      <td className="py-2.5 px-2.5 text-[12px] text-gray-500 font-mono">
                        {r.adjustment_index ?? "\u2014"}
                      </td>

                      {/* Idx curr */}
                      <td className="py-2.5 px-2.5 text-[12px] text-gray-500 font-mono">
                        {r.current_index ?? "\u2014"}
                      </td>

                      {/* Delta */}
                      <td
                        className={cls(
                          "py-2.5 px-2.5 text-[12px] font-semibold font-mono",
                          (r.delta ?? 0) > 0
                            ? "text-emerald-600"
                            : (r.delta ?? 0) < 0
                            ? "text-red-500"
                            : "text-gray-400"
                        )}
                      >
                        {fmtPct(r.delta ?? null)}
                      </td>

                      {/* Pass-through */}
                      <td className="py-2.5 px-2.5 text-[12px] text-gray-500">
                        {fmtPct(r.partially_passing_on ?? null, 0)}
                      </td>

                      {/* Cap */}
                      <td className="py-2.5 px-2.5 text-[12px] text-gray-500">
                        {fmtPct((r.maximal_percentage ?? 0) || null)}
                      </td>

                      {/* Applied */}
                      <td className="py-2.5 px-2.5 text-[12px] font-semibold text-gray-900 font-mono">
                        {fmtPct(r.applied_percentage ?? null)}
                      </td>

                      {/* Old rent */}
                      <td className="py-2.5 px-2.5 text-[12px] text-gray-500 font-mono whitespace-nowrap">
                        {fmtMoney(r.current_rent)}
                      </td>

                      {/* New rent */}
                      <td className="py-2.5 px-2.5 text-[12px] font-medium text-gray-900 font-mono whitespace-nowrap">
                        {fmtMoney(newRent)}
                      </td>

                      {/* Action */}
                      <td className="py-2.5 px-2.5">
                        <button
                          type="button"
                          onClick={() => handleOpenIndexation(r)}
                          disabled={!canUpdate(r) || busyId === r.id}
                          className={cls(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition shadow-sm",
                            canUpdate(r)
                              ? "bg-gray-900 text-white hover:bg-gray-800"
                              : "bg-gray-100 text-gray-400 cursor-default",
                            "disabled:opacity-40"
                          )}
                        >
                          {busyId === r.id ? (
                            <>
                              <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Opening…
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              Indexation
                            </>
                          )}
                        </button>
                      </td>

                      {/* Reason */}
                      <td className="py-2.5 px-2.5 text-[11px] text-gray-400 whitespace-normal">
                        <div className="leading-tight space-y-0.5">
                          <span className="font-mono text-[10px] text-gray-300">
                            {r.current_month_key || r.current_year_key || ""}
                          </span>
                          {r.reason && (
                            <p className="text-gray-400">{r.reason}</p>
                          )}
                          {r.next_wait_date && (
                            <p className="font-mono text-[10px] text-gray-300">
                              next: {r.next_wait_date}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}