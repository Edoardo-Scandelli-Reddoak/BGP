CREATE TYPE "public"."contact_type" AS ENUM('AGENTE', 'CLIENTE');--> statement-breakpoint
CREATE TYPE "public"."email_kind" AS ENUM('AVVISO_MAGAZZINO', 'CONFERMA_SPEDIZIONE', 'AVVISO_BOLLA', 'TEST');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('INVIATA', 'ERRORE', 'SIMULATA');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('it', 'en', 'fr', 'de');--> statement-breakpoint
CREATE TYPE "public"."request_source" AS ENUM('INTERNO', 'MODULO_PUBBLICO');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('NUOVA', 'IN_PREPARAZIONE', 'PRONTA_RITIRO', 'SPEDITA', 'COMPLETATA');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'BACKOFFICE', 'MAGAZZINO', 'LOGISTICA', 'DIREZIONE', 'CRM');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"kind" text DEFAULT 'DDT' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tracking_url_template" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "contact_type" DEFAULT 'CLIENTE' NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"country" text,
	"default_address" text,
	"language" "language" DEFAULT 'it' NOT NULL,
	"agent_id" integer,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer,
	"kind" "email_kind" NOT NULL,
	"language" "language" DEFAULT 'it' NOT NULL,
	"to_addresses" text NOT NULL,
	"cc_addresses" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"attachment_names" text,
	"status" "email_status" NOT NULL,
	"error" text,
	"message_id" text,
	"triggered_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "email_kind" NOT NULL,
	"language" "language" NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pieces" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"length_cm" numeric(10, 1) NOT NULL,
	"width_cm" numeric(10, 1) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"area_m2" numeric(12, 4) GENERATED ALWAYS AS (round(length_cm * width_cm * quantity / 10000.0, 4)) STORED NOT NULL,
	"condition_note" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"brand" text,
	"category" text,
	"format" text,
	"finish" text,
	"unit_weight_kg" numeric(10, 3),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sample_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" "request_status" DEFAULT 'NUOVA' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "request_source" DEFAULT 'INTERNO' NOT NULL,
	"contact_id" integer NOT NULL,
	"destination_address" text DEFAULT '' NOT NULL,
	"notes" text,
	"delivery_form_required" boolean DEFAULT false NOT NULL,
	"requester_name" text,
	"requester_email" text,
	"requester_ip" text,
	"created_by_id" integer,
	"packages_count" integer,
	"weight_kg" numeric(10, 2),
	"warehouse_notes" text,
	"carrier_id" integer,
	"pickup_date" date,
	"tracking_number" text,
	"shipment_date" date,
	"ddt_number" text,
	"shipping_cost" numeric(10, 2),
	"logistics_notes" text,
	"notification_sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"from_status" "request_status",
	"to_status" "request_status" NOT NULL,
	"user_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_request_id_sample_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sample_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_agent_id_contacts_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_request_id_sample_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sample_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_request_id_sample_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sample_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_request_id_sample_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sample_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_request_id_sample_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sample_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_request_idx" ON "attachments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "contacts_name_idx" ON "contacts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "contacts_agent_idx" ON "contacts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "contacts_type_idx" ON "contacts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "email_log_request_idx" ON "email_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "email_log_created_idx" ON "email_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_kind_lang_unique" ON "email_templates" USING btree ("kind","language");--> statement-breakpoint
CREATE INDEX "pieces_request_idx" ON "pieces" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "pieces_product_idx" ON "pieces" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_code_unique" ON "products" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "items_request_idx" ON "request_items" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "items_product_idx" ON "request_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "sample_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requests_contact_idx" ON "sample_requests" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "requests_received_idx" ON "sample_requests" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "requests_shipment_date_idx" ON "sample_requests" USING btree ("shipment_date");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "status_events_request_idx" ON "status_events" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));