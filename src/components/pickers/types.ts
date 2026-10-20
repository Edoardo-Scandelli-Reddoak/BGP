/** Risultato di GET /api/prodotti/search e /api/public/prodotti */
export type ProductOption = {
  id: number;
  code: string;
  description: string;
  active: boolean;
};

/** Risultato di GET /api/contatti/search */
export type ContactOption = {
  id: number;
  type: "AGENTE" | "CLIENTE";
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  defaultAddress: string | null;
  country: string | null;
  language: "it" | "en" | "fr" | "de";
  agentName: string | null;
  agentEmail: string | null;
  needsReview: boolean;
};
