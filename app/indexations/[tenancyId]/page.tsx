// app/indexations/[tenancyId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

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
};

type ApiPayload = {
  count: number;
  items: TenancyRow[];
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
  comment: string;
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
  params: { tenancyId: string };
}) {
  const tenancyId = useMemo(
    () => Number(params.tenancyId),
    [params.tenancyId]
  );

  const [form, setForm] = useState<IndexationFormState>({
    tenancyId: Number.isFinite(tenancyId) ? tenancyId : 0,
    tenancyName: null,
    propertyLabel: null,
    tenant: null,
    oldRent: null,
    newRent: null,
    appliedPct: null,
    effectiveDate: firstDayOfNextMonthLocal(),
    comment: "",
  });

  const [sourceRow, setSourceRow] = useState<TenancyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastInd, setLastInd] = useState<string | null>(null);

  // ---------- Prefill from /api/tenancies ----------
  useEffect(() => {
    if (!Number.isFinite(tenancyId)) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);

        const res = await fetch("/api/tenancies", { cache: "no-store" });
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
            ? `${row.main_property_id[0]} — ${row.main_property_id[1]}`
            : null,
          tenant: row.name ?? null,
          oldRent,
          newRent,
          appliedPct,
          effectiveDate: firstDayOfNextMonthLocal(),
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
  }, [tenancyId]);

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

  const pctDisplay =
    form.appliedPct != null ? (form.appliedPct * 100).toFixed(2) : "";

  const previewText = useMemo(() => {
    return [
      `Tenancy ID: ${form.tenancyId}`,
      form.tenancyName ? `Tenancy: ${form.tenancyName}` : "",
      form.propertyLabel ? `Property: ${form.propertyLabel}` : "",
      form.tenant ? `Tenant: ${form.tenant}` : "",
      `Old rent: ${form.oldRent ?? "—"}`,
      `New rent: ${form.newRent ?? "—"}`,
      `Increase: ${
        form.appliedPct != null ? (form.appliedPct * 100).toFixed(2) + "%" : "—"
      }`,
      `Effective date: ${form.effectiveDate}`,
      form.comment ? `Comment: ${form.comment}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }, [form]);

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

  const handleConfirm = async () => {
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
      setSubmitting(true);
      setLastInd(null);

      const res = await fetch("/api/indexations/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenancy_id: form.tenancyId,
          old_rent: oldRent,
          new_rent: newRent,
          applied_pct: appliedPct,
          effective_date: form.effectiveDate,
          comment: form.comment,
          ui_row: sourceRow,
          return_pdf: true,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        console.error("API error:", json);
        alert(`Error: ${json.error ?? res.status}`);
        return;
      }

      setLastInd(json.ind ?? null);

      if (json.pdf_base64) {
        downloadPdfFromBase64(
          json.pdf_base64,
          json.pdf_file_name || "indexation.pdf"
        );
      }

      alert(`Indexation saved.\nIND: ${json.ind ?? "—"}`);
    } catch (e: any) {
      console.error(e);
      alert(`Unexpected error: ${e?.message ?? String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

    const handleBackToList = () => {
    if (typeof window !== "undefined") {
        window.location.href = "/NO-AM";
    }
    };

  if (!Number.isFinite(tenancyId)) {
    return (
      <div className="p-6 text-sm text-red-600">
        Invalid tenancy ID.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-800">
        Loading…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 text-sm text-red-600">
        Loading error: {loadError}
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-gray-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">
              Indexation for tenancy #{form.tenancyId}
            </h1>

            {form.propertyLabel && (
              <p className="text-xs text-gray-700">
                Property: {form.propertyLabel}
              </p>
            )}

            {lastInd && (
              <p className="text-xs text-emerald-700">
                Last IND generated:{" "}
                <span className="font-mono">{lastInd}</span>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleBackToList}
            className="px-3 py-1.5 rounded-lg border border-gray-500 bg-white text-xs font-medium text-gray-900 hover:bg-gray-100"
          >
            Back to indexation list
          </button>
        </header>

        {/* Main form block */}
        <section className="space-y-4 rounded-2xl border border-gray-300 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs text-gray-700 mb-1">
                Old rent (net)
              </label>
              <input
                type="number"
                className="w-full border border-gray-400 rounded px-2 py-1 text-sm text-gray-900"
                value={form.oldRent ?? ""}
                onChange={(e) =>
                  handleChange(
                    "oldRent",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </div>

            <div>
              <label className="block text-xs text-gray-700 mb-1">
                New rent (net)
              </label>
              <input
                type="number"
                className="w-full border border-gray-400 rounded px-2 py-1 text-sm text-gray-900"
                value={form.newRent ?? ""}
                onChange={(e) => handleNewRentChange(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-700 mb-1">
                % applied
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  className="w-full border border-gray-400 rounded px-2 py-1 text-sm text-gray-900"
                  value={pctDisplay}
                  onChange={(e) => handlePctChange(e.target.value)}
                />
                <span className="text-sm text-gray-900">%</span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-700 mb-1">
                Effective date
              </label>
              <input
                type="date"
                className="w-full border border-gray-400 rounded px-2 py-1 text-sm text-gray-900"
                value={form.effectiveDate}
                onChange={(e) => handleChange("effectiveDate", e.target.value)}
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs text-gray-700 mb-1">
              Indexation comment
            </label>
            <textarea
              className="w-full border border-gray-400 rounded px-2 py-1 text-sm text-gray-900 min-h-[80px]"
              value={form.comment}
              onChange={(e) => handleChange("comment", e.target.value)}
            />
          </div>
        </section>

        {/* Preview + actions */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-300 bg-white p-4 shadow-sm text-xs whitespace-pre-wrap text-gray-900">
            <div className="font-semibold mb-2">Plain text preview</div>
            {previewText}
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="px-3 py-2 rounded-lg bg-black text-white text-sm disabled:opacity-50"
            >
              {submitting ? "Saving indexation…" : "Confirm indexation"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
