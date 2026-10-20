import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { and, asc, eq, gte, inArray, like, notInArray, sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import {
  bollaCounters,
  contacts,
  emailLog,
  products,
  sampleRequests,
  scheduledRuns,
  settings as settingsTable,
  type EmailKind,
} from "@/db/schema";
import type { ActionResult } from "@/lib/action-result";
import type { SessionUser } from "@/lib/auth/session";
import { DEFAULT_BOLLA_CONFIG, type BollaConfig } from "@/lib/config/bolla";
import { activeCostComponents, DEFAULT_COST_CONFIG, type CostConfig } from "@/lib/config/costs";
import { DEFAULT_CRM_EXPORT_CONFIG, type CrmExportConfig, type CrmGroupBy, type CrmRow } from "@/lib/config/crm-export";
import { todayIso } from "@/lib/format";
import type { RequestInfoInput } from "@/lib/requests/service";
import type { AppSettings } from "@/lib/settings";
import { cleanupTestData, createFixtures, dbTestsSkipReason, type Fixtures } from "./fixtures";

/**
 * Configurazioni di BGP sul database locale: bolla (numerazione, modalità, regole), costi per cliente
 * (voci manuali e calcolo SQL), export dei m² per il CRM (righe, file, invio programmato) e modulo pubblico.
 *
 * Le impostazioni sono condivise con `next dev` e con chi lavora sull'app: ogni test che le cambia
 * le rimette com'erano subito dopo (withSettings). Contatore delle bolle, esecuzioni programmate ed
 * email dell'export creati dai test vengono eliminati o ripristinati alla fine.
 */

const SKIP_REASON = dbTestsSkipReason();
if (SKIP_REASON) console.warn(`Test di integrazione saltati: ${SKIP_REASON}`);

type Service = typeof import("@/lib/requests/service");
type SettingsModule = typeof import("@/lib/settings");
type CrmRun = typeof import("@/lib/crm-export/run");
type Costs = typeof import("@/lib/requests/costs");
type Queries = typeof import("@/lib/requests/queries");
type PublicModule = typeof import("@/lib/requests/public");

const RUN = `cfg${Date.now().toString(36)}`;
const MISSING_ID = 2_147_480_000;
const DENIED = /permessi/;
const YEAR = Number(todayIso().slice(0, 4));
const STARTED_AT = new Date();

/** Mesi «storici» usati solo da questi test per l'export CRM (nessun altro dato in quei mesi). */
const CRM_MONTH = "2001-02";
const CRM_JOB = "crm-export";
const CRM_PERIODS = ["2001-02", "2001-03", "2001-05", "2001-06"];
/** Destinatari dell'export: prefisso "vitest-" come gli utenti di prova, per la pulizia del registro email. */
const RCPT = `vitest-crm-${RUN}@example.test`;
const RCPT2 = `vitest-crm2-${RUN}@example.test`;

let db: DB;
let svc: Service;
let settingsMod: SettingsModule;
let crm: CrmRun;
let costs: Costs;
let queries: Queries;
let pub: PublicModule;
let fx: Fixtures;

let counterBefore: number | null = null;
/** Numeri progressivi delle bolle generate dai test (per ripristinare il contatore dell'anno). */
const generatedSeq: number[] = [];

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

function info(contactId: number, items: { productId: number; sampleFormat?: string }[], extra: Partial<RequestInfoInput> = {}): RequestInfoInput {
  return {
    contactId,
    recipientName: "ORBIS FURNITURE SRL",
    attentionOf: "Sig. Rossi",
    destinationAddress: "Via S. Vincenzo de Paoli 8\n24023 Clusone (BG)",
    phoneNotice: false,
    phoneNoticeNumber: null,
    notes: null,
    deliveryFormRequired: false,
    receivedAt: null,
    items: items.map((i) => ({ productId: i.productId, quantity: 1, sampleFormat: i.sampleFormat ?? "MEZZE_DOGHE" })),
    ...extra,
  };
}

async function getRequest(id: number) {
  const [row] = await db.select().from(sampleRequests).where(eq(sampleRequests.id, id));
  return row;
}

function getEmails(id: number, kind: EmailKind) {
  return db
    .select()
    .from(emailLog)
    .where(and(eq(emailLog.requestId, id), eq(emailLog.kind, kind)))
    .orderBy(asc(emailLog.id));
}

type ConfigKey = "costConfig" | "bollaConfig" | "crmExport";

/**
 * Esegue `fn` con le configurazioni indicate salvate nel database, poi rimette le righe com'erano
 * (o le elimina se non c'erano): altri sviluppatori e agenti usano lo stesso database.
 */
async function withSettings(patch: Partial<Pick<AppSettings, ConfigKey>>, fn: () => Promise<void>): Promise<void> {
  const keys = Object.keys(patch) as ConfigKey[];
  const before = await db.select().from(settingsTable).where(inArray(settingsTable.key, keys));
  await settingsMod.updateSettings(patch);
  try {
    await fn();
  } finally {
    for (const key of keys) {
      const prev = before.find((r) => r.key === key);
      if (prev) {
        await db
          .insert(settingsTable)
          .values({ key, value: prev.value as object })
          .onConflictDoUpdate({ target: settingsTable.key, set: { value: prev.value as object } });
      } else {
        await db.delete(settingsTable).where(eq(settingsTable.key, key));
      }
    }
  }
}

const bollaConfig = (patch: Partial<BollaConfig> = {}): BollaConfig => ({ ...DEFAULT_BOLLA_CONFIG, ...patch });
const rules = (patch: Partial<BollaConfig["rules"]>): BollaConfig =>
  bollaConfig({ rules: { ...DEFAULT_BOLLA_CONFIG.rules, ...patch } });

async function bollaCounter(): Promise<number | null> {
  const [row] = await db.select().from(bollaCounters).where(eq(bollaCounters.year, YEAR));
  return row?.lastNumber ?? null;
}

/** Richiesta portata fino a «Pronta per il ritiro» passando dal servizio. */
async function readyRequest(
  extra: Partial<RequestInfoInput> = {},
  packagesCount = 1,
  contactId = fx.contacts.clienteIt.id,
): Promise<number> {
  const id = createdId(
    await svc.createRequest(actor("BACKOFFICE"), info(contactId, [{ productId: fx.products.a.id }], extra), {
      sendToWarehouse: true,
    }),
  );
  expectOk(await svc.updateWarehouseData(actor("MAGAZZINO"), id, { packagesCount, weightKg: 1 }));
  expectOk(await svc.advanceStatus(actor("MAGAZZINO"), id, "PRONTA_RITIRO", { acknowledgeNoPieces: true }));
  return id;
}

describe.skipIf(SKIP_REASON !== null)("configurazioni di BGP (integrazione con il database)", () => {
  beforeAll(async () => {
    ({ db } = await import("@/db"));
    svc = await import("@/lib/requests/service");
    settingsMod = await import("@/lib/settings");
    crm = await import("@/lib/crm-export/run");
    costs = await import("@/lib/requests/costs");
    queries = await import("@/lib/requests/queries");
    pub = await import("@/lib/requests/public");
    await cleanupTestData(db);
    await cleanupCrmRuns();
    fx = await createFixtures(db, RUN);
    counterBefore = await bollaCounter();
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await restoreBollaCounter();
      await cleanupCrmRuns();
      await cleanupTestData(db);
    } finally {
      await db.$client.end({ timeout: 5 });
    }
  });

  /** Esecuzioni programmate e email dell'export create da questi test (anche di esecuzioni interrotte). */
  // Lo scheduler del server di sviluppo può partire mentre i test hanno attivato l'invio automatico
  // (dal giorno 28 in poi): si eliminano anche le esecuzioni create durante i test.
  const testsStartedAt = new Date();

  async function cleanupCrmRuns() {
    await db.delete(scheduledRuns).where(and(eq(scheduledRuns.job, CRM_JOB), inArray(scheduledRuns.period, CRM_PERIODS)));
    await db.delete(scheduledRuns).where(and(eq(scheduledRuns.job, CRM_JOB), gte(scheduledRuns.createdAt, testsStartedAt)));
    await db.delete(emailLog).where(and(eq(emailLog.kind, "EXPORT_CRM"), like(emailLog.toAddresses, "vitest-%@example.test%")));
  }

  /**
   * Il contatore annuale torna al valore precedente ai test, ma solo se nel frattempo nessun altro ha
   * generato bolle (altrimenti si rischierebbero numeri doppi): in quel caso resta com'è.
   */
  async function restoreBollaCounter() {
    if (generatedSeq.length === 0) return;
    const last = Math.max(...generatedSeq);
    const myContacts = Object.values(fx.contacts).map((c) => c.id);
    const [others] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sampleRequests)
      .where(and(gte(sampleRequests.bollaGeneratedAt, STARTED_AT), notInArray(sampleRequests.contactId, myContacts)));
    if (others.n > 0 || (await bollaCounter()) !== last) return;
    if (counterBefore === null) {
      await db.delete(bollaCounters).where(and(eq(bollaCounters.year, YEAR), eq(bollaCounters.lastNumber, last)));
    } else {
      await db
        .update(bollaCounters)
        .set({ lastNumber: counterBefore })
        .where(and(eq(bollaCounters.year, YEAR), eq(bollaCounters.lastNumber, last)));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Bolla di consegna: numerazione e modalità                           */
  /* ------------------------------------------------------------------ */

  describe("bolla generata dal sistema", () => {
    const seq = (number: string) => {
      const m = /^C(\d{4,})\/(\d{4})$/.exec(number);
      if (!m) throw new Error(`Numero di bolla inatteso: ${number}`);
      expect(Number(m[2])).toBe(YEAR);
      return Number(m[1]);
    };

    it("numeri progressivi dell'anno; idempotente; permessi e stato controllati", async () => {
      await withSettings({ bollaConfig: bollaConfig() }, async () => {
        const r1 = await readyRequest();
        const r2 = await readyRequest();
        const draft = createdId(await svc.createRequest(actor("BACKOFFICE"), info(fx.contacts.clienteIt.id, [{ productId: fx.products.a.id }])));

        for (const role of ["MAGAZZINO", "DIREZIONE", "CRM"] as const) {
          expectFail(await svc.generateBolla(actor(role), r1), DENIED);
        }
        expectFail(await svc.generateBolla(actor("LOGISTICA"), draft), /Nuova richiesta/);
        expectFail(await svc.generateBolla(actor("LOGISTICA"), MISSING_ID), /non trovata/);
        expect(await getRequest(r1)).toMatchObject({ bollaNumber: null, bollaGeneratedAt: null, deliveryFormReady: false });

        const first = await svc.generateBolla(actor("LOGISTICA"), r1);
        expectOk(first);
        const n1 = seq(first.data!.number);
        generatedSeq.push(n1);
        expect(first.message).toBe(`Bolla N° ${first.data!.number} generata.`);
        const row = await getRequest(r1);
        expect(row).toMatchObject({ bollaNumber: first.data!.number, deliveryFormReady: true });
        expect(row.bollaGeneratedAt).toBeInstanceOf(Date);
        expect(await bollaCounter()).toBe(n1);

        // Di nuovo sulla stessa richiesta: stesso numero, nessun numero consumato.
        const again = await svc.generateBolla(actor("LOGISTICA"), r1);
        expectOk(again);
        expect(again.data!.number).toBe(first.data!.number);
        expect(again.message).toBe(`Bolla N° ${first.data!.number}.`);
        expect(await bollaCounter()).toBe(n1);

        // Il back office ha anche il permesso della logistica.
        const second = await svc.generateBolla(actor("BACKOFFICE"), r2);
        expectOk(second);
        const n2 = seq(second.data!.number);
        generatedSeq.push(n2);
        expect(n2).toBe(n1 + 1);

        expect(await svc.getWorkflowSnapshot(r1)).toMatchObject({ bollaNumber: first.data!.number, bollaMode: "ENTRAMBE" });
      });
    });

    it("due generazioni simultanee sulla stessa richiesta: un solo numero, nessun buco nella serie", async () => {
      await withSettings({ bollaConfig: bollaConfig() }, async () => {
        const r = await readyRequest();
        const next = await readyRequest();
        const before = (await bollaCounter()) ?? 0;
        const results = await Promise.all([svc.generateBolla(actor("LOGISTICA"), r), svc.generateBolla(actor("LOGISTICA"), r)]);
        for (const res of results) expectOk(res);
        const [a, b] = results.map((res) => (res.ok ? res.data!.number : ""));
        expect(a).toBe(b);
        expect(seq(a)).toBe(before + 1);
        generatedSeq.push(seq(a));
        expect((await getRequest(r)).bollaNumber).toBe(a);
        expect(await bollaCounter()).toBe(before + 1);

        const following = await svc.generateBolla(actor("LOGISTICA"), next);
        expectOk(following);
        generatedSeq.push(seq(following.data!.number));
        expect(seq(following.data!.number)).toBe(before + 2);
      });
    });

    it("modalità GESTIONALE: generazione rifiutata, la bolla è il DDT (numero o file)", async () => {
      await withSettings({ bollaConfig: bollaConfig({ mode: "GESTIONALE" }) }, async () => {
        const r = await readyRequest({ deliveryFormRequired: true });
        expect(await getEmails(r, "AVVISO_BOLLA")).toHaveLength(1);
        const counter = await bollaCounter();

        expectFail(await svc.generateBolla(actor("LOGISTICA"), r), /DDT del gestionale/);
        expect((await getRequest(r)).bollaNumber).toBeNull();
        expect(await bollaCounter()).toBe(counter);
        expect(await svc.getWorkflowSnapshot(r)).toMatchObject({ bollaMode: "GESTIONALE", deliveryFormRequired: true });

        // «Bolla pronta» senza DDT non basta in questa modalità.
        expectOk(
          await svc.updateLogisticsData(actor("LOGISTICA"), r, { carrierId: fx.carrier.id, pickupDate: "2026-10-20", deliveryFormReady: true }),
        );
        const todo = (await svc.countByStatus()).bolle;
        const blocked = await svc.advanceStatus(actor("LOGISTICA"), r, "SPEDITA");
        expectFail(blocked, /numero del DDT del gestionale o carica il file/);

        expectOk(
          await svc.updateLogisticsData(actor("LOGISTICA"), r, {
            carrierId: fx.carrier.id,
            pickupDate: "2026-10-20",
            deliveryFormReady: true,
            ddtNumber: "13807",
          }),
        );
        expect((await svc.countByStatus()).bolle).toBe(todo - 1);
        expectOk(await svc.advanceStatus(actor("LOGISTICA"), r, "SPEDITA"));
      });
    });

    it("modalità GENERATA con formato personalizzato: il DDT del gestionale non basta, la bolla generata sì", async () => {
      await withSettings(
        { bollaConfig: bollaConfig({ mode: "GENERATA", numberFormat: "T-{anno}-{numero}", numberPadding: 6 }) },
        async () => {
          const r = await readyRequest({ deliveryFormRequired: true });
          expectOk(
            await svc.updateLogisticsData(actor("LOGISTICA"), r, { carrierId: fx.carrier.id, pickupDate: "2026-10-20", ddtNumber: "13807" }),
          );
          expectFail(await svc.advanceStatus(actor("LOGISTICA"), r, "SPEDITA"), /generala dal pannello Spedizione/);
          const todo = (await svc.countByStatus()).bolle;

          const before = (await bollaCounter()) ?? 0;
          const res = await svc.generateBolla(actor("LOGISTICA"), r);
          expectOk(res);
          expect(res.data!.number).toBe(`T-${YEAR}-${String(before + 1).padStart(6, "0")}`);
          generatedSeq.push(before + 1);
          expect((await svc.countByStatus()).bolle).toBe(todo - 1);
          expect(await svc.getWorkflowSnapshot(r)).toMatchObject({ bollaMode: "GENERATA", bollaNumber: res.data!.number });
          expectOk(await svc.advanceStatus(actor("LOGISTICA"), r, "SPEDITA"));
        },
      );
    });
  });

  /* ------------------------------------------------------------------ */
  /* Bolla di consegna: regole automatiche                               */
  /* ------------------------------------------------------------------ */

  describe("regole della bolla", () => {
    it("valori predefiniti: nessuna regola, decide sempre la scelta manuale (come oggi)", async () => {
      await withSettings({ bollaConfig: bollaConfig() }, async () => {
        const c = fx.contacts.clienteIt.id;
        const abroad = createdId(
          await svc.createRequest(
            actor("BACKOFFICE"),
            info(c, [{ productId: fx.products.a.id, sampleFormat: "ESPOSITORE_COMPLETO" }], { destinationCountry: "Francia" }),
          ),
        );
        expect(await getRequest(abroad)).toMatchObject({
          destinationCountry: "Francia",
          deliveryFormRequired: false,
          deliveryFormAutoReason: null,
        });
        const manual = createdId(
          await svc.createRequest(actor("BACKOFFICE"), info(c, [{ productId: fx.products.a.id }], { deliveryFormRequired: true })),
        );
        expect(await getRequest(manual)).toMatchObject({ deliveryFormRequired: true, deliveryFormAutoReason: null });
      });
    });

    it("creazione: estero (paese indicato o del contatto) e formati rendono obbligatoria la bolla", async () => {
      await db.update(contacts).set({ country: "Francia" }).where(eq(contacts.id, fx.contacts.clientFr.id));
      await withSettings({ bollaConfig: rules({ abroad: true, formats: ["ESPOSITORE_COMPLETO"] }) }, async () => {
        const bo = actor("BACKOFFICE");
        const c = fx.contacts.clienteIt.id;
        const a = fx.products.a.id;

        const fr = createdId(await svc.createRequest(bo, info(c, [{ productId: a }], { destinationCountry: " Francia " })));
        expect(await getRequest(fr)).toMatchObject({
          destinationCountry: "Francia",
          deliveryFormRequired: true,
          deliveryFormAutoReason: "spedizione all'estero",
        });

        const it_ = createdId(await svc.createRequest(bo, info(c, [{ productId: a }], { destinationCountry: "Italia" })));
        expect(await getRequest(it_)).toMatchObject({ deliveryFormRequired: false, deliveryFormAutoReason: null });

        // Paese non indicato e contatto senza paese: non si può dire che sia estero.
        const unknown = createdId(await svc.createRequest(bo, info(c, [{ productId: a }])));
        expect(await getRequest(unknown)).toMatchObject({ destinationCountry: null, deliveryFormRequired: false });

        // Paese non indicato: vale quello del contatto.
        const fromContact = createdId(await svc.createRequest(bo, info(fx.contacts.clientFr.id, [{ productId: a }])));
        expect(await getRequest(fromContact)).toMatchObject({
          destinationCountry: "Francia",
          deliveryFormRequired: true,
          deliveryFormAutoReason: "spedizione all'estero",
        });

        const display = createdId(
          await svc.createRequest(bo, info(c, [{ productId: a }, { productId: fx.products.b.id, sampleFormat: "ESPOSITORE_COMPLETO" }])),
        );
        expect(await getRequest(display)).toMatchObject({
          deliveryFormRequired: true,
          deliveryFormAutoReason: "formato che richiede la bolla",
        });

        const both = createdId(
          await svc.createRequest(
            bo,
            info(c, [{ productId: a, sampleFormat: "ESPOSITORE_COMPLETO" }], { destinationCountry: "Svizzera", deliveryFormRequired: true }),
          ),
        );
        expect((await getRequest(both)).deliveryFormAutoReason).toBe("spedizione all'estero, formato che richiede la bolla");
      });
    });

    it("modifica: le regole si rivalutano a ogni salvataggio; senza regole torna la scelta manuale", async () => {
      await withSettings({ bollaConfig: rules({ abroad: true }) }, async () => {
        const bo = actor("BACKOFFICE");
        const c = fx.contacts.clienteIt.id;
        const items = [{ productId: fx.products.a.id }];
        const id = createdId(await svc.createRequest(bo, info(c, items, { destinationCountry: "Italia" })));
        expect((await getRequest(id)).deliveryFormRequired).toBe(false);

        expectOk(await svc.updateRequestInfo(bo, id, info(c, items, { destinationCountry: "Germania" })));
        expect(await getRequest(id)).toMatchObject({
          destinationCountry: "Germania",
          deliveryFormRequired: true,
          deliveryFormAutoReason: "spedizione all'estero",
        });

        // Paese tolto dal form, stesso contatto: resta quello salvato.
        expectOk(await svc.updateRequestInfo(bo, id, info(c, items, { destinationCountry: null })));
        expect(await getRequest(id)).toMatchObject({ destinationCountry: "Germania", deliveryFormRequired: true });

        expectOk(await svc.updateRequestInfo(bo, id, info(c, items, { destinationCountry: "Italia" })));
        expect(await getRequest(id)).toMatchObject({ deliveryFormRequired: false, deliveryFormAutoReason: null });

        expectOk(await svc.updateRequestInfo(bo, id, info(c, items, { destinationCountry: "Italia", deliveryFormRequired: true })));
        expect(await getRequest(id)).toMatchObject({ deliveryFormRequired: true, deliveryFormAutoReason: null });

        // Cambio di contatto senza paese indicato: vale il paese del nuovo contatto.
        await db.update(contacts).set({ country: "Belgio" }).where(eq(contacts.id, fx.contacts.customerEn.id));
        expectOk(await svc.updateRequestInfo(bo, id, info(fx.contacts.customerEn.id, items, { destinationCountry: null })));
        expect(await getRequest(id)).toMatchObject({
          contactId: fx.contacts.customerEn.id,
          destinationCountry: "Belgio",
          deliveryFormRequired: true,
          deliveryFormAutoReason: "spedizione all'estero",
        });
      });
    });

    it("colli minimi: valutati a «Pronta per il ritiro» con l'avviso alla logistica (Automazione 3)", async () => {
      await withSettings({ bollaConfig: rules({ minPackages: 3 }) }, async () => {
        const many = await readyRequest({}, 3);
        expect(await getRequest(many)).toMatchObject({
          status: "PRONTA_RITIRO",
          deliveryFormRequired: true,
          deliveryFormAutoReason: "3 colli (da 3 in su)",
        });
        const mails = await getEmails(many, "AVVISO_BOLLA");
        expect(mails).toHaveLength(1);
        expect(mails[0].triggeredById).toBe(actor("MAGAZZINO").id);

        const few = await readyRequest({}, 2);
        expect(await getRequest(few)).toMatchObject({ deliveryFormRequired: false, deliveryFormAutoReason: null });
        expect(await getEmails(few, "AVVISO_BOLLA")).toHaveLength(0);

        // Bolla già richiesta a mano: un solo avviso, nessun motivo automatico.
        const manual = await readyRequest({ deliveryFormRequired: true }, 5);
        expect(await getRequest(manual)).toMatchObject({ deliveryFormRequired: true, deliveryFormAutoReason: null });
        expect(await getEmails(manual, "AVVISO_BOLLA")).toHaveLength(1);
      });
    });

    it("regola dei colli attivata dopo: al salvataggio della richiesta già pronta parte l'avviso (una volta)", async () => {
      let id = 0;
      await withSettings({ bollaConfig: bollaConfig() }, async () => {
        id = await readyRequest({}, 4);
        expect((await getRequest(id)).deliveryFormRequired).toBe(false);
      });
      await withSettings({ bollaConfig: rules({ minPackages: 3 }) }, async () => {
        const bo = actor("BACKOFFICE");
        const res = await svc.updateRequestInfo(bo, id, info(fx.contacts.clienteIt.id, [{ productId: fx.products.a.id }]));
        expectOk(res);
        expect(res.message).toMatch(/Avviso bolla inviato alla logistica|email non inviata|modalità prova/);
        expect(await getRequest(id)).toMatchObject({ deliveryFormRequired: true, deliveryFormAutoReason: "4 colli (da 3 in su)" });
        expect(await getEmails(id, "AVVISO_BOLLA")).toHaveLength(1);

        expectOk(await svc.updateRequestInfo(bo, id, info(fx.contacts.clienteIt.id, [{ productId: fx.products.a.id }], { notes: "x" })));
        expect(await getEmails(id, "AVVISO_BOLLA")).toHaveLength(1);
      });
    });
  });

  /* ------------------------------------------------------------------ */
  /* Costi per cliente                                                   */
  /* ------------------------------------------------------------------ */

  describe("costi: voci manuali della logistica", () => {
    const MANUAL: CostConfig["manual"] = [
      { key: "m_imballo_speciale", label: "Imballo speciale", enabled: true },
      { key: "m_dogana", label: "Dogana", enabled: false },
    ];

    it("solo le voci attive nelle impostazioni; importi validati e uniti a quelli già salvati", async () => {
      await withSettings({ costConfig: { ...DEFAULT_COST_CONFIG, manual: MANUAL }, bollaConfig: bollaConfig() }, async () => {
        const log = actor("LOGISTICA");
        const r = await readyRequest();
        const base = { carrierId: fx.carrier.id, pickupDate: "2026-10-20" };

        expectFail(await svc.updateLogisticsData(log, r, { ...base, extraCosts: { m_sconosciuta: 5 } }), /Voce di costo non prevista/);
        expectFail(await svc.updateLogisticsData(log, r, { ...base, extraCosts: { m_dogana: 5 } }), /Voce di costo non prevista/);
        expectFail(await svc.updateLogisticsData(log, r, { ...base, extraCosts: { Imballo: 5 } }), /Controlla i campi/);
        expectFail(await svc.updateLogisticsData(log, r, { ...base, extraCosts: { m_imballo_speciale: -1 } }), /Controlla i campi/);
        expectFail(await svc.updateLogisticsData(log, r, { ...base, extraCosts: { m_imballo_speciale: 100_001 } }), /Controlla i campi/);
        expect((await getRequest(r)).extraCosts).toBeNull();

        // Una voce disattivata ma già salvata resta (riattivandola torna nei report).
        await db.update(sampleRequests).set({ extraCosts: { m_dogana: 3 } }).where(eq(sampleRequests.id, r));
        expectOk(await svc.updateLogisticsData(log, r, { ...base, extraCosts: { m_imballo_speciale: "12.5" as unknown as number } }));
        expect((await getRequest(r)).extraCosts).toEqual({ m_dogana: 3, m_imballo_speciale: 12.5 });

        // Senza voci nel form: importi invariati.
        expectOk(await svc.updateLogisticsData(log, r, { ...base, shippingCost: 9 }));
        expect((await getRequest(r)).extraCosts).toEqual({ m_dogana: 3, m_imballo_speciale: 12.5 });

        // Dopo la chiusura le voci restano modificabili come il costo del corriere.
        expectOk(await svc.advanceStatus(log, r, "SPEDITA"));
        expectOk(await svc.completeWithoutEmail(log, r, "ritiro in sede"));
        const done = await svc.updateLogisticsData(log, r, { extraCosts: { m_imballo_speciale: 20 }, shippingCost: 9 });
        expectOk(done);
        expect(done.message).toBe("Dati amministrativi aggiornati.");
        expect(await getRequest(r)).toMatchObject({
          status: "COMPLETATA",
          shippingCost: 9,
          extraCosts: { m_dogana: 3, m_imballo_speciale: 20 },
        });
        expectFail(await svc.updateLogisticsData(log, r, { extraCosts: { m_altro: 1 } }), /Voce di costo non prevista/);

        for (const role of ["MAGAZZINO", "DIREZIONE", "CRM"] as const) {
          expectFail(await svc.updateLogisticsData(actor(role), r, { extraCosts: { m_imballo_speciale: 1 } }), DENIED);
        }
        expect((await getRequest(r)).extraCosts).toEqual({ m_dogana: 3, m_imballo_speciale: 20 });
      });
    });

    it("valori predefiniti (nessuna voce manuale): qualsiasi voce è rifiutata", async () => {
      await withSettings({ costConfig: DEFAULT_COST_CONFIG }, async () => {
        const r = await readyRequest();
        expectFail(
          await svc.updateLogisticsData(actor("LOGISTICA"), r, { carrierId: fx.carrier.id, extraCosts: { m_imballo_speciale: 1 } }),
          /Voce di costo non prevista/,
        );
      });
    });
  });

  describe("costi: calcolo SQL dei report uguale a quello dei pannelli", () => {
    const FULL: CostConfig = {
      courier: { enabled: true, label: "Corriere" },
      perRequest: { enabled: true, label: "Gestione", amount: 4 },
      perPackage: { enabled: true, label: "Collo", amount: 2.5 },
      perKg: { enabled: true, label: "Kg", amount: 1.2 },
      perM2: { enabled: true, label: "Valore campioni", amount: 20, useProductPrice: true },
      manual: [
        { key: "m_imballo_speciale", label: "Imballo speciale", enabled: true },
        { key: "m_dogana", label: "Dogana", enabled: false },
      ],
    };
    const CONFIGS: [string, CostConfig][] = [
      ["predefinito", DEFAULT_COST_CONFIG],
      ["tutte le voci, prezzo del prodotto", FULL],
      ["tutte le voci, prezzo unico", { ...FULL, perM2: { ...FULL.perM2, useProductPrice: false } }],
      ["voci manuali tutte attive", { ...FULL, manual: FULL.manual.map((m) => ({ ...m, enabled: true })) }],
      ["solo importi fissi", { ...DEFAULT_COST_CONFIG, courier: { enabled: false, label: "Corriere" }, perRequest: FULL.perRequest }],
      [
        "nessuna voce",
        {
          ...DEFAULT_COST_CONFIG,
          courier: { enabled: false, label: "Corriere" },
          manual: [{ key: "m_imballo_speciale", label: "Imballo speciale", enabled: false }],
        },
      ],
    ];
    let ids: number[] = [];

    beforeAll(async () => {
      if (!fx) return;
      const bo = actor("BACKOFFICE");
      const mag = actor("MAGAZZINO");
      const { a, b } = fx.products;
      await db.update(products).set({ pricePerM2: 35.5 }).where(eq(products.id, a.id));

      async function measured(
        productIds: number[],
        warehouse: { packagesCount: number | null; weightKg: number | null },
        pieceList: { productId: number; lengthCm: number; widthCm: number; quantity?: number }[],
        extra: { shippingCost: number | null; extraCosts: Record<string, number> | null },
      ) {
        const id = createdId(
          await svc.createRequest(bo, info(fx.contacts.clienteIt.id, productIds.map((productId) => ({ productId }))), {
            sendToWarehouse: true,
          }),
        );
        expectOk(await svc.updateWarehouseData(mag, id, warehouse));
        for (const p of pieceList) expectOk(await svc.addPiece(mag, id, p));
        await db.update(sampleRequests).set(extra).where(eq(sampleRequests.id, id));
        return id;
      }

      ids = [
        await measured(
          [a.id, b.id],
          { packagesCount: 2, weightKg: 3.75 },
          [
            { productId: a.id, lengthCm: 100, widthCm: 50, quantity: 2 },
            { productId: b.id, lengthCm: 60, widthCm: 20 },
          ],
          { shippingCost: 18.3, extraCosts: { m_imballo_speciale: 6.5, m_dogana: 4 } },
        ),
        await measured([a.id], { packagesCount: 1, weightKg: 0.4 }, [], { shippingCost: null, extraCosts: null }),
        await measured(
          [a.id, b.id],
          { packagesCount: null, weightKg: null },
          [
            { productId: a.id, lengthCm: 33.3, widthCm: 33.3, quantity: 3 },
            { productId: b.id, lengthCm: 12.5, widthCm: 7.3 },
          ],
          { shippingCost: 0, extraCosts: { m_imballo_speciale: 1.25 } },
        ),
      ];
    });

    it.each(CONFIGS)("%s: totale e singole voci coincidono", async (_name, config) => {
      const components = costs.costSqlComponents(config);
      expect(components.map((c) => c.key)).toEqual(activeCostComponents(config).map((c) => c.key));

      const fields: Record<string, SQL<number>> = {
        total: sql<number>`${costs.costSqlTotal(config)}`.mapWith(Number),
      };
      for (const c of components) fields[c.key] = sql<number>`${c.expr}`.mapWith(Number);
      const rows = await db
        .select({ id: sampleRequests.id, ...fields })
        .from(sampleRequests)
        .where(inArray(sampleRequests.id, ids));
      expect(rows).toHaveLength(ids.length);

      for (const id of ids) {
        const detail = await queries.getRequestDetail(id);
        const expected = costs.requestCost(detail!, config);
        const row = rows.find((r) => r.id === id) as unknown as Record<string, number>;
        // Le righe del pannello sono arrotondate al centesimo, il SQL no: differenza al massimo di mezzo centesimo per voce.
        for (const c of components) {
          const line = expected.lines.find((l) => l.key === c.key)?.amount ?? 0;
          expect(Math.abs(row[c.key] - line), `${id} ${c.key}`).toBeLessThanOrEqual(0.005 + 1e-9);
        }
        expect(Math.abs(row.total - expected.total), `${id} totale`).toBeLessThanOrEqual(0.005 * Math.max(1, components.length) + 1e-9);
      }
    });

    it("valori attesi sulla richiesta completa (tutte le voci, prezzo del prodotto)", async () => {
      const detail = await queries.getRequestDetail(ids[0]);
      const { total, lines } = costs.requestCost(detail!, FULL);
      // 18,30 corriere + 4 gestione + 2×2,50 colli + 3,75×1,20 kg + (1 m² × 35,50 + 0,12 m² × 20) + 6,50 imballo
      expect(lines.map((l) => [l.key, l.amount])).toEqual([
        ["courier", 18.3],
        ["perRequest", 4],
        ["perPackage", 5],
        ["perKg", 4.5],
        ["perM2", 37.9],
        ["m_imballo_speciale", 6.5],
      ]);
      expect(total).toBe(76.2);
      const [row] = await db
        .select({ total: sql<number>`${costs.costSqlTotal(FULL)}`.mapWith(Number) })
        .from(sampleRequests)
        .where(eq(sampleRequests.id, ids[0]));
      expect(row.total).toBeCloseTo(76.2, 6);
    });
  });

  /* ------------------------------------------------------------------ */
  /* Export dei m² per il CRM                                            */
  /* ------------------------------------------------------------------ */

  describe("export CRM: righe, file, invio e programmazione", () => {
    let server: Server;
    let baseUrl = "";
    const hits: { path: string; headers: IncomingHttpHeaders; body: string }[] = [];

    const exportConfig = (patch: Partial<CrmExportConfig> = {}): CrmExportConfig => ({ ...DEFAULT_CRM_EXPORT_CONFIG, ...patch });
    const rowsFor = (groupBy: CrmGroupBy) => crm.getCrmExportRows(CRM_MONTH, exportConfig({ groupBy }));

    beforeAll(async () => {
      server = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          hits.push({ path: req.url ?? "", headers: req.headers, body });
          res.statusCode = req.url === "/fail" ? 500 : 200;
          res.end("ok");
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      if (!fx) return;

      // Spedizioni di febbraio 2001 (e una di marzo, e una non ancora spedita) con pezzi misurati.
      const { a, b } = fx.products;
      await db.update(products).set({ brand: "BGP Test", category: "Parquet" }).where(eq(products.id, a.id));
      await db.update(contacts).set({ country: "Italia" }).where(eq(contacts.id, fx.contacts.clienteIt.id));
      await db.update(contacts).set({ country: "Regno Unito" }).where(eq(contacts.id, fx.contacts.customerEn.id));

      const bo = actor("BACKOFFICE");
      const mag = actor("MAGAZZINO");
      const log = actor("LOGISTICA");
      async function shipped(
        contactId: number,
        pieceList: { productId: number; lengthCm: number; widthCm: number; quantity?: number }[],
        pickupDate: string,
        then: "SPEDITA" | "COMPLETATA" | "PRONTA_RITIRO",
      ) {
        const productIds = [...new Set(pieceList.map((p) => p.productId))];
        const id = createdId(
          await svc.createRequest(bo, info(contactId, productIds.map((productId) => ({ productId }))), { sendToWarehouse: true }),
        );
        expectOk(await svc.updateWarehouseData(mag, id, { packagesCount: 1, weightKg: 1 }));
        for (const p of pieceList) expectOk(await svc.addPiece(mag, id, p));
        expectOk(await svc.advanceStatus(mag, id, "PRONTA_RITIRO"));
        expectOk(await svc.updateLogisticsData(log, id, { carrierId: fx.carrier.id, pickupDate }));
        if (then === "PRONTA_RITIRO") return id;
        expectOk(await svc.advanceStatus(log, id, "SPEDITA"));
        if (then === "COMPLETATA") expectOk(await svc.completeWithoutEmail(log, id, "ritiro in sede"));
        return id;
      }

      await withSettings({ bollaConfig: bollaConfig() }, async () => {
        await shipped(
          fx.contacts.clienteIt.id,
          [
            { productId: a.id, lengthCm: 100, widthCm: 50, quantity: 2 },
            { productId: b.id, lengthCm: 60, widthCm: 20 },
          ],
          "2001-02-10",
          "SPEDITA",
        );
        await shipped(fx.contacts.customerEn.id, [{ productId: a.id, lengthCm: 50, widthCm: 50 }], "2001-02-20", "COMPLETATA");
        await shipped(fx.contacts.noEmail.id, [{ productId: b.id, lengthCm: 100, widthCm: 100 }], "2001-02-28", "SPEDITA");
        await shipped(fx.contacts.clienteIt.id, [{ productId: a.id, lengthCm: 10, widthCm: 10 }], "2001-03-05", "SPEDITA");
        await shipped(fx.contacts.clienteIt.id, [{ productId: a.id, lengthCm: 20, widthCm: 20 }], "2001-02-15", "PRONTA_RITIRO");
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    });

    const mine = (rows: CrmRow[], column: "codice" | "cliente" | "agente", values: string[]) =>
      rows.filter((r) => values.includes(String(r[column])));

    it("per prodotto (predefinito): richieste, pezzi e m² del mese di spedizione", async () => {
      const { a, b } = fx.products;
      const rows = mine(await rowsFor("PRODOTTO"), "codice", [a.code, b.code]);
      expect(rows).toEqual([
        {
          mese: CRM_MONTH,
          codice: a.code,
          descrizione: a.description,
          marchio: "BGP Test",
          categoria: "Parquet",
          richieste: 2,
          pezzi: 3,
          m2: 1.25,
        },
        { mese: CRM_MONTH, codice: b.code, descrizione: b.description, marchio: null, categoria: null, richieste: 2, pezzi: 2, m2: 1.12 },
      ]);
      // La spedizione di marzo conta in marzo.
      const march = await crm.getCrmExportRows("2001-03", exportConfig());
      expect(mine(march, "codice", [a.code, b.code])).toMatchObject([{ codice: a.code, richieste: 1, pezzi: 1, m2: 0.01 }]);
    });

    it("per prodotto e cliente: una riga per coppia, con paese e agente (o «Direzionale»)", async () => {
      const { a, b } = fx.products;
      const { clienteIt, customerEn, noEmail, agent } = fx.contacts;
      const rows = mine(await rowsFor("PRODOTTO_CLIENTE"), "codice", [a.code, b.code]);
      const pick = (r: CrmRow) => [r.codice, r.cliente, r.paese, r.agente, r.richieste, r.pezzi, r.m2];
      expect(rows.map(pick)).toEqual([
        [a.code, clienteIt.name, "Italia", agent.name, 1, 2, 1],
        [a.code, customerEn.name, "Regno Unito", agent.name, 1, 1, 0.25],
        [b.code, clienteIt.name, "Italia", agent.name, 1, 1, 0.12],
        [b.code, noEmail.name, null, "Direzionale (senza agente)", 1, 1, 1],
      ]);
      expect(rows[0]).toMatchObject({ mese: CRM_MONTH, descrizione: a.description, marchio: "BGP Test", categoria: "Parquet" });
    });

    it("per cliente: totali del cliente, dal più grande", async () => {
      const { clienteIt, customerEn, noEmail, agent } = fx.contacts;
      const rows = mine(await rowsFor("CLIENTE"), "cliente", [clienteIt.name, customerEn.name, noEmail.name]);
      expect(rows).toEqual([
        { mese: CRM_MONTH, cliente: clienteIt.name, paese: "Italia", agente: agent.name, richieste: 1, pezzi: 3, m2: 1.12 },
        { mese: CRM_MONTH, cliente: noEmail.name, paese: null, agente: "Direzionale (senza agente)", richieste: 1, pezzi: 1, m2: 1 },
        { mese: CRM_MONTH, cliente: customerEn.name, paese: "Regno Unito", agente: agent.name, richieste: 1, pezzi: 1, m2: 0.25 },
      ]);
    });

    it("per agente: i clienti senza agente insieme in «Direzionale»", async () => {
      const rows = mine(await rowsFor("AGENTE"), "agente", [fx.contacts.agent.name, "Direzionale (senza agente)"]);
      expect(rows).toEqual([
        { mese: CRM_MONTH, agente: fx.contacts.agent.name, richieste: 2, pezzi: 4, m2: 1.37 },
        { mese: CRM_MONTH, agente: "Direzionale (senza agente)", richieste: 1, pezzi: 1, m2: 1 },
      ]);
    });

    it("file CSV predefinito: una riga per prodotto con marchio e categoria", async () => {
      const { a } = fx.products;
      const file = await crm.buildCrmExportFile(CRM_MONTH, DEFAULT_CRM_EXPORT_CONFIG);
      expect(file.fileName).toBe(`m2-campioni-${CRM_MONTH}.csv`);
      expect(file.contentType).toBe("text/csv; charset=utf-8");
      const text = file.data.toString("utf8");
      const lines = text.replace(/^﻿/, "").split("\r\n");
      expect(lines[0]).toBe("Codice;Descrizione;Marchio;Categoria;Richieste;Pezzi;m2");
      expect(lines).toContain(`${a.code};${a.description};BGP Test;Parquet;2;3;1,25`);
      expect(file.rows).toBe(lines.length - 2);
      expect(file.rows).toBe((await rowsFor("PRODOTTO")).length);
    });

    it("file Excel: colonne scelte, codici come testo, con e senza intestazione", async () => {
      const { a } = fx.products;
      const config = exportConfig({
        groupBy: "PRODOTTO_CLIENTE",
        columns: ["codice", "cliente", "m2"],
        format: "XLSX",
        fileName: "crm {mese}",
      });
      const file = await crm.buildCrmExportFile(CRM_MONTH, config);
      expect(file.fileName).toBe(`crm ${CRM_MONTH}.xlsx`);
      expect(file.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      const read = async (data: Buffer) => {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(data as unknown as ArrayBuffer);
        const ws = wb.worksheets[0];
        const values: unknown[][] = [];
        ws.eachRow((row) => values.push((row.values as unknown[]).slice(1)));
        return { ws, values };
      };
      const withHeader = await read(file.data);
      expect(withHeader.ws.name).toBe(`m2 ${CRM_MONTH}`);
      expect(withHeader.values[0]).toEqual(["Codice", "Cliente", "m2"]);
      expect(withHeader.values).toContainEqual([a.code, fx.contacts.clienteIt.name, 1]);
      expect(withHeader.values).toHaveLength(file.rows + 1);
      expect(withHeader.ws.getColumn(1).numFmt).toBe("@");

      const noHeader = await read((await crm.buildCrmExportFile(CRM_MONTH, { ...config, header: false })).data);
      expect(noHeader.values).toHaveLength(file.rows);
      expect(noHeader.values[0]).not.toEqual(["Codice", "Cliente", "m2"]);
      expect(noHeader.values).toContainEqual([a.code, fx.contacts.clienteIt.name, 1]);
    });

    it("invio: email con il file ai destinatari e webhook firmato (HMAC SHA-256)", async () => {
      const config = exportConfig({
        autoSend: { enabled: true, recipients: [RCPT], day: 28 },
        // http locale solo per il test: lo schema delle impostazioni accetta solo https://
        webhook: { enabled: true, url: `${baseUrl}/ok`, secret: "s3cr3t" },
      });
      await withSettings({ crmExport: config }, async () => {
        hits.length = 0;
        const res = await crm.sendCrmExport(CRM_MONTH, { triggeredById: actor("ADMIN").id });
        expect(res).toMatchObject({
          month: CRM_MONTH,
          email: { status: "SIMULATA" },
          webhook: { status: "OK", detail: "HTTP 200" },
        });
        expect(res.rows).toBe((await rowsFor("PRODOTTO")).length);

        const logged = await db.select().from(emailLog).where(and(eq(emailLog.kind, "EXPORT_CRM"), eq(emailLog.toAddresses, RCPT)));
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatchObject({
          requestId: null,
          language: "it",
          subject: "Export m² campioni — febbraio 2001",
          attachmentNames: `m2-campioni-${CRM_MONTH}.csv`,
          status: "SIMULATA",
          triggeredById: actor("ADMIN").id,
        });
        expect(logged[0].body).toContain(`(${res.rows} righe)`);

        expect(hits).toHaveLength(1);
        const [hit] = hits;
        expect(hit.path).toBe("/ok");
        expect(hit.headers["content-type"]).toBe("application/json");
        const signature = createHmac("sha256", "s3cr3t").update(hit.body).digest("hex");
        expect(hit.headers["x-bgp-signature"]).toBe(`sha256=${signature}`);
        const payload = JSON.parse(hit.body) as { tipo: string; mese: string; raggruppamento: string; colonne: string[]; righe: CrmRow[]; generatoIl: string };
        expect(payload).toMatchObject({
          tipo: "export_m2_campioni",
          mese: CRM_MONTH,
          raggruppamento: "PRODOTTO",
          colonne: DEFAULT_CRM_EXPORT_CONFIG.columns,
        });
        expect(Number.isNaN(Date.parse(payload.generatoIl))).toBe(false);
        expect(payload.righe).toContainEqual({
          codice: fx.products.a.code,
          descrizione: fx.products.a.description,
          marchio: "BGP Test",
          categoria: "Parquet",
          richieste: 2,
          pezzi: 3,
          m2: 1.25,
        });
        expect(payload.righe).toHaveLength(res.rows);

        // «Invia ora» con destinatari indicati: solo email, il webhook non parte.
        const manual = await crm.sendCrmExport(CRM_MONTH, { recipients: [RCPT2] });
        expect(manual).toMatchObject({ email: { status: "SIMULATA" }, webhook: { status: "DISATTIVATO" } });
        expect(hits).toHaveLength(1);
        expect(await db.select().from(emailLog).where(eq(emailLog.toAddresses, RCPT2))).toHaveLength(1);
      });
    });

    it("webhook che risponde con un errore: esito ERRORE con il codice HTTP", async () => {
      const config = exportConfig({ webhook: { enabled: true, url: `${baseUrl}/fail`, secret: "" } });
      await withSettings({ crmExport: config }, async () => {
        const res = await crm.sendCrmExport(CRM_MONTH);
        expect(res).toMatchObject({ email: { status: "DISATTIVATO" }, webhook: { status: "ERRORE", detail: "HTTP 500" } });
      });
    });

    it("valori predefiniti: nessun canale attivo, niente email né webhook", async () => {
      await withSettings({ crmExport: DEFAULT_CRM_EXPORT_CONFIG }, async () => {
        const res = await crm.sendCrmExport(CRM_MONTH);
        expect(res).toMatchObject({ email: { status: "DISATTIVATO" }, webhook: { status: "DISATTIVATO" } });
        expect(await crm.runDueCrmExport("2001-03-28")).toBeNull();
        const runs = await db
          .select()
          .from(scheduledRuns)
          .where(and(eq(scheduledRuns.job, CRM_JOB), eq(scheduledRuns.period, CRM_MONTH)));
        expect(runs).toHaveLength(0);
      });
    });

    it("invio programmato: dal giorno indicato, una sola volta per mese (lucchetto in scheduled_runs)", async () => {
      // Giorno 28: lo scheduler di `next dev` (che usa la data di oggi) non parte durante il test.
      const config = exportConfig({ autoSend: { enabled: true, recipients: [RCPT], day: 28 } });
      await withSettings({ crmExport: config }, async () => {
        const sentBefore = await db
          .select()
          .from(emailLog)
          .where(and(eq(emailLog.kind, "EXPORT_CRM"), eq(emailLog.toAddresses, RCPT)));

        expect(await crm.runDueCrmExport("2001-03-27")).toBeNull();
        const runsFor = (period: string) =>
          db.select().from(scheduledRuns).where(and(eq(scheduledRuns.job, CRM_JOB), eq(scheduledRuns.period, period)));
        expect(await runsFor(CRM_MONTH)).toHaveLength(0);

        const res = await crm.runDueCrmExport("2001-03-28");
        expect(res).toMatchObject({ month: CRM_MONTH, email: { status: "SIMULATA" }, webhook: { status: "DISATTIVATO" } });
        const [run] = await runsFor(CRM_MONTH);
        expect(run).toMatchObject({ status: "OK" });
        expect(JSON.parse(run.detail ?? "{}")).toMatchObject({ month: CRM_MONTH, rows: res!.rows });

        // Già inviato: nessun nuovo invio, né lo stesso giorno né dopo.
        expect(await crm.runDueCrmExport("2001-03-28")).toBeNull();
        expect(await crm.runDueCrmExport("2001-03-31")).toBeNull();
        expect(await runsFor(CRM_MONTH)).toHaveLength(1);
        const sent = await db
          .select()
          .from(emailLog)
          .where(and(eq(emailLog.kind, "EXPORT_CRM"), eq(emailLog.toAddresses, RCPT)));
        expect(sent.length - sentBefore.length).toBe(1);
        expect(sent[sent.length - 1].subject).toBe("Export m² campioni — febbraio 2001");

        // Due istanze nello stesso momento: un solo invio.
        const parallel = await Promise.all([crm.runDueCrmExport("2001-04-28"), crm.runDueCrmExport("2001-04-28")]);
        expect(parallel.filter((r) => r !== null)).toHaveLength(1);
        expect(parallel.find((r) => r !== null)).toMatchObject({ month: "2001-03" });
        expect(await runsFor("2001-03")).toHaveLength(1);
        const march = await db
          .select()
          .from(emailLog)
          .where(and(eq(emailLog.kind, "EXPORT_CRM"), eq(emailLog.toAddresses, RCPT), eq(emailLog.subject, "Export m² campioni — marzo 2001")));
        expect(march).toHaveLength(1);
      });
    });

    it("invio programmato solo via webhook: esito registrato, ERRORE se il CRM non risponde bene", async () => {
      const runsFor = (period: string) =>
        db.select().from(scheduledRuns).where(and(eq(scheduledRuns.job, CRM_JOB), eq(scheduledRuns.period, period)));

      await withSettings({ crmExport: exportConfig({ autoSend: { enabled: false, recipients: [], day: 28 }, webhook: { enabled: true, url: `${baseUrl}/ok`, secret: "x" } }) }, async () => {
        const res = await crm.runDueCrmExport("2001-06-28");
        expect(res).toMatchObject({ month: "2001-05", email: { status: "DISATTIVATO" }, webhook: { status: "OK" } });
        expect((await runsFor("2001-05"))[0]).toMatchObject({ status: "OK" });
      });

      await withSettings({ crmExport: exportConfig({ autoSend: { enabled: false, recipients: [], day: 28 }, webhook: { enabled: true, url: `${baseUrl}/fail`, secret: "x" } }) }, async () => {
        const res = await crm.runDueCrmExport("2001-07-28");
        expect(res).toMatchObject({ month: "2001-06", webhook: { status: "ERRORE", detail: "HTTP 500" } });
        expect((await runsFor("2001-06"))[0]).toMatchObject({ status: "ERRORE" });
      });
    });

    it("mese precedente: anche a gennaio e a fine mese", () => {
      expect(crm.previousMonthIso("2026-01-15")).toBe("2025-12");
      expect(crm.previousMonthIso("2026-03-31")).toBe("2026-02");
      expect(crm.previousMonthIso("2026-10-01")).toBe("2026-09");
    });
  });

  /* ------------------------------------------------------------------ */
  /* Modulo pubblico                                                     */
  /* ------------------------------------------------------------------ */

  describe("modulo pubblico", () => {
    const token = () => pub.issuePublicFormToken(Date.now() - 10_000);
    const form = (n: number, overrides: Record<string, unknown> = {}) => ({
      requesterType: "CLIENTE",
      requesterName: "Mario Rossi",
      requesterEmail: `vitest-pub${n}-${RUN}@example.test`,
      recipientName: `${fx.mark} Rossi Arredamenti ${n}`,
      recipientIsPrivate: false,
      attentionOf: "Sig. Bianchi",
      address: "Via Roma 1, 24023 Clusone (BG)",
      country: null,
      language: "it",
      phoneNotice: true,
      phoneNoticeNumber: "035 123456",
      items: [{ productId: fx.products.a.id, quantity: 2, sampleFormat: "MAZZETTA" }],
      consent: true,
      website: "",
      formToken: token(),
      ...overrides,
    });
    const requestOf = async (code: string) => getRequest(Number(code.replace(/\D/g, "")));

    it("dati incompleti: errori sui campi, nessuna richiesta salvata", async () => {
      const res = await pub.createPublicRequest(
        form(1, {
          attentionOf: null,
          phoneNoticeNumber: "-----",
          items: [{ productId: fx.products.a.id, quantity: 1, sampleFormat: "" }],
        }),
        null,
      );
      expectFail(res, /Controlla i campi/);
      expect(Object.keys(res.fieldErrors ?? {})).toEqual(expect.arrayContaining(["attentionOf", "phoneNoticeNumber", "items.0.sampleFormat", "items"]));
      const saved = await db.select().from(contacts).where(like(contacts.name, `${fx.mark} Rossi Arredamenti 1%`));
      expect(saved).toHaveLength(0);
    });

    it("destinatario privato: «alla c.a.» non salvato; preavviso «No»: niente numero", async () => {
      await withSettings({ bollaConfig: bollaConfig() }, async () => {
        const res = await pub.createPublicRequest(
          form(2, { recipientIsPrivate: true, attentionOf: "Sig. Bianchi", phoneNotice: false, phoneNoticeNumber: "035 123456" }),
          null,
        );
        expectOk(res);
        expect(await requestOf(res.data!.code)).toMatchObject({
          source: "MODULO_PUBBLICO",
          status: "NUOVA",
          recipientName: `${fx.mark} Rossi Arredamenti 2`,
          attentionOf: null,
          phoneNotice: false,
          phoneNoticeNumber: null,
          deliveryFormRequired: false,
        });
      });
    });

    it("regole della bolla anche per il modulo pubblico: paese di consegna a parte", async () => {
      await withSettings({ bollaConfig: rules({ abroad: true }) }, async () => {
        const res = await pub.createPublicRequest(form(3, { country: "Francia", address: "12 Rue de la Paix, 75002 Paris" }), null);
        expectOk(res);
        expect(await requestOf(res.data!.code)).toMatchObject({
          destinationCountry: "Francia",
          destinationAddress: "12 Rue de la Paix, 75002 Paris",
          attentionOf: "Sig. Bianchi",
          phoneNoticeNumber: "035 123456",
          deliveryFormRequired: true,
          deliveryFormAutoReason: "spedizione all'estero",
        });
      });
    });
  });
});
