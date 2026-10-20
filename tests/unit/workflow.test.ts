import { describe, expect, it } from "vitest";
import type { RequestStatus } from "@/db/schema";
import { can, ROLES } from "@/lib/roles";
import { nextStatus, STATUS_ORDER, STATUS_OWNER } from "@/lib/status";
import { sampleFormatMissing } from "@/lib/sample-formats";
import {
  ADVANCE_LABELS,
  bollaSatisfied,
  EDITABLE_IN,
  shipmentConfirmationProblems,
  shouldSendShipmentConfirmation,
  transitionPermission,
  transitionProblems,
  type WorkflowSnapshot,
} from "@/lib/requests/workflow";

/** Snapshot "completo": ogni transizione verso lo stato successivo è consentita. */
function snap(overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    status: "NUOVA",
    contactId: 1,
    contactHasEmail: true,
    recipientName: "ORBIS FURNITURE SRL",
    destinationAddress: "Via Roma 1\n24023 Clusone (BG)",
    phoneNotice: true,
    phoneNoticeNumber: "328 3556565",
    itemsCount: 2,
    itemsMissingFormat: 0,
    packagesCount: 1,
    weightKg: 2.5,
    piecesCount: 3,
    deliveryFormRequired: false,
    deliveryFormReady: false,
    carrierId: 1,
    pickupDate: "2026-10-21",
    ddtNumber: null,
    hasDdtAttachment: false,
    trackingNumber: null,
    shipmentDate: null,
    notificationSentAt: null,
    ...overrides,
  };
}

describe("transitionProblems — passaggi non ammessi", () => {
  it("accetta solo lo stato immediatamente successivo", () => {
    for (const from of STATUS_ORDER) {
      for (const to of STATUS_ORDER) {
        if (to === nextStatus(from)) continue;
        const problems = transitionProblems(snap({ status: from }), to);
        expect(problems, `${from} → ${to}`).toHaveLength(1);
        expect(problems[0]).toMatch(/Passaggio non consentito/);
      }
    }
  });

  it("non permette di saltare stati né di tornare indietro", () => {
    expect(transitionProblems(snap({ status: "NUOVA" }), "PRONTA_RITIRO")).not.toEqual([]);
    expect(transitionProblems(snap({ status: "NUOVA" }), "SPEDITA")).not.toEqual([]);
    expect(transitionProblems(snap({ status: "SPEDITA" }), "PRONTA_RITIRO")).not.toEqual([]);
    expect(transitionProblems(snap({ status: "COMPLETATA" }), "NUOVA")).not.toEqual([]);
  });

  it("Completata non si raggiunge manualmente", () => {
    const problems = transitionProblems(snap({ status: "SPEDITA", trackingNumber: "X", shipmentDate: "2026-10-22" }), "COMPLETATA");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/automaticamente/);
  });
});

describe("transitionProblems — Nuova richiesta → In preparazione", () => {
  const to: RequestStatus = "IN_PREPARAZIONE";
  const RECIPIENT = "Indica il destinatario (ragione sociale o cognome e nome).";
  const ADDRESS = "Indica l'indirizzo di consegna.";
  const PHONE_NOTICE = "Indica se serve il preavviso telefonico prima della consegna.";
  const PHONE_NUMBER = "Indica il numero di telefono per il preavviso.";

  it("con i dati richiesti da BGP è consentito", () => {
    expect(transitionProblems(snap(), to)).toEqual([]);
  });

  it("segnala contatto, destinatario, indirizzo e prodotti mancanti", () => {
    expect(transitionProblems(snap({ contactId: null }), to)).toEqual(["Seleziona il contatto (cliente o agente)."]);
    expect(transitionProblems(snap({ recipientName: null }), to)).toEqual([RECIPIENT]);
    expect(transitionProblems(snap({ recipientName: "  " }), to)).toEqual([RECIPIENT]);
    expect(transitionProblems(snap({ destinationAddress: null }), to)).toEqual([ADDRESS]);
    expect(transitionProblems(snap({ destinationAddress: "   " }), to)).toEqual([ADDRESS]);
    expect(transitionProblems(snap({ itemsCount: 0, itemsMissingFormat: 0 }), to)).toEqual([
      "Aggiungi almeno un prodotto richiesto.",
    ]);
  });

  it("«alla c.a.» non è obbligatorio (non sempre si sa se il destinatario è una ditta)", () => {
    // Lo snapshot non lo contiene nemmeno: è solo un promemoria nell'interfaccia.
    expect(transitionProblems(snap({ recipientName: "LEGNOARTE SRL" }), to)).toEqual([]);
  });

  it("ogni prodotto deve avere il formato del campione", () => {
    const one = transitionProblems(snap({ itemsMissingFormat: 1 }), to);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatch(/formato del campione/);
    expect(one[0]).toMatch(/doghe intere, mezze doghe, mazzetta/);
    expect(transitionProblems(snap({ itemsCount: 3, itemsMissingFormat: 2 }), to)).toEqual([
      "Indica il formato del campione per 2 prodotti.",
    ]);
  });

  it("«Altro» senza descrizione conta come formato mancante (come nel conteggio del servizio)", () => {
    const items = [
      { sampleFormat: "MAZZETTA", formatNote: null },
      { sampleFormat: "ALTRO", formatNote: null },
      { sampleFormat: "ALTRO", formatNote: "   " },
      { sampleFormat: "ALTRO", formatNote: "listello tagliato a 30 cm" },
      { sampleFormat: null, formatNote: null },
    ];
    const itemsMissingFormat = items.filter((i) => sampleFormatMissing(i.sampleFormat, i.formatNote)).length;
    expect(itemsMissingFormat).toBe(3);
    expect(transitionProblems(snap({ itemsCount: items.length, itemsMissingFormat }), to)).toEqual([
      "Indica il formato del campione per 3 prodotti.",
    ]);
  });

  it("il preavviso telefonico va indicato (sì o no); se sì serve il numero", () => {
    expect(transitionProblems(snap({ phoneNotice: null, phoneNoticeNumber: null }), to)).toEqual([PHONE_NOTICE]);
    expect(transitionProblems(snap({ phoneNotice: true, phoneNoticeNumber: null }), to)).toEqual([PHONE_NUMBER]);
    expect(transitionProblems(snap({ phoneNotice: true, phoneNoticeNumber: "  " }), to)).toEqual([PHONE_NUMBER]);
    expect(transitionProblems(snap({ phoneNotice: false, phoneNoticeNumber: null }), to)).toEqual([]);
    // Un numero rimasto da prima non conta se il preavviso non serve.
    expect(transitionProblems(snap({ phoneNotice: false, phoneNoticeNumber: "035 123456" }), to)).toEqual([]);
  });

  it("elenca tutti i problemi insieme, nell'ordine del modulo", () => {
    const problems = transitionProblems(
      snap({
        contactId: null,
        recipientName: null,
        destinationAddress: "",
        itemsCount: 1,
        itemsMissingFormat: 1,
        phoneNotice: null,
        phoneNoticeNumber: null,
      }),
      to,
    );
    expect(problems).toHaveLength(5);
    expect(problems[0]).toMatch(/contatto/);
    expect(problems[1]).toBe(RECIPIENT);
    expect(problems[2]).toBe(ADDRESS);
    expect(problems[3]).toMatch(/formato del campione/);
    expect(problems[4]).toBe(PHONE_NOTICE);
    expect(transitionProblems(snap({ contactId: null, destinationAddress: "", itemsCount: 0 }), to)).toHaveLength(3);
  });

  it("i dati di magazzino e logistica non contano in questa fase", () => {
    expect(
      transitionProblems(snap({ packagesCount: null, weightKg: null, piecesCount: 0, carrierId: null, pickupDate: null }), to),
    ).toEqual([]);
  });

  it("i dati di presa in carico non bloccano gli stati successivi (richieste nate prima della regola)", () => {
    const legacy = {
      recipientName: null,
      phoneNotice: null,
      phoneNoticeNumber: null,
      itemsMissingFormat: 2,
    } satisfies Partial<WorkflowSnapshot>;
    expect(transitionProblems(snap({ ...legacy, status: "IN_PREPARAZIONE" }), "PRONTA_RITIRO")).toEqual([]);
    expect(transitionProblems(snap({ ...legacy, status: "PRONTA_RITIRO" }), "SPEDITA")).toEqual([]);
  });
});

describe("transitionProblems — In preparazione → Pronta per il ritiro", () => {
  const base = snap({ status: "IN_PREPARAZIONE" });
  const to: RequestStatus = "PRONTA_RITIRO";

  it("con colli, peso e pezzi è consentito", () => {
    expect(transitionProblems(base, to)).toEqual([]);
  });

  it("richiede il numero di colli (almeno 1)", () => {
    expect(transitionProblems({ ...base, packagesCount: null }, to)).toEqual(["Indica il numero di colli."]);
    expect(transitionProblems({ ...base, packagesCount: 0 }, to)).toEqual(["Indica il numero di colli."]);
  });

  it("richiede un peso maggiore di zero", () => {
    expect(transitionProblems({ ...base, weightKg: null }, to)).toEqual(["Indica il peso totale in kg."]);
    expect(transitionProblems({ ...base, weightKg: 0 }, to)).toEqual(["Indica il peso totale in kg."]);
    expect(transitionProblems({ ...base, weightKg: -1 }, to)).toEqual(["Indica il peso totale in kg."]);
  });

  it("senza pezzi serve la conferma esplicita del magazzino", () => {
    const noPieces = { ...base, piecesCount: 0 };
    const problems = transitionProblems(noPieces, to);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/misure dei pezzi/);
    expect(transitionProblems(noPieces, to, { acknowledgeNoPieces: true })).toEqual([]);
    expect(transitionProblems(noPieces, to, { acknowledgeNoPieces: false })).toHaveLength(1);
  });

  it("la conferma «nessun pezzo» non sostituisce colli e peso", () => {
    const problems = transitionProblems({ ...base, piecesCount: 0, packagesCount: null, weightKg: null }, to, {
      acknowledgeNoPieces: true,
    });
    expect(problems).toEqual(["Indica il numero di colli.", "Indica il peso totale in kg."]);
  });

  it("la bolla non è richiesta per il passaggio a Pronta per il ritiro", () => {
    expect(transitionProblems({ ...base, deliveryFormRequired: true }, to)).toEqual([]);
  });
});

describe("transitionProblems — Pronta per il ritiro → Spedita", () => {
  const base = snap({ status: "PRONTA_RITIRO" });
  const to: RequestStatus = "SPEDITA";

  it("con corriere e data di ritiro (bolla non richiesta) è consentito", () => {
    expect(transitionProblems(base, to)).toEqual([]);
  });

  it("richiede corriere e data di ritiro", () => {
    expect(transitionProblems({ ...base, carrierId: null }, to)).toEqual(["Seleziona il corriere."]);
    expect(transitionProblems({ ...base, pickupDate: null }, to)).toEqual(["Indica la data di ritiro."]);
    expect(transitionProblems({ ...base, carrierId: null, pickupDate: null }, to)).toHaveLength(2);
  });

  it("tracking e data di spedizione non sono necessari per segnare la spedizione", () => {
    expect(transitionProblems({ ...base, trackingNumber: null, shipmentDate: null }, to)).toEqual([]);
  });

  describe("regola della bolla di consegna", () => {
    const required = { ...base, deliveryFormRequired: true };

    it("bolla richiesta e non preparata: blocca", () => {
      const problems = transitionProblems(required, to);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/Bolla di consegna richiesta/);
    });

    it("soddisfatta da «bolla pronta»", () => {
      expect(transitionProblems({ ...required, deliveryFormReady: true }, to)).toEqual([]);
    });

    it("soddisfatta dal numero DDT (non vuoto)", () => {
      expect(transitionProblems({ ...required, ddtNumber: "13807" }, to)).toEqual([]);
      expect(transitionProblems({ ...required, ddtNumber: "   " }, to)).toHaveLength(1);
    });

    it("soddisfatta dal DDT caricato", () => {
      expect(transitionProblems({ ...required, hasDdtAttachment: true }, to)).toEqual([]);
    });

    it("bollaSatisfied: se la bolla non è richiesta è sempre soddisfatta", () => {
      expect(bollaSatisfied({ deliveryFormRequired: false, deliveryFormReady: false, ddtNumber: null, hasDdtAttachment: false })).toBe(true);
      expect(bollaSatisfied({ deliveryFormRequired: true, deliveryFormReady: false, ddtNumber: null, hasDdtAttachment: false })).toBe(false);
      expect(bollaSatisfied({ deliveryFormRequired: true, deliveryFormReady: false, ddtNumber: " 42 ", hasDdtAttachment: false })).toBe(true);
    });
  });
});

describe("transitionPermission e ADVANCE_LABELS", () => {
  it("ogni stato avanza con il permesso del suo responsabile", () => {
    expect(transitionPermission("NUOVA")).toBe("requests.manage");
    expect(transitionPermission("IN_PREPARAZIONE")).toBe("warehouse.work");
    expect(transitionPermission("PRONTA_RITIRO")).toBe("logistics.work");
  });

  it("Spedita → Completata è automatico e Completata è finale", () => {
    expect(transitionPermission("SPEDITA")).toBeNull();
    expect(transitionPermission("COMPLETATA")).toBeNull();
  });

  it("il ruolo responsabile dello stato (STATUS_OWNER) ha il permesso per farlo avanzare", () => {
    for (const status of STATUS_ORDER) {
      const permission = transitionPermission(status);
      const owner = STATUS_OWNER[status];
      if (!permission || owner === "SISTEMA") continue;
      expect(can(owner, permission), `${owner} in ${status}`).toBe(true);
    }
  });

  it("solo DIREZIONE e CRM non possono far avanzare alcuno stato", () => {
    const movers = ROLES.filter((role) =>
      STATUS_ORDER.some((s) => {
        const p = transitionPermission(s);
        return p !== null && can(role, p);
      }),
    );
    expect(movers.sort()).toEqual(["ADMIN", "BACKOFFICE", "LOGISTICA", "MAGAZZINO"]);
  });

  it("c'è un'etichetta del pulsante per ogni passaggio manuale", () => {
    const manual = STATUS_ORDER.filter((s) => transitionPermission(s) !== null);
    expect(Object.keys(ADVANCE_LABELS).sort()).toEqual([...manual].sort());
    expect(ADVANCE_LABELS.NUOVA).toBe("Invia al magazzino");
  });
});

describe("Automazione 2 — conferma di spedizione", () => {
  const shipped = snap({ status: "SPEDITA", trackingNumber: "1Z999AA10123456784", shipmentDate: "2026-10-22" });

  it("parte con stato Spedita, tracking, data di spedizione e nessun invio precedente", () => {
    expect(shouldSendShipmentConfirmation(shipped)).toBe(true);
  });

  it("non parte senza tracking (anche solo spazi) o senza data di spedizione", () => {
    expect(shouldSendShipmentConfirmation({ ...shipped, trackingNumber: null })).toBe(false);
    expect(shouldSendShipmentConfirmation({ ...shipped, trackingNumber: "   " })).toBe(false);
    expect(shouldSendShipmentConfirmation({ ...shipped, shipmentDate: null })).toBe(false);
  });

  it("non parte due volte", () => {
    expect(shouldSendShipmentConfirmation({ ...shipped, notificationSentAt: new Date() })).toBe(false);
  });

  it("parte solo nello stato Spedita", () => {
    for (const status of STATUS_ORDER.filter((s) => s !== "SPEDITA")) {
      expect(shouldSendShipmentConfirmation({ ...shipped, status }), status).toBe(false);
    }
  });

  it("shipmentConfirmationProblems elenca ciò che manca", () => {
    expect(shipmentConfirmationProblems(shipped)).toEqual([]);
    expect(shipmentConfirmationProblems({ ...shipped, trackingNumber: " ", shipmentDate: null, contactHasEmail: false })).toEqual([
      "Inserisci il numero di tracking.",
      "Inserisci la data di spedizione.",
      "Il contatto non ha un indirizzo email valido.",
    ]);
  });
});

describe("EDITABLE_IN", () => {
  it("dati della richiesta modificabili fino al ritiro", () => {
    expect(EDITABLE_IN.info).toEqual(["NUOVA", "IN_PREPARAZIONE", "PRONTA_RITIRO"]);
  });

  it("prodotti modificabili solo prima che il magazzino chiuda la preparazione", () => {
    expect(EDITABLE_IN.items).toEqual(["NUOVA", "IN_PREPARAZIONE"]);
  });

  it("dati di magazzino modificabili durante la preparazione e fino al ritiro", () => {
    expect(EDITABLE_IN.warehouse).toEqual(["IN_PREPARAZIONE", "PRONTA_RITIRO"]);
  });

  it("dati di spedizione modificabili dal ritiro in poi (costo anche dopo la chiusura)", () => {
    expect(EDITABLE_IN.logistics).toEqual(["PRONTA_RITIRO", "SPEDITA", "COMPLETATA"]);
  });

  it("i prodotti sono un sottoinsieme dei dati modificabili", () => {
    for (const s of EDITABLE_IN.items) expect(EDITABLE_IN.info).toContain(s);
  });
});
