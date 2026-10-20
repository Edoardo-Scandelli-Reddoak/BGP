import type { Metadata } from "next";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, bollaCounters, sampleRequests } from "@/db/schema";
import { BollaSettingsForm, type OpenRequestBolla } from "@/components/impostazioni/bolla-settings-form";
import { Alert } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth/session";
import { bollaSatisfiedForMode, DEFAULT_BOLLA_CONFIG, formatBollaNumber } from "@/lib/config/bolla";
import { todayIso } from "@/lib/format";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Bolla di consegna — Impostazioni" };

/** Richieste non ancora spedite con la bolla richiesta: per ogni modalità, la bolla risulterebbe pronta? */
async function openRequestsBolla(): Promise<OpenRequestBolla[]> {
  const rows = await db
    .select({
      deliveryFormRequired: sampleRequests.deliveryFormRequired,
      deliveryFormReady: sampleRequests.deliveryFormReady,
      ddtNumber: sampleRequests.ddtNumber,
      bollaNumber: sampleRequests.bollaNumber,
      hasDdtAttachment: sql<boolean>`exists (select 1 from ${attachments} where ${attachments.requestId} = ${sampleRequests.id} and ${attachments.kind} = 'DDT')`,
    })
    .from(sampleRequests)
    .where(
      and(
        inArray(sampleRequests.status, ["NUOVA", "IN_PREPARAZIONE", "PRONTA_RITIRO"]),
        eq(sampleRequests.deliveryFormRequired, true),
      ),
    );
  return rows.map((r) => ({
    GENERATA: bollaSatisfiedForMode(r, "GENERATA"),
    GESTIONALE: bollaSatisfiedForMode(r, "GESTIONALE"),
    ENTRAMBE: bollaSatisfiedForMode(r, "ENTRAMBE"),
  }));
}

export default async function BollaSettingsPage() {
  await requireUser("settings.manage");
  // stesso anno usato da generateBolla (fuso di Roma)
  const year = Number(todayIso().slice(0, 4));
  const [config, [counter], openRequests] = await Promise.all([
    getSetting("bollaConfig"),
    db.select({ last: bollaCounters.lastNumber }).from(bollaCounters).where(eq(bollaCounters.year, year)),
    openRequestsBolla(),
  ]);

  const isDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_BOLLA_CONFIG);

  return (
    <>
      <Alert tone="info" title="Bolla di consegna: tre scelte per BGP">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Chi la prepara</strong>: il sistema (PDF sul modello del DDT di BGP) o il gestionale (DDT caricato
            dalla logistica), oppure entrambi a scelta.
          </li>
          <li>
            <strong>Come si numera</strong> la bolla generata dal sistema.
          </li>
          <li>
            <strong>Quando è obbligatoria</strong>: oltre alla spunta del back office, regole automatiche per estero,
            formati o numero di colli.
          </li>
        </ul>
        <p className="mt-2">
          {isDefault ? "Impostazione attuale: " : "Impostazione iniziale: "}
          entrambe le modalità, numero {formatBollaNumber(1, year, DEFAULT_BOLLA_CONFIG)}, nessuna regola automatica.
        </p>
      </Alert>
      <BollaSettingsForm
        initial={config}
        year={year}
        generatedThisYear={counter?.last ?? 0}
        openRequests={openRequests}
      />
    </>
  );
}
