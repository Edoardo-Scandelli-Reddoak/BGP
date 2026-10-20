import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPasswordConstantTime } from "./password";

/**
 * Controllo delle credenziali con limite di tentativi.
 *
 * - Per account (in Postgres, vale anche dopo un riavvio e con più istanze): 10 tentativi falliti
 *   in 15 minuti bloccano l'account per 15 minuti. Il contatore si azzera all'accesso riuscito.
 * - Email non registrate: stesso comportamento visibile, con un contatore in memoria, così il
 *   blocco non rivela se l'account esiste. Anche il confronto bcrypt viene sempre eseguito.
 * - Per IP (solo se l'IP è affidabile, vedi getClientIp): limite più alto, in memoria.
 */

export const LOGIN_MAX_FAILURES = 10;
const WINDOW_MINUTES = 15;
const LOCK_MINUTES = 15;
const IP_MAX_FAILURES = 50;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
const LOCK_MS = LOCK_MINUTES * 60 * 1000;
/** Voci massime per ciascun contatore in memoria (oltre si eliminano le scadute, poi le più vecchie). */
const MAX_TRACKED = 10_000;

export const LOGIN_LOCKED_MESSAGE = `Troppi tentativi, riprova tra ${LOCK_MINUTES} minuti.`;

type Counter = { count: number; first: number; lockedUntil: number };

/** Contatore di tentativi in memoria con dimensione limitata. */
class MemoryCounter {
  private map = new Map<string, Counter>();

  constructor(private readonly maxFailures: number) {}

  isLocked(key: string, now = Date.now()): boolean {
    const c = this.map.get(key);
    return !!c && c.lockedUntil > now;
  }

  /** Registra un tentativo e restituisce quanti ce ne sono nella finestra corrente. */
  hit(key: string, now = Date.now()): number {
    let c = this.map.get(key);
    if (!c || now - c.first > WINDOW_MS) {
      this.map.delete(key);
      if (this.map.size >= MAX_TRACKED) this.prune(now);
      c = { count: 0, first: now, lockedUntil: 0 };
      this.map.set(key, c);
    }
    c.count++;
    if (c.count >= this.maxFailures && c.lockedUntil <= now) c.lockedUntil = now + LOCK_MS;
    return c.count;
  }

  private prune(now: number) {
    for (const [key, c] of this.map) {
      if (c.lockedUntil <= now && now - c.first > WINDOW_MS) this.map.delete(key);
    }
    // Ancora pieno: elimina il 10% più vecchio (la Map mantiene l'ordine di inserimento).
    if (this.map.size >= MAX_TRACKED) {
      let drop = Math.ceil(MAX_TRACKED / 10);
      for (const key of this.map.keys()) {
        if (drop-- <= 0) break;
        this.map.delete(key);
      }
    }
  }
}

// In sviluppo l'HMR ricarica i moduli: i contatori restano sullo stesso oggetto globale.
const globalCounters = globalThis as unknown as { bgpLoginCounters?: { email: MemoryCounter; ip: MemoryCounter } };
const counters = (globalCounters.bgpLoginCounters ??= {
  email: new MemoryCounter(LOGIN_MAX_FAILURES),
  ip: new MemoryCounter(IP_MAX_FAILURES),
});

type LoginUser = typeof users.$inferSelect;

export type LoginCheck = { status: "ok"; user: LoginUser } | { status: "invalid" } | { status: "locked" };

const windowExpired = sql`(${users.failedLoginAt} is null or ${users.failedLoginAt} < now() - ${sql.raw(`interval '${WINDOW_MINUTES} minutes'`)})`;
const nextCount = sql`case when ${windowExpired} then 1 else ${users.failedLoginCount} + 1 end`;

/**
 * Conta il tentativo prima del confronto della password (atomico: anche con richieste in parallelo
 * passano al massimo LOGIN_MAX_FAILURES confronti per finestra). Al decimo si imposta il blocco,
 * che un accesso riuscito annulla.
 */
async function hitAccount(userId: number): Promise<number> {
  const [row] = await db
    .update(users)
    .set({
      failedLoginCount: nextCount,
      failedLoginAt: sql`case when ${windowExpired} then now() else ${users.failedLoginAt} end`,
      lockedUntil: sql`case when ${nextCount} >= ${LOGIN_MAX_FAILURES} and (${users.lockedUntil} is null or ${users.lockedUntil} <= now()) then now() + ${sql.raw(`interval '${LOCK_MINUTES} minutes'`)} else ${users.lockedUntil} end`,
      // Non è una modifica dell'utente: updated_at resta invariato.
      updatedAt: sql`${users.updatedAt}`,
    })
    .where(eq(users.id, userId))
    .returning({ count: users.failedLoginCount });
  return row?.count ?? 0;
}

/** Accesso riuscito: azzera contatore e blocco (il tentativo appena contato incluso). */
async function resetAccount(userId: number) {
  await db
    .update(users)
    .set({ failedLoginCount: 0, failedLoginAt: null, lockedUntil: null, updatedAt: sql`${users.updatedAt}` })
    .where(eq(users.id, userId));
}

/**
 * Verifica email (già normalizzata in minuscolo) e password. `ip` è l'IP affidabile del client,
 * o null quando non è noto (in quel caso vale solo il limite per account).
 */
export async function checkLogin(email: string, password: string, ip: string | null): Promise<LoginCheck> {
  const now = Date.now();
  if (ip && counters.ip.isLocked(ip, now)) return { status: "locked" };

  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  let attempt: number;
  if (user) {
    if (user.lockedUntil && user.lockedUntil.getTime() > now) return { status: "locked" };
    attempt = await hitAccount(user.id);
  } else {
    const key = email.slice(0, 254);
    if (counters.email.isLocked(key, now)) return { status: "locked" };
    attempt = counters.email.hit(key, now);
  }
  if (attempt > LOGIN_MAX_FAILURES) return { status: "locked" };

  const passwordOk = await verifyPasswordConstantTime(password, user?.passwordHash);
  if (user && user.active && passwordOk) {
    await resetAccount(user.id);
    return { status: "ok", user };
  }
  if (ip) counters.ip.hit(ip);
  return { status: "invalid" };
}
