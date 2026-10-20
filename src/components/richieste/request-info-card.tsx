"use client";

import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useRequestEditing } from "./request-editing";
import { RequestForm, type RequestFormInitial } from "./request-form";

export type RequestEditConfig = {
  requestId: number;
  initial: RequestFormInitial;
  today: string;
  itemsEditable: boolean;
  itemsLockedReason?: string;
  /** Richiesta ancora nuova: nel form compare anche «Salva e invia al magazzino». */
  canSendToWarehouse?: boolean;
};

/** Pannello «Richiesta»: vista in sola lettura (children, dal server) e, per il back office, modifica sul posto. */
export function RequestInfoCard({
  description,
  edit,
  children,
}: {
  description?: ReactNode;
  /** null = non modificabile da questo utente o in questo stato. */
  edit: RequestEditConfig | null;
  children: ReactNode;
}) {
  const { editing, setEditing } = useRequestEditing();
  const [message, setMessage] = useState<string | null>(null);
  const isEditing = Boolean(edit) && editing;

  return (
    <Card id="richiesta">
      <CardHeader
        title={isEditing ? "Modifica richiesta" : "Richiesta"}
        description={isEditing ? "Contatto, prodotti, destinazione e note." : description}
        actions={
          edit && !isEditing ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setMessage(null);
                setEditing(true);
              }}
            >
              Modifica
            </Button>
          ) : null
        }
      />
      <CardBody>
        {message && !isEditing ? (
          <Alert tone={/attenzione|non inviat/i.test(message) ? "warning" : "success"} className="mb-4">
            {message}
          </Alert>
        ) : null}
        {edit && isEditing ? (
          <RequestForm
            mode="edit"
            requestId={edit.requestId}
            initial={edit.initial}
            today={edit.today}
            itemsEditable={edit.itemsEditable}
            itemsLockedReason={edit.itemsLockedReason}
            canSendToWarehouse={edit.canSendToWarehouse}
            onCancel={() => setEditing(false)}
            onSaved={(m) => {
              setEditing(false);
              setMessage(m ?? "Dati della richiesta aggiornati.");
            }}
          />
        ) : (
          children
        )}
      </CardBody>
    </Card>
  );
}
