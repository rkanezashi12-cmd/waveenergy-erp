import Link from "next/link";
import { cx } from "@/components/ui";

export const STEPS = [
  { n: 1, label: "基本情報・発番" },
  { n: 2, label: "AI下書き（任意）" },
  { n: 3, label: "要求仕様書" },
  { n: 4, label: "資料チェックリスト" },
  { n: 5, label: "未確定項目" },
  { n: 6, label: "確認・発令" },
];

/** 作成手順の表示。発番後は各手順へ移動できる（保存していない入力は失われる） */
export function Stepper({ current, orderId, aiEnabled }: { current: number; orderId?: string; aiEnabled: boolean }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-1 text-xs sm:text-sm">
      {STEPS.filter((s) => aiEnabled || s.n !== 2).map((s) => {
        const active = s.n === current;
        const body = (
          <span
            className={cx(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1",
              active ? "border-brand-600 bg-brand-600 text-white" : s.n < current ? "border-brand-600 bg-white text-brand-700" : "border-slate-300 bg-white text-slate-500",
            )}
          >
            {["①", "②", "③", "④", "⑤", "⑥"][s.n - 1]} {s.label}
          </span>
        );
        return (
          <li key={s.n}>
            {orderId && !active ? (
              <Link href={`/orders/${orderId}/edit?step=${s.n}`} aria-label={`手順${s.n}：${s.label}へ移動`}>
                {body}
              </Link>
            ) : (
              <span aria-current={active ? "step" : undefined}>{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
