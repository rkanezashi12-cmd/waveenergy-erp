import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { previewNextNumber } from "@/lib/numbering";
import { fmtDateTime } from "@/lib/dates";
import { Alert, Card, Empty, ForbiddenView, Table } from "@/components/ui";
import { AdminHeader } from "../_shared";
import { NumberingForm } from "./forms";
import { previewRule } from "./preview";

export const metadata: Metadata = { title: "採番ルール" };

export default async function NumberingPage() {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const current = await previewNextNumber();
  const [preview, counters] = await Promise.all([
    previewRule(current.rule),
    prisma.numberingCounter.findMany({ orderBy: [{ ruleId: "asc" }, { periodKey: "desc" }] }),
  ]);
  const { rule } = current;

  return (
    <>
      <AdminHeader title="採番ルール" />
      <div className="flex flex-col gap-4">
        <Alert kind="warn" title="変更する前に確認してください">
          <ul className="list-disc pl-5">
            <li>ルールを変更しても、既に発番したオーダーの番号は変わりません（付け直しはしません）。</li>
            <li>番号は再利用しません。取消したオーダーの番号や、既に使われている番号は飛ばして採番します。</li>
            <li>リセット単位や年度の開始月を変えると、連番を数える区切り（キー）が変わり、新しいキーでは1から数え直します。</li>
          </ul>
        </Alert>
        <Card title="現在の採番状況">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
            <dt className="text-slate-500">次に採番される番号</dt>
            <dd className="font-mono text-lg font-bold text-brand-800">{preview.next ?? current.next}</dd>
            <dt className="text-slate-500">リセット単位のキー</dt>
            <dd className="font-mono">{current.periodKey}</dd>
            <dt className="text-slate-500">現在値</dt>
            <dd>
              {current.current}
              {preview.currentNumber && (
                <span className="ml-2 text-slate-500">
                  （最後に採番した番号：<span className="font-mono">{preview.currentNumber}</span>）
                </span>
              )}
            </dd>
          </dl>
          {preview.skipped > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              連番どおりなら {current.next} ですが、既存のオーダー番号と重なるため {preview.skipped} 件飛ばします。
            </p>
          )}
        </Card>
        <Card title="ルールの変更">
          <NumberingForm
            rule={{
              prefix: rule.prefix,
              yearFormat: rule.yearFormat,
              separator: rule.separator,
              digits: rule.digits,
              resetUnit: rule.resetUnit,
              fiscalYearStartMonth: rule.fiscalYearStartMonth,
            }}
            initialPreview={preview}
          />
        </Card>
        <Card title="連番の現在値（リセット単位ごと）">
          {counters.length === 0 ? (
            <Empty>まだ採番していません。</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>リセット単位のキー</th>
                  <th>現在値</th>
                  <th>最終更新</th>
                </tr>
              </thead>
              <tbody>
                {counters.map((c) => (
                  <tr key={`${c.ruleId}-${c.periodKey}`} className={c.periodKey === current.periodKey ? "font-semibold" : ""}>
                    <td className="font-mono">
                      {c.periodKey}
                      {c.periodKey === current.periodKey && <span className="ml-2 text-xs font-normal text-brand-700">（使用中）</span>}
                    </td>
                    <td>{c.value}</td>
                    <td>{fmtDateTime(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
