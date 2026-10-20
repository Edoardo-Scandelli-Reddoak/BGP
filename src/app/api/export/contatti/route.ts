import type { NextRequest } from "next/server";
import { contactWhere, parseContactFilters } from "@/app/(app)/anagrafiche/_lib/queries";
import { getContactExportRows } from "@/lib/exports/registry-data";
import { buildContactsWorkbook, xlsxResponse } from "@/lib/exports/registry-xlsx";
import { todayIso } from "@/lib/format";
import { authorizeRoute } from "@/lib/reports/route-auth";

/**
 * GET /api/export/contatti?<filtri dell'elenco contatti> → Excel dei clienti nel formato dell'import
 * (colonne del file Airtable di BGP). Sempre e solo clienti: il filtro «tipo» non si applica.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeRoute("registry.view");
  if (auth.response) return auth.response;

  const filters = { ...parseContactFilters(Object.fromEntries(request.nextUrl.searchParams)), type: "CLIENTE" as const };
  const rows = await getContactExportRows(contactWhere(filters));
  return xlsxResponse(`contatti-${todayIso()}.xlsx`, await buildContactsWorkbook(rows));
}
