"use client";

import { useState, type ReactNode } from "react";
import { BrandMark } from "./brand";
import { NavLinks } from "./nav-links";
import type { NavCountKey, NavSection } from "./nav-config";

export function MobileNav({
  sections,
  counts,
  footer,
}: {
  sections: NavSection[];
  counts: Partial<Record<NavCountKey, number>>;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between bg-brand-900 px-4 lg:hidden">
        <BrandMark inverted compact />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-brand-100 hover:bg-white/10"
          aria-label="Apri menu"
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-brand-900 px-3 py-4">
            <div className="mb-6 flex items-center justify-between px-3">
              <BrandMark inverted />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-brand-100 hover:bg-white/10"
                aria-label="Chiudi menu"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavLinks sections={sections} counts={counts} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-white/10 pt-3">{footer}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
