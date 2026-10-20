"use client";

import { Badge } from "@/components/ui/badge";
import { PRODUCT_LABEL_NAMES, type ProductLabelField } from "@/lib/products/labels";

/**
 * «Da completare: marchio e categoria» nella scheda prodotto. Con `formId` (chi può modificare) è un
 * link che porta al primo campo mancante del form e lo seleziona.
 */
export function ProductMissingLabels({ missing, formId }: { missing: ProductLabelField[]; formId?: string }) {
  if (missing.length === 0) return null;
  const text = `Da completare: ${missing.map((f) => PRODUCT_LABEL_NAMES[f].singular.toLowerCase()).join(" e ")}`;
  if (!formId) return <Badge tone="amber">{text}</Badge>;
  return (
    <a
      href={`#${formId}`}
      title="Vai al campo da compilare"
      className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      onClick={(e) => {
        const input = document.querySelector<HTMLInputElement>(`#${formId} [name="${missing[0]}"]`);
        if (!input) return;
        e.preventDefault();
        input.focus({ preventScroll: true });
        input.scrollIntoView({ block: "center", behavior: "smooth" });
      }}
    >
      <Badge tone="amber" className="hover:bg-amber-100">
        {text} →
      </Badge>
    </a>
  );
}
