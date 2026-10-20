"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { BrandMark } from "./brand";
import { NavLinks } from "./nav-links";
import type { NavCountKey, NavSection } from "./nav-config";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const panelId = useId();
  const titleId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  // Focus nel menu all'apertura, di nuovo sul pulsante alla chiusura; Esc chiude.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      closeRef.current?.focus();
      const onKey = (e: globalThis.KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      toggleRef.current?.focus();
    }
  }, [open]);

  // Il Tab resta dentro il menu finché è aperto (dialog modale).
  function trapFocus(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between bg-brand-900 px-4 lg:hidden">
        <BrandMark inverted compact />
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-brand-100 hover:bg-white/10"
          aria-label="Apri menu"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {open ? (
        <div
          id={panelId}
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={trapFocus}
        >
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} aria-hidden />
          <div ref={panelRef} className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-brand-900 px-3 py-4">
            <h2 id={titleId} className="sr-only">
              Menu di navigazione
            </h2>
            <div className="mb-6 flex items-center justify-between px-3">
              <BrandMark inverted />
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-brand-100 hover:bg-white/10"
                aria-label="Chiudi menu"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nav-scroll -mx-3 flex-1 overflow-y-auto px-3">
              <NavLinks sections={sections} counts={counts} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-white/10 pt-3">{footer}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
