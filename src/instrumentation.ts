/**
 * Avvio del server: scheduler interno delle attività programmate (export CRM mensile).
 * Ogni ora chiama /api/cron/export-crm su questo stesso server; il route handler decide se è il
 * momento e, con un lucchetto nel database, garantisce un solo invio per mese anche con più istanze.
 * Disattivabile con SCHEDULER_ENABLED=false (es. se si usa un cron esterno).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.SCHEDULER_ENABLED === "false") return;
  const g = globalThis as unknown as { bgpSchedulerStarted?: boolean };
  if (g.bgpSchedulerStarted) return;
  g.bgpSchedulerStarted = true;

  const { cronSecret } = await import("./lib/cron-secret");
  const port = process.env.PORT || "3000";
  const tick = async () => {
    const secret = cronSecret();
    if (!secret) return;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cron/export-crm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) console.warn(`[scheduler] export CRM: HTTP ${res.status}`);
    } catch (err) {
      console.warn("[scheduler] export CRM non eseguito:", err instanceof Error ? err.message : err);
    }
  };
  setTimeout(tick, 2 * 60_000).unref?.();
  setInterval(tick, 60 * 60_000).unref?.();
}
