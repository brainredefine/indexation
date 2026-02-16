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

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cls(
        "text-left text-[12px] uppercase tracking-wide py-2.5 px-2",
        "bg-gray-100",
        "text-gray-900",
        "border-b border-gray-300",
        className
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td
      className={cls(
        "py-3 px-2 align-top text-[13px] text-gray-900",
        className
      )}
      title={title}
    >
      {children}
    </td>
  );
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
      // Also derive refYear from the month key
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
    // Reset busyId after a short delay (window.open is non-blocking)
    setTimeout(() => setBusyId(null), 1500);
  };

  return (
    <main className="p-6 w-full bg-gray-100">
      {/* ---- Header row ---- */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-900">
          Indexations — {isNoAM ? "No AM (tous)" : amSlug}
        </h1>

        <div className="flex flex-wrap items-center gap-4">
          {/* Reference month selector */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="refMonth"
              className="text-sm text-gray-700 whitespace-nowrap"
            >
              Reference month:
            </label>
            <select
              id="refMonth"
              value={refMonth}
              onChange={(e) => handleRefMonthChange(e.target.value)}
              className="rounded-lg border border-gray-400 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              {MONTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {activeRefMonth && activeRefMonth !== refMonth && (
              <span className="text-xs text-amber-700">
                (API used: {activeRefMonth})
              </span>
            )}
          </div>

          {/* Eligible filter */}
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input
              type="checkbox"
              checked={onlyEligible}
              onChange={(e) => setOnlyEligible(e.target.checked)}
              className="h-4 w-4 rounded border-gray-400 text-emerald-600 focus:ring-emerald-500"
            />
            Only show indexable
          </label>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-800">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-800">No rows.</div>
      ) : (
        <div className="w-full rounded-2xl border border-gray-300 bg-white shadow-sm overflow-x-auto">
          <table
            className="w-full text-sm tabular-nums"
            style={{ borderCollapse: "separate", borderSpacing: "0 0" }}
          >
            <thead>
              <tr>
                <Th>Indexable</Th>
                <Th>Asset</Th>
                <Th>Tenant</Th>
                <Th>Index</Th>
                <Th>Threshold</Th>
                <Th>Lock</Th>
                <Th className="min-w-[120px]">Last Adj.</Th>
                <Th>Wait</Th>
                <Th>Index(prev.)</Th>
                <Th>Index(curr.)</Th>
                <Th>{"\u0394"}</Th>
                <Th>Pass-Through</Th>
                <Th>Cap</Th>
                <Th>Applied</Th>
                <Th>Old rent</Th>
                <Th>New rent</Th>
                <Th className="min-w-[180px]">Updating Rent</Th>
                <Th className="min-w-[280px]">Reason (Debug)</Th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r, idx) => {
                const newRent = calcNewRent(r);
                const isEven = idx % 2 === 0;

                return (
                  <tr
                    key={r.id}
                    className={cls(
                      isEven ? "bg-white" : "bg-gray-50",
                      "hover:bg-emerald-50/50",
                      "transition-colors"
                    )}
                  >
                    <Td>
                      <span
                        className={cls(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
                          r.eligible_now
                            ? "border-emerald-500 text-emerald-700"
                            : "border-gray-500 text-gray-800"
                        )}
                      >
                        {r.eligible_now ? "Yes" : "No"}
                      </span>
                    </Td>

                    <Td className="max-w-[280px] truncate" title={m2oName(r.main_property_id)}>
                      {m2oName(r.main_property_id)}
                    </Td>

                    <Td className="max-w-[180px] truncate" title={r.name || undefined}>
                      {r.name ?? "\u2014"}
                    </Td>

                    <Td className="whitespace-nowrap">{r.index_name ?? "\u2014"}</Td>

                    <Td>{fmtPct(r.threshold ?? null, 0)}</Td>

                    <Td>{r.lock_date ?? "\u2014"}</Td>

                    <Td
                      className="min-w-[120px] whitespace-nowrap"
                      title={r.adjustment_month_key || r.adjustment_year_key || r.adjustment_date || undefined}
                    >
                      {r.adjustment_month_key || r.adjustment_year_key || "\u2014"}
                    </Td>

                    <Td className="text-center">{r.waiting_time ?? 0}</Td>

                    <Td>{r.adjustment_index ?? "\u2014"}</Td>
                    <Td>{r.current_index ?? "\u2014"}</Td>

                    <Td
                      className={cls(
                        (r.delta ?? 0) > 0
                          ? "text-emerald-700"
                          : (r.delta ?? 0) < 0
                          ? "text-rose-700"
                          : "text-gray-900",
                        "font-medium"
                      )}
                    >
                      {fmtPct(r.delta ?? null)}
                    </Td>

                    <Td>{fmtPct(r.partially_passing_on ?? null, 0)}</Td>

                    <Td>{fmtPct((r.maximal_percentage ?? 0) || null)}</Td>
                    <Td className="font-semibold">{fmtPct(r.applied_percentage ?? null)}</Td>

                    <Td>{fmtMoney(r.current_rent)}</Td>
                    <Td>{fmtMoney(newRent)}</Td>

                    <Td>
                      <button
                        type="button"
                        onClick={() => handleOpenIndexation(r)}
                        disabled={!canUpdate(r) || busyId === r.id}
                        className="px-2 py-1 rounded border border-gray-500 text-xs text-gray-900 bg-white hover:bg-gray-100 disabled:opacity-40"
                      >
                        {busyId === r.id ? "Opening…" : "Open indexation panel"}
                      </button>
                    </Td>

                    <Td className="min-w-[280px] whitespace-normal break-words">
                      <div className="leading-tight">
                        <div className="text-[11px] text-gray-700">
                          cur: {r.current_month_key || r.current_year_key || "\u2014"}
                        </div>
                        <div>{r.reason || "\u2014"}</div>
                        {r.next_wait_date && (
                          <div className="text-[11px] text-gray-700">
                            next: {r.next_wait_date}
                          </div>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan={18} className="h-px bg-gray-300" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </main>
  );
}