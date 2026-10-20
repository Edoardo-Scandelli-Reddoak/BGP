import type { RequestStatus, Role } from "@/db/schema";

/** Ordine del flusso: Nuova richiesta → In preparazione → Pronta per il ritiro → Spedita → Completata. */
export const STATUS_ORDER: RequestStatus[] = [
  "NUOVA",
  "IN_PREPARAZIONE",
  "PRONTA_RITIRO",
  "SPEDITA",
  "COMPLETATA",
];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  NUOVA: "Nuova richiesta",
  IN_PREPARAZIONE: "In preparazione",
  PRONTA_RITIRO: "Pronta per il ritiro",
  SPEDITA: "Spedita",
  COMPLETATA: "Completata",
};

/** Ruolo responsabile di ciascuno stato (blueprint, sezione 2). */
export const STATUS_OWNER: Record<RequestStatus, Role | "SISTEMA"> = {
  NUOVA: "BACKOFFICE",
  IN_PREPARAZIONE: "MAGAZZINO",
  PRONTA_RITIRO: "LOGISTICA",
  SPEDITA: "LOGISTICA",
  COMPLETATA: "SISTEMA",
};

/** Cosa deve fare il responsabile per far avanzare la richiesta. */
export const STATUS_TODO: Record<RequestStatus, string> = {
  NUOVA: "Il back office completa i dati e invia la richiesta al magazzino.",
  IN_PREPARAZIONE: "Il magazzino registra colli, peso e misure dei pezzi, poi la segna pronta per il ritiro.",
  PRONTA_RITIRO:
    "La logistica indica corriere e data di ritiro (e prepara la bolla, se richiesta), poi la segna spedita.",
  SPEDITA:
    "La logistica inserisce numero di tracking e data di spedizione: parte l'email al cliente e la richiesta si chiude.",
  COMPLETATA: "Richiesta chiusa. Conferma di spedizione inviata.",
};

/** Classi Tailwind per i badge di stato. */
export const STATUS_BADGE_CLASSES: Record<RequestStatus, string> = {
  NUOVA: "bg-sky-50 text-sky-800 ring-sky-600/20",
  IN_PREPARAZIONE: "bg-amber-50 text-amber-800 ring-amber-600/20",
  PRONTA_RITIRO: "bg-violet-50 text-violet-800 ring-violet-600/20",
  SPEDITA: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
  COMPLETATA: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
};

/** Colore "pieno" per grafici e indicatori. */
export const STATUS_COLORS: Record<RequestStatus, string> = {
  NUOVA: "#0284c7",
  IN_PREPARAZIONE: "#d97706",
  PRONTA_RITIRO: "#7c3aed",
  SPEDITA: "#4f46e5",
  COMPLETATA: "#059669",
};

export const OPEN_STATUSES: RequestStatus[] = ["NUOVA", "IN_PREPARAZIONE", "PRONTA_RITIRO", "SPEDITA"];

export function nextStatus(status: RequestStatus): RequestStatus | null {
  const i = STATUS_ORDER.indexOf(status);
  return i >= 0 && i < STATUS_ORDER.length - 1 ? STATUS_ORDER[i + 1] : null;
}

export function previousStatus(status: RequestStatus): RequestStatus | null {
  const i = STATUS_ORDER.indexOf(status);
  return i > 0 ? STATUS_ORDER[i - 1] : null;
}

export function isStatus(value: unknown): value is RequestStatus {
  return typeof value === "string" && (STATUS_ORDER as string[]).includes(value);
}
