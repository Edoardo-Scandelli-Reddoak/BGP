/**
 * SOLO SVILUPPO / DEMO: crea un utente per ruolo e ~45 richieste in tutti gli stati,
 * usando i contatti e i prodotti già importati. Non invia email.
 *   npm run db:seed-demo
 * Password degli utenti demo: DEMO_PASSWORD (default "demo-campioni-2026").
 */
import "dotenv/config";
import { and, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  carriers,
  contacts,
  emailLog,
  pieces,
  products,
  requestItems,
  sampleRequests,
  statusEvents,
  users,
  type RequestStatus,
  type Role,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";

if (process.env.NODE_ENV === "production") {
  console.error("seed-demo non va eseguito in produzione.");
  process.exit(1);
}

const DEMO_USERS: { name: string; email: string; role: Role }[] = [
  { name: "Elena Galbiati", email: "backoffice@demo.local", role: "BACKOFFICE" },
  { name: "Marco (magazzino)", email: "magazzino1@demo.local", role: "MAGAZZINO" },
  { name: "Luca (magazzino)", email: "magazzino2@demo.local", role: "MAGAZZINO" },
  { name: "Giulia (logistica)", email: "logistica@demo.local", role: "LOGISTICA" },
  { name: "Direzione", email: "direzione@demo.local", role: "DIREZIONE" },
  { name: "Francesca (CRM)", email: "crm@demo.local", role: "CRM" },
];

// Generatore pseudo-casuale deterministico: lo stesso seed produce sempre gli stessi dati.
let state = 20261020;
function rand(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const password = process.env.DEMO_PASSWORD || "demo-campioni-2026";
  const hash = await hashPassword(password);
  const userIds: Record<string, number> = {};
  for (const u of DEMO_USERS) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email));
    if (existing) userIds[u.role] = existing.id;
    else {
      const [row] = await db.insert(users).values({ ...u, passwordHash: hash }).returning({ id: users.id });
      userIds[u.role] = row.id;
    }
  }
  console.log(`Utenti demo pronti (password: ${password}).`);

  const already = await db.select({ n: sql<number>`count(*)::int` }).from(sampleRequests);
  if (already[0].n > 0) {
    console.log("Ci sono già richieste nel database: non ne creo altre.");
    return;
  }

  const customers = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.type, "CLIENTE"), isNotNull(contacts.email), isNotNull(contacts.defaultAddress)))
    .limit(600);
  const catalog = await db
    .select()
    .from(products)
    .where(
      or(
        ilike(products.code, "MAZZ%"),
        ilike(products.code, "PANPL%"),
        ilike(products.code, "SVR%"),
        ilike(products.code, "PL0%"),
        ilike(products.code, "10150%"),
        ilike(products.code, "NOD%"),
      ),
    )
    .limit(400);
  const carrierRows = await db.select().from(carriers);
  const gls = carrierRows.find((c) => c.name === "GLS") ?? carrierRows[0];
  const brt = carrierRows.find((c) => c.name === "BRT") ?? carrierRows[0];

  const today = new Date();
  const plan: { status: RequestStatus; daysAgo: number }[] = [];
  for (let i = 0; i < 30; i++) plan.push({ status: "COMPLETATA", daysAgo: between(12, 150) });
  for (let i = 0; i < 3; i++) plan.push({ status: "SPEDITA", daysAgo: between(3, 8) });
  for (let i = 0; i < 4; i++) plan.push({ status: "PRONTA_RITIRO", daysAgo: between(1, 4) });
  for (let i = 0; i < 5; i++) plan.push({ status: "IN_PREPARAZIONE", daysAgo: between(0, 3) });
  for (let i = 0; i < 4; i++) plan.push({ status: "NUOVA", daysAgo: between(0, 1) });
  plan.sort((a, b) => b.daysAgo - a.daysAgo);

  const ORDER: RequestStatus[] = ["NUOVA", "IN_PREPARAZIONE", "PRONTA_RITIRO", "SPEDITA", "COMPLETATA"];
  const OWNER: Record<RequestStatus, number | null> = {
    NUOVA: userIds.BACKOFFICE,
    IN_PREPARAZIONE: userIds.BACKOFFICE,
    PRONTA_RITIRO: userIds.MAGAZZINO,
    SPEDITA: userIds.LOGISTICA,
    COMPLETATA: null,
  };

  for (const [n, p] of plan.entries()) {
    const contact = pick(customers);
    const received = addDays(today, -p.daysAgo);
    received.setHours(between(8, 17), between(0, 59));
    const stage = ORDER.indexOf(p.status);
    const bolla = rand() < 0.3;
    const chosen = [...new Set(Array.from({ length: between(1, 3) }, () => pick(catalog)))];
    const pickup = addDays(received, between(1, 3));
    const shipped = pickup;
    const carrier = rand() < 0.75 ? gls : brt;

    const [req] = await db
      .insert(sampleRequests)
      .values({
        status: p.status,
        receivedAt: received,
        source: n % 7 === 0 ? "MODULO_PUBBLICO" : "INTERNO",
        contactId: contact.id,
        destinationAddress: `${contact.name}\n${contact.defaultAddress}`,
        notes: rand() < 0.3 ? pick(["Preavviso telefonico 1 giorno prima", "Consegna orario continuato 9-18", "Urgente per showroom"]) : null,
        deliveryFormRequired: bolla,
        createdById: userIds.BACKOFFICE,
        requesterName: n % 7 === 0 ? "Agente (modulo pubblico)" : null,
        packagesCount: stage >= 2 ? between(1, 3) : null,
        weightKg: stage >= 2 ? Math.round((1 + rand() * 18) * 100) / 100 : null,
        carrierId: stage >= 3 ? carrier.id : null,
        pickupDate: stage >= 3 ? iso(pickup) : null,
        deliveryFormReady: bolla && stage >= 3,
        ddtNumber: bolla && stage >= 3 ? String(13700 + n) : null,
        trackingNumber: stage >= 4 ? `L6 ${between(600000000, 699999999)}` : null,
        shipmentDate: stage >= 4 ? iso(shipped) : null,
        shippingCost: stage >= 4 && rand() < 0.85 ? Math.round((7 + rand() * 30) * 100) / 100 : null,
        notificationSentAt: stage >= 4 ? addDays(shipped, 0) : null,
        completedAt: stage >= 4 ? addDays(shipped, 0) : null,
      })
      .returning({ id: sampleRequests.id });

    await db.insert(requestItems).values(chosen.map((prod) => ({ requestId: req.id, productId: prod.id, quantity: between(1, 3) })));

    if (stage >= 2) {
      for (const prod of chosen) {
        if (prod.code.startsWith("MAZZ")) continue; // mazzette colori: niente m²
        const pcs = between(1, 3);
        for (let k = 0; k < pcs; k++) {
          await db.insert(pieces).values({
            requestId: req.id,
            productId: prod.id,
            lengthCm: pick([30, 40, 60, 90, 120, 122]),
            widthCm: pick([14, 18.9, 19, 20, 22.8, 30]),
            quantity: between(1, 2),
            conditionNote: rand() < 0.1 ? "Leggero graffio su un lato" : null,
            createdById: userIds.MAGAZZINO,
          });
        }
      }
    }

    let t = received;
    await db.insert(statusEvents).values({ requestId: req.id, fromStatus: null, toStatus: "NUOVA", userId: userIds.BACKOFFICE, createdAt: t });
    for (let s = 1; s <= stage; s++) {
      t = s === 4 ? addDays(shipped, 0) : new Date(t.getTime() + between(2, 20) * 3600000);
      await db.insert(statusEvents).values({
        requestId: req.id,
        fromStatus: ORDER[s - 1],
        toStatus: ORDER[s],
        userId: OWNER[ORDER[s]],
        note: s === 4 ? `Conferma di spedizione inviata a ${contact.email}` : null,
        createdAt: t,
      });
    }
    if (stage >= 4) {
      await db.insert(emailLog).values({
        requestId: req.id,
        kind: "CONFERMA_SPEDIZIONE",
        language: contact.language,
        toAddresses: contact.email ?? "",
        subject: `INVIO CAMPIONATURA cli. ${contact.name}`,
        body: "(email demo)",
        status: "SIMULATA",
        createdAt: t,
      });
    }
  }
  console.log(`Create ${plan.length} richieste demo.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
