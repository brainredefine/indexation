// app/[am]/ClientTable.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

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
  applied_percentage?: number | null; // décimal (ex 0.021)
  next_wait_date?: string | null;
  blocked_by_lock?: boolean;
  reason?: string;
  index_kind?: string;
};

type ApiPayload = { count: number; items: TenancyRow[] };

const AM_UID: Record<string, number> = { BKO: 8, CFR: 12, FKE: 7, MSC: 9 };

const cls = (...s: (string | false | undefined)[]) => s.filter(Boolean).join(" ");
const fmtPct = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(2)}%`);
const m2oName = (v: M2O) => (v && v[1]) || "—";
const fmtMoney = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 2,
      }).format(n);

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cls("text-left text-[12px] uppercase tracking-wide text-gray-500 py-2", className)}>
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
    <td className={cls("py-3 align-top text-[13px] text-gray-800 dark:text-gray-100", className)} title={title}>
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

  const refresh = async () => {
    const res = await fetch("/api/tenancies", { cache: "no-store" });
    const json: ApiPayload = await res.json();
    setData(json.items || []);
  };

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
  }, []);

  const rows = useMemo(() => {
    const byAM = isNoAM ? data : data.filter((r) => r.sales_person_id && r.sales_person_id[0] === AM_UID[amSlug]);
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

  // new rent = old * (1 + applied_percentage)
  const calcNewRent = (r: TenancyRow) => {
    if (r.current_rent == null || r.applied_percentage == null) return null;
    return +(r.current_rent * (1 + r.applied_percentage)).toFixed(2);
  };

  const canUpdate = (r: TenancyRow) =>
    Boolean(r.eligible_now && r.current_rent != null && r.applied_percentage != null && calcNewRent(r) != null);

  const handleUpdate = async (r: TenancyRow) => {
    const newRent = calcNewRent(r);
    if (!canUpdate(r) || newRent == null) return;
    try {
      setBusyId(r.id);
      const res = await fetch("/api/update-rent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenancy_id: r.id, new_rent: newRent, ui_row: r }),
      });
      const json = await res.json();
      if (!json.ok) {
        alert("Odoo update failed: " + (json.error || "unknown"));
        return;
      }
      await refresh();
      alert(`Rent mis à jour (tenancy ${r.id}).`);
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      alert("Erreur: " + msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Indexations — {isNoAM ? "No AM (tous)" : amSlug}
        </h1>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} className="h-4 w-4" />
          Only show indexable
        </label>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Chargement…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500">Aucune ligne.</div>
      ) : (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
          <table
            className="w-full text-sm tabular-nums"
            style={{ borderCollapse: "separate", borderSpacing: "28px 0" }}
          >
            <thead>
              <tr>
                <Th>Indexable</Th>
                <Th>Asset</Th>
                <Th>Tenant</Th>
                <Th>Index</Th>
                <Th>Threshold</Th>
                <Th>Lock</Th>
                <Th className="min-w-[190px]">Last Adj.</Th> {/* élargie */}
                <Th>Wait</Th>
                <Th>Index(prev.)</Th>
                <Th>Index(curr.)</Th>
                <Th>Δ</Th>
                <Th>Pass-Through</Th>
                <Th>Cap</Th>
                <Th>Applied</Th>
                <Th>Old rent</Th>
                <Th>New rent</Th>
                <Th className="min-w-[180px]">Updating Rent</Th> {/* élargie */}
                <Th className="min-w-[280px]">Reason (Debug)</Th> {/* élargie */}
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => {
                const newRent = calcNewRent(r);

                return (
                  <tr key={r.id}>
                    <Td>
                      <span
                        className={cls(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
                          r.eligible_now
                            ? "border-emerald-300 text-emerald-700 dark:text-emerald-400"
                            : "border-gray-300 text-gray-600 dark:text-gray-300"
                        )}
                      >
                        {r.eligible_now ? "Yes" : "No"}
                      </span>
                    </Td>

                    <Td className="max-w-[280px] truncate" title={m2oName(r.main_property_id)}>
                      {m2oName(r.main_property_id)}
                    </Td>

                    <Td className="max-w-[180px] truncate" title={r.name || undefined}>
                      {r.name ?? "—"}
                    </Td>

                    <Td>
                      <div className="leading-tight">
                        <div className="font-medium">{r.index_name ?? "—"}</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">{r.index_kind ?? ""}</div>
                      </div>
                    </Td>

                    <Td>{fmtPct(r.threshold ?? null)}</Td>
                    <Td>{r.lock_date ?? "—"}</Td>

                    {/* Last Adj. — large + wrap autorisé */}
                    <Td
                      className="min-w-[190px] whitespace-normal break-words"
                      title={r.adjustment_month_key || r.adjustment_year_key || undefined}
                    >
                      <div className="leading-tight">
                        <div>{r.adjustment_date ?? "—"}</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          {r.adjustment_month_key || r.adjustment_year_key || "—"}
                        </div>
                      </div>
                    </Td>

                    <Td className="text-center">{r.waiting_time ?? 0}</Td>

                    <Td>{r.adjustment_index ?? "—"}</Td>
                    <Td>{r.current_index ?? "—"}</Td>

                    <Td
                      className={cls(
                        (r.delta ?? 0) > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : (r.delta ?? 0) < 0
                          ? "text-rose-700 dark:text-rose-400"
                          : "text-gray-700 dark:text-gray-200",
                        "font-medium"
                      )}
                    >
                      {fmtPct(r.delta ?? null)}
                    </Td>

                    <Td>{fmtPct(r.partially_passing_on ?? null)}</Td>
                    <Td>{fmtPct((r.maximal_percentage ?? 0) || null)}</Td>
                    <Td className="font-semibold">{fmtPct(r.applied_percentage ?? null)}</Td>

                    <Td>{fmtMoney(r.current_rent)}</Td>
                    <Td>{fmtMoney(newRent)}</Td>

                    {/* Action — large */}
                    <Td className="min-w-[180px]">
                      <button
                        disabled={!canUpdate(r) || busyId === r.id}
                        onClick={() => handleUpdate(r)}
                        className={cls(
                          "rounded-lg px-3 py-1.5 text-xs font-medium border transition",
                          canUpdate(r) && busyId !== r.id
                            ? "border-gray-300 text-gray-800 hover:bg-black/5 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-white/5"
                            : "border-gray-200 text-gray-400 cursor-not-allowed dark:border-gray-800"
                        )}
                        title={!canUpdate(r) ? "Non éligible ou données manquantes" : "Mettre à jour dans Odoo"}
                      >
                        {busyId === r.id ? "Mise à jour…" : "Update new rent"}
                      </button>
                    </Td>

                    {/* Raison — large + wrap */}
                    <Td className="min-w-[280px] whitespace-normal break-words">
                      <div className="leading-tight">
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          cur: {r.current_month_key || r.current_year_key || "—"}
                        </div>
                        <div>{r.reason || "—"}</div>
                        {r.next_wait_date && (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400">next: {r.next_wait_date}</div>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan={18} className="h-px bg-gray-200/60 dark:bg-gray-800/60" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </main>
  );
}
