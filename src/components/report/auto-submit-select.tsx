"use client";

import type { ComponentProps } from "react";
import { Select } from "@/components/ui/form";

/** Tendina che invia subito il form GET in cui si trova (il pulsante di invio resta come alternativa). */
export function AutoSubmitSelect({ onChange, ...props }: ComponentProps<"select">) {
  return (
    <Select
      {...props}
      onChange={(e) => {
        onChange?.(e);
        e.currentTarget.form?.requestSubmit();
      }}
    />
  );
}
