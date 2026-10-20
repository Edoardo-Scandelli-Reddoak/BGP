/**
 * Periodi e mesi per report e cruscotto. Modulo puro: la data odierna arriva dal chiamante
 * (todayIso() di src/lib/format.ts), così le funzioni sono testabili.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Primo valore di un parametro di query (Next passa string | string[] | undefined). */
export function firstParam(value: string | string[] | undefined | null): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const s = v?.trim();
  return s ? s : undefined;
}

/** "2026-10-20" valida (anche come data di calendario: niente 31 febbraio). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** "2026-10" valido (anni 2000-2100). */
export function isIsoMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_MONTH.exec(value);
  return !!m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** "2026-01" + (-1) → "2025-12" */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

/** Ultimo giorno del mese, es. "2026-02" → "2026-02-28". */
export function monthEnd(month: string): string {
  return addDays(monthStart(addMonths(month, 1)), -1);
}

/** Mesi da `from` a `to` inclusi, in ordine crescente (vuoto se from > to). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 1200; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Gli ultimi `count` mesi fino a `current` incluso, dal più recente. */
export function recentMonths(current: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(current, -i));
}

/** Giorni tra due date ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);
}

/* ------------------------------------------------------------------ */
/* Periodo del cruscotto (?da=YYYY-MM-DD&a=YYYY-MM-DD)                 */
/* ------------------------------------------------------------------ */

export const PERIOD_PRESETS = ["30g", "12m", "anno"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  "30g": "Ultimi 30 giorni",
  "12m": "Ultimi 12 mesi",
  anno: "Anno corrente",
};

export const DEFAULT_PRESET: PeriodPreset = "12m";

export type Period = { da: string; a: string; preset: PeriodPreset | null };

export function presetRange(preset: PeriodPreset, today: string): { da: string; a: string } {
  switch (preset) {
    case "30g":
      return { da: addDays(today, -29), a: today };
    case "12m":
      // 12 mesi di calendario interi, compreso quello in corso
      return { da: monthStart(addMonths(today.slice(0, 7), -11)), a: today };
    case "anno":
      return { da: `${today.slice(0, 4)}-01-01`, a: today };
  }
}

/** Legge da/a dalla query: valori non validi → predefinito (ultimi 12 mesi); date invertite → scambiate. */
export function resolvePeriod(input: { da?: string; a?: string }, today: string): Period {
  const fallback = presetRange(DEFAULT_PRESET, today);
  let da = isIsoDate(input.da) ? input.da : undefined;
  let a = isIsoDate(input.a) ? input.a : undefined;
  if (!da && !a) return { ...fallback, preset: DEFAULT_PRESET };
  da ??= fallback.da;
  a ??= today;
  if (da > a) [da, a] = [a, da];
  const preset = PERIOD_PRESETS.find((p) => {
    const r = presetRange(p, today);
    return r.da === da && r.a === a;
  });
  return { da, a, preset: preset ?? null };
}
