import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL non configurata");
  // In sviluppo l'HMR ricarica i moduli: riusiamo la stessa connessione.
  const client = globalForDb.pgClient ?? postgres(url, { max: 10, prepare: false });
  if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;
  return drizzle(client, { schema, casing: undefined });
}

export type DB = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

let instance: DB | undefined;

/** Connessione al database, creata alla prima query (non all'import del modulo). */
export function getDb(): DB {
  instance ??= createDb();
  return instance;
}

/**
 * `db` si usa come un normale client Drizzle, ma la connessione nasce al primo utilizzo:
 * importare il modulo non richiede DATABASE_URL (serve a `next build`, che carica tutte le pagine,
 * e all'immagine Docker, che riceve le variabili solo all'avvio).
 */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    // i metodi della classe (select, transaction…) restano legati al client vero; le proprietà
    // proprie come $client (funzione con metodi, es. end) si restituiscono così come sono
    return typeof value === "function" && !Object.prototype.hasOwnProperty.call(real, prop) ? value.bind(real) : value;
  },
  has(_target, prop) {
    return Reflect.has(getDb(), prop);
  },
});

export { schema };
