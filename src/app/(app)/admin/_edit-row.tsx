"use client";
// 表の行の下に、表の幅いっぱいの編集パネルを開く部品。
// （セルの中にフォームを開くと表の幅が広がりすぎるため）
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, cx } from "@/components/ui";

const CloseCtx = createContext<(() => void) | null>(null);

/** 編集パネルを閉じる関数（パネルの外では null）。保存に成功したら呼ぶ */
export function useCloseEdit() {
  return useContext(CloseCtx);
}

/** 表を囲む。パネルの幅を表示幅に合わせるためのコンテナ */
export function EditableTable({ children }: { children: ReactNode }) {
  return <div className="@container">{children}</div>;
}

export function EditableRow({
  cells,
  colSpan,
  panels,
  className,
}: {
  /** 行のセル（<td> の並び）。操作ボタンのセルは自動で末尾に付く */
  cells: ReactNode;
  /** 操作ボタンのセルを含めた列数 */
  colSpan: number;
  panels: { label: string; content: ReactNode; variant?: "secondary" | "danger" }[];
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <tr className={cx(className, open !== null && "bg-brand-50/60 [&>td]:border-b-0")}>
        {cells}
        <td>
          <div className="flex flex-wrap gap-2">
            {panels.map((p, i) => (
              <Button
                key={p.label}
                type="button"
                variant={open === i ? "primary" : "secondary"}
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </td>
      </tr>
      {open !== null && (
        <tr className="bg-brand-50/60">
          <td colSpan={colSpan}>
            {/* 横スクロールしても表示幅に収まるよう、幅を表示領域に合わせて左に固定する */}
            <div className="sticky left-0 w-[calc(100cqw-1rem)] rounded-md border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-700">{panels[open].label}</div>
                <Button type="button" variant="ghost" onClick={() => setOpen(null)}>
                  閉じる
                </Button>
              </div>
              <CloseCtx.Provider value={() => setOpen(null)}>{panels[open].content}</CloseCtx.Provider>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
