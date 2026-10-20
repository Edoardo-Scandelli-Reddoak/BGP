import "server-only";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { requestCode } from "@/lib/format";
import type { RequestDetail } from "@/lib/requests/queries";
import type { AppSettings } from "@/lib/settings";

/**
 * Bolla di consegna in PDF per una richiesta.
 * SEGNAPOSTO: versione minima, da sostituire con il layout completo (modulo logistica).
 */
export async function generateBollaPdf(detail: RequestDetail, settings: AppSettings): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(`${settings.companyName} — Bolla di consegna ${requestCode(detail.id)}`, {
    x: 40,
    y: 800,
    size: 14,
    font,
  });
  return pdf.save();
}
