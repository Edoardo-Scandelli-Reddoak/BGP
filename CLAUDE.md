@AGENTS.md

# Campionature BGP — gestionale richieste e spedizioni campioni

Web app interna per BGP Group (Bergamo Parquet): il back office inserisce la richiesta di campioni,
il magazzino prepara e misura i pezzi, la logistica spedisce, il sistema avvisa cliente e agente e
calcola i m² del mese per il CRM. Specifica di riferimento: blueprint BGP "app oc ai" (v1.0, maggio 2026)
e i due PDF di analisi nella cartella superiore.

## Stack
- Next.js 16 (App Router, `cacheComponents: false`, `src/proxy.ts` al posto di middleware), React 19, TypeScript
- PostgreSQL + Drizzle ORM (`src/db/schema.ts`, migrazioni in `drizzle/`)
- Tailwind CSS v4 (colori `brand-*` e `accent-*` in `src/app/globals.css`)
- Email SMTP con nodemailer (in sviluppo Mailpit, UI http://localhost:8035), PDF con pdf-lib, import xlsx con exceljs

## Comandi
- `docker compose up -d` — Postgres (porta 5442) e Mailpit (SMTP 1035, UI 8035)
- `npm run db:migrate` · `npm run db:seed` · `npm run import -- --contatti <xlsx> --prodotti <xlsx>`
- `npm run db:seed-demo` — solo sviluppo: utenti demo per ruolo + richieste in tutti gli stati
- `npm run dev` · `npm run typecheck` · `npm run lint` · `npm test`
- `npm run dev:session -- <email>` — solo sviluppo: token di sessione per provare le pagine con curl

## Convenzioni
- Interfaccia, messaggi ed email in italiano; identificatori del codice in inglese.
- Ogni modifica a una richiesta passa da `src/lib/requests/service.ts` (permessi, stato ammesso, storico,
  email automatiche). Le regole pure del flusso sono in `src/lib/requests/workflow.ts`.
- Permessi: matrice in `src/lib/roles.ts`; pagine con `requireUser(permesso)`, server action e route con
  `getAuthorizedUser(permesso)`.
- Server action: file `actions.ts` del modulo, restituiscono `ActionResult` (`src/lib/action-result.ts`) e
  dopo una modifica chiamano `revalidatePath("/", "layout")`.
- Dati per la presa in carico (BGP): destinatario e indirizzo obbligatori già per salvare; formato del
  campione per ogni riga e preavviso telefonico Sì/No (con numero se Sì) obbligatori per «Invia al magazzino»
  (`transitionProblems` in `workflow.ts`); «alla c.a.» mai bloccante (solo suggerimento; obbligatorio nel modulo
  pubblico per le ditte). Formati, etichette per lingua e proposte dal codice in `src/lib/sample-formats.ts`.
- Configurazioni di BGP (Impostazioni → Costi, Bolla di consegna, Export CRM): tipi, valori predefiniti e logica pura
  in `src/lib/config/`, lette con `getSettings()`/`getSetting()`; costi in SQL in `src/lib/requests/costs.ts`,
  export e invio mensile in `src/lib/crm-export/run.ts` (scheduler in `src/instrumentation.ts`).
- Paesi: ogni paese salvato (contatti, richieste, modulo pubblico, import) passa da `normalizeCountry` in
  `src/lib/countries.ts` (nome italiano; sigle ISO e nomi in altre lingue riconosciuti); `isAbroad` usa `isItaly`.
- Marchio e categoria dei prodotti: testo libero ma allineato ai valori esistenti (`src/lib/products/labels.ts`,
  puro; `labels-db.ts` per assegnazione in blocco, rinomina/unione, rimozione). Filtro «senza» = `MISSING_LABEL_FILTER` («-»).
- Export Excel delle anagrafiche nel formato dell'import (`src/lib/exports/`): ogni colonna esportata deve tornare
  invariata con l'import (test di andata e ritorno in `tests/unit/registry-xlsx.test.ts`).
- Componenti UI condivisi in `src/components/ui/`; formattazione (date, m², euro, codice richiesta) in `src/lib/format.ts`.
- Dopo aver aggiunto route: `npx next typegen` per i tipi `PageProps<"/percorso">`.
