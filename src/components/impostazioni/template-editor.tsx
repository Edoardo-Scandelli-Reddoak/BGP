"use client";

import { useRef, useState, useTransition } from "react";
import {
  previewTemplateAction,
  resetTemplateAction,
  saveTemplateAction,
} from "@/app/(app)/impostazioni/actions";
import { ActionMessage, Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action-result";
import { PLACEHOLDERS, unknownPlaceholders, type TemplateContent } from "@/lib/email/templates";

export type PreviewRequestOption = { id: number; label: string };

type Target = "subject" | "body";

export function TemplateEditor({
  kind,
  language,
  initial,
  defaults,
  isCustom,
  requests,
  defaultRequestId,
  isShipmentConfirmation,
}: {
  kind: string;
  language: string;
  initial: TemplateContent;
  defaults: TemplateContent;
  isCustom: boolean;
  requests: PreviewRequestOption[];
  defaultRequestId: number | null;
  isShipmentConfirmation: boolean;
}) {
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [saving, startSaving] = useTransition();

  const [requestId, setRequestId] = useState<string>(defaultRequestId ? String(defaultRequestId) : "");
  const [preview, setPreview] = useState<ActionResult<TemplateContent> | null>(null);
  const [previewing, startPreview] = useTransition();

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastTarget = useRef<Target>("body");

  const dirty = subject !== initial.subject || body !== initial.body;
  const unknown = unknownPlaceholders(`${subject}\n${body}`);
  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;

  function insertPlaceholder(key: string) {
    const target = lastTarget.current;
    const el = target === "subject" ? subjectRef.current : bodyRef.current;
    const current = target === "subject" ? subject : body;
    const token = `{${key}}`;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    if (target === "subject") setSubject(next);
    else setBody(next);
    const caret = start + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function save() {
    startSaving(async () => {
      setResult(await saveTemplateAction({ kind, language, subject, body }));
    });
  }

  function restoreDefault() {
    if (!window.confirm("Ripristinare il testo predefinito? Le modifiche salvate a questo template andranno perse.")) return;
    startSaving(async () => {
      const res = await resetTemplateAction({ kind, language });
      setResult(res);
      if (res.ok) {
        setSubject(defaults.subject);
        setBody(defaults.body);
      }
    });
  }

  function showPreview() {
    startPreview(async () => {
      setPreview(await previewTemplateAction({ kind, language, subject, body, requestId: Number(requestId) }));
    });
  }

  return (
    <div className="space-y-5">
      <Alert tone="info" title="Come funzionano i segnaposto">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            I testi tra graffe, come <code className="font-mono">{"{cliente}"}</code>, vengono sostituiti con i dati della
            richiesta.
          </li>
          <li>
            Una riga con un segnaposto vuoto viene omessa: «Note: {"{note}"}» sparisce se la richiesta non ha note.
          </li>
          <li>Nell&apos;oggetto i segnaposto vuoti diventano semplicemente testo vuoto.</li>
        </ul>
      </Alert>

      <Field label="Oggetto" htmlFor="tpl-subject" required error={fieldErrors?.subject}>
        <Input
          ref={subjectRef}
          id="tpl-subject"
          value={subject}
          maxLength={300}
          onChange={(e) => setSubject(e.target.value)}
          onFocus={() => {
            lastTarget.current = "subject";
          }}
          aria-invalid={!!fieldErrors?.subject || undefined}
        />
      </Field>

      <Field label="Testo" htmlFor="tpl-body" required error={fieldErrors?.body}>
        <Textarea
          ref={bodyRef}
          id="tpl-body"
          value={body}
          rows={16}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => {
            lastTarget.current = "body";
          }}
          className="font-mono text-[13px] leading-relaxed"
          aria-invalid={!!fieldErrors?.body || undefined}
        />
      </Field>

      <div>
        <p className="text-sm font-medium text-slate-700">Segnaposto disponibili</p>
        <p className="text-xs text-slate-500">Clic per inserirlo nel punto del cursore (nell&apos;oggetto o nel testo).</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                title={p.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertPlaceholder(p.key)}
                className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-brand-50 hover:text-brand-800 hover:ring-brand-200"
              >
                {`{${p.key}}`}
                <span className="sr-only"> — {p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {unknown.length ? (
        <Alert tone="warning" title="Segnaposto non riconosciuti">
          {unknown.map((u) => `{${u}}`).join(", ")} — resteranno scritti così nell&apos;email. Controlla l&apos;ortografia o
          usa uno dei segnaposto disponibili.
        </Alert>
      ) : null}

      <ActionMessage state={result} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty ? <span className="mr-auto text-xs font-medium text-amber-700">Modifiche non salvate</span> : null}
        {dirty ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSubject(initial.subject);
              setBody(initial.body);
              setResult(null);
            }}
            disabled={saving}
          >
            Annulla modifiche
          </Button>
        ) : null}
        <Button variant="secondary" onClick={restoreDefault} disabled={saving || !isCustom}>
          Ripristina predefinito
        </Button>
        <Button onClick={save} disabled={saving || !dirty} aria-busy={saving}>
          {saving ? "Salvataggio…" : "Salva template"}
        </Button>
      </div>

      <section className="space-y-3 border-t border-slate-100 pt-5" aria-labelledby="tpl-preview-title">
        <h3 id="tpl-preview-title" className="text-sm font-semibold text-slate-900">
          Anteprima con una richiesta reale
        </h3>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-500">Non ci sono ancora richieste da usare per l&apos;anteprima.</p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Richiesta" htmlFor="tpl-request" className="sm:flex-1">
              <Select id="tpl-request" value={requestId} onChange={(e) => setRequestId(e.target.value)}>
                {requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="secondary" onClick={showPreview} disabled={previewing || !requestId} aria-busy={previewing}>
              {previewing ? "Preparazione…" : "Mostra anteprima"}
            </Button>
          </div>
        )}
        <p className="text-xs text-slate-500">
          L&apos;anteprima usa il testo scritto qui sopra, anche se non è ancora salvato. Nessuna email viene inviata.
        </p>
        {preview && !preview.ok ? <ActionMessage state={preview} /> : null}
        {preview?.ok && preview.data ? (
          <div className="overflow-hidden rounded-lg ring-1 ring-slate-200" aria-live="polite">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
              <span className="text-slate-500">Oggetto: </span>
              <span className="font-medium text-slate-900">{preview.data.subject}</span>
            </div>
            <div className="max-h-[32rem] overflow-auto bg-white px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-800">
              {preview.data.body}
            </div>
            {isShipmentConfirmation ? (
              <p className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
                Nell&apos;email vera vengono aggiunti il banner BGP (se attivo) e in allegato il DDT o la bolla generata.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
