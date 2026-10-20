import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DetailItem } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  attentionMissing,
  ItemFormat,
  PhoneNoticeBadge,
  PhoneNoticeValue,
  recipientOf,
} from "@/components/logistica/delivery-info";
import { formatBytes } from "@/components/logistica/utils";
import { requireUser } from "@/lib/auth/session";
import { parseEmailList } from "@/lib/email/recipients";
import { formatCm, formatDate, formatKg, formatM2, formatNumber, LANGUAGE_LABELS, requestCode } from "@/lib/format";
import { listDeliveryForms, type DeliveryFormRow } from "../_lib/queries";

export const metadata: Metadata = { title: "Bolle da preparare" };

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="space-y-0.5 text-sm text-slate-800">{children}</div>
    </div>
  );
}

function DeliveryFormCard({ r }: { r: DeliveryFormRow }) {
  const code = requestCode(r.id);
  const emails = parseEmailList(r.contact.email);
  const recipient = recipientOf(r, r.contact.name);
  // Lo stesso prodotto può essere richiesto in due formati: i m² misurati vanno sulla prima riga.
  const m2Shown = new Set<number>();
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{code}</span>
            <span className="font-normal text-slate-500">·</span>
            <span>{recipient}</span>
            {r.bollaReady ? <Badge tone="green">Bolla pronta</Badge> : <Badge tone="amber">Da preparare</Badge>}
            <PhoneNoticeBadge phoneNotice={r.phoneNotice} number={r.phoneNoticeNumber} />
          </span>
        }
        description={`Ricevuta il ${formatDate(r.receivedAt)}${r.ddtNumber ? ` · DDT n. ${r.ddtNumber}` : ""}`}
        actions={
          <>
            <a
              href={`/api/richieste/${r.id}/bolla`}
              target="_blank"
              rel="noopener"
              className={buttonClasses("primary", "md", "w-full sm:w-auto")}
            >
              Scarica bolla PDF
            </a>
            <LinkButton href={`/richieste/${r.id}`} className="w-full sm:w-auto">
              Apri richiesta
            </LinkButton>
          </>
        }
      />
      <CardBody className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Block title="Cessionario (contatto)">
          <p className="font-semibold text-slate-900">{r.contact.name}</p>
          {r.contact.company && r.contact.company !== r.contact.name ? <p>{r.contact.company}</p> : null}
          {r.contact.defaultAddress ? <p className="whitespace-pre-line">{r.contact.defaultAddress}</p> : null}
          {r.contact.country ? <p>{r.contact.country}</p> : null}
          {r.contact.phone ? (
            <p>
              Tel.{" "}
              <a href={`tel:${r.contact.phone.replace(/[^\d+]/g, "")}`} className="text-brand-700 hover:underline">
                {r.contact.phone}
              </a>
            </p>
          ) : (
            <p className="text-slate-400">Telefono non indicato</p>
          )}
          {emails.length ? (
            <p className="break-all">
              {emails.map((e, i) => (
                <span key={e}>
                  {i > 0 ? ", " : ""}
                  <a href={`mailto:${e}`} className="text-brand-700 hover:underline">
                    {e}
                  </a>
                </span>
              ))}
            </p>
          ) : (
            <p className="text-red-700">Nessuna email valida</p>
          )}
          <p className="text-xs text-slate-500">
            Lingua: {LANGUAGE_LABELS[r.contact.language]}
            {r.contact.agent ? ` · Agente: ${r.contact.agent.name}` : ""}
          </p>
        </Block>

        <Block title="Luogo di destinazione">
          <p className="font-semibold text-slate-900">{recipient}</p>
          {r.attentionOf?.trim() ? (
            <p>Alla c.a. {r.attentionOf.trim()}</p>
          ) : attentionMissing(r) ? (
            <p className="text-xs text-amber-700">«Alla c.a.» non indicato: il destinatario sembra una ditta.</p>
          ) : null}
          <p className="whitespace-pre-line">{r.destinationAddress || "Indirizzo non indicato"}</p>
          <div className="pt-3">
            <p className="text-xs font-semibold text-slate-500">Preavviso telefonico</p>
            <p>
              <PhoneNoticeValue phoneNotice={r.phoneNotice} number={r.phoneNoticeNumber} />
            </p>
          </div>
          {r.notes ? (
            <div className="pt-3">
              <p className="text-xs font-semibold text-slate-500">Note della richiesta</p>
              <p className="whitespace-pre-line">{r.notes}</p>
            </div>
          ) : null}
          {r.warehouseNotes ? (
            <div className="pt-3">
              <p className="text-xs font-semibold text-slate-500">Note del magazzino</p>
              <p className="whitespace-pre-line">{r.warehouseNotes}</p>
            </div>
          ) : null}
        </Block>

        <Block title="Spedizione">
          <dl className="grid grid-cols-2 gap-3">
            <DetailItem label="Colli">{r.packagesCount ?? ""}</DetailItem>
            <DetailItem label="Peso lordo">{formatKg(r.weightKg)}</DetailItem>
            <DetailItem label="m² totali">{r.totalM2 > 0 ? formatM2(r.totalM2) : ""}</DetailItem>
            <DetailItem label="Pezzi misurati">{r.piecesCount || ""}</DetailItem>
            <DetailItem label="Corriere">{r.carrier?.name}</DetailItem>
            <DetailItem label="Data di ritiro">{formatDate(r.pickupDate)}</DetailItem>
            <DetailItem label="Numero DDT">{r.ddtNumber}</DetailItem>
            <DetailItem label="DDT caricato">
              {r.ddtAttachment ? (
                <a
                  href={`/api/richieste/${r.id}/ddt`}
                  target="_blank"
                  rel="noopener"
                  className="break-all text-brand-700 hover:underline"
                >
                  {r.ddtAttachment.fileName} ({formatBytes(r.ddtAttachment.sizeBytes)})
                </a>
              ) : null}
            </DetailItem>
          </dl>
          {r.deliveryFormReady ? <p className="pt-2 text-xs text-emerald-700">Segnata come «bolla pronta».</p> : null}
        </Block>
      </CardBody>

      <div className="border-t border-slate-100">
        <h3 className="px-5 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Prodotti richiesti</h3>
        <Table>
          <THead>
            <tr>
              <TH>Codice</TH>
              <TH>Formato</TH>
              <TH>Descrizione</TH>
              <TH className="text-right">Quantità</TH>
              <TH className="text-right">m²</TH>
            </tr>
          </THead>
          <TBody>
            {r.items.map((item) => {
              const m2 = m2Shown.has(item.productId) ? undefined : r.m2ByProduct.get(item.productId);
              m2Shown.add(item.productId);
              return (
                <TR key={item.id}>
                  <TD className="font-mono text-xs whitespace-nowrap">{item.product.code}</TD>
                  <TD className="whitespace-nowrap font-medium">
                    <ItemFormat item={item} />
                  </TD>
                  <TD className="min-w-72">
                    {item.product.description || "—"}
                    {item.notes ? <p className="text-xs text-slate-500">Nota: {item.notes}</p> : null}
                  </TD>
                  <TD className="text-right tabular-nums">{item.quantity}</TD>
                  <TD className="text-right whitespace-nowrap tabular-nums">{m2 ? formatNumber(m2, 2) : "—"}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      <div className="border-t border-slate-100">
        <h3 className="px-5 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Misure dei pezzi</h3>
        {r.pieces.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-slate-500">Nessun pezzo misurato (es. mazzetta colori o cartella).</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Prodotto</TH>
                <TH className="text-right">Lunghezza × larghezza</TH>
                <TH className="text-right">Q.tà</TH>
                <TH className="text-right">m²</TH>
                <TH>Stato del pezzo</TH>
              </tr>
            </THead>
            <TBody>
              {r.pieces.map((p) => (
                <TR key={p.id}>
                  <TD className="font-mono text-xs whitespace-nowrap">{p.product.code}</TD>
                  <TD className="text-right whitespace-nowrap tabular-nums">
                    {formatCm(p.lengthCm)} × {formatCm(p.widthCm)} cm
                  </TD>
                  <TD className="text-right tabular-nums">{p.quantity}</TD>
                  <TD className="text-right whitespace-nowrap tabular-nums">{formatNumber(p.areaM2, 2)}</TD>
                  <TD className="text-slate-600">{p.conditionNote || "—"}</TD>
                </TR>
              ))}
              <TR className="bg-slate-50/60">
                <TD className="font-semibold">Totale</TD>
                <TD />
                <TD className="text-right font-semibold tabular-nums">{r.piecesCount}</TD>
                <TD className="text-right font-semibold whitespace-nowrap tabular-nums">{formatNumber(r.totalM2, 2)}</TD>
                <TD />
              </TR>
            </TBody>
          </Table>
        )}
      </div>
    </Card>
  );
}

export default async function DeliveryFormsPage() {
  await requireUser("logistics.work");
  const rows = await listDeliveryForms();
  // Prima quelle ancora da preparare, poi le pronte (ciascun gruppo dalla più vecchia).
  const sorted = [...rows.filter((r) => !r.bollaReady), ...rows.filter((r) => r.bollaReady)];
  const todo = rows.length - rows.filter((r) => r.bollaReady).length;

  return (
    <>
      <PageHeader
        eyebrow="Logistica"
        title="Bolle da preparare"
        description={
          rows.length
            ? `Richieste pronte per il ritiro con «bolla di consegna richiesta»: ${todo} da preparare, ${rows.length - todo} già pronte.`
            : "Richieste pronte per il ritiro per cui il back office ha chiesto la bolla di consegna."
        }
      />
      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            title="Nessuna bolla da preparare"
            description="Quando una richiesta con «bolla di consegna richiesta» è pronta per il ritiro, la trovi qui con tutti i dati per compilare il documento."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {sorted.map((r) => (
            <DeliveryFormCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </>
  );
}
