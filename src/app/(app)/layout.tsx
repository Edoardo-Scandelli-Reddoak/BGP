import { logout } from "@/app/login/actions";
import { BrandMark } from "@/components/layout/brand";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NAV, type NavCountKey } from "@/components/layout/nav-config";
import { NavLinks } from "@/components/layout/nav-links";
import { requireUser } from "@/lib/auth/session";
import { countByStatus } from "@/lib/requests/service";
import { can, ROLE_LABELS } from "@/lib/roles";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => can(user.role, i.permission)) })).filter(
    (s) => s.items.length > 0,
  );
  const stats = await countByStatus();
  const counts: Partial<Record<NavCountKey, number>> = stats;

  const footer = (
    <div className="flex items-center justify-between gap-2 px-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="truncate text-xs text-brand-300">{ROLE_LABELS[user.role]}</p>
      </div>
      <form action={logout}>
        <button type="submit" className="rounded-md px-2 py-1 text-xs font-medium text-brand-100 hover:bg-white/10 hover:text-white">
          Esci
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col bg-brand-900 px-3 py-5">
        <div className="mb-8 px-3">
          <BrandMark inverted />
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks sections={sections} counts={counts} />
        </div>
        <div className="border-t border-white/10 pt-4">{footer}</div>
      </aside>
      <MobileNav sections={sections} counts={counts} footer={footer} />
      <main className="flex-1 lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
