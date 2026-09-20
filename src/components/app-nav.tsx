"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand-strong)]"
                : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            }`}
          >
            <span>{item.label}</span>
            {item.badge && item.badge > 0 ? (
              <span className="ml-2 rounded-full bg-[var(--color-brand)] px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function DesktopNav({ items }: { items: NavItem[] }) {
  return <NavLinks items={items} />;
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever navigation completes.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary lg:hidden"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Close" : "Menu"}
      </button>
      {open ? (
        <div
          id="mobile-nav"
          className="absolute inset-x-0 top-full z-20 border-b border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-lg lg:hidden"
        >
          <NavLinks items={items} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}
