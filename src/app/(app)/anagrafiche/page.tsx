import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

export default async function RegistryIndexPage() {
  await requireUser("registry.view");
  redirect("/anagrafiche/contatti");
}
