import type { NextRequest } from "next/server";
import { crmExportResponse } from "@/lib/reports/crm-file";
import { isIsoMonth } from "@/lib/reports/period";
import { authorizeRoute } from "@/lib/reports/route-auth";

/** GET /api/report/crm?mese=AAAA-MM → export dei m² del mese per il CRM (CSV o Excel, come configurato). */
export async function GET(request: NextRequest) {
  const auth = await authorizeRoute("reports.m2");
  if (auth.response) return auth.response;

  const mese = request.nextUrl.searchParams.get("mese")?.trim();
  if (!mese) return Response.json({ error: "Indica il mese: ?mese=AAAA-MM." }, { status: 400 });
  if (!isIsoMonth(mese)) return Response.json({ error: "Mese non valido: usa il formato AAAA-MM." }, { status: 400 });
  return crmExportResponse(mese);
}
