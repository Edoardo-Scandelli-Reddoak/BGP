import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/roles";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? ROLE_HOME[user.role] : "/login");
}
