import { Children, cloneElement, Fragment, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";

const CONTROL =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-base sm:text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:ring-red-500";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block text-sm font-medium text-slate-700", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(CONTROL, "h-10", className)} {...props} />;
}

export function Textarea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(CONTROL, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(CONTROL, "h-10 pr-8", className)} {...props} />;
}

export function Checkbox({ className, label, hint, ...props }: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-3 text-sm", className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
        {...props}
      />
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        {hint ? <span className="block text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Id del testo di suggerimento/errore di un Field (per controlli personalizzati che lo collegano da sé). */
export function fieldDescriptionId(htmlFor: string): string {
  return `${htmlFor}-desc`;
}

type DescribableProps = { id?: unknown; "aria-describedby"?: unknown };

/**
 * Collega il suggerimento/errore al controllo con id = htmlFor (aria-describedby), così il lettore
 * di schermo lo legge quando il campo riceve il focus. Gli altri figli restano invariati.
 * La struttura dei figli non cambia quando l'errore compare o sparisce (niente rimontaggio dei controlli).
 */
function describeControl(children: ReactNode, htmlFor: string, descId: string | undefined): ReactNode {
  const describe = (child: ReactNode): ReactNode => {
    if (!descId || !isValidElement<DescribableProps>(child) || child.type === Fragment || child.props.id !== htmlFor) {
      return child;
    }
    const existing = typeof child.props["aria-describedby"] === "string" ? child.props["aria-describedby"] : "";
    if (existing.split(/\s+/).includes(descId)) return child;
    return cloneElement(child as ReactElement<DescribableProps>, {
      "aria-describedby": existing ? `${existing} ${descId}` : descId,
    });
  };
  return isValidElement(children) ? describe(children) : Children.map(children, describe);
}

/** Campo di form con etichetta, suggerimento ed errore. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const descId = htmlFor && (error || hint) ? fieldDescriptionId(htmlFor) : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </Label>
      {htmlFor ? describeControl(children, htmlFor, descId) : children}
      {error ? (
        <p id={descId} className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
