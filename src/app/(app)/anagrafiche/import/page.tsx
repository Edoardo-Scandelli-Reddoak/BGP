import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ImportForm } from "@/components/anagrafiche/import-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { formatNumber } from "@/lib/format";
import { registryCounts } from "../_lib/queries";

export const metadata: Metadata = { title: "Importa anagrafiche" };

/** Colonna del file: nome, descrizione e se è obbligatoria o consigliata. */
type ImportColumn = [name: string, description: ReactNode, level?: "obbligatoria" | "consigliata"];

const LINK = "font-medium text-brand-700 hover:underline";

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

        <Alert tone="info" title="Completare paesi, marchi e categorie in Excel">
          Esporta l&apos;elenco attuale da{" "}
          <Link href="/anagrafiche/contatti" className={LINK}>
            Anagrafiche → Contatti
          </Link>{" "}
          o{" "}
          <Link href="/anagrafiche/prodotti" className={LINK}>
            Prodotti
          </Link>{" "}
          con «Esporta Excel»: il file ha già le colonne di questa pagina. Completa in Excel le colonne Country (paese),
          Marchio e Categoria e importalo qui: i contatti sono riconosciuti da nome e indirizzo (non modificarli nel
          file), i prodotti dal codice.
        </Alert>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Contatti" description="Clienti e agenti, come nell'export Airtable «Lista clienti»." />
            <CardBody className="space-y-5">
              <ColumnList
                columns={[
                  ["Name", "nome o ragione sociale del cliente", "obbligatoria"],
                  ["Email", "uno o più indirizzi separati da «;»"],
                  [
                    "Default address",
                    "indirizzo predefinito; se la colonna Country è vuota il paese viene ricavato da qui, es. CAP italiano e sigla di provincia «(BG)» → Italia",
                  ],
                  ["Agent name", "agente di riferimento (vuoto = cliente direzionale)"],
                  ["Agent email (cc)", "email dell'agente, in copia nelle conferme di spedizione"],
                  ["Language", "Italiano, English, Français o Deutsch (vuoto = italiano)"],
                  [
                    "Country",
                    "paese del cliente: nome in italiano, in inglese o nella lingua del paese (Italia, France, Schweiz, Hrvatska…) oppure sigla ISO (IT, FR, CH); viene salvato in italiano. Vale più del paese ricavato dall'indirizzo; una cella vuota lascia il paese già salvato.",
                    "consigliata",
                  ],
                ]}
                extra="Facoltativa: Phone / Telefono. Le intestazioni sono riconosciute anche in italiano (Nome, Indirizzo, Agente, Lingua, Paese o Nazione)."
              />
              <Rules
                items={[
                  "Gli agenti vengono creati o aggiornati a partire dalle colonne Agent name e Agent email.",
                  "Un cliente già presente (stesso nome e indirizzo) viene aggiornato: email, agente, lingua, paese e telefono vengono allineati al file.",
                  "Un paese non riconosciuto viene salvato com'è e segnalato nel riepilogo; i clienti che restano senza paese sono indicati con un unico avviso (in Contatti, filtro Paese «Non indicato»).",
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
                  ["Codice_articolo", "codice articolo del gestionale BGP", "obbligatoria"],
                  ["Descrizione_articolo_estesa", "descrizione mostrata nei moduli, nelle email e nella bolla"],
                  [
                    "Marchio",
                    "es. SmartFloors, Gaia Parquet, AFAP, Aquawood; abbinato ai marchi già presenti senza distinguere maiuscole e spazi («gaia parquet» diventa «Gaia Parquet»)",
                    "consigliata",
                  ],
                  [
                    "Categoria",
                    "es. Legno, SPC, Rivestimento, Tecnico; abbinata alle categorie già presenti allo stesso modo",
                    "consigliata",
                  ],
                  ["Prezzo_m2", "facoltativa: prezzo al m² in euro, es. 45,50 (valore dei campioni nei costi, se attivo in Impostazioni → Costi)"],
                  ["Attivo", "facoltativa: Sì / No; con «No» il prodotto viene disattivato (è nel file di «Esporta Excel»)"],
                ]}
                extra="Sono accettate anche le intestazioni Codice, SKU, Descrizione, Description, Brand, Category, Prezzo al m2 / Prezzo m²."
              />
              <Rules
                items={[
                  "I prodotti sono riconosciuti dal codice, senza distinzione tra maiuscole e minuscole.",
                  "Se la descrizione è cambiata viene aggiornata. I prodotti del file vengono attivati, salvo «No» nella colonna Attivo: così un file esportato e reimportato non riattiva quelli disattivati.",
                  "Marchio, categoria e prezzo al m² vengono aggiornati solo se la cella è compilata: le celle vuote non cancellano i valori salvati. Un prezzo non numerico viene ignorato e segnalato nel riepilogo.",
                  "Formato e finitura inseriti a mano non vengono modificati.",
                  "Codici ripetuti nel file vengono segnalati: vale la prima riga.",
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

function ColumnList({ columns, extra }: { columns: ImportColumn[]; extra?: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Colonne attese</h3>
      <ul className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        {columns.map(([name, desc, level]) => (
          <li key={name} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:gap-3">
            <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 sm:w-48 sm:flex-col sm:items-start sm:pt-0.5">
              <code className="font-mono text-xs font-semibold break-words text-brand-800">
                {name}
                {level === "obbligatoria" ? (
                  <span className="ml-0.5 text-red-600" title="obbligatoria">
                    *
                  </span>
                ) : null}
              </code>
              {level === "consigliata" ? <Badge tone="blue">consigliata</Badge> : null}
            </div>
            <span className="min-w-0 break-words text-slate-600">{desc}</span>
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
