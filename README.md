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
| **Indirizzo** di consegna | Solo l'indirizzo (via, CAP, città, provincia) più il «Paese di consegna» in un campo a parte |
| **Codice** del prodotto | Una riga per prodotto (anche lo stesso prodotto in due formati) |
| **Formato**: doghe intere, mezze doghe, mazzette, pannelli, espositore completo o solo culle… | Obbligatorio per ogni riga; «Altro» con descrizione. Proposto dal codice (MAZZ… mazzetta, PAN… pannello) |
| **Quantità** | Per ogni riga |
| Serve il **preavviso telefonico** prima della consegna? | Sì/No, da indicare sempre |
| Se sì, il **numero** da usare | Obbligatorio con «Sì»; finisce sulla bolla come sul DDT di BGP («PREAVVISO TASSATIVO 1GG PRIMA TEL. …») |

Il **modulo pubblico** chiede gli stessi dati, così le richieste di agenti e clienti arrivano già
complete; lì «Alla c.a.» è obbligatorio a meno di spuntare «il destinatario è un privato».
Destinatario, alla c.a., formato e preavviso compaiono nelle email al magazzino e alla logistica, con l'indirizzo
seguito dal paese quando la consegna è all'estero (anche sulla scheda della coda magazzino); la conferma al cliente
riporta il formato nella lingua del cliente. Le note della richiesta e delle righe restano interne (email al
magazzino, pagine dell'app): sulla bolla generata non vengono stampate. Le richieste registrate prima di questa
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
| Direzione | Cruscotto · Storico completo | Sola lettura: stato, volumi, costi per cliente, conteggi per contatto/prodotto/paese/marchio/categoria; storico ed export CSV con destinatario e formato dei campioni |
| Ufficio CRM | Report m² mensile | m² del mese ed export per il CRM (formato, colonne e invio automatico configurabili in Impostazioni → Export CRM) |
| Amministratore | tutto | Utenti, destinatari email, template, corrieri, dati della bolla, registro email e le [impostazioni di BGP](#impostazioni-di-bgp): costi per cliente, bolla di consegna, export m² per il CRM |

Agenti e clienti inviano le richieste dal **modulo pubblico** `/richiedi-campioni`, senza login.
I contatti nuovi creati dal modulo vengono segnalati al back office come «da verificare».

## Impostazioni di BGP

Tre scelte del processo le fa BGP da sola, in *Impostazioni* (solo amministratore). I valori iniziali
riproducono il comportamento di prima, quindi nulla cambia finché qualcuno non li modifica. Ogni pagina
spiega cosa succede, mostra un'anteprima dal vivo e controlla i campi prima di salvare.

**Costi** (`/impostazioni/costi`) — cosa sono i «costi per cliente» del cruscotto della direzione: il costo di
ogni richiesta spedita è la somma delle voci attive, ricalcolata sempre con le impostazioni attuali (anche per
i mesi passati).

| Voce | Come si calcola |
|---|---|
| Corriere | Importo inserito dalla logistica («Costo spedizione») |
| Gestione richiesta | € fissi per ogni richiesta spedita |
| Imballo | € per collo × colli indicati dal magazzino |
| Peso | € per kg × peso indicato dal magazzino |
| Valore campioni | m² spediti × € al m²; facoltativo: il prezzo al m² del prodotto, se indicato in anagrafica |
| Voci manuali | Fino a 10 voci con un nome a scelta (es. «Imballo speciale»), importo inserito dalla logistica su ogni richiesta |

Ogni voce si attiva/disattiva e si rinomina (il nome è l'intestazione nei report). Una voce manuale disattivata
sparisce da logistica e totali ma i suoi importi restano salvati e tornano riattivandola; eliminandola gli importi
restano nel database e tornano se si ricrea una voce con lo stesso nome. La pagina ha un esempio di calcolo con
i valori medi delle ultime spedizioni.

**Bolla di consegna** (`/impostazioni/bolla`) — chi la prepara, come si numera, quando è obbligatoria:
- *Modalità*: generata dal sistema (PDF sul modello del DDT di BGP, numerazione propria), DDT dal gestionale BGP
  (numero e/o PDF caricato dalla logistica, allegato alla conferma) oppure entrambe a scelta della logistica.
  Vale anche per le richieste in corso: la pagina avvisa se qualcuna tornerebbe tra le «bolle da preparare».
- *Numerazione* della bolla generata: formato con `{numero}` e `{anno}` (es. `C{numero}/{anno}` → `C0001/2026`),
  cifre del numero, anteprima del prossimo numero. Riparte da 1 ogni anno. Il DDT è un documento fiscale: se la
  bolla la genera il sistema va usata una serie dedicata concordata con il commercialista.
- *Regole* che spuntano da sole «bolla di consegna richiesta»: sempre, spedizioni all'estero, formati del campione
  (es. espositori), da N colli in su. Si applicano a richieste nuove o modificate e quando il magazzino segna
  una richiesta pronta (i colli si conoscono solo allora); le richieste già registrate non cambiano. Le regole
  aggiungono la bolla, non la tolgono: il back office può sempre spuntarla a mano.

Intestazione, causale, porto e aspetto della bolla restano in *Bolla e azienda* (`/impostazioni/azienda`).

**Export CRM** (`/impostazioni/export-crm`) — il file mensile dei m² per il CRM:
- *Contenuto*: una riga per prodotto, per prodotto e cliente, per cliente, per agente, per marchio o per categoria;
  colonne scelte e ordinate (mese, codice, descrizione, marchio, categoria, cliente, paese, agente, richieste, pezzi, m²).
  Marchio e categoria mancanti compaiono come «Non indicato».
- *Formato*: CSV (separatore `;` `,` o tabulazione, decimali con virgola o punto, riga di intestazione) o Excel,
  nome del file con `{mese}`. Anteprima con i dati veri di un mese e «Scarica il file di esempio».
- *Invio automatico*: il giorno scelto (1-28) il sistema manda per email ai destinatari il file del mese
  precedente, una sola volta per mese (se il server era spento, appena riparte). «Invia ora il mese precedente»
  manda subito il file ai destinatari salvati, per prova; gli invii sono nel registro email.
- *Webhook* (facoltativo, per il fornitore del CRM): lo stesso giorno un `POST` JSON firmato all'indirizzo https
  indicato, intestazione `X-BGP-Signature: sha256=<HMAC SHA-256 del corpo con il segreto condiviso>`; la pagina
  genera il segreto e ha una nota tecnica con un esempio del contenuto. Gli esiti degli invii automatici sono
  elencati nella pagina.

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
  `Agent email (cc)`, `Language`, consigliata `Country` (o `Paese`/`Nazione`), facoltativa `Phone`. Gli agenti
  diventano contatti di tipo «Agente» collegati ai clienti; i clienti senza agente sono i «direzionali». Più email
  separate da `;`.
  - **Colonna Country**: nome del paese in italiano, inglese o nella lingua locale, oppure sigla ISO (`IT`, `FR`,
    `CH`…); viene salvato sempre col nome italiano (`src/lib/countries.ts`, lo stesso vale per i form). Un valore
    non riconosciuto resta com'è con un avviso; un paese diverso da quello che risulta dall'indirizzo (es. `BG`,
    sigla di provincia letta come Bulgaria) viene salvato ma segnalato. Le celle vuote non cancellano il paese
    salvato; il riepilogo dice quanti clienti restano senza paese.
  - **Paese** (se manca la colonna): Italia quando l'indirizzo ha CAP a 5 cifre e sigla di una provincia
    italiana, es. `24023 CLUSONE (BG)`; `(HR)` → Croazia, `(SM)` → San Marino, `(CH)`/`(TI)`/`(ZH)` con
    CAP a 4 cifre → Svizzera; `(EE)` e gli altri casi restano da completare («Paese non indicato»).
    Il paese ricavato dall'indirizzo non sostituisce mai quello già salvato in anagrafica.
  - **Lingua** (obbligatoria per BGP, decide la lingua della conferma): se manca, un contatto nuovo viene
    creato in italiano e segnato «da verificare»; uno esistente mantiene la sua. Il riepilogo dell'import
    elenca queste righe.
- **Prodotti** — `Codice_articolo`, `Descrizione_articolo_estesa`; consigliate `Marchio` e `Categoria`
  (allineate ai valori già presenti senza distinguere maiuscole, spazi e accenti: «gaia parquet» diventa
  «Gaia Parquet»), facoltative `Prezzo_m2` e `Attivo` (Sì/No). Le celle vuote non cancellano i valori salvati; i
  prodotti del file vengono attivati salvo «No» nella colonna Attivo.

L'import è ripetibile: aggiorna i record esistenti (clienti riconosciuti per nome + indirizzo,
prodotti per codice) e non cancella nulla.

**Esporta Excel** (*Anagrafiche → Contatti / Prodotti*, `/api/export/contatti` e `/api/export/prodotti` con gli
stessi filtri dell'elenco) scarica i dati esattamente nel formato dell'import: si completano in Excel (es. la
colonna Country dei clienti con «Paese non indicato», o Marchio e Categoria) e si reimportano. Il file contatti
contiene solo i clienti; gli agenti sono nelle colonne Agent.

### Marchio e categoria dei prodotti

BGP li vuole (risposta del 20/10/2026), ma la lista prodotti ha solo codice e descrizione. Per compilarli:
- *Anagrafiche → Prodotti*: riepilogo dei prodotti attivi senza marchio o categoria, filtri «Senza marchio» /
  «Senza categoria» e **assegnazione in blocco** ai prodotti filtrati (es. cerca «battiscopa» → categoria;
  cerca «collezione NAIF» → marchio), solo dove manca o sostituendo i valori presenti.
- *Anagrafiche → Prodotti → Marchi e categorie*: valori in uso con il numero di prodotti, rinomina (che unisce
  due grafie dello stesso valore) e rimozione.
- Oppure in Excel con «Esporta Excel» e import.

Marchio e categoria compaiono nella ricerca prodotti dei moduli, nel cruscotto (*Per marchio*, *Per categoria*),
nei filtri dello storico, nel report m² (con riepilogo per marchio e categoria) e nell'export CRM.

`npm run bgp:files` prepara in `../per-BGP/` i file originali di BGP con le colonne da completare: la lista
clienti con la colonna `Country` già compilata dove il paese è noto (celle vuote evidenziate in giallo, contatti
da verificare in arancione) e la lista prodotti con `Marchio` e `Categoria` (menu dei valori proposti) più due
colonne di aiuto ignorate dall'import, «Tipo (dalla descrizione)» e «Collezione», per filtrare in Excel.

## Produzione

```bash
docker build -t campionature-bgp .
docker run -p 127.0.0.1:3000:3000 --env-file /etc/campionature/.env.production campionature-bgp
```

Il container applica le migrazioni all'avvio. Variabili: `DATABASE_URL`, `APP_URL` (usato nei link
delle email), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `TRUST_PROXY`, `APP_SECRET`
(firma il gettone anti-bot del modulo pubblico; se manca si usa un valore derivato da `DATABASE_URL`),
`CRON_SECRET` e `SCHEDULER_ENABLED` (vedi sotto).
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

**Attività programmate.** L'invio mensile dell'export CRM parte da uno scheduler interno: ogni ora il server
chiama `POST /api/cron/export-crm` su sé stesso, che invia solo se è il giorno giusto e il mese non è già stato
inviato (con più istanze dell'app un lucchetto nel database evita doppi invii). La chiamata richiede
`Authorization: Bearer <segreto>`: il segreto è `CRON_SECRET` se impostato, altrimenti un valore derivato da
`DATABASE_URL`. Con `SCHEDULER_ENABLED=false` lo scheduler interno è spento e serve un cron esterno che chiami
quell'indirizzo ogni ora con `CRON_SECRET` (in quel caso va impostato). La pagina *Impostazioni → Export CRM*
avvisa se lo scheduler è spento.

Primo avvio: eseguire `npm run db:seed` e l'import puntando `DATABASE_URL` al database di produzione,
poi dalle *Impostazioni* configurare i destinatari di magazzino e logistica.

## Decisioni che BGP può prendere da Impostazioni

Le tre domande aperte con BGP sono diventate [impostazioni](#impostazioni-di-bgp) che BGP compila da sola.
Finché nessuno le modifica vale il comportamento predefinito:

1. **Costi per cliente** (*Impostazioni → Costi*): quali voci contano. Predefinito: solo il costo del corriere
   inserito dalla logistica.
2. **Bolla di consegna** (*Impostazioni → Bolla di consegna*): bolla generata dal sistema, DDT del gestionale o
   entrambi, numerazione della bolla generata e regole che la rendono obbligatoria. Predefinito: entrambe a scelta
   della logistica, numero `C0001/2026`, nessuna regola (la bolla la richiede il back office). Se BGP sceglie la
   bolla generata, la serie di numerazione va concordata con il commercialista.
3. **m² nel CRM** (*Impostazioni → Export CRM*): raggruppamento, colonne e formato del file, invio automatico
   mensile per email e/o webhook verso il CRM. Predefinito: CSV per prodotto (`Codice;Descrizione;Marchio;Categoria;Richieste;Pezzi;m2`,
   virgola decimale), scaricato a mano, nessun invio automatico. Il mese è quello della data di spedizione, o
   della data di ritiro se la spedizione non ha data.

### Dati da completare con BGP

1. **Marchio e categoria dei prodotti**: confermati necessari; vanno compilati con gli strumenti descritti in
   [Marchio e categoria dei prodotti](#marchio-e-categoria-dei-prodotti) o con il file preparato da `npm run bgp:files`.
2. **Paese dei contatti esteri**: BGP aggiunge la colonna `Country` al file contatti. Nel file Airtable la sigla
   tra parentesi non distingue sempre l'estero: `(EE)` e i CAP non italiani restano senza paese; due indirizzi
   esteri con CAP a 5 cifre e sigla uguale a una provincia (`71000 SARAJEVO (BA)`, `21233 CENEJ (SR)`) risultano
   Italia e vanno corretti. Il paese serve anche alla regola «spedizioni all'estero» della bolla.
