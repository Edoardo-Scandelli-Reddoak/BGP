"use client";

import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { RequestForm, type RequestFormInitial } from "./request-form";

export type RequestEditConfig = {
  requestId: number;
  initial: RequestFormInitial;
  today: string;
  itemsEditable: boolean;
  itemsLockedReason?: string;
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
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Card id="richiesta">
      <CardHeader
        title={editing ? "Modifica richiesta" : "Richiesta"}
        description={editing ? "Contatto, prodotti, destinazione e note." : description}
        actions={
          edit && !editing ? (
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
        {message && !editing ? (
          <Alert tone="success" className="mb-4">
            {message}
          </Alert>
        ) : null}
        {edit && editing ? (
          <RequestForm
            mode="edit"
            requestId={edit.requestId}
            initial={edit.initial}
            today={edit.today}
            itemsEditable={edit.itemsEditable}
            itemsLockedReason={edit.itemsLockedReason}
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
