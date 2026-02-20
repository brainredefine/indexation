// app/indexations/[tenancyId]/page.tsx
"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type M2O = [number, string] | null;

// must match /api/tenancies
type TenancyRow = {
  id: number;
  name: string | null;
  main_property_id: M2O;
  sales_person_id: M2O;
  indexing_rent: number | null;
  current_rent: number | null;
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

  date_end_display?: string | null;
  current_ancillary_costs?: number | null;
};

type ApiPayload = {
  count: number;
  items: TenancyRow[];
  ref_month?: string;
  ref_year?: string;
};

type IndexationFormState = {
  tenancyId: number;
  tenancyName: string | null;
  propertyLabel: string | null;
  tenant: string | null;

  oldRent: number | null;
  newRent: number | null;
  appliedPct: number | null; // decimal
  effectiveDate: string; // "YYYY-MM-DD"
  referenceDate: string; // "YYYY-MM-DD" — future adjustment_date for Odoo
  comment: string;

  // Nebenkosten indexation
  indexNebenkosten: boolean;
  oldAncillary: number | null;
  newAncillary: number | null;
  ancillaryAppliedPct: number | null; // decimal
};

function firstDayOfNextMonthLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth();
  const next = new Date(Date.UTC(y, m + 1, 1));
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function IndexationDetailPage({
  params,
}: {
  params: Promise<{ tenancyId: string }>;
}) {
  // Next.js 15: params is a Promise in client components — unwrap with use()
  const { tenancyId: tenancyIdStr } = use(params);
  const tenancyId = useMemo(() => Number(tenancyIdStr), [tenancyIdStr]);

  const searchParams = useSearchParams();
  // Read refMonth from query string (propagated from ClientTable)
  const refMonth = searchParams.get("refMonth") || "";

  const [form, setForm] = useState<IndexationFormState>({
    tenancyId: Number.isFinite(tenancyId) ? tenancyId : 0,
    tenancyName: null,
    propertyLabel: null,
    tenant: null,
    oldRent: null,
    newRent: null,
    appliedPct: null,
    effectiveDate: firstDayOfNextMonthLocal(),
    referenceDate: firstDayOfNextMonthLocal(),
    comment: "",
    indexNebenkosten: false,
    oldAncillary: null,
    newAncillary: null,
    ancillaryAppliedPct: null,
  });

  const [sourceRow, setSourceRow] = useState<TenancyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [lastInd, setLastInd] = useState<string | null>(null);

  // ---------- Prefill from /api/tenancies ----------
  useEffect(() => {
    if (!Number.isFinite(tenancyId)) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);

        // Build URL with refMonth if provided
        const qp = new URLSearchParams();
        if (refMonth) {
          qp.set("refMonth", refMonth);
          const yearPart = refMonth.split("/")[1];
          if (yearPart) qp.set("refYear", yearPart);
        }
        const qs = qp.toString();
        const url = `/api/tenancies${qs ? `?${qs}` : ""}`;

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json: ApiPayload = await res.json();
        const row = json.items.find((r) => r.id === tenancyId);
        if (!row) throw new Error("Tenancy not found in /api/tenancies");

        const oldRent = row.current_rent ?? row.indexing_rent ?? null;
        const appliedPct = row.applied_percentage ?? null;

        const newRent =
          oldRent != null && appliedPct != null
            ? +(oldRent * (1 + appliedPct)).toFixed(2)
            : null;

        if (cancelled) return;

        setSourceRow(row);
        setForm((prev) => ({
          ...prev,
          tenancyId,
          tenancyName: row.name ?? null,
          propertyLabel: row.main_property_id
            ? `${row.main_property_id[0]} \u2014 ${row.main_property_id[1]}`
            : null,
          tenant: row.name ?? null,
          oldRent,
          newRent,
          appliedPct,
          effectiveDate: firstDayOfNextMonthLocal(),
          oldAncillary: row.current_ancillary_costs ?? null,
        }));
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenancyId, refMonth]);

  // ---------- Form handlers ----------
  const handleChange = <K extends keyof IndexationFormState>(
    key: K,
    value: IndexationFormState[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const handlePctChange = (value: string) => {
    const pct = value === "" ? null : Number(value) / 100;
    setForm((prev) => {
      const oldRent = prev.oldRent ?? null;
      const newRent =
        oldRent != null && pct != null
          ? +(oldRent * (1 + pct)).toFixed(2)
          : prev.newRent;
      return { ...prev, appliedPct: pct, newRent };
    });
  };

  const handleNewRentChange = (value: string) => {
    const nr = value === "" ? null : Number(value);
    setForm((prev) => {
      const oldRent = prev.oldRent ?? null;
      const pct =
        oldRent != null && nr != null && oldRent > 0
          ? +(nr / oldRent - 1)
          : prev.appliedPct;
      return { ...prev, newRent: nr, appliedPct: pct };
    });
  };

  const handleToggleNK = (checked: boolean) => {
    setForm((prev) => {
      if (!checked) {
        return { ...prev, indexNebenkosten: false, newAncillary: null, ancillaryAppliedPct: null };
      }
      // Auto-calculate NK from same applied_pct as rent
      const oldAnc = prev.oldAncillary;
      const pct = prev.appliedPct;
      const newAnc =
        oldAnc != null && pct != null ? +(oldAnc * (1 + pct)).toFixed(2) : null;
      return {
        ...prev,
        indexNebenkosten: true,
        newAncillary: newAnc,
        ancillaryAppliedPct: pct,
      };
    });
  };

  const handleNewAncillaryChange = (value: string) => {
    const na = value === "" ? null : Number(value);
    setForm((prev) => {
      const oldAnc = prev.oldAncillary ?? null;
      const pct =
        oldAnc != null && na != null && oldAnc > 0 ? +(na / oldAnc - 1) : prev.ancillaryAppliedPct;
      return { ...prev, newAncillary: na, ancillaryAppliedPct: pct };
    });
  };

  const handleAncillaryPctChange = (value: string) => {
    const pct = value === "" ? null : Number(value) / 100;
    setForm((prev) => {
      const oldAnc = prev.oldAncillary ?? null;
      const newAnc =
        oldAnc != null && pct != null ? +(oldAnc * (1 + pct)).toFixed(2) : prev.newAncillary;
      return { ...prev, ancillaryAppliedPct: pct, newAncillary: newAnc };
    });
  };

  const ancPctDisplay =
    form.ancillaryAppliedPct != null ? (form.ancillaryAppliedPct * 100).toFixed(2) : "";

  const pctDisplay =
    form.appliedPct != null ? (form.appliedPct * 100).toFixed(2) : "";

  const previewText = useMemo(() => {
    return [
      `Tenancy ID: ${form.tenancyId}`,
      form.tenancyName ? `Tenancy: ${form.tenancyName}` : "",
      form.propertyLabel ? `Property: ${form.propertyLabel}` : "",
      form.tenant ? `Tenant: ${form.tenant}` : "",
      `Old rent: ${form.oldRent ?? "\u2014"}`,
      `New rent: ${form.newRent ?? "\u2014"}`,
      `Increase: ${
        form.appliedPct != null ? (form.appliedPct * 100).toFixed(2) + "%" : "\u2014"
      }`,
      form.indexNebenkosten
        ? `NK indexed: ${form.oldAncillary ?? "?"} → ${form.newAncillary ?? "?"} (${
            form.ancillaryAppliedPct != null
              ? (form.ancillaryAppliedPct * 100).toFixed(2) + "%"
              : "\u2014"
          })`
        : "",
      `Effective date: ${form.effectiveDate}`,
      form.referenceDate !== form.effectiveDate
        ? `Future reference date: ${form.referenceDate}`
        : "",
      refMonth ? `Reference month: ${refMonth}` : "",
      form.comment ? `Comment: ${form.comment}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }, [form, refMonth]);

  function downloadPdfFromBase64(b64: string, filename = "indexation.pdf") {
    const byteCharacters = atob(b64);
    const byteNumbers = Array.from(byteCharacters, (c) => c.charCodeAt(0));
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.open(url, "_blank");
  }

  const callConfirmApi = async (dryRun: boolean) => {
    if (!sourceRow) {
      alert("Missing tenancy data.");
      return;
    }

    const oldRent = numOrNull(form.oldRent);
    const newRent = numOrNull(form.newRent);
    const appliedPct = numOrNull(form.appliedPct);

    if (
      oldRent == null ||
      newRent == null ||
      appliedPct == null ||
      !form.effectiveDate
    ) {
      alert("Please fill old rent, new rent, % applied and effective date.");
      return;
    }

    try {
      if (dryRun) {
        setPreviewing(true);
      } else {
        setSubmitting(true);
      }
      if (!dryRun) setLastInd(null);

      const res = await fetch("/api/indexations/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenancy_id: form.tenancyId,
          old_rent: oldRent,
          new_rent: newRent,
          applied_pct: appliedPct,
          effective_date: form.effectiveDate,
          reference_date: form.referenceDate || form.effectiveDate,
          comment: form.comment,
          ui_row: sourceRow,
          return_pdf: true,
          dry_run: dryRun,
          // Nebenkosten indexation
          index_nebenkosten: form.indexNebenkosten,
          new_ancillary: form.indexNebenkosten ? form.newAncillary : null,
          ancillary_applied_pct: form.indexNebenkosten ? form.ancillaryAppliedPct : null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        console.error("API error:", json);
        alert(`Error: ${json.error ?? res.status}`);
        return;
      }

      if (!dryRun) {
        setLastInd(json.ind ?? null);
      }

      if (json.pdf_base64) {
        downloadPdfFromBase64(
          json.pdf_base64,
          json.pdf_file_name || (dryRun ? "preview.pdf" : "indexation.pdf")
        );
      }

      if (!dryRun) {
        alert(`Indexation saved.\nIND: ${json.ind ?? "\u2014"}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`Unexpected error: ${e?.message ?? String(e)}`);
    } finally {
      if (dryRun) {
        setPreviewing(false);
      } else {
        setSubmitting(false);
      }
    }
  };

  const handlePreview = () => callConfirmApi(true);
  const handleConfirm = () => callConfirmApi(false);

  const handleBackToList = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/NO-AM";
    }
  };

  if (!Number.isFinite(tenancyId)) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center">
        <div className="bg-white rounded-xl border border-red-200 px-6 py-4 text-sm text-red-600 shadow-sm">
          Invalid tenancy ID.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading tenancy data…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center">
        <div className="bg-white rounded-xl border border-red-200 px-6 py-4 shadow-sm max-w-md">
          <p className="text-sm font-medium text-red-600 mb-1">Failed to load</p>
          <p className="text-xs text-red-500">{loadError}</p>
        </div>
      </div>
    );
  }

  const rentDelta =
    form.oldRent != null && form.newRent != null
      ? form.newRent - form.oldRent
      : null;

  return (
    <main className="min-h-screen w-full bg-[#f5f6f8]">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleBackToList}
              className="shrink-0 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>
            <div className="h-4 w-px bg-gray-200" />
            <h1 className="text-sm font-semibold text-gray-900 truncate">
              Tenancy #{form.tenancyId}
            </h1>
            {refMonth && (
              <span className="hidden sm:inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-mono text-gray-500">
                ref {refMonth}
              </span>
            )}
          </div>
          {lastInd && (
            <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-mono text-emerald-700">
              {lastInd}
            </span>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Context banner */}
        {(form.propertyLabel || form.tenancyName) && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
            {form.propertyLabel && (
              <span>
                <span className="text-gray-400">Property</span>{" "}
                <span className="text-gray-700 font-medium">{form.propertyLabel}</span>
              </span>
            )}
            {form.tenancyName && (
              <span>
                <span className="text-gray-400">Tenant</span>{" "}
                <span className="text-gray-700 font-medium">{form.tenancyName}</span>
              </span>
            )}
          </div>
        )}

        {/* ── Rent section ── */}
        <section className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Rent indexation</h2>
          </div>
          <div className="p-5 grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
            {/* Old rent */}
            <div>
              <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                Old rent (net)
              </label>
              <input
                type="number"
                className="w-full rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition"
                value={form.oldRent ?? ""}
                onChange={(e) =>
                  handleChange(
                    "oldRent",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </div>

            {/* New rent */}
            <div>
              <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                New rent (net)
              </label>
              <input
                type="number"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition"
                value={form.newRent ?? ""}
                onChange={(e) => handleNewRentChange(e.target.value)}
              />
            </div>

            {/* % applied */}
            <div>
              <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                % applied
              </label>
              <div className="relative">
                <input
                  type="number"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-8 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition"
                  value={pctDisplay}
                  onChange={(e) => handlePctChange(e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
              </div>
            </div>

            {/* Delta badge */}
            <div className="flex items-end pb-1">
              {rentDelta != null && (
                <div className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${
                  rentDelta > 0
                    ? "bg-emerald-50 text-emerald-700"
                    : rentDelta < 0
                    ? "bg-red-50 text-red-600"
                    : "bg-gray-50 text-gray-500"
                }`}>
                  {rentDelta > 0 ? "+" : ""}
                  {rentDelta.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Dates section ── */}
        <section className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Dates</h2>
          </div>
          <div className="p-5 grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
            <div>
              <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                Effective date
              </label>
              <input
                type="date"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition"
                value={form.effectiveDate}
                onChange={(e) => handleChange("effectiveDate", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                Future reference date
              </label>
              <input
                type="date"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition"
                value={form.referenceDate}
                onChange={(e) => handleChange("referenceDate", e.target.value)}
              />
              <p className="text-[10px] text-gray-400 mt-1">
                Next indexation reference in Odoo
              </p>
            </div>
          </div>
        </section>

        {/* ── Nebenkosten section ── */}
        <section className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Nebenkosten</h2>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-[11px] text-gray-500">Indexieren</span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={form.indexNebenkosten}
                  onChange={(e) => handleToggleNK(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-8 h-[18px] bg-gray-200 rounded-full peer-checked:bg-gray-900 transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-[14px] h-[14px] bg-white rounded-full shadow-sm peer-checked:translate-x-[14px] transition-transform" />
              </div>
            </label>
          </div>

          {!form.indexNebenkosten && form.oldAncillary != null && (
            <div className="px-5 py-4 text-sm text-gray-500">
              Current NK netto:{" "}
              <span className="font-medium text-gray-700">
                {form.oldAncillary.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
              </span>
            </div>
          )}

          {form.indexNebenkosten && (
            <div className="p-5 grid grid-cols-3 gap-x-5 gap-y-4 text-sm">
              <div>
                <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                  Old NK (net)
                </label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm text-gray-500 outline-none cursor-default"
                  value={form.oldAncillary ?? ""}
                  readOnly
                  tabIndex={-1}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                  New NK (net)
                </label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition"
                  value={form.newAncillary ?? ""}
                  onChange={(e) => handleNewAncillaryChange(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                  % NK applied
                </label>
                <div className="relative">
                  <input
                    type="number"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-8 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition"
                    value={ancPctDisplay}
                    onChange={(e) => handleAncillaryPctChange(e.target.value)}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                </div>
              </div>
            </div>
          )}

          {!form.indexNebenkosten && form.oldAncillary == null && (
            <div className="px-5 py-4 text-xs text-gray-400 italic">
              No ancillary costs found for this tenancy.
            </div>
          )}
        </section>

        {/* ── Comment ── */}
        <section className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Comment</h2>
          </div>
          <div className="p-5">
            <textarea
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition min-h-[80px] resize-y"
              placeholder="Optional indexation comment…"
              value={form.comment}
              onChange={(e) => handleChange("comment", e.target.value)}
            />
          </div>
        </section>

        {/* ── Summary + Actions ── */}
        <section className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Summary</h2>
          </div>
          <div className="p-5">
            <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-4 border border-gray-100">
              {previewText}
            </pre>
          </div>

          {/* Action buttons */}
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/40 flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewing || submitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition shadow-sm"
            >
              {previewing ? (
                <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M2 2h12v12H2z" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M5 5h6M5 8h6M5 11h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              )}
              {previewing ? "Generating…" : "Preview PDF"}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || previewing}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-gray-900 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40 transition shadow-sm"
            >
              {submitting ? (
                <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {submitting ? "Saving…" : "Confirm indexation"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}