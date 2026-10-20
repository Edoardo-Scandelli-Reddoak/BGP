import { NextResponse, type NextRequest } from "next/server";
import { getAuthorizedUser } from "@/lib/auth/session";
import { searchContacts } from "@/lib/search";

export async function GET(request: NextRequest) {
  const user = await getAuthorizedUser("registry.view");
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const tipo = request.nextUrl.searchParams.get("tipo");
  const type = tipo === "AGENTE" || tipo === "CLIENTE" ? tipo : undefined;
  return NextResponse.json(await searchContacts(q, { type }));
}
