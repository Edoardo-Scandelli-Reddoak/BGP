import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Variabili del file .env (DATABASE_URL, APP_URL...) senza sovrascrivere quelle già impostate. */
function dotEnv(): Record<string, string> {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return {};
  return Object.fromEntries(Object.entries(parse(readFileSync(file))).filter(([key]) => process.env[key] === undefined));
}

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${path.join(root, "src")}/` },
      // I moduli server importano "server-only": nei test è un modulo vuoto.
      { find: /^server-only$/, replacement: path.join(root, "tests/empty-module.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      ...dotEnv(),
      // Nessuna email reale durante i test: il registro email riporta lo stato SIMULATA.
      EMAIL_DRY_RUN: "true",
    },
    // I test di integrazione condividono il database di sviluppo: un file alla volta.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
