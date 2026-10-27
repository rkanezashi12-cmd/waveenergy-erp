import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/dates";
import { emailResultLabel, mailTransportLabel } from "@/lib/labels";
import { Alert, Badge, Card, Empty, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "送信メール履歴" };
const PAGE_SIZE = 50;

/** 送信メール履歴（デモ時のみ）。管理者はすべて、その他のユーザーは自分宛てのメールを表示する */
export default async function MailsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (!env.isDemo) notFound();
  const user = await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = can.admin(user) ? {} : { to: user.email };
  const [total, mails] = await Promise.all([
    prisma.outboundEmail.count({ where }),
    prisma.outboundEmail.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <>
      <PageHeader title="送信メール履歴" sub={can.admin(user) ? `すべてのメール（${total}件）` : `あなた宛てのメール（${total}件）`} />
      <div className="mb-3">
        <Alert kind="info">
          デモ環境の送信方式は「{mailTransportLabel[env.mailTransport === "smtp" ? "SMTP" : env.mailTransport === "graph" ? "GRAPH" : "DB"]}」です。DB保存の場合は実際には送信せず、ここで内容を確認できます。
        </Alert>
      </div>
      <Card>
        {!mails.length ? (
          <Empty>送信メールはありません。</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {mails.map((m) => (
              <li key={m.id} className="py-3">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{m.subject}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      宛先：{m.to}　{fmtDateTime(m.createdAt)}
                    </span>
                    <Badge className={m.result === "FAILED" ? "ml-2 bg-red-50 text-red-700 ring-red-300" : "ml-2 bg-slate-100 text-slate-600 ring-slate-300"}>
                      {mailTransportLabel[m.transport]}／{emailResultLabel[m.result]}
                    </Badge>
                  </summary>
                  <pre className="mt-2 rounded bg-slate-50 p-3 font-sans text-sm whitespace-pre-wrap">{m.body}</pre>
                  {m.error && <div className="mt-1 text-red-700">エラー：{m.error}</div>}
                </details>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav className="mt-3 flex gap-3" aria-label="ページ">
            {page > 1 && <Link className="text-brand-700 underline" href={`/mails?page=${page - 1}`}>前へ</Link>}
            <span>{page} / {pages}</span>
            {page < pages && <Link className="text-brand-700 underline" href={`/mails?page=${page + 1}`}>次へ</Link>}
          </nav>
        )}
      </Card>
    </>
  );
}
