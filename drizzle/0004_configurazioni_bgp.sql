ALTER TYPE "public"."email_kind" ADD VALUE 'EXPORT_CRM';--> statement-breakpoint
CREATE TABLE "bolla_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"period" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_per_m2" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "sample_requests" ADD COLUMN "destination_country" text;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD COLUMN "delivery_form_auto_reason" text;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD COLUMN "bolla_number" text;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD COLUMN "bolla_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD COLUMN "extra_costs" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_runs_job_period_unique" ON "scheduled_runs" USING btree ("job","period");--> statement-breakpoint
-- Paese di consegna delle richieste esistenti: quello del contatto.
UPDATE "sample_requests" r SET "destination_country" = c."country"
FROM "contacts" c WHERE r."destination_country" IS NULL AND c."id" = r."contact_id";
