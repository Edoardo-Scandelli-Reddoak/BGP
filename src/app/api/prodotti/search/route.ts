import { NextResponse, type NextRequest } from "next/server";
import { getAuthorizedUser } from "@/lib/auth/session";
import { searchProducts } from "@/lib/search";

export async function GET(request: NextRequest) {
  const user = await getAuthorizedUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const includeInactive = request.nextUrl.searchParams.get("tutti") === "1";
  return NextResponse.json(await searchProducts(q, { onlyActive: !includeInactive }));
}
