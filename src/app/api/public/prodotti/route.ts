import { NextResponse, type NextRequest } from "next/server";
import { searchProducts } from "@/lib/search";

/** Ricerca prodotti per il modulo pubblico (senza login): solo prodotti attivi (codice, descrizione, marchio e categoria: dati del catalogo). */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  if (q.trim().length < 2) return NextResponse.json([]);
  const rows = await searchProducts(q, { onlyActive: true, limit: 15 });
  return NextResponse.json(rows, { headers: { "Cache-Control": "public, max-age=60" } });
}
