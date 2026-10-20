import type { Metadata } from "next";
import Link from "next/link";
import { summarizeCrmRun } from "@/components/impostazioni/config-utils";
import {
  CrmExportSettingsForm,
  type CrmPreviewData,
  type CrmRunRow,
} from "@/components/impostazioni/crm-export-settings-form";
import { Alert } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth/session";
import { CRM_COLUMNS, CRM_GROUPS, DEFAULT_CRM_EXPORT_CONFIG, type CrmExportConfig } from "@/lib/config/crm-export";
import { getCrmExportRows, previousMonthIso, recentCrmExportRuns } from "@/lib/crm-export/run";
import { formatMonth, todayIso } from "@/lib/format";
import { addMonths, firstParam, isIsoMonth } from "@/lib/reports/period";
import { getProductLabelCoverage } from "@/lib/reports/product-labels";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Export CRM — Impostazioni" };

const PREVIEW_LIMIT = 8;

/** Righe dell'anteprima per ogni raggruppamento: il form le mostra subito anche cambiando raggruppamento. */
async function previewData(month: string, config: CrmExportConfig): Promise<CrmPreviewData> {
  const all = await Promise.all(CRM_GROUPS.map((groupBy) => getCrmExportRows(month, { ...config, groupBy })));
  return Object.fromEntries(
    CRM_GROUPS.map((g, i) => [g, { rows: all[i].slice(0, PREVIEW_LIMIT), total: all[i].length }]),
  ) as CrmPreviewData;
}

/** Quando parte il prossimo invio automatico, a parole (stessa logica di runDueCrmExport). */
function nextRunText(config: CrmExportConfig, today: string, sentPeriods: Set<string>): string {
  const email = config.autoSend.enabled && config.autoSend.recipients.length > 0;
  if (!email && !config.webhook.enabled) {
    return "Invio automatico non attivo: il file si scarica a mano oppure si invia con «Invia ora».";
  }
  const channels = [email ? "email" : null, config.webhook.enabled ? "webhook" : null].filter(Boolean).join(" e ");
  const day = config.autoSend.day;
  const current = today.slice(0, 7);
  const previous = previousMonthIso(today);
  if (!sentPeriods.has(previous)) {
    return Number(today.slice(8, 10)) >= day
      ? `Invio automatico attivo (${channels}): l'export di ${formatMonth(previous)} parte al prossimo controllo, entro un'ora.`
      : `Invio automatico attivo (${channels}): prossimo invio il ${day} ${formatMonth(current)}, con l'export di ${formatMonth(previous)}.`;
  }
  return `Invio automatico attivo (${channels}): prossimo invio il ${day} ${formatMonth(addMonths(current, 1))}, con l'export di ${formatMonth(current)}.`;
}

export default async function CrmExportSettingsPage({ searchParams }: PageProps<"/impostazioni/export-crm">) {
  await requireUser("settings.manage");
  const sp = await searchParams;
  const today = todayIso();
  const currentMonth = today.slice(0, 7);
  const previousMonth = previousMonthIso(today);
  const requested = firstParam(sp.mese);
  const previewMonth = isIsoMonth(requested) && requested <= currentMonth ? requested : previousMonth;

  const config = await getSetting("crmExport");
  const [preview, runs, labelCoverage] = await Promise.all([
    previewData(previewMonth, config),
    recentCrmExportRuns(12),
    getProductLabelCoverage(),
  ]);
  const sentPeriods = new Set(runs.map((r) => r.period));
  const runRows: CrmRunRow[] = runs.slice(0, 6).map((r) => ({
    id: r.id,
    period: r.period,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    summary: summarizeCrmRun(r.detail),
  }));
  const isDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_CRM_EXPORT_CONFIG);

  return (
    <>
      <Alert tone="info" title="m² dei campioni per il CRM">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Ogni mese l&apos;ufficio CRM riporta nel CRM i m² dei campioni spediti. Qui BGP sceglie com&apos;è fatto il file
            e se deve arrivare da solo: per email ai destinatari indicati e/o direttamente al CRM (webhook).
          </li>
          <li>
            Il file del mese si scarica anche dal{" "}
            <Link href="/report/mq" className="font-medium underline">
              report m² mensile
            </Link>
            .
          </li>
          <li>
            Marchio e categoria sono quelli dell&apos;anagrafica prodotti: si possono mettere come colonne del file per
            prodotto oppure usare come raggruppamento («Per marchio», «Per categoria»).
          </li>
          <li>
            {isDefault ? "Impostazione attuale: " : "Impostazione iniziale: "}
            CSV con «;» e virgola decimale, una riga per prodotto (
            {DEFAULT_CRM_EXPORT_CONFIG.columns.map((c) => CRM_COLUMNS[c]).join(", ")}), nessun invio automatico.
          </li>
        </ul>
      </Alert>
      <CrmExportSettingsForm
        initial={config}
        previewMonth={previewMonth}
        preview={preview}
        downloadHref={`/api/report/crm?mese=${previewMonth}`}
        previousMonth={previousMonth}
        currentMonth={currentMonth}
        todayDay={Number(today.slice(8, 10))}
        previousMonthSent={sentPeriods.has(previousMonth)}
        schedulerEnabled={process.env.SCHEDULER_ENABLED !== "false"}
        nextRun={nextRunText(config, today, sentPeriods)}
        runs={runRows}
        labeledProducts={{ brand: labelCoverage.brand, category: labelCoverage.category }}
      />
    </>
  );
}
