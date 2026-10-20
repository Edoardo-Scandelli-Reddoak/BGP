import { redirect } from "next/navigation";

/** L'elenco utenti è la pagina principale delle impostazioni. */
export default function UsersIndexRedirect() {
  redirect("/impostazioni");
}
