import { NextResponse, type NextRequest } from "next/server";
import { isValidCronAuthorization } from "@/lib/cron-secret";
import { runDueCrmExport } from "@/lib/crm-export/run";

/**
 * Export CRM mensile programmato. Chiamato ogni ora dallo scheduler interno (src/instrumentation.ts)
 * o da un cron esterno con "Authorization: Bearer <CRON_SECRET>". Non fa nulla se non è il momento
 * o se il mese è già stato inviato.
 */
export async function POST(request: NextRequest) {
  if (!isValidCronAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const result = await runDueCrmExport();
  return NextResponse.json({ ok: true, eseguito: result !== null, result });
}
