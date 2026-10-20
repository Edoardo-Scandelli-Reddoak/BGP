import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cronSecret, isValidCronAuthorization } from "@/lib/cron-secret";

// Il route handler non deve toccare il database in questi test: l'export è simulato.
const run = vi.hoisted(() => ({ runDueCrmExport: vi.fn(async () => null as unknown) }));
vi.mock("@/lib/crm-export/run", () => run);

const SECRET = "segreto-di-prova-1234567890";

describe("segreto delle attività programmate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("CRON_SECRET configurato: è quello (senza spazi ai bordi)", () => {
    vi.stubEnv("CRON_SECRET", `  ${SECRET} `);
    expect(cronSecret()).toBe(SECRET);
  });

  it("senza CRON_SECRET: derivato da DATABASE_URL, stabile e diverso dall'URL", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5442/db");
    const derived = cronSecret();
    expect(derived).toBe(createHash("sha256").update("bgp-cron:postgres://u:p@localhost:5442/db").digest("hex"));
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(cronSecret()).toBe(derived);
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5442/altro");
    expect(cronSecret()).not.toBe(derived);
  });

  it("né CRON_SECRET né DATABASE_URL: nessun segreto e nessuna chiamata autorizzata", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("DATABASE_URL", "");
    expect(cronSecret()).toBeNull();
    expect(isValidCronAuthorization("Bearer ")).toBe(false);
    expect(isValidCronAuthorization("Bearer null")).toBe(false);
  });

  it("isValidCronAuthorization: solo «Bearer <segreto>» esatto", () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(isValidCronAuthorization(`Bearer ${SECRET}`)).toBe(true);
    for (const header of [
      null,
      "",
      SECRET,
      `bearer ${SECRET}`,
      `Bearer  ${SECRET}`,
      `Bearer ${SECRET} `,
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
      "Bearer sbagliato",
      `Basic ${SECRET}`,
    ]) {
      expect(isValidCronAuthorization(header), String(header)).toBe(false);
    }
  });
});

describe("POST /api/cron/export-crm", () => {
  let POST: typeof import("@/app/api/cron/export-crm/route").POST;

  beforeEach(async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    run.runDueCrmExport.mockClear();
    ({ POST } = await import("@/app/api/cron/export-crm/route"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const call = (authorization?: string) =>
    POST(
      new NextRequest("http://localhost:3000/api/cron/export-crm", {
        method: "POST",
        headers: authorization === undefined ? {} : { authorization },
      }),
    );

  it("senza intestazione Authorization: 401 e l'export non parte", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Non autorizzato" });
    expect(run.runDueCrmExport).not.toHaveBeenCalled();
  });

  it("con un Bearer sbagliato: 401 e l'export non parte", async () => {
    // (gli spazi ai bordi del valore li toglie già l'API Headers: il controllo esatto è nel test sopra)
    for (const auth of ["Bearer sbagliato", `Bearer ${SECRET}x`, `bearer ${SECRET}`, SECRET]) {
      const res = await call(auth);
      expect(res.status, auth).toBe(401);
    }
    expect(run.runDueCrmExport).not.toHaveBeenCalled();
  });

  it("con il segreto giusto: esegue il controllo dell'export (nulla da fare → eseguito: false)", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, eseguito: false, result: null });
    expect(run.runDueCrmExport).toHaveBeenCalledTimes(1);
  });

  it("con il segreto giusto ed export inviato: eseguito: true con l'esito", async () => {
    const result = { month: "2026-09", rows: 3, email: { status: "SIMULATA" }, webhook: { status: "DISATTIVATO" } };
    run.runDueCrmExport.mockResolvedValueOnce(result);
    const res = await call(`Bearer ${SECRET}`);
    expect(await res.json()).toEqual({ ok: true, eseguito: true, result });
  });
});
