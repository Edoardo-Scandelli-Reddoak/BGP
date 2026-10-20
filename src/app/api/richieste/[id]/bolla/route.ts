import type { NextRequest } from "next/server";
import { getAuthorizedUser } from "@/lib/auth/session";
import { requestCode } from "@/lib/format";
import { generateBollaPdf } from "@/lib/pdf/bolla";
import { getRequestDetail } from "@/lib/requests/queries";
import { can, canViewRequestInStatus } from "@/lib/roles";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

/** GET /api/richieste/[id]/bolla → bolla di consegna in PDF (generata al volo). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/richieste/[id]/bolla">) {
  const user = await getAuthorizedUser();
  if (!user) return Response.json({ error: "Non autenticato" }, { status: 401 });
  if (!can(user.role, "logistics.work") && !can(user.role, "requests.manage") && !can(user.role, "management.view")) {
    return Response.json({ error: "Non hai i permessi per scaricare la bolla." }, { status: 403 });
  }

  const { id: rawId } = await ctx.params;
  const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : null;
  const detail = id ? await getRequestDetail(id) : null;
  if (!detail) return Response.json({ error: "Richiesta non trovata." }, { status: 404 });
  if (!canViewRequestInStatus(user.role, detail.status)) {
    return Response.json({ error: "Non hai accesso a questa richiesta." }, { status: 403 });
  }

  let pdf: Uint8Array;
  try {
    pdf = await generateBollaPdf(detail, await getSettings());
  } catch (err) {
    console.error(`Errore nella generazione della bolla ${requestCode(detail.id)}`, err);
    return Response.json({ error: "Impossibile generare la bolla." }, { status: 500 });
  }

  const fileName = `Bolla-${requestCode(detail.id)}.pdf`;
  const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
