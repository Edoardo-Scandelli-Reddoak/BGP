"use client";

import Image from "next/image";
import { saveEmailSettingsAction, sendTestEmailAction } from "@/app/(app)/impostazioni/actions";
import { ActionMessage } from "@/components/ui/alert";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { PendingButton, useFormAction } from "./form-kit";

export type EmailSettingsValues = {
  mailFrom: string;
  mailReplyTo: string;
  mailSignature: string;
  mailSignatureImage: boolean;
  warehouseEmails: string[];
  logisticsEmails: string[];
  shipmentBcc: string[];
};

const LIST_HINT = "Un indirizzo per riga (oppure separati da «;»).";

export function EmailSettingsForm({ values }: { values: EmailSettingsValues }) {
  const { state, pending, onSubmit, fieldError } = useFormAction(saveEmailSettingsAction);
  // I campi si rigenerano dopo il salvataggio, così mostrano gli indirizzi normalizzati.
  const version = JSON.stringify(values);

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div key={version} className="space-y-6">
        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-slate-900">Destinatari interni</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Magazzino — avviso «nuovo campionario da preparare»"
              htmlFor="warehouseEmails"
              error={fieldError("warehouseEmails")}
              hint={`Automazione 1: parte quando il back office invia la richiesta al magazzino. ${LIST_HINT}`}
            >
              <Textarea
                id="warehouseEmails"
                name="warehouseEmails"
                rows={3}
                defaultValue={values.warehouseEmails.join("\n")}
                placeholder="magazzino@bgpgroup.it"
                aria-invalid={!!fieldError("warehouseEmails") || undefined}
              />
            </Field>
            <Field
              label="Logistica — avviso «bolla di consegna richiesta»"
              htmlFor="logisticsEmails"
              error={fieldError("logisticsEmails")}
              hint={`Automazione 3: parte quando una richiesta con bolla diventa pronta per il ritiro. ${LIST_HINT}`}
            >
              <Textarea
                id="logisticsEmails"
                name="logisticsEmails"
                rows={3}
                defaultValue={values.logisticsEmails.join("\n")}
                placeholder="logistica@bgpgroup.it"
                aria-invalid={!!fieldError("logisticsEmails") || undefined}
              />
            </Field>
          </div>
          <Field
            label="Copia nascosta delle conferme di spedizione (facoltativo)"
            htmlFor="shipmentBcc"
            error={fieldError("shipmentBcc")}
            hint={`Ricevono in Ccn ogni conferma inviata ai clienti, ad esempio per archivio. ${LIST_HINT}`}
          >
            <Textarea
              id="shipmentBcc"
              name="shipmentBcc"
              rows={2}
              defaultValue={values.shipmentBcc.join("\n")}
              aria-invalid={!!fieldError("shipmentBcc") || undefined}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-4 border-t border-slate-100 pt-6">
          <legend className="sr-only">Mittente e firma</legend>
          <p className="text-sm font-semibold text-slate-900">Mittente e firma</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Mittente"
              htmlFor="mailFrom"
              required
              error={fieldError("mailFrom")}
              hint="Formato: BGP Group <info@bgpgroup.it>. Deve essere un indirizzo autorizzato dal server SMTP."
            >
              <Input
                id="mailFrom"
                name="mailFrom"
                required
                maxLength={200}
                defaultValue={values.mailFrom}
                aria-invalid={!!fieldError("mailFrom") || undefined}
              />
            </Field>
            <Field
              label="Rispondi a (facoltativo)"
              htmlFor="mailReplyTo"
              error={fieldError("mailReplyTo")}
              hint="Se il cliente risponde, la risposta arriva a questo indirizzo invece che al mittente."
            >
              <Input
                id="mailReplyTo"
                name="mailReplyTo"
                type="email"
                maxLength={200}
                defaultValue={values.mailReplyTo}
                aria-invalid={!!fieldError("mailReplyTo") || undefined}
              />
            </Field>
          </div>
          <Field
            label="Firma"
            htmlFor="mailSignature"
            error={fieldError("mailSignature")}
            hint="Inserita al posto del segnaposto {firma} nelle conferme di spedizione."
          >
            <Textarea
              id="mailSignature"
              name="mailSignature"
              rows={5}
              maxLength={2000}
              defaultValue={values.mailSignature}
              aria-invalid={!!fieldError("mailSignature") || undefined}
            />
          </Field>
          <div className="flex flex-col gap-4 rounded-lg bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <Checkbox
              name="mailSignatureImage"
              defaultChecked={values.mailSignatureImage}
              label="Aggiungi il banner BGP sotto la firma"
              hint="Immagine con i loghi dei marchi, inserita nelle conferme di spedizione in formato HTML."
            />
            <Image
              src="/email/firma-bgp.png"
              alt="Anteprima del banner BGP"
              width={378}
              height={151}
              className="h-auto w-full max-w-60 rounded bg-white ring-1 ring-slate-200"
            />
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ActionMessage state={state} className="sm:flex-1" />
        <PendingButton pending={pending} pendingText="Salvataggio…" className="sm:ml-auto">
          Salva impostazioni email
        </PendingButton>
      </div>
    </form>
  );
}

export function TestEmailForm({ defaultTo }: { defaultTo: string }) {
  const { state, pending, onSubmit, fieldError } = useFormAction(sendTestEmailAction);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field label="Destinatario" htmlFor="test-to" error={fieldError("to")} className="sm:flex-1">
          <Input
            id="test-to"
            name="to"
            type="email"
            required
            defaultValue={defaultTo}
            aria-invalid={!!fieldError("to") || undefined}
          />
        </Field>
        <PendingButton pending={pending} pendingText="Invio…" variant="secondary" className="sm:mt-7">
          Invia email di prova
        </PendingButton>
      </div>
      <ActionMessage state={state} />
    </form>
  );
}
