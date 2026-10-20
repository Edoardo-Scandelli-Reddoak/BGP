import type { NextRequest } from "next/server";
import { listProductFacets, parseProductFilters, productWhere } from "@/app/(app)/anagrafiche/_lib/queries";
import { BRAND_SUGGESTIONS, CATEGORY_SUGGESTIONS, mergeSuggestions } from "@/components/anagrafiche/constants";
import { getProductExportRows } from "@/lib/exports/registry-data";
import { buildProductsWorkbook, xlsxResponse } from "@/lib/exports/registry-xlsx";
import { todayIso } from "@/lib/format";
import { authorizeRoute } from "@/lib/reports/route-auth";

/**
 * GET /api/export/prodotti?<filtri dell'elenco prodotti> → Excel dei prodotti nel formato dell'import
 * (Codice_articolo, Descrizione_articolo_estesa, Marchio, Categoria, Prezzo_m2), nell'ordine dell'elenco.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeRoute("registry.view");
  if (auth.response) return auth.response;

  const filters = parseProductFilters(Object.fromEntries(request.nextUrl.searchParams));
  const [rows, facets] = await Promise.all([getProductExportRows(productWhere(filters), filters.sort), listProductFacets()]);
  const data = await buildProductsWorkbook(rows, {
    brands: mergeSuggestions(BRAND_SUGGESTIONS, facets.brands),
    categories: mergeSuggestions(CATEGORY_SUGGESTIONS, facets.categories),
  });
  return xlsxResponse(`prodotti-${todayIso()}.xlsx`, data);
}
