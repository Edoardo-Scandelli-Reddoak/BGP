import type { SessionUser } from "@/lib/auth/session";
import type { RequestDetail } from "@/lib/requests/queries";
import type { WorkflowSnapshot } from "@/lib/requests/workflow";

/**
 * CONTRATTO (implementato dal modulo magazzino): pannello "Preparazione magazzino" mostrato
 * nella pagina di dettaglio /richieste/[id] quando lo stato è In preparazione o successivo.
 * Server component; gestisce da solo modificabilità e azioni in base a ruolo e stato.
 */
export async function WarehousePanel(props: { request: RequestDetail; user: SessionUser; snapshot: WorkflowSnapshot }) {
  void props;
  return null;
}
