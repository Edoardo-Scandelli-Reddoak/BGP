import type { NextRequest } from "next/server";
import { currentMonthIso } from "@/lib/format";
import { crmExportResponse } from "@/lib/reports/crm-file";
import { isIsoMonth } from "@/lib/reports/period";
import { authorizeRoute } from "@/lib/reports/route-auth";

/**
 * GET /api/report/mq?mese=AAAA-MM → export dei m² del mese per il CRM (mese corrente se manca).
 * Indirizzo storico, mantenuto per i link già salvati: genera lo stesso file di /api/report/crm.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeRoute("reports.m2");
  if (auth.response) return auth.response;

  const mese = request.nextUrl.searchParams.get("mese")?.trim();
  if (mese && !isIsoMonth(mese)) {
    return Response.json({ error: "Mese non valido: usa il formato AAAA-MM." }, { status: 400 });
  }
  return crmExportResponse(mese || currentMonthIso());
}
