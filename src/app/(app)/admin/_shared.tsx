// 管理画面で共通に使う表示部品
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, PageHeader, cx } from "@/components/ui";

/** 管理画面の見出し（管理メニューへ戻るリンク付き） */
export function AdminHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <PageHeader
      title={title}
      sub={
        <Link href="/admin" className="text-brand-700 underline">
          管理
        </Link>
      }
      actions={actions}
    />
  );
}

/** 有効／無効の表示 */
export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-300">有効</Badge>
  ) : (
    <Badge className="bg-slate-100 text-slate-500 ring-slate-300">無効</Badge>
  );
}

/** 切替タブ（リンク） */
export function LinkTabs({ items }: { items: { href: string; label: ReactNode; active: boolean }[] }) {
  return (
    <nav className="-mx-1 flex flex-wrap gap-1" aria-label="切替">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cx(
            "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
            t.active ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** チェックボックスの一覧（複数選択）。フォームには同じ name で複数の値を送る */
export function CheckboxGroup({
  name,
  options,
  defaultValues,
  empty = "選択できる項目がありません。",
}: {
  name: string;
  options: { value: string; label: ReactNode; note?: ReactNode }[];
  defaultValues: string[];
  empty?: ReactNode;
}) {
  if (!options.length) return <div className="text-sm text-slate-500">{empty}</div>;
  return (
    <div className="grid max-h-60 gap-x-4 gap-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o.value} className="flex items-start gap-2 py-0.5 text-sm">
          <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValues.includes(o.value)} className="mt-1" />
          <span>
            {o.label}
            {o.note && <span className="ml-1 text-xs text-slate-500">{o.note}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
