import type { RequestStatus, Role } from "@/db/schema";

export const ROLES: Role[] = ["ADMIN", "BACKOFFICE", "MAGAZZINO", "LOGISTICA", "DIREZIONE", "CRM"];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Amministratore",
  BACKOFFICE: "Back office",
  MAGAZZINO: "Magazzino",
  LOGISTICA: "Logistica",
  DIREZIONE: "Direzione",
  CRM: "Ufficio CRM",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Accesso completo, gestione utenti e impostazioni.",
  BACKOFFICE: "Inserisce e gestisce le richieste, anagrafiche prodotti e contatti.",
  MAGAZZINO: "Prepara i campioni: colli, peso e misure dei pezzi.",
  LOGISTICA: "Corriere, ritiro, bolla di consegna, tracking e spedizione.",
  DIREZIONE: "Sola lettura: cruscotto, storico completo e report.",
  CRM: "Report mensile dei m² per prodotto ed export CSV.",
};

/** Pagina iniziale dopo il login, una per ruolo. */
export const ROLE_HOME: Record<Role, string> = {
  ADMIN: "/richieste",
  BACKOFFICE: "/richieste",
  MAGAZZINO: "/magazzino",
  LOGISTICA: "/logistica",
  DIREZIONE: "/direzione",
  CRM: "/report/mq",
};

/**
 * Matrice dei permessi. Le pagine e le server action la usano tramite `can()`;
 * il servizio delle richieste (src/lib/requests/service.ts) la riapplica lato dominio.
 */
export const PERMISSIONS = {
  /** Vista "Back office — tutte le aperte" e creazione richieste. */
  "requests.manage": ["ADMIN", "BACKOFFICE"],
  /** Coda magazzino e preparazione (colli, peso, pezzi). */
  "warehouse.work": ["ADMIN", "BACKOFFICE", "MAGAZZINO"],
  /** Viste logistica, dati di spedizione, bolla, DDT. */
  "logistics.work": ["ADMIN", "BACKOFFICE", "LOGISTICA"],
  /** Cruscotto direzione e storico completo (sola lettura). */
  "management.view": ["ADMIN", "BACKOFFICE", "DIREZIONE"],
  /** Report mensile m² ed export CSV per il CRM. */
  "reports.m2": ["ADMIN", "BACKOFFICE", "DIREZIONE", "CRM"],
  /** Consultazione anagrafiche. */
  "registry.view": ["ADMIN", "BACKOFFICE", "DIREZIONE"],
  /** Modifica anagrafiche e import da file. */
  "registry.edit": ["ADMIN", "BACKOFFICE"],
  /** Utenti, corrieri, impostazioni email, template, registro email. */
  "settings.manage": ["ADMIN"],
  /** Riportare una richiesta allo stato precedente (correzioni). */
  "requests.revert": ["ADMIN", "BACKOFFICE"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Stati di cui un ruolo può aprire il dettaglio. */
export function canViewRequestInStatus(role: Role, status: RequestStatus): boolean {
  switch (role) {
    case "ADMIN":
    case "BACKOFFICE":
    case "DIREZIONE":
      return true;
    case "MAGAZZINO":
      return status === "IN_PREPARAZIONE" || status === "PRONTA_RITIRO";
    case "LOGISTICA":
      return status === "PRONTA_RITIRO" || status === "SPEDITA" || status === "COMPLETATA";
    case "CRM":
      return false;
  }
}
