import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Controllo "ottimistico": senza cookie di sessione si va al login.
 * La verifica vera (sessione valida, ruolo, permessi) avviene nelle pagine e nelle server action.
 */
const PUBLIC_PREFIXES = ["/login", "/richiedi-campioni", "/api/public", "/email/", "/_next", "/favicon"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

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
