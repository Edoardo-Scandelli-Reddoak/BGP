import type { RequestStatus } from "@/db/schema";
import type { Permission } from "@/lib/roles";
import { nextStatus } from "@/lib/status";

/**
 * Regole del flusso a 5 stati (blueprint BGP, sezione 2 "What triggers each transition").
 * Funzioni pure: usate dal servizio lato server e dai pannelli per mostrare cosa manca.
 */

export type WorkflowSnapshot = {
  status: RequestStatus;
  contactId: number | null;
  contactHasEmail: boolean;
  destinationAddress: string | null;
  itemsCount: number;
  packagesCount: number | null;
  weightKg: number | null;
  piecesCount: number;
  deliveryFormRequired: boolean;
  deliveryFormReady: boolean;
  carrierId: number | null;
  pickupDate: string | null;
  ddtNumber: string | null;
  hasDdtAttachment: boolean;
  trackingNumber: string | null;
  shipmentDate: string | null;
  notificationSentAt: Date | null;
};

export type TransitionOptions = {
  /** Il magazzino conferma che non ci sono pezzi da misurare (es. mazzetta colori). */
  acknowledgeNoPieces?: boolean;
};

/** Permesso necessario per far avanzare la richiesta da `from` allo stato successivo. */
export function transitionPermission(from: RequestStatus): Permission | null {
  switch (from) {
    case "NUOVA":
      return "requests.manage";
    case "IN_PREPARAZIONE":
      return "warehouse.work";
    case "PRONTA_RITIRO":
      return "logistics.work";
    // SPEDITA → COMPLETATA è automatico (conferma email) o "completa senza email".
    default:
      return null;
  }
}

/** Etichetta del pulsante che fa avanzare la richiesta. */
export const ADVANCE_LABELS: Partial<Record<RequestStatus, string>> = {
  NUOVA: "Invia al magazzino",
  IN_PREPARAZIONE: "Pronta per il ritiro",
  PRONTA_RITIRO: "Segna come spedita",
};

export function bollaSatisfied(s: Pick<WorkflowSnapshot, "deliveryFormRequired" | "deliveryFormReady" | "ddtNumber" | "hasDdtAttachment">): boolean {
  if (!s.deliveryFormRequired) return true;
  return s.deliveryFormReady || Boolean(s.ddtNumber?.trim()) || s.hasDdtAttachment;
}

/**
 * Cosa manca per passare allo stato successivo. Lista vuota = transizione consentita.
 * I messaggi sono pensati per essere mostrati così come sono all'utente.
 */
export function transitionProblems(
  s: WorkflowSnapshot,
  to: RequestStatus,
  options: TransitionOptions = {},
): string[] {
  const problems: string[] = [];
  if (nextStatus(s.status) !== to) {
    return [`Passaggio non consentito: la richiesta è nello stato sbagliato.`];
  }
  switch (to) {
    case "IN_PREPARAZIONE":
      if (!s.contactId) problems.push("Seleziona il contatto (cliente o agente).");
      if (!s.destinationAddress?.trim()) problems.push("Indica l'indirizzo di destinazione.");
      if (s.itemsCount === 0) problems.push("Aggiungi almeno un prodotto richiesto.");
      break;
    case "PRONTA_RITIRO":
      if (!s.packagesCount || s.packagesCount < 1) problems.push("Indica il numero di colli.");
      if (!s.weightKg || s.weightKg <= 0) problems.push("Indica il peso totale in kg.");
      if (s.piecesCount === 0 && !options.acknowledgeNoPieces) {
        problems.push("Registra le misure dei pezzi oppure conferma che non ci sono pezzi da misurare.");
      }
      break;
    case "SPEDITA":
      if (!s.carrierId) problems.push("Seleziona il corriere.");
      if (!s.pickupDate) problems.push("Indica la data di ritiro.");
      if (!bollaSatisfied(s)) {
        problems.push("Bolla di consegna richiesta: preparala (numero DDT, file caricato o «bolla pronta»).");
      }
      break;
    case "COMPLETATA":
      problems.push("La richiesta si completa automaticamente quando parte la conferma di spedizione.");
      break;
    default:
      problems.push("Passaggio non consentito.");
  }
  return problems;
}

/**
 * Automazione 2 del blueprint: "Tracking number is not empty AND Status = Shipped"
 * → email al cliente con l'agente in CC, poi la richiesta passa a Completata.
 */
export function shouldSendShipmentConfirmation(s: WorkflowSnapshot): boolean {
  return (
    s.status === "SPEDITA" &&
    Boolean(s.trackingNumber?.trim()) &&
    Boolean(s.shipmentDate) &&
    s.notificationSentAt === null
  );
}

/** Cosa manca per inviare la conferma di spedizione (per i messaggi nel pannello logistica). */
export function shipmentConfirmationProblems(s: WorkflowSnapshot): string[] {
  const problems: string[] = [];
  if (!s.trackingNumber?.trim()) problems.push("Inserisci il numero di tracking.");
  if (!s.shipmentDate) problems.push("Inserisci la data di spedizione.");
  if (!s.contactHasEmail) problems.push("Il contatto non ha un indirizzo email valido.");
  return problems;
}

/** Stati in cui ciascun gruppo di campi è modificabile. */
export const EDITABLE_IN = {
  /** Contatto, destinazione, note, bolla richiesta. */
  info: ["NUOVA", "IN_PREPARAZIONE", "PRONTA_RITIRO"] as RequestStatus[],
  /** Prodotti richiesti e quantità. */
  items: ["NUOVA", "IN_PREPARAZIONE"] as RequestStatus[],
  /** Colli, peso, note di magazzino, pezzi. */
  warehouse: ["IN_PREPARAZIONE", "PRONTA_RITIRO"] as RequestStatus[],
  /** Corriere, date, tracking, DDT, costo. */
  logistics: ["PRONTA_RITIRO", "SPEDITA", "COMPLETATA"] as RequestStatus[],
};
