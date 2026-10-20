import type { RequestStatus } from "@/db/schema";
import { isStatus } from "@/lib/status";
import { firstParam, isIsoDate } from "./period";

/**
 * Filtri dello storico completo, condivisi tra la pagina (/direzione/storico) e l'export CSV
 * (/api/export/richieste): stessi nomi dei parametri di query.
 */
export type RequestSourceFilter = "INTERNO" | "MODULO_PUBBLICO";

export type HistoryFilters = {
  da?: string;
  a?: string;
  stato?: RequestStatus;
  contatto?: string;
  prodotto?: string;
  /** Id dell'agente, oppure "nessuno" per i clienti direzionali. */
  agente?: number | "nessuno";
  /** Paese del contatto, oppure "nessuno" per i contatti senza paese. */
  paese?: string;
  marchio?: string;
  origine?: RequestSourceFilter;
};

export const NONE_VALUE = "nessuno";

export const SOURCE_LABELS: Record<RequestSourceFilter, string> = {
  INTERNO: "Inserita dal back office",
  MODULO_PUBBLICO: "Modulo pubblico",
};

type ParamGetter = (key: string) => string | undefined;

function getterFrom(input: URLSearchParams | Record<string, string | string[] | undefined>): ParamGetter {
  if (input instanceof URLSearchParams) return (k) => firstParam(input.get(k));
  return (k) => firstParam(input[k]);
}

const MAX_TEXT = 100;

export function parseHistoryFilters(input: URLSearchParams | Record<string, string | string[] | undefined>): HistoryFilters {
  const get = getterFrom(input);
  const f: HistoryFilters = {};
  let da = get("da");
  let a = get("a");
  if (da && !isIsoDate(da)) da = undefined;
  if (a && !isIsoDate(a)) a = undefined;
  if (da && a && da > a) [da, a] = [a, da];
  if (da) f.da = da;
  if (a) f.a = a;

  const stato = get("stato");
  if (isStatus(stato)) f.stato = stato;

  const contatto = get("contatto");
  if (contatto) f.contatto = contatto.slice(0, MAX_TEXT);
  const prodotto = get("prodotto");
  if (prodotto) f.prodotto = prodotto.slice(0, MAX_TEXT);

  const agente = get("agente");
  if (agente === NONE_VALUE) f.agente = NONE_VALUE;
  else if (agente && /^\d{1,9}$/.test(agente)) f.agente = Number(agente);

  const paese = get("paese");
  if (paese) f.paese = paese.slice(0, MAX_TEXT);
  const marchio = get("marchio");
  if (marchio) f.marchio = marchio.slice(0, MAX_TEXT);

  const origine = get("origine");
  if (origine === "INTERNO" || origine === "MODULO_PUBBLICO") f.origine = origine;
  return f;
}

/** Filtri → parametri di query (per paginazione, link di export, "azzera"). */
export function historyFiltersToParams(f: HistoryFilters): Record<string, string | undefined> {
  return {
    da: f.da,
    a: f.a,
    stato: f.stato,
    contatto: f.contatto,
    prodotto: f.prodotto,
    agente: f.agente === undefined ? undefined : String(f.agente),
    paese: f.paese,
    marchio: f.marchio,
    origine: f.origine,
  };
}

export function toQueryString(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export function hasActiveFilters(f: HistoryFilters): boolean {
  return Object.values(f).some((v) => v !== undefined);
}
