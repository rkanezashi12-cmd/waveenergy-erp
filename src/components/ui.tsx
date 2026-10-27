// 共通の画面部品
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { OrderStatus, UnresolvedStatus, TaskStatus } from "@/generated/prisma/enums";
import { orderStatusLabel, taskStatusLabel, unresolvedStatusLabel } from "@/lib/labels";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variantClass: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300",
  ghost: "text-brand-700 hover:bg-brand-50",
};
const btnBase =
  "inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(btnBase, variantClass[variant], className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(btnBase, variantClass[variant], className)} {...props} />;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-base font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {sub && <div className="mt-1 text-slate-600">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const statusColor: Record<OrderStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-300",
  ACCEPT_PENDING: "bg-amber-50 text-amber-800 ring-amber-300",
  RETURNED: "bg-red-50 text-red-700 ring-red-300",
  SPEC_PENDING: "bg-sky-50 text-sky-800 ring-sky-300",
  SPEC_FIXED: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  COMPLETED: "bg-slate-200 text-slate-700 ring-slate-300",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-200 line-through",
};

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge className={statusColor[status]}>{orderStatusLabel[status]}</Badge>;
}

const unresolvedColor: Record<UnresolvedStatus, string> = {
  OPEN: "bg-amber-50 text-amber-800 ring-amber-300",
  CHECKING: "bg-sky-50 text-sky-800 ring-sky-300",
  RESOLVED: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  WITHDRAWN: "bg-slate-100 text-slate-500 ring-slate-300",
};

export function UnresolvedBadge({ status }: { status: UnresolvedStatus }) {
  return <Badge className={unresolvedColor[status]}>{unresolvedStatusLabel[status]}</Badge>;
}

const taskColor: Record<TaskStatus, string> = {
  TODO: "bg-amber-50 text-amber-800 ring-amber-300",
  IN_PROGRESS: "bg-sky-50 text-sky-800 ring-sky-300",
  DONE: "bg-emerald-50 text-emerald-800 ring-emerald-300",
};

export function TaskBadge({ status }: { status: TaskStatus }) {
  return <Badge className={taskColor[status]}>{taskStatusLabel[status]}</Badge>;
}

export function OverdueBadge() {
  return <Badge className="bg-red-600 text-white ring-red-600">期限超過</Badge>;
}

export function Alert({ kind = "info", title, children }: { kind?: "info" | "warn" | "error" | "success"; title?: ReactNode; children?: ReactNode }) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-300 bg-red-50 text-red-900",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2", cls)}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

export function Field({
  label,
  required,
  error,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-700">必須</span>}
      </label>
      {children}
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
      {error && <div className="text-xs font-medium text-red-600">{error}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-slate-500">{children}</div>;
}

/** 表。横に長い表はスマートフォンで横スクロールさせる */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-max border-collapse text-sm [&_td]:border-b [&_td]:border-slate-100 [&_td]:px-2 [&_td]:py-2 [&_td]:align-top [&_th]:border-b [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-slate-600 [&_th]:whitespace-nowrap">
        {children}
      </table>
    </div>
  );
}

export function DL({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="break-words whitespace-pre-wrap text-slate-900">{v === null || v === undefined || v === "" ? <span className="text-slate-400">―</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ForbiddenView() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Alert kind="error" title="権限がありません">
        この画面を表示する権限がありません。必要な場合は管理者にお問い合わせください。
      </Alert>
    </div>
  );
}
