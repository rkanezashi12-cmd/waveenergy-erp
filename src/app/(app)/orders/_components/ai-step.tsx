import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { draftCandidates } from "@/lib/ai/draft";
import type { OrderDetail } from "@/lib/orders/queries";
import { Alert, Card, LinkButton } from "@/components/ui";
import { AiUpload } from "./ai-upload";
import { AiAdopt } from "./ai-adopt";
import { adoptAiDraftAction } from "../ai-actions";
import { defaultDueStr, userOptions } from "../_lib/view";

/** ②AI下書き（任意） */
export async function AiDraftStep({ order }: { order: OrderDetail }) {
  const latest = await prisma.aiRun.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
  const pending = latest && latest.status === "SUCCEEDED" && !latest.adoptedAt ? await draftCandidates(order.id, latest.id) : null;
  const users = pending ? await userOptions() : [];
  return (
    <div className="flex flex-col gap-4">
      <Card title="②AI下書き（任意）" actions={<LinkButton href={`/orders/${order.id}/edit?step=3`} variant="secondary">AIを使わずに次へ</LinkButton>}>
        <p className="mb-3 text-slate-600">
          見積書・顧客仕様書・メールから、要求仕様書の下書きをAIで作ります。AIの候補は、項目ごとに「採用」「修正して採用」「却下」を選ぶまで要求仕様書に反映されません。AIの出力だけで発令することはできません。
        </p>
        {latest?.status === "FAILED" && (
          <div className="mb-3">
            <Alert kind="error">前回のAI下書き（{fmtDateTime(latest.createdAt)}）は失敗しました：{latest.error}</Alert>
          </div>
        )}
        {latest?.adoptedAt && (
          <div className="mb-3">
            <Alert kind="success">{fmtDateTime(latest.adoptedAt)} にAI下書きを反映しました。もう一度実行することもできます。</Alert>
          </div>
        )}
        <AiUpload orderId={order.id} />
      </Card>
      {pending && (
        <Card
          title="AIの読み取り結果"
          actions={
            <span className="text-xs text-slate-500">
              {fmtDateTime(pending.run.createdAt)}／モデル：{pending.run.model}／トークン：入力 {pending.run.promptTokens ?? "―"}・出力 {pending.run.outputTokens ?? "―"}
            </span>
          }
        >
          <AiAdopt data={pending} action={adoptAiDraftAction.bind(null, order.id, pending.run.id)} users={users} salesUserId={order.salesUserId} defaultDue={defaultDueStr()} />
        </Card>
      )}
    </div>
  );
}
