import { inArray, like } from "drizzle-orm";
import type { DB } from "@/db";
import {
  carriers,
  contacts,
  emailLog,
  products,
  sampleRequests,
  users,
  type Carrier,
  type Contact,
  type Product,
  type Role,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Dati di prova per i test di integrazione. Il database è quello di sviluppo (condiviso con
 * `next dev`): tutto ciò che viene creato porta il marcatore TEST-VITEST- e viene eliminato alla fine.
 */

export const MARK_PREFIX = "TEST-VITEST-";
const USER_EMAIL_PREFIX = "vitest-";
const EMAIL_DOMAIN = "example.test";

/** Motivo per non eseguire i test sul database, oppure null se si può procedere. */
export function dbTestsSkipReason(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return "DATABASE_URL non configurata";
  if (process.env.NODE_ENV === "production") return "NODE_ENV=production";
  if (process.env.EMAIL_DRY_RUN !== "true") return "EMAIL_DRY_RUN deve essere «true» (nessuna email reale nei test)";
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "DATABASE_URL non valida";
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!local && process.env.TEST_DB_ALLOW_REMOTE !== "true") {
    return `DATABASE_URL punta a «${host}»: i test di integrazione girano solo su un database locale (TEST_DB_ALLOW_REMOTE=true per forzare)`;
  }
  return null;
}

export type Fixtures = {
  mark: string;
  run: string;
  actors: Record<Role, SessionUser>;
  products: { a: Product; b: Product; notRequested: Product; inactive: Product };
  carrier: Carrier;
  contacts: {
    agent: Contact;
    /** Cliente italiano con due email e agente. */
    clienteIt: Contact;
    /** Cliente inglese con agente. */
    customerEn: Contact;
    /** Cliente francese con la stessa email dell'agente (cliente che è anche agente). */
    clientFr: Contact;
    /** Cliente direzionale senza email. */
    noEmail: Contact;
    inactive: Contact;
  };
};

export async function createFixtures(db: DB, run: string): Promise<Fixtures> {
  const mark = `${MARK_PREFIX}${run}`;
  const email = (local: string) => `${local}-${run}@${EMAIL_DOMAIN}`;

  const roles: Role[] = ["ADMIN", "BACKOFFICE", "MAGAZZINO", "LOGISTICA", "DIREZIONE", "CRM"];
  const userRows = await db
    .insert(users)
    .values(
      roles.map((role) => ({
        name: `${mark} ${role}`,
        email: `${USER_EMAIL_PREFIX}${run}-${role.toLowerCase()}@${EMAIL_DOMAIN}`,
        // Hash non valido: questi utenti non possono accedere all'app.
        passwordHash: "!",
        role,
      })),
    )
    .returning();
  const actors = Object.fromEntries(
    userRows.map((u) => [u.role, { id: u.id, name: u.name, email: u.email, role: u.role } satisfies SessionUser]),
  ) as Record<Role, SessionUser>;

  const productRows = await db
    .insert(products)
    .values([
      { code: `${mark}-A`, description: "Rovere naturale spazzolato 14x190 (prova)" },
      { code: `${mark}-B`, description: "Noce canaletto verniciato 10x120 (prova)" },
      { code: `${mark}-C`, description: "Prodotto non richiesto (prova)" },
      { code: `${mark}-OFF`, description: "Fuori catalogo (prova)", active: false },
    ])
    .returning();
  const byCode = (suffix: string) => productRows.find((p) => p.code === `${mark}-${suffix}`)!;

  const [carrier] = await db
    .insert(carriers)
    .values({ name: `${mark} Corriere`, trackingUrlTemplate: "https://track.example.test/?n={tracking}", sortOrder: 999 })
    .returning();

  const [agent] = await db
    .insert(contacts)
    .values({ type: "AGENTE", name: `${mark} Agente`, email: email("agente"), language: "it" })
    .returning();
  const address = "Via S. Vincenzo de Paoli 8, 24023 Clusone (BG)";
  const contactRows = await db
    .insert(contacts)
    .values([
      {
        name: `${mark} Cliente IT`,
        email: `${email("Cliente")}; ${email("amministrazione")}`,
        defaultAddress: address,
        language: "it" as const,
        agentId: agent.id,
      },
      { name: `${mark} Customer EN`, email: email("buyer"), defaultAddress: "1 High Street, London", language: "en" as const, agentId: agent.id },
      { name: `${mark} Client FR`, email: agent.email, defaultAddress: "12 Rue de la Paix, Paris", language: "fr" as const, agentId: agent.id },
      { name: `${mark} Senza email`, email: null, defaultAddress: address, language: "it" as const, agentId: null },
      { name: `${mark} Disattivato`, email: email("disattivato"), defaultAddress: address, language: "it" as const, active: false },
    ])
    .returning();
  const contact = (suffix: string) => contactRows.find((c) => c.name === `${mark} ${suffix}`)!;

  return {
    mark,
    run,
    actors,
    products: { a: byCode("A"), b: byCode("B"), notRequested: byCode("C"), inactive: byCode("OFF") },
    carrier,
    contacts: {
      agent,
      clienteIt: contact("Cliente IT"),
      customerEn: contact("Customer EN"),
      clientFr: contact("Client FR"),
      noEmail: contact("Senza email"),
      inactive: contact("Disattivato"),
    },
  };
}

/**
 * Elimina i dati di prova (anche quelli rimasti da esecuzioni interrotte).
 * Ordine: email del registro → richieste (a cascata righe, pezzi, storico, allegati) → anagrafiche → utenti.
 */
export async function cleanupTestData(db: DB, prefix = MARK_PREFIX): Promise<void> {
  const contactIds = (
    await db.select({ id: contacts.id }).from(contacts).where(like(contacts.name, `${prefix}%`))
  ).map((r) => r.id);
  if (contactIds.length) {
    const requestIds = (
      await db.select({ id: sampleRequests.id }).from(sampleRequests).where(inArray(sampleRequests.contactId, contactIds))
    ).map((r) => r.id);
    if (requestIds.length) {
      await db.delete(emailLog).where(inArray(emailLog.requestId, requestIds));
      await db.delete(sampleRequests).where(inArray(sampleRequests.id, requestIds));
    }
    await db.delete(contacts).where(inArray(contacts.id, contactIds));
  }
  await db.delete(products).where(like(products.code, `${prefix}%`));
  await db.delete(carriers).where(like(carriers.name, `${prefix}%`));
  await db.delete(users).where(like(users.email, `${USER_EMAIL_PREFIX}%@${EMAIL_DOMAIN}`));
}
