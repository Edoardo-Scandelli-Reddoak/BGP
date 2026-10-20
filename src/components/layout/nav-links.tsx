"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import type { NavCountKey, NavSection } from "./nav-config";

export function NavLinks({
  sections,
  counts,
  onNavigate,
}: {
  sections: NavSection[];
  counts: Partial<Record<NavCountKey, number>>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="space-y-6">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-brand-300">{section.title}</p>
          <ul className="mt-2 space-y-0.5">
            {section.items.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + "/");
              const n = item.count ? counts[item.count] : undefined;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-white/10 text-white" : "text-brand-100 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <span>{item.label}</span>
                    {n ? (
                      <span className="ml-2 rounded-full bg-accent-500 px-2 py-0.5 text-[11px] font-semibold text-white">{n}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
