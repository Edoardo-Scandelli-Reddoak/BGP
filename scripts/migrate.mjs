// Applica le migrazioni del database all'avvio del container (senza drizzle-kit).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL non configurata");
  process.exit(1);
}
const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Migrazioni applicate.");
} finally {
  await client.end();
}
