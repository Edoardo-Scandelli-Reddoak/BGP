/**
 * Import iniziale (o aggiornamento) di contatti e prodotti dai file di BGP.
 *   npm run import -- --contatti ../Lista_clienti_Airtable.xlsx --prodotti "../Product list.xlsx"
 * Formati: .xlsx (primo foglio) o .csv. Vedi src/lib/import/parse.ts per le colonne riconosciute.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { importContacts, importProducts, type ImportSummary } from "@/lib/import/import-db";
import { readTabularFile } from "@/lib/import/read-file";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function printRows(title: string, rows: { row: number; reason: string }[], max = 15) {
  if (rows.length === 0) return;
  console.log(`  ${title}:`);
  for (const r of rows.slice(0, max)) console.log(`    riga ${r.row}: ${r.reason}`);
  if (rows.length > max) console.log(`    … altre ${rows.length - max}`);
}

function print(label: string, s: ImportSummary) {
  console.log(
    `\n${label}: ${s.created} creati, ${s.updated} aggiornati, ${s.unchanged} invariati, ${s.skipped.length} scartati, ${s.warnings.length} da verificare`,
  );
  if (s.agentsCreated !== undefined) console.log(`  agenti: ${s.agentsCreated} creati, ${s.agentsUpdated} aggiornati`);
  printRows("scartati", s.skipped);
  printRows("da verificare", s.warnings);
}

async function main() {
  const contatti = arg("contatti");
  const prodotti = arg("prodotti");
  if (!contatti && !prodotti) {
    console.log('Uso: npm run import -- --contatti <file.xlsx|csv> --prodotti <file.xlsx|csv>');
    process.exit(1);
  }
  if (prodotti) {
    const file = path.resolve(prodotti);
    print("Prodotti", await importProducts(await readTabularFile(file, await readFile(file))));
  }
  if (contatti) {
    const file = path.resolve(contatti);
    print("Contatti", await importContacts(await readTabularFile(file, await readFile(file))));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
