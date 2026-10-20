import { twMerge } from "tailwind-merge";

/**
 * Unisce classi CSS ignorando i valori falsy e risolvendo i conflitti di Tailwind: la classe passata
 * per ultima vince (es. un `className="pr-14"` passato a un componente che ha già `pr-28`).
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return twMerge(classes.filter(Boolean).join(" "));
}
