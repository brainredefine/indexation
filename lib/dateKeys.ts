// lib/dateKeys.ts
/** Formatte une date JS -> "MM/YYYY" */
export function monthKey(d: Date): string {
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const y = d.getFullYear();
  return `${m}/${y}`;
}

/** Mois précédent -> "MM/YYYY" */
export function prevMonthKey(from = new Date()): string {
  const d = new Date(from);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return monthKey(d);
}

/** Parse plusieurs formats: "YYYY-MM-DD", "YYYY-MM", "DD/MM/YYYY", "MM/YYYY" */
export function parseToMonthKey(input: string): string | null {
  if (!input) return null;

  // "YYYY-MM-DD" ou "YYYY-MM"
  const ymd = input.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (ymd) {
    const [, y, m] = ymd;
    return `${m}/${y}`;
  }

  // "DD/MM/YYYY"
  const dmy = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) {
    const [, , m, y] = dmy;
    return `${m}/${y}`;
  }

  // "MM/YYYY"
  const my = input.match(/^(\d{2})\/(\d{4})$/);
  if (my) {
    const [, m, y] = my;
    return `${m}/${y}`;
  }

  // Date parsable par JS (fallback)
  const t = Date.parse(input);
  if (!Number.isNaN(t)) {
    return monthKey(new Date(t));
  }
  return null;
}

/** Ajoute N mois à une date (préserve le jour si possible) */
export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + (months || 0));
  // Repose le jour initial (gère fin de mois automatiquement)
  out.setDate(Math.min(day, daysInMonth(out.getFullYear(), out.getMonth())));
  return out;
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}
