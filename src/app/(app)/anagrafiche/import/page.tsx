import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ImportForm } from "@/components/anagrafiche/import-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { formatNumber } from "@/lib/format";
import { registryCounts } from "../_lib/queries";

export const metadata: Metadata = { title: "Importa anagrafiche" };

export default async function ImportPage() {
  await requireUser("registry.edit");
  const counts = await registryCounts();

  return (
    <>
      <PageHeader
        eyebrow="Anagrafiche"
        title="Importa da file"
        description="Carica l'elenco clienti esportato da Airtable o il listino prodotti per creare e aggiornare le anagrafiche."
      />

      <div className="space-y-6">
        <Alert tone="info" title="Nessun dato viene eliminato">
          L&apos;import crea i record nuovi e aggiorna quelli già presenti; contatti e prodotti assenti dal file restano
          invariati. Oggi in anagrafica: {formatNumber(counts.customers, 0)} clienti, {formatNumber(counts.agents, 0)}{" "}
          agenti e {formatNumber(counts.products, 0)} prodotti ({formatNumber(counts.activeProducts, 0)} attivi).
        </Alert>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Contatti" description="Clienti e agenti, come nell'export Airtable «Lista clienti»." />
            <CardBody className="space-y-5">
              <ColumnList
                columns={[
                  ["Name", "nome o ragione sociale del cliente", true],
                  ["Email", "uno o più indirizzi separati da «;»"],
                  ["Default address", "indirizzo predefinito; se termina con la sigla di provincia, es. «(BG)», il paese diventa Italia"],
                  ["Agent name", "agente di riferimento (vuoto = cliente direzionale)"],
                  ["Agent email (cc)", "email dell'agente, in copia nelle conferme di spedizione"],
                  ["Language", "Italiano, English, Français o Deutsch (vuoto = italiano)"],
                ]}
                extra="Facoltative: Phone / Telefono, Country / Paese. Le intestazioni sono riconosciute anche in italiano (Nome, Indirizzo, Agente, Lingua)."
              />
              <Rules
                items={[
                  "Gli agenti vengono creati o aggiornati a partire dalle colonne Agent name e Agent email.",
                  "Un cliente già presente (stesso nome e indirizzo) viene aggiornato: email, agente, lingua, paese e telefono vengono allineati al file.",
                  "Righe senza nome o ripetute nel file vengono scartate e segnalate nel riepilogo.",
                ]}
              />
              <ImportForm kind="contatti" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Prodotti" description="Listino articoli, come nel file «Product list»." />
            <CardBody className="space-y-5">
              <ColumnList
                columns={[
                  ["Codice_articolo", "codice articolo del gestionale BGP", true],
                  ["Descrizione_articolo_estesa", "descrizione mostrata nei moduli, nelle email e nella bolla"],
                ]}
                extra="Sono accettate anche le intestazioni Codice, SKU, Descrizione, Description."
              />
              <Rules
                items={[
                  "I prodotti sono riconosciuti dal codice, senza distinzione tra maiuscole e minuscole.",
                  "Se la descrizione è cambiata viene aggiornata; i prodotti disattivati presenti nel file vengono riattivati.",
                  "Marchio, categoria, formato e finitura inseriti a mano non vengono modificati.",
                  "Codici ripetuti nel file vengono segnalati: vale l'ultima riga.",
                ]}
              />
              <ImportForm kind="prodotti" />
            </CardBody>
          </Card>
        </div>

        <p className="text-xs text-slate-500">
          File accettati: Excel .xlsx (viene letto il primo foglio, con le intestazioni nella prima riga) oppure .csv in
          UTF-8 con separatore «;» o «,». Dimensione massima 15 MB.
        </p>
      </div>
    </>
  );
}

function ColumnList({ columns, extra }: { columns: [string, string, boolean?][]; extra?: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Colonne attese</h3>
      <ul className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        {columns.map(([name, desc, required]) => (
          <li key={name} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:gap-3">
            <code className="shrink-0 font-mono text-xs font-semibold text-brand-800 sm:w-48 sm:pt-0.5">
              {name}
              {required ? <span className="ml-0.5 text-red-600">*</span> : null}
            </code>
            <span className="text-slate-600">{desc}</span>
          </li>
        ))}
      </ul>
      {extra ? <p className="mt-2 text-xs text-slate-500">{extra}</p> : null}
    </div>
  );
}

function Rules({ items }: { items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Come funziona</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
