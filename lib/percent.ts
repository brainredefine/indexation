// lib/percent.ts

/**
 * Arrondit un pourcentage décimal à 1 décimale en points de %.
 * ex: 0.1066 (10,66 %) → 0.107 (10,7 %)
 * toPrecision évite les erreurs de flottant (ex: 0.10650000000000001).
 */
export function roundPct1(v: number): number;
export function roundPct1(v: number | null): number | null;
export function roundPct1(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return v;
  return Math.round(Number((v * 1000).toPrecision(12))) / 1000;
}
