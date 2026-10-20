import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enum                                                                */
/* ------------------------------------------------------------------ */

/** Ruoli applicativi. Vedi src/lib/roles.ts per etichette e permessi. */
export const roleEnum = pgEnum("role", [
  "ADMIN",
  "BACKOFFICE",
  "MAGAZZINO",
  "LOGISTICA",
  "DIREZIONE",
  "CRM",
]);

/** I 5 stati del flusso (blueprint BGP, sezione 2). Vedi src/lib/status.ts. */
export const requestStatusEnum = pgEnum("request_status", [
  "NUOVA",
  "IN_PREPARAZIONE",
  "PRONTA_RITIRO",
  "SPEDITA",
  "COMPLETATA",
]);

export const contactTypeEnum = pgEnum("contact_type", ["AGENTE", "CLIENTE"]);

/** Lingua del contatto: obbligatoria (nota BGP sul blueprint), decide la lingua delle email. */
export const languageEnum = pgEnum("language", ["it", "en", "fr", "de"]);

export const requestSourceEnum = pgEnum("request_source", ["INTERNO", "MODULO_PUBBLICO"]);

export const emailKindEnum = pgEnum("email_kind", [
  "AVVISO_MAGAZZINO",
  "CONFERMA_SPEDIZIONE",
  "AVVISO_BOLLA",
  "TEST",
]);

export const emailStatusEnum = pgEnum("email_status", ["INVIATA", "ERRORE", "SIMULATA"]);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ------------------------------------------------------------------ */
/* Utenti e sessioni                                                   */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 del token salvato nel cookie: il token in chiaro non tocca mai il DB. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* Anagrafiche (blueprint: tabelle Contacts e Products)                */
/* ------------------------------------------------------------------ */

export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    type: contactTypeEnum("type").notNull().default("CLIENTE"),
    /** Ragione sociale o nome e cognome: campo principale usato ovunque. */
    name: text("name").notNull(),
    /** Studio / azienda, se diversa dal nome (opzionale). */
    company: text("company"),
    /** Uno o più indirizzi email separati da ";" (come nel file Airtable di BGP). */
    email: text("email"),
    phone: text("phone"),
    country: text("country"),
    /** Indirizzo predefinito: precompila la destinazione delle nuove richieste. */
    defaultAddress: text("default_address"),
    language: languageEnum("language").notNull().default("it"),
    /** Agente di riferimento (solo per i clienti). Clienti "direzionali" non hanno agente. */
    agentId: integer("agent_id").references((): AnyPgColumn => contacts.id, { onDelete: "set null" }),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    /** Contatti creati dal modulo pubblico: il back office deve verificarli. */
    needsReview: boolean("needs_review").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("contacts_name_idx").on(t.name),
    index("contacts_agent_idx").on(t.agentId),
    index("contacts_type_idx").on(t.type),
  ],
);

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    /** Codice articolo (SKU) come nel gestionale BGP. */
    code: text("code").notNull(),
    description: text("description").notNull().default(""),
    /** Campi opzionali del blueprint: oggi BGP fornisce solo codice e descrizione. */
    brand: text("brand"),
    category: text("category"),
    format: text("format"),
    finish: text("finish"),
    unitWeightKg: numeric("unit_weight_kg", { precision: 10, scale: 3, mode: "number" }),
    /** Disattivare per nascondere i prodotti fuori catalogo dai moduli di richiesta. */
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("products_code_unique").on(sql`upper(${t.code})`)],
);

export const carriers = pgTable("carriers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** URL di tracking con segnaposto {tracking}, es. https://www.gls-italy.com/...?numero={tracking} */
  trackingUrlTemplate: text("tracking_url_template"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

/* ------------------------------------------------------------------ */
/* Richieste campioni (blueprint: tabella Sample Requests)             */
/* ------------------------------------------------------------------ */

export const sampleRequests = pgTable(
  "sample_requests",
  {
    /** Request ID: numero progressivo, mostrato come CAMP-00001 (src/lib/format.ts). */
    id: serial("id").primaryKey(),
    status: requestStatusEnum("status").notNull().default("NUOVA"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    source: requestSourceEnum("source").notNull().default("INTERNO"),

    /** Agente o cliente che riceve i campioni (destinatario delle email). */
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    destinationAddress: text("destination_address").notNull().default(""),
    notes: text("notes"),
    /** "Bolla di consegna richiesta": la logistica deve preparare il documento prima del ritiro. */
    deliveryFormRequired: boolean("delivery_form_required").notNull().default(false),

    /** Chi ha compilato il modulo pubblico (può essere l'agente per conto del cliente). */
    requesterName: text("requester_name"),
    requesterEmail: text("requester_email"),
    requesterIp: text("requester_ip"),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),

    /* --- Magazzino --- */
    packagesCount: integer("packages_count"),
    weightKg: numeric("weight_kg", { precision: 10, scale: 2, mode: "number" }),
    warehouseNotes: text("warehouse_notes"),

    /* --- Logistica --- */
    carrierId: integer("carrier_id").references(() => carriers.id, { onDelete: "set null" }),
    pickupDate: date("pickup_date", { mode: "string" }),
    trackingNumber: text("tracking_number"),
    shipmentDate: date("shipment_date", { mode: "string" }),
    /** La logistica conferma di aver preparato la bolla di consegna (se richiesta). */
    deliveryFormReady: boolean("delivery_form_ready").notNull().default(false),
    /** Numero del DDT / bolla (es. quello del gestionale BGP "13807"). */
    ddtNumber: text("ddt_number"),
    /** Costo della spedizione in euro: alimenta i "costi per cliente" del cruscotto direzione. */
    shippingCost: numeric("shipping_cost", { precision: 10, scale: 2, mode: "number" }),
    logisticsNotes: text("logistics_notes"),

    /** "Notification sent": valorizzato dal sistema quando parte la conferma di spedizione. */
    notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("requests_status_idx").on(t.status),
    index("requests_contact_idx").on(t.contactId),
    index("requests_received_idx").on(t.receivedAt),
    index("requests_shipment_date_idx").on(t.shipmentDate),
  ],
);

/** Prodotti richiesti, con quantità per prodotto. */
export const requestItems = pgTable(
  "request_items",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => sampleRequests.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(1),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("items_request_idx").on(t.requestId), index("items_product_idx").on(t.productId)],
);

/**
 * Misure dei pezzi (blueprint: tabella Piece Dimensions).
 * Una riga per pezzo misurato; `quantity` consente di registrare N pezzi identici in una riga.
 * m² = lunghezza(cm) × larghezza(cm) × quantità / 10.000, calcolato dal database.
 */
export const pieces = pgTable(
  "pieces",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => sampleRequests.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    lengthCm: numeric("length_cm", { precision: 10, scale: 1, mode: "number" }).notNull(),
    widthCm: numeric("width_cm", { precision: 10, scale: 1, mode: "number" }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    areaM2: numeric("area_m2", { precision: 12, scale: 4, mode: "number" })
      .notNull()
      .generatedAlwaysAs(sql`round(length_cm * width_cm * quantity / 10000.0, 4)`),
    conditionNote: text("condition_note"),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("pieces_request_idx").on(t.requestId), index("pieces_product_idx").on(t.productId)],
);

/** Storico dei cambi di stato (chi, quando, da/a). */
export const statusEvents = pgTable(
  "status_events",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => sampleRequests.id, { onDelete: "cascade" }),
    fromStatus: requestStatusEnum("from_status"),
    toStatus: requestStatusEnum("to_status").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("status_events_request_idx").on(t.requestId)],
);

/** Allegati della richiesta: oggi solo il DDT caricato dalla logistica. */
export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => sampleRequests.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("DDT"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    uploadedById: integer("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_request_idx").on(t.requestId)],
);

/* ------------------------------------------------------------------ */
/* Email                                                               */
/* ------------------------------------------------------------------ */

/** Template modificabili dalle impostazioni. Segnaposto nel formato {nome_campo}. */
export const emailTemplates = pgTable(
  "email_templates",
  {
    id: serial("id").primaryKey(),
    kind: emailKindEnum("kind").notNull(),
    language: languageEnum("language").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    updatedById: integer("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("email_templates_kind_lang_unique").on(t.kind, t.language)],
);

export const emailLog = pgTable(
  "email_log",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").references(() => sampleRequests.id, { onDelete: "set null" }),
    kind: emailKindEnum("kind").notNull(),
    language: languageEnum("language").notNull().default("it"),
    toAddresses: text("to_addresses").notNull(),
    ccAddresses: text("cc_addresses"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    attachmentNames: text("attachment_names"),
    status: emailStatusEnum("status").notNull(),
    error: text("error"),
    messageId: text("message_id"),
    triggeredById: integer("triggered_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_log_request_idx").on(t.requestId), index("email_log_created_idx").on(t.createdAt)],
);

/** Impostazioni chiave/valore (destinatari interni, mittente, firma, dati azienda per la bolla...). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/* ------------------------------------------------------------------ */
/* Relazioni (per db.query.*)                                          */
/* ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  agent: one(contacts, {
    fields: [contacts.agentId],
    references: [contacts.id],
    relationName: "agent_clients",
  }),
  clients: many(contacts, { relationName: "agent_clients" }),
  requests: many(sampleRequests),
}));

export const productsRelations = relations(products, ({ many }) => ({
  requestItems: many(requestItems),
  pieces: many(pieces),
}));

export const carriersRelations = relations(carriers, ({ many }) => ({
  requests: many(sampleRequests),
}));

export const sampleRequestsRelations = relations(sampleRequests, ({ one, many }) => ({
  contact: one(contacts, { fields: [sampleRequests.contactId], references: [contacts.id] }),
  carrier: one(carriers, { fields: [sampleRequests.carrierId], references: [carriers.id] }),
  createdBy: one(users, { fields: [sampleRequests.createdById], references: [users.id] }),
  items: many(requestItems),
  pieces: many(pieces),
  events: many(statusEvents),
  attachments: many(attachments),
  emails: many(emailLog),
}));

export const requestItemsRelations = relations(requestItems, ({ one }) => ({
  request: one(sampleRequests, { fields: [requestItems.requestId], references: [sampleRequests.id] }),
  product: one(products, { fields: [requestItems.productId], references: [products.id] }),
}));

export const piecesRelations = relations(pieces, ({ one }) => ({
  request: one(sampleRequests, { fields: [pieces.requestId], references: [sampleRequests.id] }),
  product: one(products, { fields: [pieces.productId], references: [products.id] }),
  createdBy: one(users, { fields: [pieces.createdById], references: [users.id] }),
}));

export const statusEventsRelations = relations(statusEvents, ({ one }) => ({
  request: one(sampleRequests, { fields: [statusEvents.requestId], references: [sampleRequests.id] }),
  user: one(users, { fields: [statusEvents.userId], references: [users.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  request: one(sampleRequests, { fields: [attachments.requestId], references: [sampleRequests.id] }),
  uploadedBy: one(users, { fields: [attachments.uploadedById], references: [users.id] }),
}));

export const emailLogRelations = relations(emailLog, ({ one }) => ({
  request: one(sampleRequests, { fields: [emailLog.requestId], references: [sampleRequests.id] }),
  triggeredBy: one(users, { fields: [emailLog.triggeredById], references: [users.id] }),
}));

/* ------------------------------------------------------------------ */
/* Tipi                                                                */
/* ------------------------------------------------------------------ */

export type Role = (typeof roleEnum.enumValues)[number];
export type RequestStatus = (typeof requestStatusEnum.enumValues)[number];
export type ContactType = (typeof contactTypeEnum.enumValues)[number];
export type Language = (typeof languageEnum.enumValues)[number];
export type EmailKind = (typeof emailKindEnum.enumValues)[number];

export type User = typeof users.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Carrier = typeof carriers.$inferSelect;
export type SampleRequest = typeof sampleRequests.$inferSelect;
export type RequestItem = typeof requestItems.$inferSelect;
export type Piece = typeof pieces.$inferSelect;
export type StatusEvent = typeof statusEvents.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type EmailLogEntry = typeof emailLog.$inferSelect;
