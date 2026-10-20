/**
 * SOLO SVILUPPO: crea una sessione per un utente e stampa il valore del cookie, per provare
 * le pagine con curl senza passare dal form di login.
 *   npm run dev:session -- backoffice@demo.local
 *   curl -s -b "bgp_session=<token>" http://localhost:3000/richieste
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Solo sviluppo");
  const email = process.argv[2];
  if (!email) throw new Error("Uso: npm run dev:session -- <email>");
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`Utente ${email} non trovato`);
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    id: createHash("sha256").update(token).digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 86400000),
  });
  console.log(token);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
