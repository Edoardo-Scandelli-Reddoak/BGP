/** Dimensione di un file in KB/MB, es. "245 KB", "1,2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB`;
}

/** Indirizzo su una riga: "Nome\nVia..." → "Nome, Via...". */
export function oneLine(value: string | null | undefined): string {
  return (value ?? "").split(/\s*\n\s*/).filter(Boolean).join(", ");
}
