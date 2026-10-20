import type { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, sampleRequests } from "@/db/schema";
import { getAuthorizedUser } from "@/lib/auth/session";
import { can, canViewRequestInStatus } from "@/lib/roles";

export const runtime = "nodejs";

/** Content-Disposition con nome file sicuro (ASCII) e variante UTF-8 (RFC 6266 / 5987). */
function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_") || "ddt";
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** GET /api/richieste/[id]/ddt → DDT caricato dalla logistica (PDF o immagine). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/richieste/[id]/ddt">) {
  const user = await getAuthorizedUser();
  if (!user) return Response.json({ error: "Non autenticato" }, { status: 401 });
  if (!can(user.role, "logistics.work") && !can(user.role, "requests.manage") && !can(user.role, "management.view")) {
    return Response.json({ error: "Non hai i permessi per scaricare il DDT." }, { status: 403 });
  }

  const { id: rawId } = await ctx.params;
  if (!/^\d{1,9}$/.test(rawId)) return Response.json({ error: "Richiesta non trovata." }, { status: 404 });
  const id = Number(rawId);

  const [row] = await db
    .select({
      status: sampleRequests.status,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      data: attachments.data,
    })
    .from(sampleRequests)
    .leftJoin(attachments, and(eq(attachments.requestId, sampleRequests.id), eq(attachments.kind, "DDT")))
    .where(eq(sampleRequests.id, id))
    .orderBy(desc(attachments.createdAt))
    .limit(1);

  if (!row) return Response.json({ error: "Richiesta non trovata." }, { status: 404 });
  if (!canViewRequestInStatus(user.role, row.status)) {
    return Response.json({ error: "Non hai accesso a questa richiesta." }, { status: 403 });
  }
  if (!row.data || !row.fileName || !row.mimeType) {
    return Response.json({ error: "Nessun DDT caricato per questa richiesta." }, { status: 404 });
  }

  const body = new Uint8Array(row.data);
  const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(body, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": contentDisposition(disposition, row.fileName),
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
