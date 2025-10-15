// app/indexations/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type M2O = [number, string] | null;

type TenancyRow = {
  id: number;
  name: string | null;
  main_property_id: M2O;
  sales_person_id: M2O;
  indexing_rent: number | null;
  index_id: M2O;
  index_name: string | null;
  lock_date: string | null;
  adjustment_period: string | number | null;
  adjustment_date: string | null;
  threshold: number | null;
  partially_passing_on: number;       // déjà normalisé côté API
  maximal_percentage: number;         // 0 = pas de cap
  waiting_time: number;

  // enrichissements de l'API
  adjustment_month_key?: string | null;
  adjustment_year_key?: string | null;
  current_month_key?: string | null;
  current_year_key?: string | null;
  adjustment_index?: number | null;
  current_index?: number | null;
  delta?: number | null;              // décimal
  eligible_now?: boolean;
  applied_percentage?: number | null; // décimal
  next_wait_date?: string | null;     // ISO YYYY-MM-DD
  blocked_by_lock?: boolean;
  reason?: string;
  index_kind?: string;
};

type ApiPayload = {
  count: number;
  items: TenancyRow[];
};

function fmtPct(x: number | null | undefined) {
  if (x == null) return "—";
  return `${(x * 100).toFixed(2)}%`;
}

function fmtM2O(v: M2O) {
  if (!v) return "—";
  const [id, name] = v;
  return `${id} — ${name}`;
}

function cls(...s: (string | false | undefined)[]) {
  return s.filter(Boolean).join(" ");
}

export default function IndexationsTablePage() {
  const [data, setData] = useState<TenancyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyEligible, setOnlyEligible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tenancies", { cache: "no-store" });
        const json: ApiPayload = await res.json();
        if (!cancelled) {
          setData(json.items || []);
        }
      } catch (e) {
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
    const base = onlyEligible ? data.filter((r) => r.eligible_now) : data;
    // tri simple: eligible en premier puis delta desc
    return [...base].sort((a, b) => {
      const ea = a.eligible_now ? 1 : 0;
      const eb = b.eligible_now ? 1 : 0;
      if (eb - ea !== 0) return eb - ea;
      const da = a.delta ?? -Infinity;
      const db = b.delta ?? -Infinity;
      return db - da;
    });
  }, [data, onlyEligible]);

  return (
    <main className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Indexations — Tableau</h1>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyEligible}
            onChange={(e) => setOnlyEligible(e.target.checked)}
          />
          N’afficher que les éligibles
        </label>
      </div>

      {loading ? (
        <div className="text-sm text-gray-600">Chargement…</div>
      ) : (
        <div className="rounded-2xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <Th>Eligible</Th>
                <Th>Bien</Th>
                <Th>Tenancy</Th>
                <Th>AM (sales_person)</Th>
                <Th>Index</Th>
                <Th>Lock</Th>
                <Th>Last Adj.</Th>
                <Th>Wait (mois)</Th>
                <Th>I(adj)</Th>
                <Th>I(cur)</Th>
                <Th>Δ</Th>
                <Th>PPP</Th>
                <Th>Cap</Th>
                <Th>À appliquer</Th>
                <Th>Raison / Next</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const eligible = Boolean(r.eligible_now);
                return (
                  <tr
                    key={r.id}
                    className={cls(
                      "border-t",
                      eligible && "bg-emerald-50/40",
                      r.blocked_by_lock && "bg-rose-50/60"
                    )}
                  >
                    <Td>
                      <span
                        className={cls(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          eligible
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                        )}
                      >
                        {eligible ? "Oui" : "Non"}
                      </span>
                    </Td>
                    <Td>{fmtM2O(r.main_property_id)}</Td>
                    <Td className="max-w-[220px] truncate" title={r.name || ""}>
                      {r.name ?? "—"}
                    </Td>
                    <Td>{fmtM2O(r.sales_person_id)}</Td>
                    <Td>
                      <div className="leading-tight">
                        <div className="font-medium">{r.index_name ?? "—"}</div>
                        <div className="text-[11px] text-gray-500">{r.index_kind ?? ""}</div>
                      </div>
                    </Td>
                    <Td>{r.lock_date ?? "—"}</Td>
                    <Td>
                      <div className="leading-tight">
                        <div>{r.adjustment_date ?? "—"}</div>
                        <div className="text-[11px] text-gray-500">
                          {r.adjustment_month_key || r.adjustment_year_key || "—"}
                        </div>
                      </div>
                    </Td>
                    <Td className="text-center">{r.waiting_time ?? 0}</Td>
                    <Td>{r.adjustment_index ?? "—"}</Td>
                    <Td>{r.current_index ?? "—"}</Td>
                    <Td className={cls(
                      (r.delta ?? 0) > 0 ? "text-emerald-700" : (r.delta ?? 0) < 0 ? "text-rose-700" : "text-gray-700",
                      "font-medium"
                    )}>
                      {fmtPct(r.delta ?? null)}
                    </Td>
                    <Td>{fmtPct(r.partially_passing_on ?? null)}</Td>
                    <Td>{fmtPct((r.maximal_percentage ?? 0) || null)}</Td>
                    <Td className="font-semibold">{fmtPct(r.applied_percentage ?? null)}</Td>
                    <Td>
                      <div className="leading-tight">
                        <div className="text-[11px] text-gray-500">
                          cur: {r.current_month_key || r.current_year_key || "—"}
                        </div>
                        <div>{r.reason || (eligible ? "OK" : "—")}</div>
                        {r.next_wait_date && (
                          <div className="text-[11px] text-gray-500">next: {r.next_wait_date}</div>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left p-2 text-[12px] uppercase tracking-wide text-gray-600">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`p-2 align-top ${className}`}>{children}</td>;
}
