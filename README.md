# Campionature BGP

Gestionale web per le richieste e le spedizioni dei campioni di BGP Group (Bergamo Parquet).
Sostituisce il processo su carta descritto nel blueprint di BGP ("app oc ai", v1.0 maggio 2026):
il back office inserisce la richiesta, il magazzino prepara e misura i pezzi, la logistica spedisce,
il sistema avvisa cliente e agente e calcola i m² del mese da riportare nel CRM.

## Flusso

| Stato | Responsabile | Cosa fa per avanzare | Automazione |
|---|---|---|---|
| Nuova richiesta | Back office | Contatto e i [dati per la presa in carico](#dati-per-la-presa-in-carico): destinatario, alla c.a., indirizzo, codice + formato + quantità di ogni prodotto, preavviso telefonico (e numero); note, «bolla di consegna richiesta» → *Invia al magazzino* | Email al magazzino |
| In preparazione | Magazzino | Colli, peso, misure di ogni pezzo (lunghezza × larghezza, quantità, note sullo stato) → *Pronta per il ritiro* | Se serve la bolla: email alla logistica |
| Pronta per il ritiro | Logistica | Corriere, data di ritiro, bolla (generata in PDF o DDT caricato) → *Segna come spedita* | — |
| Spedita | Logistica | Numero di tracking e data di spedizione | Email al cliente con l'agente in copia, nella lingua del cliente, DDT allegato → *Completata* |
| Completata | Sistema | — | — |

Il back office (e l'amministratore) può riportare una richiesta allo stato precedente indicando il motivo;
solo l'amministratore riapre una richiesta completata. Le correzioni non inviano email: se la conferma al
cliente era già partita, salvare i dati di spedizione non la ripete, la si reinvia con «Invia conferma».
Una richiesta «Spedita» senza email del contatto (o con ritiro in sede) si può completare senza conferma.
La bolla richiesta su una richiesta già «Pronta per il ritiro» fa partire subito l'avviso alla logistica.

### Dati per la presa in carico

BGP prende in carico una richiesta di campionatura (Italia ed estero) solo con questi dati, che clienti e
agenti non mandano quasi mai completi (elenco fornito da BGP, 23/09/2026). *Invia al magazzino* resta bloccato
finché mancano e la pagina della richiesta elenca cosa manca; la bozza si può salvare anche incompleta.

| Dato | Nel gestionale |
|---|---|
| **Ragione sociale** della ditta o **cognome e nome** del destinatario | «Destinatario», obbligatorio |
| Se si spedisce a una ditta, la **persona** a cui è destinata | «Alla c.a.»: promemoria non bloccante quando il destinatario sembra una ditta (non sempre si può sapere) |
| **Indirizzo** di consegna | Solo l'indirizzo: via, CAP, città, provincia, paese se estero |
| **Codice** del prodotto | Una riga per prodotto (anche lo stesso prodotto in due formati) |
| **Formato**: doghe intere, mezze doghe, mazzette, pannelli, espositore completo o solo culle… | Obbligatorio per ogni riga; «Altro» con descrizione. Proposto dal codice (MAZZ… mazzetta, PAN… pannello) |
| **Quantità** | Per ogni riga |
| Serve il **preavviso telefonico** prima della consegna? | Sì/No, da indicare sempre |
| Se sì, il **numero** da usare | Obbligatorio con «Sì»; finisce sulla bolla come sul DDT di BGP («PREAVVISO TASSATIVO 1GG PRIMA TEL. …») |

Il **modulo pubblico** chiede gli stessi dati, così le richieste di agenti e clienti arrivano già
complete; lì «Alla c.a.» è obbligatorio a meno di spuntare «il destinatario è un privato».
Destinatario, alla c.a., formato e preavviso compaiono nelle email al magazzino e alla logistica; la
conferma al cliente riporta il formato nella lingua del cliente. Le richieste registrate prima di questa
regola sono state migrate (la prima riga dell'indirizzo è diventata il destinatario; mazzette e pannelli
hanno già il formato): se sono ancora «Nuova richiesta» vanno completate prima dell'invio.

**m² e report**: una richiesta conta nel mese della data di spedizione; se la logistica non l'ha inserita
vale la data di ritiro del corriere (obbligatoria per «Spedita»). Report m², export CSV per il CRM e
cruscotto usano tutti la stessa regola.

## Ruoli e viste

| Ruolo | Vista principale | Può |
|---|---|---|
| Back office | Richieste aperte | Creare e modificare richieste, anagrafiche, import |
| Magazzino (×2, da telefono) | Coda magazzino | Colli, peso, pezzi, «pronta per il ritiro» |
| Logistica | Pronte per il ritiro · Bolle da preparare · Spedite senza tracking | Spedizione, bolla, DDT, tracking, costi |
| Direzione | Cruscotto · Storico completo | Sola lettura: stato, volumi, costi per cliente, conteggi per contatto/prodotto/paese; storico ed export CSV con destinatario e formato dei campioni |
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
npm run db:seed-demo          # facoltativo: utenti demo per ruolo e richieste di esempio (solo su database senza richieste)
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
  `Agent email (cc)`, `Language` (facoltativi `Country`/`Paese`, `Phone`). Gli agenti diventano contatti
  di tipo «Agente» collegati ai clienti; i clienti senza agente sono i «direzionali». Più email separate da `;`.
  - **Paese** (se manca la colonna): Italia quando l'indirizzo ha CAP a 5 cifre e sigla di una provincia
    italiana, es. `24023 CLUSONE (BG)`; `(HR)` → Croazia, `(SM)` → San Marino, `(CH)`/`(TI)`/`(ZH)` con
    CAP a 4 cifre → Svizzera; `(EE)` e gli altri casi restano da completare («Paese non indicato»).
    Il paese ricavato dall'indirizzo non sostituisce mai quello già salvato in anagrafica.
  - **Lingua** (obbligatoria per BGP, decide la lingua della conferma): se manca, un contatto nuovo viene
    creato in italiano e segnato «da verificare»; uno esistente mantiene la sua. Il riepilogo dell'import
    elenca queste righe.
- **Prodotti** — `Codice_articolo`, `Descrizione_articolo_estesa`; facoltative `Marchio` e `Categoria`
  (impostate solo se la cella non è vuota).

L'import è ripetibile: aggiorna i record esistenti (clienti riconosciuti per nome + indirizzo,
prodotti per codice) e non cancella nulla.

## Produzione

```bash
docker build -t campionature-bgp .
docker run -p 127.0.0.1:3000:3000 --env-file /etc/campionature/.env.production campionature-bgp
```

Il container applica le migrazioni all'avvio. Variabili: `DATABASE_URL`, `APP_URL` (usato nei link
delle email), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `TRUST_PROXY`, `APP_SECRET`
(firma il gettone anti-bot del modulo pubblico; se manca si usa un valore derivato da `DATABASE_URL`).
La build non richiede variabili: i segreti si passano solo all'avvio (`--env-file` o segreti
dell'orchestratore). `.dockerignore` esclude comunque tutti i file `.env*` (tranne `.env.example`) e `*.pem`,
ma è meglio tenere il file di produzione fuori dalla cartella del progetto.

**Reverse proxy obbligatorio.** L'app va pubblicata dietro a un proxy (nginx, Caddy, Traefik…) che
gestisce HTTPS: in produzione il cookie di sessione è `Secure` e senza HTTPS il login non funziona.
Il proxy deve impostare `X-Real-IP` (o aggiungere l'IP del client a `X-Forwarded-For`) e l'app va avviata
con `TRUST_PROXY=true`: solo così i limiti di frequenza per IP di login e modulo pubblico vedono l'IP vero.
Senza `TRUST_PROXY` l'IP è solo indicativo (un client malevolo può falsificarlo): valgono comunque i limiti
non basati sull'IP. Non impostarlo se il container è raggiungibile direttamente, senza proxy.

**Protezioni.** Login: dopo 10 tentativi sbagliati in 15 minuti l'account resta bloccato per 15 minuti;
l'amministratore lo sblocca reimpostando la password (o riattivando l'utente) dalle *Impostazioni*.
Modulo pubblico: campo trappola, gettone firmato (invio non prima di 3 secondi e non dopo 24 ore),
massimo 5 richieste all'ora per email del richiedente e per IP, 300 all'ora in totale. Per un traffico
ostile distribuito si può aggiungere un CAPTCHA (es. Cloudflare Turnstile).

Primo avvio: eseguire `npm run db:seed` e l'import puntando `DATABASE_URL` al database di produzione,
poi dalle *Impostazioni* configurare i destinatari di magazzino e logistica.

## Punti da confermare con BGP

1. **Costi per cliente** nel cruscotto: oggi è il costo di spedizione inserito dalla logistica.
2. **Bolla di consegna**: l'app genera un PDF sul modello del DDT di BGP e permette di caricare il DDT
   del gestionale, che viene allegato alla conferma al cliente. Va deciso quale dei due usare.
3. **m² nel CRM**: export CSV mensile da copiare; un collegamento automatico non è incluso.
   Il mese è quello della data di spedizione, o della data di ritiro se la spedizione non ha data.
4. **Marchio e categoria dei prodotti** (filtro «Marchio» dello storico e colonna Marchio del CSV m²):
   la lista prodotti di BGP ha solo codice e descrizione, quindi oggi sono vuoti. Servono? Se sì, basta
   un file con `Codice_articolo` e `Marchio` (es. SmartFloors, Gaia Parquet, AFAP, Aquawood) ed
   eventualmente `Categoria`, da caricare con l'import prodotti.
5. **Paese dei contatti esteri**: nel file Airtable la sigla tra parentesi non distingue sempre l'estero.
   `(EE)` e i CAP non italiani restano senza paese («Paese non indicato», da completare in anagrafica);
   due indirizzi esteri con CAP a 5 cifre e sigla uguale a una provincia (`71000 SARAJEVO (BA)`,
   `21233 CENEJ (SR)`) risultano Italia e vanno corretti a mano. Meglio aggiungere una colonna `Country`.
