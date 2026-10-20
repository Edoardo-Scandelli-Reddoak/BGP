/**
 * Correzione una tantum (idempotente) dei contatti importati prima delle nuove regole dell'import:
 *  1. paese «Italia» ricavato a torto dall'indirizzo (sigle estere come (EE), (HR), (SM), CAP non
 *     italiani): ricalcolato con la regola attuale (Croazia, San Marino, Svizzera o non indicato) e
 *     contatto segnato «da verificare»;
 *  2. clienti senza lingua nel file di BGP (importati in italiano senza avviso) e agenti senza nessun
 *     cliente con la lingua: segnati «da verificare».
 * Tocca solo i contatti riconosciuti nel file (stessa chiave dell'import: nome + indirizzo, agenti per
 * email/nome); quelli inseriti a mano o dal modulo pubblico restano come sono.
 *
 *   npx tsx --conditions=react-server scripts/fix-countries-languages.ts \
 *     [--contatti ../Lista_clienti_Airtable.xlsx] [--dry-run]
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { agentKey, customerKey, parseContactRows } from "@/lib/import/parse";
import { readTabularFile } from "@/lib/import/read-file";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = path.resolve(arg("contatti") ?? "../Lista_clienti_Airtable.xlsx");
  const dryRun = process.argv.includes("--dry-run");
  const { agents, customers } = parseContactRows(await readTabularFile(file, await readFile(file)));
  const parsedByKey = new Map(customers.rows.map((c) => [c.key, c]));

  // Agenti per cui nessun cliente del file ha la lingua: la loro lingua è un valore predefinito.
  const agentsWithLanguage = new Set(customers.rows.filter((c) => c.language && c.agentKey).map((c) => c.agentKey));
  const agentKeysWithoutLanguage = new Set(agents.filter((a) => !agentsWithLanguage.has(a.key)).map((a) => a.key));

  const existing = await db
    .select({
      id: contacts.id,
      type: contacts.type,
      name: contacts.name,
      email: contacts.email,
      defaultAddress: contacts.defaultAddress,
      country: contacts.country,
      needsReview: contacts.needsReview,
    })
    .from(contacts);

  const countryFixes: { id: number; name: string; address: string | null; country: string | null }[] = [];
  const languageReview: { id: number; name: string }[] = [];
  for (const c of existing) {
    if (c.type === "AGENTE") {
      if (agentKeysWithoutLanguage.has(agentKey(c.name, c.email)) && !c.needsReview) {
        languageReview.push({ id: c.id, name: c.name });
      }
      continue;
    }
    const parsed = parsedByKey.get(customerKey(c.name, c.defaultAddress));
    if (!parsed) continue;
    if (c.country === "Italia" && parsed.countryDerived && parsed.country !== "Italia") {
      countryFixes.push({ id: c.id, name: c.name, address: c.defaultAddress, country: parsed.country });
    } else if (parsed.language === null && !c.needsReview) {
      languageReview.push({ id: c.id, name: c.name });
    }
  }

  console.log(`File: ${file}${dryRun ? " (prova: nessuna modifica)" : ""}`);
  console.log(`\nPaese «Italia» da correggere: ${countryFixes.length}`);
  const byCountry = new Map<string, number>();
  for (const f of countryFixes) byCountry.set(f.country ?? "non indicato", (byCountry.get(f.country ?? "non indicato") ?? 0) + 1);
  for (const [country, n] of byCountry) console.log(`  → ${country}: ${n}`);
  for (const f of countryFixes) console.log(`    ${f.name} | ${f.address ?? ""} → ${f.country ?? "non indicato"}`);
  console.log(`\nLingua mancante nel file, da verificare: ${languageReview.length}`);
  for (const r of languageReview.slice(0, 10)) console.log(`    ${r.name}`);
  if (languageReview.length > 10) console.log(`    … altri ${languageReview.length - 10}`);

  if (dryRun || (countryFixes.length === 0 && languageReview.length === 0)) return;

  await db.transaction(async (tx) => {
    for (const f of countryFixes) {
      await tx
        .update(contacts)
        .set({ country: f.country, needsReview: true })
        .where(and(eq(contacts.id, f.id), eq(contacts.country, "Italia")));
    }
    const ids = languageReview.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      await tx.update(contacts).set({ needsReview: true }).where(inArray(contacts.id, ids.slice(i, i + 500)));
    }
  });
  console.log("\nCorrezioni salvate.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
