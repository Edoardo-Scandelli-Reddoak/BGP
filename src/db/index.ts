import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL non configurata");
  return postgres(url, { max: 10, prepare: false });
}

// In sviluppo l'HMR ricarica i moduli: riusiamo la stessa connessione.
const client = globalForDb.pgClient ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema, casing: undefined });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
