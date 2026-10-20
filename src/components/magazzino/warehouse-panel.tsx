import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DetailItem } from "@/components/ui/card";
import type { SessionUser } from "@/lib/auth/session";
import { formatDateTime, formatKg, formatM2, requestCode } from "@/lib/format";
import type { RequestDetail } from "@/lib/requests/queries";
import { EDITABLE_IN, type WorkflowSnapshot } from "@/lib/requests/workflow";
import { can } from "@/lib/roles";
import { sampleFormatMissing } from "@/lib/sample-formats";
import { PiecesSection } from "./pieces-section";
import { PreparationForm } from "./preparation-form";
import { SampleFormatLabel } from "./sample-format-label";
import type { PieceGroup, WarehouseProduct } from "./types";

function SectionTitle({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h3 id={id} className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {children}
      </h3>
      {aside ? <div className="text-sm text-slate-600">{aside}</div> : null}
    </div>
  );
}

/**
 * Prodotti selezionabili per i pezzi misurati: i pezzi sono legati al prodotto, non al formato,
 * quindi un prodotto richiesto in due formati (es. mazzetta e doghe intere) compare una volta sola.
 */
function warehouseProducts(request: RequestDetail): WarehouseProduct[] {
  const byId = new Map<number, WarehouseProduct>();
  for (const item of request.items) {
    const p = byId.get(item.productId);
    if (p) p.requestedQty += item.quantity;
    else
      byId.set(item.productId, {
        productId: item.productId,
        code: item.product.code,
        description: item.product.description,
        requestedQty: item.quantity,
      });
  }
  return [...byId.values()];
}

/** Pezzi raggruppati per prodotto, nell'ordine dei prodotti richiesti. */
function groupPieces(request: RequestDetail): PieceGroup[] {
  const order = new Map<number, number>();
  request.items.forEach((item, i) => {
    if (!order.has(item.productId)) order.set(item.productId, i);
  });
  const groups = new Map<number, PieceGroup>();
  for (const p of request.pieces) {
    let g = groups.get(p.productId);
    if (!g) {
      g = { productId: p.productId, code: p.product.code, description: p.product.description, pieces: [], piecesCount: 0, m2: 0 };
      groups.set(p.productId, g);
    }
    g.pieces.push({
      id: p.id,
      productId: p.productId,
      lengthCm: p.lengthCm,
      widthCm: p.widthCm,
      quantity: p.quantity,
      areaM2: Number(p.areaM2),
      conditionNote: p.conditionNote,
    });
    g.piecesCount += p.quantity;
    g.m2 += Number(p.areaM2);
  }
  return [...groups.values()].sort(
    (a, b) => (order.get(a.productId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.productId) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Quando e da chi la richiesta è stata segnata pronta, e l'esito dell'avviso bolla alla logistica. */
function readyDetails(request: RequestDetail) {
  // Se la richiesta è stata riportata in preparazione, il vecchio passaggio non conta più.
  const event =
    request.status === "IN_PREPARAZIONE" ? undefined : request.events.filter((e) => e.toStatus === "PRONTA_RITIRO").at(-1);
  const readyInfo = event
    ? `Segnata pronta il ${formatDateTime(event.createdAt)}${event.user ? ` da ${event.user.name}` : ""}.`
    : null;

  let bollaNotice: { tone: "success" | "warning" | "error"; text: string } | null = null;
  if (request.deliveryFormRequired) {
    // emails è ordinato dal più recente
    const email = request.emails.find((e) => e.kind === "AVVISO_BOLLA");
    if (!email) bollaNotice = { tone: "warning", text: "Bolla richiesta: nessun avviso email alla logistica registrato." };
    else if (email.status === "ERRORE")
      bollaNotice = { tone: "error", text: `Avviso bolla alla logistica NON inviato: ${email.error ?? "errore di invio"}.` };
    else
      bollaNotice = {
        tone: "success",
        text: `Avviso bolla alla logistica ${email.status === "SIMULATA" ? "registrato (modalità prova)" : "inviato"} il ${formatDateTime(email.createdAt)}.`,
      };
  }
  return { readyInfo, bollaNotice };
}

/**
 * Pannello «Preparazione magazzino» del dettaglio richiesta (/richieste/[id]), dallo stato
 * «In preparazione» in poi. Modificabile da chi ha il permesso warehouse.work negli stati
 * EDITABLE_IN.warehouse; altrimenti riepilogo in sola lettura.
 */
export async function WarehousePanel({
  request,
  user,
  snapshot,
}: {
  request: RequestDetail;
  user: SessionUser;
  snapshot: WorkflowSnapshot;
}) {
  const editable = can(user.role, "warehouse.work") && EDITABLE_IN.warehouse.includes(request.status);
  const inPreparation = request.status === "IN_PREPARAZIONE";

  const products = warehouseProducts(request);
  const groups = groupPieces(request);
  const byProduct = new Map(groups.map((g) => [g.productId, g]));
  // Prodotto presente su più righe (formati diversi): i pezzi misurati sono il totale del prodotto.
  const linesPerProduct = new Map<number, number>();
  for (const item of request.items) linesPerProduct.set(item.productId, (linesPerProduct.get(item.productId) ?? 0) + 1);
  const missingFormat = request.items.filter((i) => sampleFormatMissing(i.sampleFormat, i.formatNote)).length;
  // Back office e amministratore possono correggere i prodotti da soli; il magazzino deve chiedere.
  const canEditItems = can(user.role, "requests.manage") && EDITABLE_IN.items.includes(request.status);
  const { readyInfo, bollaNotice } = readyDetails(request);

  const description = editable
    ? inPreparation
      ? "Prepara i prodotti, registra le misure dei pezzi, poi colli e peso."
      : "Dati registrati dal magazzino."
    : "Riepilogo dei dati registrati dal magazzino.";

  return (
    <Card aria-labelledby="magazzino-title">
      <CardHeader
        title={<span id="magazzino-title">Preparazione magazzino</span>}
        description={description}
        actions={
          request.deliveryFormRequired ? <Badge tone="violet">Bolla di consegna richiesta</Badge> : null
        }
      />
      <CardBody className="space-y-8">
        {editable && request.status === "PRONTA_RITIRO" ? (
          <Alert tone="warning" title="Già pronta per il ritiro: modifica solo per correggere.">
            Le modifiche a colli, peso e pezzi aggiornano i dati usati da logistica, bolla e report m².
          </Alert>
        ) : null}

        {/* Prodotti da preparare */}
        <section aria-labelledby="magazzino-items">
          <SectionTitle id="magazzino-items">{inPreparation ? "Da preparare" : "Prodotti richiesti"}</SectionTitle>
          {inPreparation && missingFormat > 0 ? (
            <Alert
              tone="warning"
              className="mb-3"
              title={
                missingFormat === 1
                  ? "Formato del campione non indicato per un prodotto."
                  : `Formato del campione non indicato per ${missingFormat} prodotti.`
              }
            >
              {canEditItems ? (
                <>
                  Indica il formato modificando i prodotti della richiesta («Modifica» nella scheda Richiesta): doghe
                  intere, mezze doghe, mazzetta, pannello o espositore.
                </>
              ) : (
                <>
                  Prima di preparare chiedi al back office se servono doghe intere, mezze doghe, mazzetta, pannello o
                  espositore: può indicarlo modificando i prodotti della richiesta.
                </>
              )}
            </Alert>
          ) : null}
          {request.notes ? (
            <div className="mb-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-inset ring-amber-200">
              <span className="font-semibold">Note del back office: </span>
              <span className="whitespace-pre-line">{request.notes}</span>
            </div>
          ) : null}
          {request.items.length === 0 ? (
            <p className="text-sm text-slate-500">Nessun prodotto nella richiesta.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {request.items.map((item) => {
                const g = byProduct.get(item.productId);
                const shared = (linesPerProduct.get(item.productId) ?? 1) > 1;
                return (
                  <li key={item.id} className="flex gap-4 px-4 py-3">
                    <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-50 text-brand-900 ring-1 ring-inset ring-brand-200">
                      <span className="text-2xl font-bold leading-none tabular-nums">{item.quantity}</span>
                      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-600">qtà</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Cosa preparare: formato (doghe intere, mezze doghe, mazzetta…), poi codice e descrizione. */}
                      <p className="leading-7">
                        <SampleFormatLabel size="lg" format={item.sampleFormat} note={item.formatNote} />
                      </p>
                      <p className="mt-1 font-mono text-base font-semibold text-slate-900">{item.product.code}</p>
                      <p className="line-clamp-2 text-sm text-slate-600">{item.product.description}</p>
                      {item.notes ? <p className="mt-1 text-sm font-medium text-amber-800">Nota: {item.notes}</p> : null}
                      <p className="mt-1 text-xs text-slate-500">
                        {g ? (
                          <span className="font-medium text-emerald-700">
                            Misurati{shared ? " (totale del prodotto, tutti i formati)" : ""}: {g.piecesCount}{" "}
                            {g.piecesCount === 1 ? "pezzo" : "pezzi"} · {formatM2(g.m2)}
                          </span>
                        ) : (
                          "Nessun pezzo misurato"
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Pezzi misurati */}
        <section aria-labelledby="magazzino-pieces">
          <SectionTitle
            id="magazzino-pieces"
            aside={
              request.piecesCount > 0 ? (
                <span className="tabular-nums">
                  {request.piecesCount} {request.piecesCount === 1 ? "pezzo" : "pezzi"} · {formatM2(request.totalM2)}
                </span>
              ) : null
            }
          >
            Pezzi misurati
          </SectionTitle>
          <PiecesSection requestId={request.id} products={products} groups={groups} editable={editable} />

          {groups.length > 0 ? (
            <div className="mt-4 rounded-xl bg-brand-50/60 p-4 ring-1 ring-inset ring-brand-100">
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Pezzi totali</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{request.piecesCount}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">m² totali</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{formatM2(request.totalM2)}</dd>
                </div>
              </dl>
              {groups.length > 1 ? (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">m² per prodotto</p>
                  <ul className="mt-1 divide-y divide-brand-100 text-sm">
                    {groups.map((g) => (
                      <li key={g.productId} className="flex justify-between gap-3 py-1.5">
                        <span className="font-mono font-medium text-slate-800">{g.code}</span>
                        <span className="tabular-nums text-slate-700">
                          {g.piecesCount} pz · <span className="font-semibold">{formatM2(request.m2ByProduct.get(g.productId) ?? g.m2)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Colli, peso e passaggio di stato */}
        <section aria-labelledby="magazzino-packages">
          <SectionTitle id="magazzino-packages">Colli e peso</SectionTitle>
          {editable ? (
            <PreparationForm
              requestId={request.id}
              code={requestCode(request.id)}
              status={request.status}
              initial={{
                packagesCount: request.packagesCount,
                weightKg: request.weightKg,
                warehouseNotes: request.warehouseNotes,
              }}
              snapshot={snapshot}
              readyInfo={readyInfo}
              bollaNotice={bollaNotice}
            />
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailItem label="N° colli">{request.packagesCount ?? ""}</DetailItem>
                <DetailItem label="Peso totale">{formatKg(request.weightKg)}</DetailItem>
                <DetailItem label="Note magazzino" className="col-span-2 sm:col-span-1">
                  {request.warehouseNotes ? <span className="whitespace-pre-line">{request.warehouseNotes}</span> : ""}
                </DetailItem>
              </dl>
              {readyInfo ? <p className="text-sm text-slate-600">{readyInfo}</p> : null}
              {inPreparation ? (
                <p className="text-sm text-slate-500">Il magazzino sta preparando il campionario.</p>
              ) : null}
            </div>
          )}
        </section>
      </CardBody>
    </Card>
  );
}
