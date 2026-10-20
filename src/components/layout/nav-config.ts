import type { Permission } from "@/lib/roles";

export type NavCountKey = "NUOVA" | "IN_PREPARAZIONE" | "PRONTA_RITIRO" | "SPEDITA" | "bolle";

/** Cosa conta il numero accanto alla voce (tooltip e testo per i lettori di schermo). */
export const NAV_COUNT_LABELS: Record<NavCountKey, string> = {
  NUOVA: "nuove da inviare al magazzino",
  IN_PREPARAZIONE: "da preparare",
  PRONTA_RITIRO: "pronte per il ritiro",
  SPEDITA: "senza tracking",
  bolle: "bolle da preparare",
};

export type NavItem = {
  href: string;
  label: string;
  permission: Permission;
  /** Contatore mostrato accanto alla voce (richieste in attesa). */
  count?: NavCountKey;
  /** Corrispondenza esatta del percorso per l'evidenziazione. */
  exact?: boolean;
};

export type NavSection = { title: string; items: NavItem[] };

/** Le 6 viste del blueprint (una per ruolo) + anagrafiche e impostazioni. */
export const NAV: NavSection[] = [
  {
    title: "Lavoro",
    items: [
      { href: "/richieste", label: "Richieste aperte", permission: "requests.manage", count: "NUOVA" },
      { href: "/magazzino", label: "Coda magazzino", permission: "warehouse.work", count: "IN_PREPARAZIONE" },
      { href: "/logistica", label: "Pronte per il ritiro", permission: "logistics.work", count: "PRONTA_RITIRO", exact: true },
      { href: "/logistica/bolle", label: "Bolle da preparare", permission: "logistics.work", count: "bolle" },
      { href: "/logistica/spedite", label: "Spedite: manca tracking", permission: "logistics.work", count: "SPEDITA" },
    ],
  },
  {
    title: "Analisi",
    items: [
      { href: "/direzione", label: "Cruscotto direzione", permission: "management.view", exact: true },
      { href: "/direzione/storico", label: "Storico completo", permission: "management.view" },
      { href: "/report/mq", label: "Report m² mensile", permission: "reports.m2" },
    ],
  },
  {
    title: "Anagrafiche",
    items: [
      { href: "/anagrafiche/contatti", label: "Contatti", permission: "registry.view" },
      { href: "/anagrafiche/prodotti", label: "Prodotti", permission: "registry.view" },
    ],
  },
  {
    title: "Amministrazione",
    items: [{ href: "/impostazioni", label: "Impostazioni", permission: "settings.manage" }],
  },
];
