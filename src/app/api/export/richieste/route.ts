import type { NextRequest } from "next/server";
import { todayIso } from "@/lib/format";
import { csvResponse } from "@/lib/reports/csv";
import { historyCsv } from "@/lib/reports/exports";
import { getHistoryForExport } from "@/lib/reports/history";
import { parseHistoryFilters } from "@/lib/reports/history-filters";
import { authorizeRoute } from "@/lib/reports/route-auth";

/** GET /api/export/richieste?<filtri dello storico> → CSV di tutte le richieste filtrate. */
export async function GET(request: NextRequest) {
  const auth = await authorizeRoute("management.view");
  if (auth.response) return auth.response;

  const filters = parseHistoryFilters(request.nextUrl.searchParams);
  const rows = await getHistoryForExport(filters);
  return csvResponse(`richieste-campioni-${todayIso()}.csv`, historyCsv(rows));
}
