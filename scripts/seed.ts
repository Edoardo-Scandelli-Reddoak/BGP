/**
 * Dati di base: primo amministratore (da SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) e corrieri.
 * Idempotente: si può rilanciare senza duplicare nulla.
 *   npm run db:seed
 */
import "dotenv/config";
import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { carriers, users } from "@/db/schema";
import { hashPassword, passwordProblem } from "@/lib/auth/password";

const DEFAULT_CARRIERS = [
  // Link usato oggi nelle email dell'ufficio commerciale: il cliente inserisce il numero a mano.
  { name: "GLS", trackingUrlTemplate: "http://www.gls-italy.com/verifica_consegna_anonimo.asp" },
  { name: "BRT", trackingUrlTemplate: "https://www.brt.it/it/tracking" },
  { name: "SDA", trackingUrlTemplate: "https://www.sda.it/wps/portal/Servizi_online/dettaglio-spedizione?locale=it&tracing.letteraVettura={tracking}" },
  { name: "DHL Express", trackingUrlTemplate: "https://www.dhl.com/it-it/home/tracking/tracking-express.html?submit=1&tracking-id={tracking}" },
  { name: "UPS", trackingUrlTemplate: "https://www.ups.com/track?loc=it_IT&tracknum={tracking}" },
  { name: "FedEx / TNT", trackingUrlTemplate: "https://www.fedex.com/fedextrack/?trknbr={tracking}" },
  { name: "Poste Italiane", trackingUrlTemplate: "https://www.poste.it/cerca/index.html#/risultati-spedizioni/{tracking}" },
  { name: "Vettore BGP (Arcadia Group)", trackingUrlTemplate: null },
  { name: "Ritiro in sede / consegna a mano", trackingUrlTemplate: null },
];

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!email) throw new Error("Imposta SEED_ADMIN_EMAIL nel file .env");

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
  if (existing) {
    console.log(`Amministratore ${email} già presente.`);
  } else {
    const problem = passwordProblem(password);
    if (problem) throw new Error(`SEED_ADMIN_PASSWORD: ${problem}`);
    await db.insert(users).values({ name: "Amministratore", email, passwordHash: await hashPassword(password), role: "ADMIN" });
    console.log(`Creato amministratore ${email}. Cambia la password al primo accesso.`);
  }

  const [{ n }] = await db.select({ n: count() }).from(carriers);
  if (n === 0) {
    await db.insert(carriers).values(DEFAULT_CARRIERS.map((c, i) => ({ ...c, sortOrder: i })));
    console.log(`Creati ${DEFAULT_CARRIERS.length} corrieri.`);
  } else {
    console.log("Corrieri già presenti.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
