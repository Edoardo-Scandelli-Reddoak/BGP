# Campionature BGP

Gestionale web per le richieste e le spedizioni dei campioni di BGP Group (Bergamo Parquet).
Sostituisce il processo su carta descritto nel blueprint di BGP ("app oc ai", v1.0 maggio 2026):
il back office inserisce la richiesta, il magazzino prepara e misura i pezzi, la logistica spedisce,
il sistema avvisa cliente e agente e calcola i m² del mese da riportare nel CRM.

## Flusso

| Stato | Responsabile | Cosa fa per avanzare | Automazione |
|---|---|---|---|
| Nuova richiesta | Back office | Contatto, prodotti e quantità, destinazione, note, «bolla di consegna richiesta» → *Invia al magazzino* | Email al magazzino |
| In preparazione | Magazzino | Colli, peso, misure di ogni pezzo (lunghezza × larghezza, quantità, note sullo stato) → *Pronta per il ritiro* | Se serve la bolla: email alla logistica |
| Pronta per il ritiro | Logistica | Corriere, data di ritiro, bolla (generata in PDF o DDT caricato) → *Segna come spedita* | — |
| Spedita | Logistica | Numero di tracking e data di spedizione | Email al cliente con l'agente in copia, nella lingua del cliente, DDT allegato → *Completata* |
| Completata | Sistema | — | — |

Il back office (e l'amministratore) può riportare una richiesta allo stato precedente indicando il motivo.
Una richiesta «Spedita» senza email del contatto (o con ritiro in sede) si può completare senza conferma.

## Ruoli e viste

| Ruolo | Vista principale | Può |
|---|---|---|
| Back office | Richieste aperte | Creare e modificare richieste, anagrafiche, import |
| Magazzino (×2, da telefono) | Coda magazzino | Colli, peso, pezzi, «pronta per il ritiro» |
| Logistica | Pronte per il ritiro · Bolle da preparare · Spedite senza tracking | Spedizione, bolla, DDT, tracking, costi |
| Direzione | Cruscotto · Storico completo | Sola lettura: stato, volumi, costi per cliente, conteggi per contatto/prodotto/paese |
| Ufficio CRM | Report m² mensile | m² per prodotto del mese, export CSV per il CRM |
| Amministratore | tutto | Utenti, destinatari email, template, corrieri, dati della bolla, registro email |

Agenti e clienti inviano le richieste dal **modulo pubblico** `/richiedi-campioni`, senza login.
I contatti nuovi creati dal modulo vengono segnalati al back office come «da verificare».

## Sviluppo locale

Requisiti: Node.js ≥ 20.9, Docker.

```bash
cp .env.example .env
docker compose up -d          # Postgres (5442) + Mailpit (SMTP 1035, interfaccia http://localhost:8035)
npm install
npm run db:migrate
npm run db:seed               # amministratore da SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD + corrieri
npm run import -- --contatti ../Lista_clienti_Airtable.xlsx --prodotti "../Product list.xlsx"
npm run db:seed-demo          # facoltativo: utenti demo per ruolo e richieste di esempio
npm run dev                   # http://localhost:3000
```

Utenti demo (solo sviluppo, password `DEMO_PASSWORD`, predefinita `demo-campioni-2026`):
`backoffice@demo.local`, `magazzino1@demo.local`, `magazzino2@demo.local`, `logistica@demo.local`,
`direzione@demo.local`, `crm@demo.local`.

In sviluppo tutte le email finiscono in Mailpit. Con `EMAIL_DRY_RUN=true` non vengono inviate ma solo
registrate nel registro email.

Altri comandi: `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:studio`.

## Import dei dati di BGP

`npm run import` (o la pagina *Anagrafiche → Importa da file*) accetta `.xlsx` o `.csv`:

- **Contatti** — formato dell'export Airtable: `Name`, `Email`, `Default address`, `Agent name`,
  `Agent email (cc)`, `Language`. Gli agenti diventano contatti di tipo «Agente» collegati ai clienti;
  i clienti senza agente sono i «direzionali». Più email separate da `;`. Il paese è impostato a Italia
  quando l'indirizzo termina con la sigla di provincia, altrimenti resta da completare.
- **Prodotti** — `Codice_articolo`, `Descrizione_articolo_estesa`.

L'import è ripetibile: aggiorna i record esistenti (clienti riconosciuti per nome + indirizzo,
prodotti per codice) e non cancella nulla.

## Produzione

```bash
docker build -t campionature-bgp .
docker run -p 3000:3000 --env-file .env.production campionature-bgp
```

Il container applica le migrazioni all'avvio. Variabili: `DATABASE_URL`, `APP_URL` (usato nei link
delle email), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`.
Primo avvio: eseguire `npm run db:seed` e l'import puntando `DATABASE_URL` al database di produzione,
poi dalle *Impostazioni* configurare i destinatari di magazzino e logistica.

## Punti da confermare con BGP

1. **Costi per cliente** nel cruscotto: oggi è il costo di spedizione inserito dalla logistica.
2. **Bolla di consegna**: l'app genera un PDF sul modello del DDT di BGP e permette di caricare il DDT
   del gestionale, che viene allegato alla conferma al cliente. Va deciso quale dei due usare.
3. **m² nel CRM**: export CSV mensile da copiare; un collegamento automatico non è incluso.
