import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import {
  attachments,
  emailLog,
  emailTemplates,
  pieces,
  requestItems,
  sampleRequests,
  statusEvents,
  type EmailKind,
  type Language,
  type RequestStatus,
} from "@/db/schema";
import type { ActionResult } from "@/lib/action-result";
import type { SessionUser } from "@/lib/auth/session";
import { formatDate, pieceAreaM2, requestCode } from "@/lib/format";
import type { LogisticsInput, RequestInfoInput } from "@/lib/requests/service";
import { shipmentConfirmationProblems } from "@/lib/requests/workflow";
import { cleanupTestData, createFixtures, dbTestsSkipReason, type Fixtures } from "./fixtures";

/**
 * Test end-to-end del servizio delle richieste (src/lib/requests/service.ts) sul database locale.
 * Le email non partono (EMAIL_DRY_RUN=true): si verifica il registro email.
 */

const SKIP_REASON = dbTestsSkipReason();
if (SKIP_REASON) console.warn(`Test di integrazione saltati: ${SKIP_REASON}`);

type Service = typeof import("@/lib/requests/service");
type Queries = typeof import("@/lib/requests/queries");

const RUN = Date.now().toString(36);
const MISSING_ID = 2_147_480_000;
const DENIED = /permessi/;

let db: DB;
let svc: Service;
let queries: Queries;
let fx: Fixtures;
/** Template personalizzati nel DB ("KIND:lang"): per quelli non si controlla il testo esatto. */
let customTemplates = new Set<string>();

function expectOk<T>(res: ActionResult<T>): asserts res is { ok: true; message?: string; data?: T } {
  if (!res.ok) {
    throw new Error(`Atteso esito positivo, ricevuto errore: ${res.error} ${JSON.stringify(res.fieldErrors ?? {})}`);
  }
}

function expectFail<T>(
  res: ActionResult<T>,
  pattern?: RegExp,
): asserts res is { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (res.ok) throw new Error(`Atteso un errore, ricevuto esito positivo: ${res.message ?? ""}`);
  if (pattern) expect(res.error).toMatch(pattern);
}

function createdId(res: ActionResult<{ id: number }>): number {
  expectOk(res);
  const id = res.data?.id;
  if (!id) throw new Error("createRequest non ha restituito l'id");
  return id;
}

const actor = (role: SessionUser["role"]) => fx.actors[role];

type ItemFixture = {
  productId: number;
  quantity: number;
  notes?: string | null;
  sampleFormat?: string | null;
  formatNote?: string | null;
};

/** Formato predefinito delle righe di prova (se la riga non lo indica, nemmeno come null). */
const DEFAULT_FORMAT = "MEZZE_DOGHE";
const RECIPIENT = "ORBIS FURNITURE SRL";
const ATTENTION_OF = "Sig. Rossi";
const PHONE = "328 3556565";

/**
 * Dati completi per «Invia al magazzino» (quelli che BGP chiede per prendere in carico una richiesta):
 * destinatario, alla c.a., indirizzo senza la riga del destinatario, formato di ogni riga, preavviso.
 */
function info(contactId: number, items: ItemFixture[], extra: Partial<RequestInfoInput> = {}): RequestInfoInput {
  return {
    contactId,
    recipientName: RECIPIENT,
    attentionOf: ATTENTION_OF,
    destinationAddress: "Via S. Vincenzo de Paoli 8\n24023 Clusone (BG)",
    phoneNotice: true,
    phoneNoticeNumber: PHONE,
    notes: null,
    deliveryFormRequired: false,
    receivedAt: null,
    items: items.map((i) => ("sampleFormat" in i ? i : { ...i, sampleFormat: DEFAULT_FORMAT })),
    ...extra,
  };
}

async function getRequest(id: number) {
  const [row] = await db.select().from(sampleRequests).where(eq(sampleRequests.id, id));
  return row;
}

function getEvents(id: number) {
  return db.select().from(statusEvents).where(eq(statusEvents.requestId, id)).orderBy(asc(statusEvents.id));
}

async function lastEvent(id: number) {
  const events = await getEvents(id);
  return events[events.length - 1];
}

function getEmails(id: number, kind: EmailKind) {
  return db
    .select()
    .from(emailLog)
    .where(and(eq(emailLog.requestId, id), eq(emailLog.kind, kind)))
    .orderBy(asc(emailLog.id));
}

function getItems(id: number) {
  return db
    .select()
    .from(requestItems)
    .where(eq(requestItems.requestId, id))
    .orderBy(asc(requestItems.productId), asc(requestItems.id));
}

const isDefaultTemplate = (kind: EmailKind, lang: Language) => !customTemplates.has(`${kind}:${lang}`);

/** Porta una nuova richiesta fino a «Spedita» (senza tracking), passando dal servizio. */
async function shippedRequest(contactId: number, productId: number): Promise<number> {
  const id = createdId(
    await svc.createRequest(actor("BACKOFFICE"), info(contactId, [{ productId, quantity: 1 }]), { sendToWarehouse: true }),
  );
  expectOk(await svc.updateWarehouseData(actor("MAGAZZINO"), id, { packagesCount: 1, weightKg: 1.2 }));
  expectOk(await svc.advanceStatus(actor("MAGAZZINO"), id, "PRONTA_RITIRO", { acknowledgeNoPieces: true }));
  expectOk(await svc.updateLogisticsData(actor("LOGISTICA"), id, { carrierId: fx.carrier.id, pickupDate: "2026-10-20" }));
  expectOk(await svc.advanceStatus(actor("LOGISTICA"), id, "SPEDITA"));
  return id;
}

describe.skipIf(SKIP_REASON !== null)("servizio richieste (integrazione con il database)", () => {
  beforeAll(async () => {
    ({ db } = await import("@/db"));
    svc = await import("@/lib/requests/service");
    queries = await import("@/lib/requests/queries");
    await cleanupTestData(db);
    fx = await createFixtures(db, RUN);
    const custom = await db.select({ kind: emailTemplates.kind, language: emailTemplates.language }).from(emailTemplates);
    customTemplates = new Set(custom.map((t) => `${t.kind}:${t.language}`));
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await cleanupTestData(db);
    } finally {
      await db.$client.end({ timeout: 5 });
    }
  });

  describe("creazione: permessi e validazione", () => {
    it("solo back office e amministratore creano richieste", async () => {
      for (const role of ["MAGAZZINO", "LOGISTICA", "DIREZIONE", "CRM"] as const) {
        const res = await svc.createRequest(actor(role), info(fx.contacts.clienteIt.id, [{ productId: fx.products.a.id, quantity: 1 }]));
        expectFail(res, DENIED);
      }
      const rows = await db.select().from(sampleRequests).where(eq(sampleRequests.contactId, fx.contacts.clienteIt.id));
      expect(rows).toHaveLength(0);
    });

    it("valida contatto, indirizzo, prodotti e quantità", async () => {
      const bo = actor("BACKOFFICE");
      const a = fx.products.a.id;
      const c = fx.contacts.clienteIt.id;

      let res = await svc.createRequest(bo, info(c, []));
      expectFail(res);
      expect(res.fieldErrors?.items).toBeTruthy();

      res = await svc.createRequest(bo, info(c, [{ productId: a, quantity: 1 }], { destinationAddress: "   " }));
      expectFail(res);
      expect(res.fieldErrors?.destinationAddress).toBeTruthy();

      res = await svc.createRequest(bo, info(c, [{ productId: a, quantity: 1 }], { recipientName: "  " }));
      expectFail(res);
      expect(res.fieldErrors?.recipientName).toBe("Indica il destinatario");

      res = await svc.createRequest(bo, info(c, [{ productId: a, quantity: 1 }], { phoneNotice: true, phoneNoticeNumber: " " }));
      expectFail(res);
      expect(res.fieldErrors?.phoneNoticeNumber).toBe("Indica il numero per il preavviso");

      res = await svc.createRequest(bo, info(c, [{ productId: a, quantity: 1, sampleFormat: "DOGHE" }]));
      expectFail(res);
      expect(res.fieldErrors?.["items.0.sampleFormat"]).toBeTruthy();

      res = await svc.createRequest(bo, info(c, [{ productId: a, quantity: 1, sampleFormat: "ALTRO", formatNote: "  " }]));
      expectFail(res);
      expect(res.fieldErrors?.["items.0.formatNote"]).toBe("Descrivi il formato richiesto");

      res = await svc.createRequest(bo, info(c, [{ productId: a, quantity: 0 }]));
      expectFail(res);
      expect(res.fieldErrors?.["items.0.quantity"]).toBeTruthy();

      res = await svc.createRequest(bo, info(MISSING_ID, [{ productId: a, quantity: 1 }]));
      expectFail(res, /Contatto non trovato/);
      expect(res.fieldErrors?.contactId).toBeTruthy();

      res = await svc.createRequest(bo, info(fx.contacts.inactive.id, [{ productId: a, quantity: 1 }]));
      expectFail(res, /disattivato/);

      res = await svc.createRequest(bo, info(c, [{ productId: fx.products.inactive.id, quantity: 1 }]));
      expectFail(res, /Prodotti non attivi/);
      expect(res.error).toContain(fx.products.inactive.code);

      res = await svc.createRequest(bo, info(c, [{ productId: MISSING_ID, quantity: 1 }]));
      expectFail(res, /non esistono/);

      const rows = await db.select().from(sampleRequests).where(eq(sampleRequests.contactId, c));
      expect(rows).toHaveLength(0);
    });
  });

  describe("dati richiesti da BGP per prendere in carico una richiesta", () => {
    it("salva destinatario, alla c.a., indirizzo (a capo normalizzati) e preavviso; con «no» il numero non resta", async () => {
      const bo = actor("BACKOFFICE");
      const c = fx.contacts.clienteIt.id;
      const id = createdId(
        await svc.createRequest(
          bo,
          info(c, [{ productId: fx.products.a.id, quantity: 1 }], {
            recipientName: "  LEGNOARTE SRL ",
            attentionOf: "  Sig.ra Bianchi ",
            destinationAddress: " Via Roma 1\r\n24023 Clusone (BG)\r\n ",
            phoneNotice: false,
            phoneNoticeNumber: "035 123456",
          }),
        ),
      );
      expect(await getRequest(id)).toMatchObject({
        recipientName: "LEGNOARTE SRL",
        attentionOf: "Sig.ra Bianchi",
        destinationAddress: "Via Roma 1\n24023 Clusone (BG)",
        phoneNotice: false,
        phoneNoticeNumber: null,
      });
      expect(await svc.getWorkflowSnapshot(id)).toMatchObject({
        recipientName: "LEGNOARTE SRL",
        phoneNotice: false,
        phoneNoticeNumber: null,
        itemsCount: 1,
        itemsMissingFormat: 0,
      });

      // Privato: niente «alla c.a.»; il preavviso diventa «sì» con il numero.
      expectOk(
        await svc.updateRequestInfo(
          bo,
          id,
          info(c, [{ productId: fx.products.a.id, quantity: 1 }], {
            recipientName: "NERI ANDREA",
            attentionOf: "",
            phoneNotice: true,
            phoneNoticeNumber: " 328 3556565 ",
          }),
        ),
      );
      expect(await getRequest(id)).toMatchObject({
        recipientName: "NERI ANDREA",
        attentionOf: null,
        phoneNotice: true,
        phoneNoticeNumber: "328 3556565",
      });
      expectOk(await svc.deleteRequest(bo, id));
    });

    it("bozza senza formato né preavviso: si salva, ma «Invia al magazzino» viene rifiutato", async () => {
      const bo = actor("BACKOFFICE");
      const c = fx.contacts.clienteIt.id;
      const { a, b } = fx.products;
      const created = await svc.createRequest(
        bo,
        info(
          c,
          [
            { productId: a.id, quantity: 1, sampleFormat: null },
            { productId: b.id, quantity: 1, sampleFormat: "" },
          ],
          { phoneNotice: null, phoneNoticeNumber: null },
        ),
        { sendToWarehouse: true },
      );
      const id = createdId(created);
      expectOk(created);
      expect(created.message).toMatch(/Richiesta salvata, ma non inviata al magazzino/);
      expect(created.message).toContain("Indica il formato del campione per 2 prodotti.");
      expect(created.message).toContain("Indica se serve il preavviso telefonico prima della consegna.");
      expect(await getRequest(id)).toMatchObject({ status: "NUOVA", phoneNotice: null });
      expect((await getItems(id)).map((i) => i.sampleFormat)).toEqual([null, null]);
      expect(await svc.getWorkflowSnapshot(id)).toMatchObject({ itemsCount: 2, itemsMissingFormat: 2, phoneNotice: null });
      expect(await getEmails(id, "AVVISO_MAGAZZINO")).toHaveLength(0);
      expect(await getEvents(id)).toHaveLength(1);

      // Formato su una sola riga e preavviso «no»: manca ancora il formato dell'altra.
      expectOk(
        await svc.updateRequestInfo(
          bo,
          id,
          info(
            c,
            [
              { productId: a.id, quantity: 1, sampleFormat: "MAZZETTA" },
              { productId: b.id, quantity: 1, sampleFormat: null },
            ],
            { phoneNotice: false },
          ),
        ),
      );
      let res = await svc.advanceStatus(bo, id, "IN_PREPARAZIONE");
      expectFail(res, /formato del campione .*per il prodotto che ne è privo/);
      expect(res.error).not.toContain("preavviso");

      // Preavviso «sì» senza numero: rifiutato già al salvataggio.
      const both = [
        { productId: a.id, quantity: 1, sampleFormat: "MAZZETTA" },
        { productId: b.id, quantity: 1, sampleFormat: "PANNELLO" },
      ];
      res = await svc.updateRequestInfo(bo, id, info(c, both, { phoneNotice: true, phoneNoticeNumber: null }));
      expectFail(res);
      expect(res.fieldErrors?.phoneNoticeNumber).toBeTruthy();

      expectOk(await svc.updateRequestInfo(bo, id, info(c, both, { phoneNotice: false })));
      expectOk(await svc.advanceStatus(bo, id, "IN_PREPARAZIONE"));
      expect((await getRequest(id)).status).toBe("IN_PREPARAZIONE");
      const [mail] = await getEmails(id, "AVVISO_MAGAZZINO");
      if (isDefaultTemplate("AVVISO_MAGAZZINO", "it")) {
        expect(mail.body).toContain("Preavviso telefonico: No");
        expect(mail.body).toContain(`- 1 × Mazzetta — ${a.description} (${a.code})`);
        expect(mail.body).toContain(`- 1 × Pannello — ${b.description} (${b.code})`);
      }
    });

    it("dati mancanti nel database (richieste precedenti): destinatario, «Altro» senza descrizione e numero bloccano l'invio", async () => {
      const bo = actor("BACKOFFICE");
      const id = createdId(await svc.createRequest(bo, info(fx.contacts.clienteIt.id, [{ productId: fx.products.a.id, quantity: 1 }])));
      // Come una richiesta migrata o modificata fuori dall'app: lo schema di input non lo permetterebbe.
      await db.update(sampleRequests).set({ recipientName: null, phoneNotice: true, phoneNoticeNumber: null }).where(eq(sampleRequests.id, id));
      await db.update(requestItems).set({ sampleFormat: "ALTRO", formatNote: null }).where(eq(requestItems.requestId, id));
      expect(await svc.getWorkflowSnapshot(id)).toMatchObject({ recipientName: null, itemsMissingFormat: 1 });

      const res = await svc.advanceStatus(bo, id, "IN_PREPARAZIONE");
      expectFail(res);
      expect(res.error).toContain("Indica il destinatario (ragione sociale o cognome e nome).");
      expect(res.error).toContain("formato del campione");
      expect(res.error).toContain("Indica il numero di telefono per il preavviso.");
      expect((await getRequest(id)).status).toBe("NUOVA");
      expect(await getEmails(id, "AVVISO_MAGAZZINO")).toHaveLength(0);
      expectOk(await svc.deleteRequest(bo, id));
    });

    it("lo stesso prodotto in due formati resta su due righe; nello stesso formato le quantità si sommano", async () => {
      const bo = actor("BACKOFFICE");
      const c = fx.contacts.clienteIt.id;
      const { a, b } = fx.products;
      const items: ItemFixture[] = [
        { productId: a.id, quantity: 1, sampleFormat: "MAZZETTA" },
        { productId: a.id, quantity: 2, sampleFormat: "DOGHE_INTERE" },
        { productId: a.id, quantity: 1, sampleFormat: "MAZZETTA", notes: "colori chiari" },
        { productId: a.id, quantity: 1, sampleFormat: "ALTRO", formatNote: "listello 30 cm" },
        { productId: a.id, quantity: 1, sampleFormat: "ALTRO", formatNote: " Listello 30 cm " },
        { productId: b.id, quantity: 1, sampleFormat: "ALTRO", formatNote: "listello 30 cm" },
      ];
      const id = createdId(await svc.createRequest(bo, info(c, items), { sendToWarehouse: true }));
      expect((await getItems(id)).map((i) => [i.productId, i.sampleFormat, i.formatNote, i.quantity, i.notes])).toEqual([
        [a.id, "MAZZETTA", null, 2, "colori chiari"],
        [a.id, "DOGHE_INTERE", null, 2, null],
        [a.id, "ALTRO", "listello 30 cm", 2, null],
        [b.id, "ALTRO", "listello 30 cm", 1, null],
      ]);
      expect((await getRequest(id)).status).toBe("IN_PREPARAZIONE");

      const [mail] = await getEmails(id, "AVVISO_MAGAZZINO");
      if (isDefaultTemplate("AVVISO_MAGAZZINO", "it")) {
        expect(mail.body).toContain(`- 2 × Mazzetta — ${a.description} (${a.code})`);
        expect(mail.body).toContain(`- 2 × Doghe intere — ${a.description} (${a.code})`);
        expect(mail.body).toContain(`- 2 × Altro: listello 30 cm — ${a.description} (${a.code})`);
        expect(mail.body).toContain(`- 1 × Altro: listello 30 cm — ${b.description} (${b.code})`);
      }

      // Durante la preparazione si può ancora cambiare il formato di una riga.
      const changed: ItemFixture[] = [
        { productId: a.id, quantity: 2, sampleFormat: "MAZZETTA", notes: "colori chiari" },
        { productId: a.id, quantity: 2, sampleFormat: "MEZZE_DOGHE" },
        { productId: a.id, quantity: 2, sampleFormat: "ALTRO", formatNote: "listello 30 cm" },
        { productId: b.id, quantity: 1, sampleFormat: "ALTRO", formatNote: "listello 30 cm" },
      ];
      expectOk(await svc.updateRequestInfo(bo, id, info(c, changed)));
      expect((await getItems(id)).map((i) => [i.productId, i.sampleFormat, i.quantity])).toEqual([
        [a.id, "MAZZETTA", 2],
        [a.id, "MEZZE_DOGHE", 2],
        [a.id, "ALTRO", 2],
        [b.id, "ALTRO", 1],
      ]);

      // Dopo la preparazione il formato è bloccato come il resto dei prodotti.
      expectOk(await svc.updateWarehouseData(actor("MAGAZZINO"), id, { packagesCount: 1, weightKg: 1 }));
      expectOk(await svc.advanceStatus(actor("MAGAZZINO"), id, "PRONTA_RITIRO", { acknowledgeNoPieces: true }));
      const locked = changed.map((i) => (i.sampleFormat === "MEZZE_DOGHE" ? { ...i, sampleFormat: "DOGHE_INTERE" } : i));
      expectFail(await svc.updateRequestInfo(bo, id, info(c, locked)), /prodotti richiesti/);
      expectOk(await svc.updateRequestInfo(bo, id, info(c, changed, { notes: "solo note" })));
      expect((await getRequest(id)).notes).toBe("solo note");
    });
  });

  describe("flusso completo: bolla richiesta, DDT e conferma in italiano", () => {
    let mainId: number;

    it("crea la richiesta in «Nuova richiesta» unendo le righe dello stesso prodotto", async () => {
      const { a, b } = fx.products;
      const res = await svc.createRequest(
        actor("BACKOFFICE"),
        info(
          fx.contacts.clienteIt.id,
          [
            { productId: a.id, quantity: 1, notes: "formato grande" },
            { productId: b.id, quantity: 1 },
            { productId: a.id, quantity: 1 },
          ],
          { deliveryFormRequired: true, notes: "Consegna al mattino", receivedAt: "2026-10-15" },
        ),
      );
      mainId = createdId(res);
      expectOk(res);
      expect(res.message).toBe("Richiesta salvata.");

      const req = await getRequest(mainId);
      expect(req).toMatchObject({
        status: "NUOVA",
        source: "INTERNO",
        createdById: actor("BACKOFFICE").id,
        deliveryFormRequired: true,
        notes: "Consegna al mattino",
        notificationSentAt: null,
      });
      expect(formatDate(req.receivedAt)).toBe("15/10/2026");

      const items = await getItems(mainId);
      expect(items.map((i) => [i.productId, i.quantity, i.notes])).toEqual([
        [a.id, 2, "formato grande"],
        [b.id, 1, null],
      ]);
      const events = await getEvents(mainId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ fromStatus: null, toStatus: "NUOVA", userId: actor("BACKOFFICE").id });
      expect(await getEmails(mainId, "AVVISO_MAGAZZINO")).toHaveLength(0);
    });

    it("accetta solo il passaggio allo stato successivo", async () => {
      for (const to of ["PRONTA_RITIRO", "SPEDITA", "COMPLETATA", "NUOVA"] as RequestStatus[]) {
        expectFail(await svc.advanceStatus(actor("BACKOFFICE"), mainId, to), /Passaggio non consentito/);
      }
      expect((await getRequest(mainId)).status).toBe("NUOVA");
      expectFail(await svc.advanceStatus(actor("BACKOFFICE"), MISSING_ID, "IN_PREPARAZIONE"), /non trovata/);
    });

    it("magazzino, logistica, direzione e CRM non possono inviare al magazzino", async () => {
      for (const role of ["MAGAZZINO", "LOGISTICA", "DIREZIONE", "CRM"] as const) {
        expectFail(await svc.advanceStatus(actor(role), mainId, "IN_PREPARAZIONE"), DENIED);
      }
      expect((await getRequest(mainId)).status).toBe("NUOVA");
      expect(await getEvents(mainId)).toHaveLength(1);
      expect(await getEmails(mainId, "AVVISO_MAGAZZINO")).toHaveLength(0);
    });

    it("direzione e CRM non possono modificare nulla", async () => {
      const piece = { productId: fx.products.a.id, lengthCm: 60, widthCm: 20, quantity: 1 };
      const pdf = { name: "ddt.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4") };
      for (const role of ["DIREZIONE", "CRM"] as const) {
        const u = actor(role);
        const attempts: ActionResult<unknown>[] = [
          await svc.updateRequestInfo(u, mainId, info(fx.contacts.clienteIt.id, [{ productId: fx.products.a.id, quantity: 9 }])),
          await svc.deleteRequest(u, mainId),
          await svc.updateWarehouseData(u, mainId, { packagesCount: 9, weightKg: 9 }),
          await svc.addPiece(u, mainId, piece),
          await svc.updateLogisticsData(u, mainId, { carrierId: fx.carrier.id, pickupDate: "2026-10-21" }),
          await svc.uploadDdt(u, mainId, pdf),
          await svc.deleteDdt(u, mainId),
          await svc.revertStatus(u, mainId, "prova"),
          await svc.completeWithoutEmail(u, mainId, "prova"),
          await svc.resendShipmentConfirmation(u, mainId),
        ];
        for (const res of attempts) expectFail(res, DENIED);
      }
      const req = await getRequest(mainId);
      expect(req).toMatchObject({ status: "NUOVA", notes: "Consegna al mattino", packagesCount: null, carrierId: null });
      expect(await getItems(mainId)).toHaveLength(2);
    });

    it("il magazzino non lavora le richieste ancora «Nuova richiesta»", async () => {
      expectFail(await svc.updateWarehouseData(actor("MAGAZZINO"), mainId, { packagesCount: 1, weightKg: 1 }), /Nuova richiesta/);
      expectFail(
        await svc.addPiece(actor("MAGAZZINO"), mainId, { productId: fx.products.a.id, lengthCm: 60, widthCm: 20 }),
        /Nuova richiesta/,
      );
    });

    it("«Invia al magazzino»: stato, storico e Automazione 1 (avviso al magazzino)", async () => {
      const res = await svc.advanceStatus(actor("BACKOFFICE"), mainId, "IN_PREPARAZIONE");
      expectOk(res);
      expect(res.message).toMatch(/magazzino/);

      expect((await getRequest(mainId)).status).toBe("IN_PREPARAZIONE");
      expect(await lastEvent(mainId)).toMatchObject({
        fromStatus: "NUOVA",
        toStatus: "IN_PREPARAZIONE",
        userId: actor("BACKOFFICE").id,
      });

      const mails = await getEmails(mainId, "AVVISO_MAGAZZINO");
      expect(mails).toHaveLength(1);
      const [mail] = mails;
      // Senza destinatari del magazzino nelle impostazioni l'email risulta in errore: il passaggio avviene comunque.
      expect(["ERRORE", "SIMULATA"]).toContain(mail.status);
      if (mail.status === "ERRORE") expect(mail.error).toMatch(/destinatar/i);
      expect(mail).toMatchObject({ language: "it", triggeredById: actor("BACKOFFICE").id });
      if (isDefaultTemplate("AVVISO_MAGAZZINO", "it")) {
        expect(mail.subject).toBe(`Nuovo campionario da preparare — ${requestCode(mainId)}`);
        expect(mail.body).toContain(`Cliente: ${fx.contacts.clienteIt.name}`);
        expect(mail.body).toContain("Note: Consegna al mattino");
        expect(mail.body).toContain("Bolla di consegna richiesta: Sì");
        expect(mail.body).toContain(`/richieste/${mainId}`);
        // Dati di presa in carico: destinatario, alla c.a., indirizzo su una riga, preavviso, formato.
        expect(mail.body).toContain(`Destinatario: ${RECIPIENT}\nAlla c.a.: ${ATTENTION_OF}\n`);
        expect(mail.body).toContain("Indirizzo: Via S. Vincenzo de Paoli 8, 24023 Clusone (BG)");
        expect(mail.body).toContain(`Preavviso telefonico: Sì, tel. ${PHONE}`);
        expect(mail.body).toContain(`- 2 × Mezze doghe — ${fx.products.a.description} (${fx.products.a.code})`);
        expect(mail.body).toContain(`- 1 × Mezze doghe — ${fx.products.b.description} (${fx.products.b.code})`);
      }
    });

    it("un secondo «Invia al magazzino» viene rifiutato senza duplicare storico ed email", async () => {
      expectFail(await svc.advanceStatus(actor("BACKOFFICE"), mainId, "IN_PREPARAZIONE"), /Passaggio non consentito/);
      expect(await getEmails(mainId, "AVVISO_MAGAZZINO")).toHaveLength(1);
      expect((await getEvents(mainId)).filter((e) => e.toStatus === "IN_PREPARAZIONE")).toHaveLength(1);
    });

    it("«Pronta per il ritiro» richiede colli, peso e misure (e il permesso di magazzino)", async () => {
      const res = await svc.advanceStatus(actor("MAGAZZINO"), mainId, "PRONTA_RITIRO");
      expectFail(res);
      expect(res.error).toContain("numero di colli");
      expect(res.error).toContain("peso totale");
      expect(res.error).toContain("misure dei pezzi");
      expectFail(await svc.advanceStatus(actor("LOGISTICA"), mainId, "PRONTA_RITIRO"), DENIED);
    });

    it("dati di magazzino: validazione e salvataggio", async () => {
      const mag = actor("MAGAZZINO");
      let res = await svc.updateWarehouseData(mag, mainId, { packagesCount: 1.5, weightKg: 2 });
      expectFail(res);
      expect(res.fieldErrors?.packagesCount).toBeTruthy();
      res = await svc.updateWarehouseData(mag, mainId, { packagesCount: 1, weightKg: -2 });
      expectFail(res);
      expect(res.fieldErrors?.weightKg).toBeTruthy();

      expectOk(await svc.updateWarehouseData(mag, mainId, { packagesCount: "2", weightKg: 3.5, warehouseNotes: "  Imballo con angolari  " }));
      expect(await getRequest(mainId)).toMatchObject({ packagesCount: 2, weightKg: 3.5, warehouseNotes: "Imballo con angolari" });

      const advance = await svc.advanceStatus(mag, mainId, "PRONTA_RITIRO");
      expectFail(advance, /misure dei pezzi/);
      expect(advance.error).not.toContain("colli");
    });

    it("pezzi: solo prodotti della richiesta, misure valide, m² calcolati dal database", async () => {
      const mag = actor("MAGAZZINO");
      const { a, notRequested } = fx.products;

      let res = await svc.addPiece(mag, mainId, { productId: notRequested.id, lengthCm: 60, widthCm: 20 });
      expectFail(res);
      expect(res.fieldErrors?.productId).toBeTruthy();
      res = await svc.addPiece(mag, mainId, { productId: a.id, lengthCm: 0, widthCm: 20 });
      expectFail(res);
      expect(res.fieldErrors?.lengthCm).toBeTruthy();
      res = await svc.addPiece(mag, mainId, { productId: a.id, lengthCm: 60, widthCm: -1 });
      expectFail(res);
      expect(res.fieldErrors?.widthCm).toBeTruthy();

      const p1 = await svc.addPiece(mag, mainId, {
        productId: a.id,
        lengthCm: "60",
        widthCm: "20",
        quantity: 1,
        conditionNote: "angolo scheggiato",
      });
      expectOk(p1);
      const p2 = await svc.addPiece(mag, mainId, { productId: a.id, lengthCm: 122, widthCm: 19, quantity: 2 });
      expectOk(p2);

      const rows = await db.select().from(pieces).where(eq(pieces.requestId, mainId)).orderBy(asc(pieces.id));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ id: p1.data?.id, lengthCm: 60, widthCm: 20, quantity: 1, areaM2: 0.12, conditionNote: "angolo scheggiato" });
      expect(rows[0].createdById).toBe(mag.id);
      expect(rows[1]).toMatchObject({ id: p2.data?.id, areaM2: 0.4636 });
      // La colonna generata del DB e la formula dell'app coincidono.
      for (const p of rows) expect(p.areaM2).toBe(pieceAreaM2(p.lengthCm, p.widthCm, p.quantity));

      const detail = await queries.getRequestDetail(mainId);
      expect(detail?.totalM2).toBe(0.5836);
      expect(detail?.piecesCount).toBe(3);
      expect(detail?.m2ByProduct.get(a.id)).toBeCloseTo(0.5836, 6);
    });

    it("updatePiece ricalcola i m², deletePiece elimina il pezzo", async () => {
      const mag = actor("MAGAZZINO");
      const { a, notRequested } = fx.products;
      const added = await svc.addPiece(mag, mainId, { productId: a.id, lengthCm: 10, widthCm: 10 });
      expectOk(added);
      const pieceId = added.data!.id;

      expectFail(await svc.updatePiece(actor("DIREZIONE"), pieceId, { productId: a.id, lengthCm: 1, widthCm: 1 }), DENIED);
      expectFail(await svc.deletePiece(actor("LOGISTICA"), pieceId), DENIED);

      expectOk(await svc.updatePiece(mag, pieceId, { productId: a.id, lengthCm: 100, widthCm: 10, quantity: 3 }));
      const [updated] = await db.select().from(pieces).where(eq(pieces.id, pieceId));
      expect(updated.areaM2).toBe(0.3);

      const wrong = await svc.updatePiece(mag, pieceId, { productId: notRequested.id, lengthCm: 1, widthCm: 1 });
      expectFail(wrong);
      expect(wrong.fieldErrors?.productId).toBeTruthy();

      expectOk(await svc.deletePiece(mag, pieceId));
      expect(await db.select().from(pieces).where(eq(pieces.id, pieceId))).toHaveLength(0);
      expectFail(await svc.updatePiece(mag, MISSING_ID, { productId: a.id, lengthCm: 1, widthCm: 1 }), /Pezzo non trovato/);
      expectFail(await svc.deletePiece(mag, MISSING_ID), /Pezzo non trovato/);
    });

    it("non si può togliere dalla richiesta un prodotto con pezzi misurati", async () => {
      const bo = actor("BACKOFFICE");
      const { a, b } = fx.products;
      const extra = { deliveryFormRequired: true, notes: "Consegna al mattino" };

      expectFail(
        await svc.updateRequestInfo(bo, mainId, info(fx.contacts.clienteIt.id, [{ productId: b.id, quantity: 1 }], extra)),
        /pezzi misurati/,
      );
      expect((await getItems(mainId)).map((i) => [i.productId, i.quantity])).toEqual([
        [a.id, 2],
        [b.id, 1],
      ]);

      // Togliere B (senza pezzi) e cambiare la quantità di A è consentito durante la preparazione.
      expectOk(await svc.updateRequestInfo(bo, mainId, info(fx.contacts.clienteIt.id, [{ productId: a.id, quantity: 3 }], extra)));
      expect((await getItems(mainId)).map((i) => [i.productId, i.quantity])).toEqual([[a.id, 3]]);
    });

    it("«Pronta per il ritiro» con bolla richiesta: Automazione 3 (avviso alla logistica)", async () => {
      const res = await svc.advanceStatus(actor("MAGAZZINO"), mainId, "PRONTA_RITIRO");
      expectOk(res);
      expect((await getRequest(mainId)).status).toBe("PRONTA_RITIRO");
      expect(await lastEvent(mainId)).toMatchObject({
        fromStatus: "IN_PREPARAZIONE",
        toStatus: "PRONTA_RITIRO",
        userId: actor("MAGAZZINO").id,
        note: null,
      });
      const mails = await getEmails(mainId, "AVVISO_BOLLA");
      expect(mails).toHaveLength(1);
      expect(["ERRORE", "SIMULATA"]).toContain(mails[0].status);
      if (isDefaultTemplate("AVVISO_BOLLA", "it")) {
        expect(mails[0].subject).toBe(`Bolla di consegna richiesta — ${requestCode(mainId)} — ${fx.contacts.clienteIt.name}`);
        expect(mails[0].body).toContain("m² totali: 0,58");
        expect(mails[0].body).toContain("N° colli: 2 — Peso: 3,50 kg");
      }
    });

    it("dopo la preparazione i prodotti non si cambiano più, gli altri dati sì", async () => {
      const bo = actor("BACKOFFICE");
      const a = fx.products.a.id;
      expectFail(
        await svc.updateRequestInfo(bo, mainId, info(fx.contacts.clienteIt.id, [{ productId: a, quantity: 4 }], { deliveryFormRequired: true })),
        /prodotti richiesti/,
      );
      expectOk(
        await svc.updateRequestInfo(
          bo,
          mainId,
          info(fx.contacts.clienteIt.id, [{ productId: a, quantity: 3 }], { deliveryFormRequired: true, notes: "Citofonare Rossi" }),
        ),
      );
      expect((await getRequest(mainId)).notes).toBe("Citofonare Rossi");
      // Il magazzino può ancora correggere colli e peso fino al ritiro.
      expectOk(await svc.updateWarehouseData(actor("MAGAZZINO"), mainId, { packagesCount: 2, weightKg: 4 }));
    });

    it("«Spedita» richiede corriere, data di ritiro e bolla (e il permesso di logistica)", async () => {
      const res = await svc.advanceStatus(actor("LOGISTICA"), mainId, "SPEDITA");
      expectFail(res);
      expect(res.error).toContain("corriere");
      expect(res.error).toContain("data di ritiro");
      expect(res.error).toContain("Bolla di consegna richiesta");
      expectFail(await svc.advanceStatus(actor("MAGAZZINO"), mainId, "SPEDITA"), DENIED);
    });

    it("dati di spedizione: validazione", async () => {
      const log = actor("LOGISTICA");
      const carrierId = fx.carrier.id;
      let res = await svc.updateLogisticsData(log, mainId, { carrierId: MISSING_ID, pickupDate: "2026-10-21" });
      expectFail(res);
      expect(res.fieldErrors?.carrierId).toBeTruthy();
      res = await svc.updateLogisticsData(log, mainId, { carrierId, pickupDate: "2026-10-21", shipmentDate: "2026-10-20" });
      expectFail(res);
      expect(res.fieldErrors?.shipmentDate).toBeTruthy();
      res = await svc.updateLogisticsData(log, mainId, { carrierId, pickupDate: "21/10/2026" });
      expectFail(res);
      expect(res.fieldErrors?.pickupDate).toBeTruthy();
      res = await svc.updateLogisticsData(log, mainId, { carrierId, shippingCost: -1 });
      expectFail(res);
      expect(res.fieldErrors?.shippingCost).toBeTruthy();
      expectFail(await svc.updateLogisticsData(actor("MAGAZZINO"), mainId, { carrierId }), DENIED);
      expect((await getRequest(mainId)).carrierId).toBeNull();
    });

    it("con corriere e data di ritiro manca ancora solo la bolla", async () => {
      const log = actor("LOGISTICA");
      const res = await svc.updateLogisticsData(log, mainId, { carrierId: fx.carrier.id, pickupDate: "2026-10-21" });
      expectOk(res);
      expect(res.message).toBe("Dati di spedizione salvati.");
      const advance = await svc.advanceStatus(log, mainId, "SPEDITA");
      expectFail(advance, /Bolla di consegna richiesta/);
      expect(advance.error).not.toContain("corriere");
    });

    it("DDT: formato, dimensione e permessi; il file caricato soddisfa la bolla", async () => {
      const log = actor("LOGISTICA");
      const pdf = new TextEncoder().encode("%PDF-1.4\n% DDT di prova\n%%EOF\n");

      expectFail(await svc.uploadDdt(log, mainId, { name: "ddt.exe", type: "application/x-msdownload", bytes: pdf }), /Formato/);
      expectFail(await svc.uploadDdt(log, mainId, { name: "ddt.pdf", type: "application/pdf", bytes: new Uint8Array(0) }), /vuoto/);
      expectFail(
        await svc.uploadDdt(log, mainId, { name: "ddt.pdf", type: "application/pdf", bytes: new Uint8Array(svc.DDT_MAX_BYTES + 1) }),
        /10 MB/,
      );
      expectFail(await svc.uploadDdt(actor("MAGAZZINO"), mainId, { name: "ddt.pdf", type: "application/pdf", bytes: pdf }), DENIED);

      expectOk(await svc.uploadDdt(log, mainId, { name: "vecchio.pdf", type: "application/pdf", bytes: pdf }));
      expect((await svc.getWorkflowSnapshot(mainId))?.hasDdtAttachment).toBe(true);
      expectOk(await svc.deleteDdt(log, mainId));
      expect((await svc.getWorkflowSnapshot(mainId))?.hasDdtAttachment).toBe(false);

      // Un nuovo caricamento sostituisce il precedente; il nome del file viene ripulito.
      expectOk(await svc.uploadDdt(log, mainId, { name: "vecchio.pdf", type: "application/pdf", bytes: pdf }));
      expectOk(await svc.uploadDdt(log, mainId, { name: "DDT 13807/A.pdf", type: "application/pdf", bytes: pdf }));
      const files = await db.select().from(attachments).where(eq(attachments.requestId, mainId));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        kind: "DDT",
        fileName: "DDT 13807_A.pdf",
        mimeType: "application/pdf",
        sizeBytes: pdf.byteLength,
        uploadedById: log.id,
      });
      expect(Buffer.from(files[0].data).equals(Buffer.from(pdf))).toBe(true);
    });

    it("«Segna come spedita»: senza tracking la conferma non parte", async () => {
      const log = actor("LOGISTICA");
      const res = await svc.advanceStatus(log, mainId, "SPEDITA");
      expectOk(res);
      expect(res.message).toMatch(/tracking/);
      const req = await getRequest(mainId);
      expect(req).toMatchObject({ status: "SPEDITA", notificationSentAt: null, completedAt: null });
      expect(await lastEvent(mainId)).toMatchObject({ fromStatus: "PRONTA_RITIRO", toStatus: "SPEDITA", userId: log.id });
      expect(await getEmails(mainId, "CONFERMA_SPEDIZIONE")).toHaveLength(0);
    });

    it("in «Spedita» dati della richiesta e di magazzino sono bloccati; Completata non si forza", async () => {
      const a = fx.products.a.id;
      expectFail(
        await svc.updateRequestInfo(actor("BACKOFFICE"), mainId, info(fx.contacts.clienteIt.id, [{ productId: a, quantity: 3 }], { deliveryFormRequired: true })),
        /Spedita/,
      );
      expectFail(await svc.updateWarehouseData(actor("MAGAZZINO"), mainId, { packagesCount: 3, weightKg: 4 }), /Spedita/);
      expectFail(await svc.addPiece(actor("MAGAZZINO"), mainId, { productId: a, lengthCm: 1, widthCm: 1 }), /Spedita/);
      expectFail(await svc.advanceStatus(actor("LOGISTICA"), mainId, "COMPLETATA"), /Passaggio non consentito/);
      expectFail(await svc.advanceStatus(actor("ADMIN"), mainId, "COMPLETATA"), /Passaggio non consentito/);
    });

    it("tracking e data di spedizione: Automazione 2 (cliente, agente in CC) e «Completata»", async () => {
      const log = actor("LOGISTICA");
      const input: LogisticsInput = {
        carrierId: fx.carrier.id,
        pickupDate: "2026-10-21",
        trackingNumber: "  1Z 999 AA1  ",
        shipmentDate: "2026-10-22",
        ddtNumber: "13807",
      };
      const res = await svc.updateLogisticsData(log, mainId, input);
      expectOk(res);
      expect(res.message).toMatch(/Richiesta completata/);

      const req = await getRequest(mainId);
      expect(req).toMatchObject({ status: "COMPLETATA", trackingNumber: "1Z 999 AA1", ddtNumber: "13807", shipmentDate: "2026-10-22" });
      expect(req.notificationSentAt).toBeInstanceOf(Date);
      expect(req.completedAt).toBeInstanceOf(Date);

      const event = await lastEvent(mainId);
      expect(event).toMatchObject({ fromStatus: "SPEDITA", toStatus: "COMPLETATA", userId: null });
      expect(event.note).toMatch(/simulata/);

      const mails = await getEmails(mainId, "CONFERMA_SPEDIZIONE");
      expect(mails).toHaveLength(1);
      const [mail] = mails;
      expect(mail).toMatchObject({
        status: "SIMULATA",
        error: null,
        language: "it",
        toAddresses: `Cliente-${RUN}@example.test; amministrazione-${RUN}@example.test`,
        ccAddresses: fx.contacts.agent.email,
        triggeredById: log.id,
        // Il DDT caricato ha la precedenza sulla bolla generata.
        attachmentNames: "DDT 13807_A.pdf",
      });
      if (isDefaultTemplate("CONFERMA_SPEDIZIONE", "it")) {
        expect(mail.subject).toBe(`INVIO CAMPIONATURA cli. ${fx.contacts.clienteIt.name}`);
        expect(mail.body).toContain("in data 22/10/2026 è stata spedita");
        expect(mail.body).toContain(`Corriere: ${fx.carrier.name}`);
        expect(mail.body).toContain("Numero di spedizione: 1Z 999 AA1");
        expect(mail.body).toContain("https://track.example.test/?n=1Z999AA1");
        expect(mail.body).toContain("Rif. DDT N° 13807");
        expect(mail.body).toContain(`- 3 × Mezze doghe — ${fx.products.a.description} (${fx.products.a.code})`);
        // Il destinatario e il preavviso sono dati interni: non compaiono nella conferma al cliente.
        expect(mail.body).not.toContain("Preavviso");
        expect(mail.body).toContain("N° colli: 2 — Peso: 4,00 kg");
        expect(mail.body).not.toMatch(/[{}]/);
        expect(mail.body).not.toContain("/richieste/");
      }
    });

    it("la conferma non parte due volte; dopo la chiusura si aggiornano solo i dati amministrativi e la data di spedizione", async () => {
      const log = actor("LOGISTICA");
      expect(await svc.maybeSendShipmentConfirmation(null, mainId)).toBeNull();
      const res = await svc.updateLogisticsData(log, mainId, {
        carrierId: fx.carrier.id,
        pickupDate: "2026-10-21",
        trackingNumber: "ALTRO",
        shipmentDate: "2026-10-23",
        ddtNumber: "13807",
        shippingCost: "12.5",
      });
      expectOk(res);
      expect(res.message).toMatch(/amministrativi/);
      expect(await getRequest(mainId)).toMatchObject({
        status: "COMPLETATA",
        trackingNumber: "1Z 999 AA1",
        pickupDate: "2026-10-21",
        shipmentDate: "2026-10-23",
        shippingCost: 12.5,
      });
      expect(await getEmails(mainId, "CONFERMA_SPEDIZIONE")).toHaveLength(1);

      // La data di spedizione non può precedere il ritiro né essere svuotata (senza data resta quella salvata).
      const early = await svc.updateLogisticsData(log, mainId, { shipmentDate: "2026-10-20", ddtNumber: "13807" });
      expectFail(early);
      expect(early.fieldErrors?.shipmentDate).toBeTruthy();
      expectOk(await svc.updateLogisticsData(log, mainId, { shipmentDate: "", ddtNumber: "13807", shippingCost: "12.5" }));
      expect(await getRequest(mainId)).toMatchObject({ shipmentDate: "2026-10-23", shippingCost: 12.5 });
      expectOk(await svc.updateLogisticsData(log, mainId, { shipmentDate: "2026-10-22", ddtNumber: "13807", shippingCost: "12.5" }));
      expect((await getRequest(mainId)).shipmentDate).toBe("2026-10-22");
    });

    it("correzioni: motivo obbligatorio; una richiesta completata la riapre solo l'amministratore", async () => {
      let res = await svc.revertStatus(actor("BACKOFFICE"), mainId, "   ");
      expectFail(res);
      expect(res.fieldErrors?.note).toBeTruthy();
      expectFail(await svc.revertStatus(actor("BACKOFFICE"), mainId, "tracking errato"), /amministratore/);
      expectFail(await svc.revertStatus(actor("LOGISTICA"), mainId, "tracking errato"), DENIED);
      expectFail(await svc.revertStatus(actor("MAGAZZINO"), mainId, "tracking errato"), DENIED);
      expect((await getRequest(mainId)).status).toBe("COMPLETATA");

      res = await svc.revertStatus(actor("ADMIN"), mainId, " tracking errato ");
      expectOk(res);
      expect(res.message).toMatch(/Spedita/);
      const reopened = await getRequest(mainId);
      expect(reopened).toMatchObject({ status: "SPEDITA", completedAt: null });
      // La conferma già inviata resta registrata.
      expect(reopened.notificationSentAt).toBeInstanceOf(Date);
      expect(await lastEvent(mainId)).toMatchObject({
        fromStatus: "COMPLETATA",
        toStatus: "SPEDITA",
        userId: actor("ADMIN").id,
        note: "Correzione: tracking errato",
      });
      // La correzione non reinvia email in automatico.
      expect(await getEmails(mainId, "CONFERMA_SPEDIZIONE")).toHaveLength(1);
    });

    it("dopo la riapertura salvare i dati di spedizione non reinvia la conferma", async () => {
      const log = actor("LOGISTICA");
      const res = await svc.updateLogisticsData(log, mainId, {
        carrierId: fx.carrier.id,
        pickupDate: "2026-10-21",
        trackingNumber: "1Z 999 AA2",
        shipmentDate: "2026-10-22",
        ddtNumber: "13807",
        shippingCost: "9.5",
        logisticsNotes: "tracking corretto",
      });
      expectOk(res);
      expect(res.message).toBe("Dati di spedizione salvati.");
      expect(await getRequest(mainId)).toMatchObject({ status: "SPEDITA", trackingNumber: "1Z 999 AA2", shippingCost: 9.5 });
      expect(await getEmails(mainId, "CONFERMA_SPEDIZIONE")).toHaveLength(1);

      // Il DDT caricato ora non parte da solo: il messaggio indica «Reinvia conferma».
      const pdf = new TextEncoder().encode("%PDF-1.4\n% DDT di prova\n%%EOF\n");
      const upload = await svc.uploadDdt(log, mainId, { name: "DDT 13807-bis.pdf", type: "application/pdf", bytes: pdf });
      expectOk(upload);
      expect(upload.message).toMatch(/già stata inviata/);
      expect(await getEmails(mainId, "CONFERMA_SPEDIZIONE")).toHaveLength(1);
    });

    it("«Invia conferma» su una richiesta riaperta reinvia l'email e la richiude", async () => {
      const res = await svc.resendShipmentConfirmation(actor("LOGISTICA"), mainId);
      expectOk(res);
      expect(await getEmails(mainId, "CONFERMA_SPEDIZIONE")).toHaveLength(2);
      // Automazione 2: conferma inviata con stato Spedita → Completata.
      expect((await getRequest(mainId)).status).toBe("COMPLETATA");
    });

    it("si eliminano solo le richieste «Nuova richiesta»", async () => {
      expectFail(await svc.deleteRequest(actor("BACKOFFICE"), mainId), /Nuova richiesta/);
      expect(await getRequest(mainId)).toBeDefined();

      const tmpId = createdId(
        await svc.createRequest(actor("BACKOFFICE"), info(fx.contacts.clienteIt.id, [{ productId: fx.products.b.id, quantity: 1 }])),
      );
      expectFail(await svc.deleteRequest(actor("MAGAZZINO"), tmpId), DENIED);
      expectOk(await svc.deleteRequest(actor("BACKOFFICE"), tmpId));
      expect(await getRequest(tmpId)).toBeUndefined();
      expect(await getItems(tmpId)).toHaveLength(0);
      expect(await getEvents(tmpId)).toHaveLength(0);
      expectFail(await svc.deleteRequest(actor("BACKOFFICE"), tmpId));
    });
  });

  describe("conferma di spedizione nella lingua del contatto", () => {
    it("cliente inglese: email in inglese con l'agente in CC, inviata appena la richiesta è «Spedita»", async () => {
      const { customerEn, agent } = fx.contacts;
      const created = await svc.createRequest(
        actor("BACKOFFICE"),
        info(customerEn.id, [{ productId: fx.products.b.id, quantity: 2, sampleFormat: "DOGHE_INTERE" }], {
          recipientName: customerEn.name,
          attentionOf: null,
          destinationAddress: "1 High Street\nLondon W1 1AA\nUnited Kingdom",
          phoneNotice: false,
          phoneNoticeNumber: null,
        }),
        { sendToWarehouse: true },
      );
      const id = createdId(created);
      expectOk(created);
      expect(created.message).toMatch(/magazzino/);
      expect((await getRequest(id)).status).toBe("IN_PREPARAZIONE");
      expect((await getEvents(id)).map((e) => e.toStatus)).toEqual(["NUOVA", "IN_PREPARAZIONE"]);
      // L'avviso al magazzino resta in italiano (formato compreso); senza «alla c.a.» la riga sparisce.
      const [warehouseMail] = await getEmails(id, "AVVISO_MAGAZZINO");
      if (isDefaultTemplate("AVVISO_MAGAZZINO", "it")) {
        expect(warehouseMail.body).toContain(`Destinatario: ${customerEn.name}\nIndirizzo: 1 High Street, London W1 1AA, United Kingdom`);
        expect(warehouseMail.body).not.toContain("Alla c.a.");
        expect(warehouseMail.body).toContain("Preavviso telefonico: No");
        expect(warehouseMail.body).toContain(`- 2 × Doghe intere — ${fx.products.b.description}`);
      }

      expectOk(await svc.updateWarehouseData(actor("MAGAZZINO"), id, { packagesCount: 1, weightKg: 0.8 }));
      expectOk(await svc.advanceStatus(actor("MAGAZZINO"), id, "PRONTA_RITIRO", { acknowledgeNoPieces: true }));
      expect((await lastEvent(id)).note).toBe("Nessun pezzo da misurare");
      expect(await getEmails(id, "AVVISO_BOLLA")).toHaveLength(0);

      // Dati completi già in «Pronta per il ritiro»: la conferma parte solo al passaggio a «Spedita».
      const saved = await svc.updateLogisticsData(actor("LOGISTICA"), id, {
        carrierId: fx.carrier.id,
        pickupDate: "2026-10-20",
        trackingNumber: "ABC123",
        shipmentDate: "2026-10-20",
      });
      expectOk(saved);
      expect(saved.message).toBe("Dati di spedizione salvati.");
      expect(await getEmails(id, "CONFERMA_SPEDIZIONE")).toHaveLength(0);

      const shipped = await svc.advanceStatus(actor("LOGISTICA"), id, "SPEDITA");
      expectOk(shipped);
      expect(shipped.message).toMatch(/Richiesta spedita.*completata/);
      expect((await getRequest(id)).status).toBe("COMPLETATA");

      const [mail, ...others] = await getEmails(id, "CONFERMA_SPEDIZIONE");
      expect(others).toHaveLength(0);
      expect(mail).toMatchObject({
        status: "SIMULATA",
        language: "en",
        toAddresses: customerEn.email,
        ccAddresses: agent.email,
        attachmentNames: null,
      });
      if (isDefaultTemplate("CONFERMA_SPEDIZIONE", "en")) {
        expect(mail.subject).toBe(`Samples shipped — ${customerEn.name}`);
        expect(mail.body.startsWith("Dear Customer,")).toBe(true);
        expect(mail.body).toContain("were shipped on 20/10/2026");
        expect(mail.body).toContain("Tracking number: ABC123");
        expect(mail.body).toContain("Track your shipment: https://track.example.test/?n=ABC123");
        expect(mail.body).not.toContain("Delivery note");
        expect(mail.body).toContain("Packages: 1 — Weight: 0.80 kg");
        // Formato nella lingua del cliente.
        expect(mail.body).toContain(`- 2 × Full-length planks — ${fx.products.b.description} (${fx.products.b.code})`);
        expect(mail.body).not.toContain("Doghe intere");
      }
    });

    it("cliente francese che coincide con l'agente: nessun CC duplicato; bolla «pronta» allegata in PDF", async () => {
      const { clientFr } = fx.contacts;
      const log = actor("LOGISTICA");
      const id = createdId(
        await svc.createRequest(
          actor("BACKOFFICE"),
          info(clientFr.id, [{ productId: fx.products.a.id, quantity: 1 }], { deliveryFormRequired: true }),
          { sendToWarehouse: true },
        ),
      );
      expectOk(await svc.updateWarehouseData(actor("MAGAZZINO"), id, { packagesCount: 1, weightKg: 2 }));
      expectOk(await svc.addPiece(actor("MAGAZZINO"), id, { productId: fx.products.a.id, lengthCm: 60, widthCm: 20 }));
      expectOk(await svc.advanceStatus(actor("MAGAZZINO"), id, "PRONTA_RITIRO"));
      expect(await getEmails(id, "AVVISO_BOLLA")).toHaveLength(1);

      const base = { carrierId: fx.carrier.id, pickupDate: "2026-10-20", deliveryFormReady: true };
      expectOk(await svc.updateLogisticsData(log, id, base));
      expectOk(await svc.advanceStatus(log, id, "SPEDITA"));
      const done = await svc.updateLogisticsData(log, id, { ...base, trackingNumber: "FR-1", shipmentDate: "2026-10-21" });
      expectOk(done);
      expect((await getRequest(id)).status).toBe("COMPLETATA");

      const [mail] = await getEmails(id, "CONFERMA_SPEDIZIONE");
      expect(mail).toMatchObject({
        status: "SIMULATA",
        language: "fr",
        toAddresses: clientFr.email,
        ccAddresses: null,
        attachmentNames: `Bolla-${requestCode(id)}.pdf`,
      });
      if (isDefaultTemplate("CONFERMA_SPEDIZIONE", "fr")) {
        expect(mail.subject).toBe(`Envoi d'échantillons — ${clientFr.name}`);
        expect(mail.body).toContain("expédiés le 21/10/2026");
      }
    });

    it("contatto senza email: la conferma non parte e la richiesta resta «Spedita» finché la logistica non la chiude", async () => {
      const log = actor("LOGISTICA");
      const id = await shippedRequest(fx.contacts.noEmail.id, fx.products.b.id);

      const res = await svc.updateLogisticsData(log, id, {
        carrierId: fx.carrier.id,
        pickupDate: "2026-10-20",
        trackingNumber: "X1",
        shipmentDate: "2026-10-20",
      });
      expectOk(res);
      expect(res.message).toMatch(/NON inviata/);
      expect(await getRequest(id)).toMatchObject({ status: "SPEDITA", notificationSentAt: null });
      expect(await getEmails(id, "CONFERMA_SPEDIZIONE")).toHaveLength(0);

      const snapshot = await svc.getWorkflowSnapshot(id);
      expect(snapshot && shipmentConfirmationProblems(snapshot)).toEqual(["Il contatto non ha un indirizzo email valido."]);
      expectFail(await svc.resendShipmentConfirmation(log, id), /NON inviata/);

      let done = await svc.completeWithoutEmail(log, id, "  ");
      expectFail(done);
      expect(done.fieldErrors?.note).toBeTruthy();
      expectFail(await svc.completeWithoutEmail(actor("MAGAZZINO"), id, "consegna a mano"), DENIED);

      done = await svc.completeWithoutEmail(log, id, " consegna a mano ");
      expectOk(done);
      const req = await getRequest(id);
      expect(req.status).toBe("COMPLETATA");
      expect(req.completedAt).toBeInstanceOf(Date);
      expect(req.shipmentDate).toBe("2026-10-20");
      expect(await lastEvent(id)).toMatchObject({
        fromStatus: "SPEDITA",
        toStatus: "COMPLETATA",
        userId: log.id,
        note: "Completata senza conferma email: consegna a mano",
      });
      expectFail(await svc.completeWithoutEmail(log, id, "di nuovo"), /Spedita/);
    });
  });

  describe("id fuori dai limiti, Automazione 3 tardiva, bolle da preparare", () => {
    it("id oltre il massimo di Postgres: errore di validazione, nessuna eccezione dal database", async () => {
      const bo = actor("BACKOFFICE");
      const huge = "99999999999";
      let res = await svc.createRequest(bo, info(huge as unknown as number, [{ productId: fx.products.a.id, quantity: 1 }]));
      expectFail(res);
      expect(res.fieldErrors?.contactId).toBeTruthy();
      res = await svc.createRequest(bo, info(fx.contacts.clienteIt.id, [{ productId: Number(huge), quantity: 1 }]));
      expectFail(res);
      expect(res.fieldErrors?.["items.0.productId"]).toBeTruthy();
      res = await svc.createRequest(bo, info("" as unknown as number, [{ productId: fx.products.a.id, quantity: 1 }]));
      expectFail(res);
      expect(res.fieldErrors?.contactId).toBe("Seleziona il contatto");

      const id = createdId(
        await svc.createRequest(bo, info(fx.contacts.clienteIt.id, [{ productId: fx.products.a.id, quantity: 1 }]), { sendToWarehouse: true }),
      );
      const piece = await svc.addPiece(actor("MAGAZZINO"), id, { productId: huge, lengthCm: 10, widthCm: 10 });
      expectFail(piece);
      expect(piece.fieldErrors?.productId).toBeTruthy();
      const logistics = await svc.updateLogisticsData(actor("LOGISTICA"), id, { carrierId: huge });
      expectFail(logistics);
      expect(logistics.fieldErrors?.carrierId).toBeTruthy();
    });

    it("bolla richiesta su una richiesta già «Pronta per il ritiro»: avviso alla logistica e badge coerente con la pagina", async () => {
      const bo = actor("BACKOFFICE");
      const a = fx.products.a.id;
      const id = createdId(await svc.createRequest(bo, info(fx.contacts.clienteIt.id, [{ productId: a, quantity: 1 }]), { sendToWarehouse: true }));
      expectOk(await svc.updateWarehouseData(actor("MAGAZZINO"), id, { packagesCount: 1, weightKg: 2 }));
      expectOk(await svc.advanceStatus(actor("MAGAZZINO"), id, "PRONTA_RITIRO", { acknowledgeNoPieces: true }));
      expect(await getEmails(id, "AVVISO_BOLLA")).toHaveLength(0);

      const before = (await svc.countByStatus()).bolle;
      const res = await svc.updateRequestInfo(bo, id, info(fx.contacts.clienteIt.id, [{ productId: a, quantity: 1 }], { deliveryFormRequired: true }));
      expectOk(res);
      expect(res.message).toMatch(/Avviso bolla inviato alla logistica|email non inviata/);
      const mails = await getEmails(id, "AVVISO_BOLLA");
      expect(mails).toHaveLength(1);
      expect(mails[0].triggeredById).toBe(bo.id);
      expect((await svc.countByStatus()).bolle).toBe(before + 1);

      // Salvare di nuovo con la bolla già richiesta non ripete l'avviso.
      expectOk(await svc.updateRequestInfo(bo, id, info(fx.contacts.clienteIt.id, [{ productId: a, quantity: 1 }], { deliveryFormRequired: true, notes: "x" })));
      expect(await getEmails(id, "AVVISO_BOLLA")).toHaveLength(1);

      // Il numero DDT soddisfa la bolla (come nella pagina «Bolle da preparare»): esce dal conteggio.
      expectOk(await svc.updateLogisticsData(actor("LOGISTICA"), id, { carrierId: fx.carrier.id, pickupDate: "2026-10-20", ddtNumber: "DDT-1" }));
      expect((await svc.countByStatus()).bolle).toBe(before);
      expect((await svc.getWorkflowSnapshot(id)) && (await svc.getWorkflowSnapshot(id))!.ddtNumber).toBe("DDT-1");

      // Bolla tolta e richiesta di nuovo quando il DDT c'è già: niente avviso, non c'è nulla da preparare.
      expectOk(await svc.updateRequestInfo(bo, id, info(fx.contacts.clienteIt.id, [{ productId: a, quantity: 1 }], { deliveryFormRequired: false })));
      const again = await svc.updateRequestInfo(bo, id, info(fx.contacts.clienteIt.id, [{ productId: a, quantity: 1 }], { deliveryFormRequired: true }));
      expectOk(again);
      expect(again.message).toBe("Dati della richiesta aggiornati.");
      expect(await getEmails(id, "AVVISO_BOLLA")).toHaveLength(1);
    });
  });

  describe("report: mese della spedizione effettiva (data di spedizione, altrimenti di ritiro)", () => {
    const MONTH = "2031-03";
    const PICKUP = "2031-03-14";
    let id: number;

    it("una richiesta «Spedita» senza data di spedizione conta nel mese del ritiro", async () => {
      const m2 = await import("@/lib/reports/m2");
      const dashboard = await import("@/lib/reports/dashboard");
      const history = await import("@/lib/reports/history");

      id = createdId(
        await svc.createRequest(actor("BACKOFFICE"), info(fx.contacts.noEmail.id, [{ productId: fx.products.a.id, quantity: 1 }]), {
          sendToWarehouse: true,
        }),
      );
      expectOk(await svc.updateWarehouseData(actor("MAGAZZINO"), id, { packagesCount: 1, weightKg: 1 }));
      expectOk(await svc.addPiece(actor("MAGAZZINO"), id, { productId: fx.products.a.id, lengthCm: 100, widthCm: 50, quantity: 2 }));
      expectOk(await svc.advanceStatus(actor("MAGAZZINO"), id, "PRONTA_RITIRO"));
      expectOk(await svc.updateLogisticsData(actor("LOGISTICA"), id, { carrierId: fx.carrier.id, pickupDate: PICKUP, shippingCost: "7" }));
      expectOk(await svc.advanceStatus(actor("LOGISTICA"), id, "SPEDITA"));
      expect((await getRequest(id)).shipmentDate).toBeNull();

      const report = await m2.getMonthlyM2Report(MONTH);
      const shipment = report.shipments.find((s) => s.id === id);
      expect(shipment).toMatchObject({ shipmentDate: PICKUP, pickupDateUsed: true, pieces: 2, m2: 1 });
      expect(report.rows.find((r) => r.productId === fx.products.a.id)).toMatchObject({ requests: 1, pieces: 2, m2: 1 });
      expect((await m2.getMonthlyM2Report("2031-02")).shipments.some((s) => s.id === id)).toBe(false);

      const kpi = await dashboard.getDashboardKpi({ da: `${MONTH}-01`, a: `${MONTH}-31` });
      expect(kpi.shipped).toBeGreaterThanOrEqual(1);
      expect(kpi.m2).toBeGreaterThanOrEqual(1);
      const series = await dashboard.getMonthlySeries({ da: `${MONTH}-01`, a: `${MONTH}-31` });
      expect(series.find((p) => p.month === MONTH)?.shipped).toBeGreaterThanOrEqual(1);

      const rows = await history.getHistoryForExport({ contatto: fx.contacts.noEmail.name });
      expect(rows.find((r) => r.id === id)).toMatchObject({
        shipmentDate: null,
        shippedOn: PICKUP,
        recipientName: RECIPIENT,
        attentionOf: ATTENTION_OF,
        productItems: [{ code: fx.products.a.code, format: DEFAULT_FORMAT, note: null }],
      });
    });

    it("storico: destinatario e formato nella tabella e nel CSV; la ricerca trova anche il destinatario", async () => {
      const history = await import("@/lib/reports/history");
      const exports = await import("@/lib/reports/exports");
      const bo = actor("BACKOFFICE");
      const { a, b } = fx.products;
      const twoFormats = createdId(
        await svc.createRequest(
          bo,
          info(
            fx.contacts.noEmail.id,
            [
              { productId: a.id, quantity: 1, sampleFormat: "MAZZETTA" },
              { productId: a.id, quantity: 1, sampleFormat: "ALTRO", formatNote: "listello 30 cm" },
              { productId: b.id, quantity: 1, sampleFormat: null },
            ],
            { recipientName: `${fx.mark} DRVOTEK DOO`, attentionOf: null },
          ),
        ),
      );

      // Il contatto è «Senza email», il destinatario è un'altra ditta: la ricerca lo trova per entrambi.
      const byRecipient = await history.getHistoryForExport({ contatto: `DRVOTEK ${fx.run}` });
      expect(byRecipient.map((r) => r.id)).toEqual([twoFormats]);
      const row = byRecipient[0];
      expect(row.productItems).toEqual([
        { code: a.code, format: "MAZZETTA", note: null },
        { code: a.code, format: "ALTRO", note: "listello 30 cm" },
        { code: b.code, format: null, note: null },
      ]);
      // Separatore « | »: le descrizioni dei formati («Altro: …») possono contenere virgole.
      expect(exports.historyProductsText(row.productItems)).toBe(
        `${a.code} — Mazzetta | ${a.code} — Altro: listello 30 cm | ${b.code}`,
      );

      const csv = exports.historyCsv(byRecipient);
      const [header, line] = csv.replace(/^\uFEFF/, "").split("\r\n");
      expect(header).toContain("Contatto;Destinatario;Alla c.a.;Agente;Paese;Prodotti;");
      expect(line).toContain(`${fx.contacts.noEmail.name};${fx.mark} DRVOTEK DOO;;`);
      expect(line).toContain(`;${a.code} — Mazzetta | ${a.code} — Altro: listello 30 cm | ${b.code};`);

      const shipped = (await history.getHistoryForExport({ contatto: fx.contacts.noEmail.name })).find((r) => r.id === id);
      expect(exports.historyCsv(shipped ? [shipped] : [])).toContain(`;${RECIPIENT};${ATTENTION_OF};`);
      expect(exports.historyCsv(shipped ? [shipped] : [])).toContain(`;${a.code} — Mezze doghe;`);

      expectOk(await svc.deleteRequest(bo, twoFormats));
    });

    it("«Completa senza email» registra come data di spedizione quella del ritiro", async () => {
      const m2 = await import("@/lib/reports/m2");
      expectOk(await svc.completeWithoutEmail(actor("LOGISTICA"), id, "ritiro in sede"));
      expect(await getRequest(id)).toMatchObject({ status: "COMPLETATA", shipmentDate: PICKUP });
      const report = await m2.getMonthlyM2Report(MONTH);
      expect(report.shipments.find((s) => s.id === id)).toMatchObject({ shipmentDate: PICKUP, pickupDateUsed: false, m2: 1 });
    });
  });

  describe("concorrenza", () => {
    it("due «Invia al magazzino» simultanei: un solo passaggio e un solo avviso", async () => {
      const bo = actor("BACKOFFICE");
      const id = createdId(await svc.createRequest(bo, info(fx.contacts.clienteIt.id, [{ productId: fx.products.b.id, quantity: 1 }])));
      const results = await Promise.all([
        svc.advanceStatus(bo, id, "IN_PREPARAZIONE"),
        svc.advanceStatus(bo, id, "IN_PREPARAZIONE"),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect((await getEvents(id)).filter((e) => e.toStatus === "IN_PREPARAZIONE")).toHaveLength(1);
      expect(await getEmails(id, "AVVISO_MAGAZZINO")).toHaveLength(1);
    });

    it("due conferme di spedizione simultanee: una sola email e una sola chiusura", async () => {
      const id = await shippedRequest(fx.contacts.customerEn.id, fx.products.b.id);
      // Tracking inserito "di nascosto" per far partire due automazioni nello stesso momento.
      await db.update(sampleRequests).set({ trackingNumber: "RACE-1", shipmentDate: "2026-10-20" }).where(eq(sampleRequests.id, id));
      const results = await Promise.all([
        svc.maybeSendShipmentConfirmation(null, id),
        svc.maybeSendShipmentConfirmation(null, id),
      ]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await getEmails(id, "CONFERMA_SPEDIZIONE")).toHaveLength(1);
      expect((await getRequest(id)).status).toBe("COMPLETATA");
      expect((await getEvents(id)).filter((e) => e.toStatus === "COMPLETATA")).toHaveLength(1);
    });
  });

  it("countByStatus restituisce tutti gli stati e il conteggio delle bolle", async () => {
    const counts = await svc.countByStatus();
    for (const key of ["NUOVA", "IN_PREPARAZIONE", "PRONTA_RITIRO", "SPEDITA", "COMPLETATA", "bolle"] as const) {
      expect(typeof counts[key], key).toBe("number");
    }
    expect(counts.COMPLETATA).toBeGreaterThanOrEqual(4);
  });
});
