import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/constants";

/**
 * Controllo "ottimistico": senza cookie di sessione si va al login.
 * La verifica vera (sessione valida, ruolo, permessi) avviene nelle pagine e nelle server action.
 */
const PUBLIC_PREFIXES = ["/login", "/richiedi-campioni", "/api/public", "/email/", "/_next", "/favicon"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session) {
    const response = NextResponse.next();
    // Rinnovo scorrevole del cookie (la scadenza in DB la rinnova getCurrentUser). Solo nelle
    // navigazioni GET: login e logout (server action POST) impostano o cancellano il cookie da sé.
    if (request.method === "GET") response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
