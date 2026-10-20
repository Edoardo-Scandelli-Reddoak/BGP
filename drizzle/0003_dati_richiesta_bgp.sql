ALTER TABLE "request_items" ADD COLUMN "sample_format" text;--> statement-breakpoint
ALTER TABLE "request_items" ADD COLUMN "format_note" text;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD COLUMN "recipient_name" text;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD COLUMN "attention_of" text;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD COLUMN "phone_notice" boolean;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD COLUMN "phone_notice_number" text;--> statement-breakpoint
-- Richieste esistenti: il vecchio modulo metteva il destinatario sulla prima riga dell'indirizzo.
UPDATE "sample_requests"
SET "recipient_name" = btrim(split_part("destination_address", E'\n', 1), E' \r\t'),
    "destination_address" = btrim(substr("destination_address", strpos("destination_address", E'\n') + 1), E' \r\n\t')
WHERE "recipient_name" IS NULL AND strpos("destination_address", E'\n') > 0;--> statement-breakpoint
UPDATE "sample_requests" r
SET "recipient_name" = c."name"
FROM "contacts" c
WHERE r."recipient_name" IS NULL AND c."id" = r."contact_id";--> statement-breakpoint
-- Formato deducibile dal codice prodotto (mazzette e pannelli campione); gli altri restano da indicare.
UPDATE "request_items" i
SET "sample_format" = CASE WHEN upper(p."code") LIKE 'MAZZ%' THEN 'MAZZETTA' ELSE 'PANNELLO' END
FROM "products" p
WHERE i."sample_format" IS NULL AND p."id" = i."product_id"
  AND (upper(p."code") LIKE 'MAZZ%' OR upper(p."code") LIKE 'PAN%');
