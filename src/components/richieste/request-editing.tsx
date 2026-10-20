"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type RequestEditing = { editing: boolean; setEditing: (editing: boolean) => void };

const RequestEditingContext = createContext<RequestEditing | null>(null);

/**
 * Stato «modifica in corso» del pannello Richiesta, condiviso con «Invia al magazzino»:
 * finché il form di modifica è aperto l'invio è sospeso (partirebbero i dati vecchi).
 * La modifica vale solo per lo stato in cui è stata aperta: dopo un cambio di stato si chiude,
 * senza rimontare i pannelli (che conservano così i messaggi delle loro azioni).
 */
export function RequestEditingProvider({ status, children }: { status: string; children: ReactNode }) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const editing = openFor === status;
  const value = useMemo(
    () => ({ editing, setEditing: (on: boolean) => setOpenFor(on ? status : null) }),
    [editing, status],
  );
  return <RequestEditingContext value={value}>{children}</RequestEditingContext>;
}

/** Fuori dal provider funziona con uno stato locale (il pannello resta utilizzabile da solo). */
export function useRequestEditing(): RequestEditing {
  const shared = useContext(RequestEditingContext);
  const [editing, setEditing] = useState(false);
  return shared ?? { editing, setEditing };
}
