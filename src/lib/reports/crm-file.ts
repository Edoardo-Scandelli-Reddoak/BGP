import "server-only";
import { buildCrmExportFile } from "@/lib/crm-export/run";
import { getSetting } from "@/lib/settings";

/** Download dell'export m² per il CRM del mese, secondo la configurazione (Impostazioni → Export CRM). */
export async function crmExportResponse(month: string): Promise<Response> {
  const config = await getSetting("crmExport");
  const file = await buildCrmExportFile(month, config);
  // nome ASCII per i client datati, nome esatto in filename* (RFC 6266)
  const asciiName = file.fileName.replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
