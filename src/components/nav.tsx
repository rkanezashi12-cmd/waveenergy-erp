"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "@/components/ui";

export type NavItem = { href: string; label: string; badge?: number };

export function AppNav({ items, user, logout }: { items: NavItem[]; user: { name: string; roles: string }; logout: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const links = (
    <ul className="flex flex-col gap-0.5">
      {items.map((it) => (
        <li key={it.href}>
          <Link
            href={it.href}
            onClick={() => setOpen(false)}
            className={cx(
              "flex items-center justify-between rounded-md px-3 py-2",
              isActive(it.href) ? "bg-brand-600 text-white" : "text-slate-200 hover:bg-white/10",
            )}
          >
            <span>{it.label}</span>
            {!!it.badge && (
              <span className="rounded-full bg-red-500 px-2 text-xs font-bold text-white" aria-label={`未読${it.badge}件`}>
                {it.badge > 99 ? "99+" : it.badge}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
  const unread = items.find((i) => i.href === "/notifications")?.badge ?? 0;
  return (
    <>
      {/* スマートフォン：上部バー */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-brand-800 px-4 py-2 text-white lg:hidden">
        <button type="button" onClick={() => setOpen(!open)} className="rounded px-2 py-1 hover:bg-white/10" aria-expanded={open} aria-label="メニュー">
          ☰ メニュー{unread ? <span className="ml-1 rounded-full bg-red-500 px-1.5 text-xs">{unread}</span> : null}
        </button>
        <span className="font-semibold">オーダー管理</span>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <nav className="h-full w-64 overflow-y-auto bg-brand-800 p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 px-3 text-xs text-slate-300">
              {user.name}
              <br />
              {user.roles}
            </div>
            {links}
            <div className="mt-4 px-3">{logout}</div>
          </nav>
        </div>
      )}
      {/* PC：左サイドバー */}
      <aside className="hidden w-60 shrink-0 flex-col bg-brand-800 p-3 lg:flex">
        <div className="mb-4 px-3 pt-2">
          <div className="text-base font-bold text-white">オーダー発令・<br />仕様確定管理</div>
        </div>
        <nav className="flex-1">{links}</nav>
        <div className="mt-4 border-t border-white/10 px-3 pt-3 text-xs text-slate-300">
          <div className="font-medium text-white">{user.name}</div>
          <div>{user.roles}</div>
          <div className="mt-2">{logout}</div>
        </div>
      </aside>
    </>
  );
}
