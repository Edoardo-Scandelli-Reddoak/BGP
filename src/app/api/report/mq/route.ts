import type { NextRequest } from "next/server";
import { currentMonthIso } from "@/lib/format";
import { csvResponse } from "@/lib/reports/csv";
import { m2ReportCsv, m2ReportFileName } from "@/lib/reports/exports";
import { getMonthlyM2Report } from "@/lib/reports/m2";
import { isIsoMonth } from "@/lib/reports/period";
import { authorizeRoute } from "@/lib/reports/route-auth";

/** GET /api/report/mq?mese=YYYY-MM → CSV dei m² del mese per prodotto (per il CRM). */
export async function GET(request: NextRequest) {
  const auth = await authorizeRoute("reports.m2");
  if (auth.response) return auth.response;

  const mese = request.nextUrl.searchParams.get("mese")?.trim();
  if (mese && !isIsoMonth(mese)) {
    return Response.json({ error: "Mese non valido: usa il formato AAAA-MM." }, { status: 400 });
  }
  const month = mese || currentMonthIso();
  const report = await getMonthlyM2Report(month);
  return csvResponse(m2ReportFileName(month), m2ReportCsv(report.rows));
}
