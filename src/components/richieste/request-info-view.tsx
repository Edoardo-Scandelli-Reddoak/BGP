import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DetailItem } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatM2 } from "@/lib/format";
import type { RequestDetail } from "@/lib/requests/queries";
import { ContactSummary } from "./contact-summary";

/** Contenuto in sola lettura del pannello «Richiesta» (contatto, destinazione, note, prodotti). */
export function RequestInfoView({ request, canViewRegistry }: { request: RequestDetail; canViewRegistry: boolean }) {
  const { contact } = request;
  const contactHref = canViewRegistry ? `/anagrafiche/contatti/${contact.id}` : null;
  const hasPieces = request.pieces.length > 0;
  const totalQty = request.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="space-y-6">
      {contact.needsReview ? (
        <Alert tone="warning" title="Contatto da verificare in anagrafica">
          Il contatto arriva dal modulo pubblico o da un import con dati mancanti: controlla nome, email, lingua e agente (e le note della richiesta) prima di inviarla al magazzino.
          {contactHref ? (
            <>
              {" "}
              <Link href={contactHref} className="font-semibold underline underline-offset-2">
                Apri la scheda del contatto
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Contatto</h3>
          <ContactSummary
            href={contactHref}
            contact={{
              id: contact.id,
              type: contact.type,
              name: contact.name,
              company: contact.company,
              email: contact.email,
              phone: contact.phone,
              country: contact.country,
              language: contact.language,
              agentName: contact.agent?.name ?? null,
              agentEmail: contact.agent?.email ?? null,
              needsReview: contact.needsReview,
              active: contact.active,
            }}
          />
        </div>
        <dl className="space-y-4">
          <DetailItem label="Indirizzo di destinazione">
            {request.destinationAddress ? <span className="whitespace-pre-line">{request.destinationAddress}</span> : null}
          </DetailItem>
          <DetailItem label="Bolla di consegna">
            {request.deliveryFormRequired ? (
              <Badge tone="amber">Richiesta</Badge>
            ) : (
              <span className="text-slate-600">Non richiesta</span>
            )}
          </DetailItem>
          <DetailItem label="Note">
            {request.notes ? <span className="whitespace-pre-line">{request.notes}</span> : null}
          </DetailItem>
          {request.source === "MODULO_PUBBLICO" && (request.requesterName || request.requesterEmail) ? (
            <DetailItem label="Compilata da (modulo pubblico)">
              {[request.requesterName, request.requesterEmail].filter(Boolean).join(" · ")}
            </DetailItem>
          ) : null}
        </dl>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Prodotti richiesti ({request.items.length})
        </h3>
        {request.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            Nessun prodotto: aggiungili con «Modifica».
          </p>
        ) : (
          <div className="rounded-lg ring-1 ring-slate-200">
            <Table>
              <THead>
                <tr>
                  <TH>Codice</TH>
                  <TH>Descrizione</TH>
                  <TH className="text-right">Q.tà</TH>
                  <TH>Note</TH>
                  <TH className="text-right">m² misurati</TH>
                </tr>
              </THead>
              <TBody>
                {request.items.map((item) => {
                  const m2 = request.m2ByProduct.get(item.productId);
                  return (
                    <TR key={item.id}>
                      <TD className="font-mono text-sm font-semibold whitespace-nowrap text-brand-800">{item.product.code}</TD>
                      <TD className="max-w-md">
                        <span className="line-clamp-2" title={item.product.description}>
                          {item.product.description || "—"}
                        </span>
                      </TD>
                      <TD className="text-right font-medium tabular-nums">{item.quantity}</TD>
                      <TD className="text-slate-600">{item.notes || <span className="text-slate-400">—</span>}</TD>
                      <TD className="text-right whitespace-nowrap tabular-nums">
                        {m2 !== undefined ? formatM2(m2) : <span className="text-slate-400">—</span>}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
              <tfoot className="bg-slate-50 text-sm">
                <tr>
                  <td className="px-4 py-2.5 font-medium text-slate-700" colSpan={2}>
                    Totale
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{totalQty}</td>
                  <td />
                  <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap tabular-nums">
                    {hasPieces ? formatM2(request.totalM2) : <span className="font-normal text-slate-400">Non misurati</span>}
                  </td>
                </tr>
              </tfoot>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
