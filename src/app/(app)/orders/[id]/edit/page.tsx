import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { loadOrderAccess } from "@/lib/permissions";
import { loadOrderDetail } from "@/lib/orders/queries";
import { activeDocumentTemplates, activeSpecTemplates, getIssueCheck } from "@/lib/orders/service";
import { prisma } from "@/lib/db";
import { dateOnlyStr, todayStr } from "@/lib/dates";
import { getSystemSetting } from "@/lib/settings";
import { orderStatusLabel } from "@/lib/labels";
import { Alert, Card, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { Stepper } from "../../_components/stepper";
import { BasicForm } from "../../_components/basic-form";
import { SpecForm, type SpecValueView } from "../../_components/spec-form";
import { DocsForm, type DocView } from "../../_components/docs-form";
import { NewUnresolvedForm, UnresolvedList } from "../../_components/unresolved-list";
import { IssueForm } from "../../_components/issue-form";
import { AiDraftStep } from "../../_components/ai-step";
import { basicFormOptions, defaultDueStr, openItemDefaults, specTemplateView, unresolvedViews, userOptions } from "../../_lib/view";
import {
  createUnresolvedAction,
  issueAction,
  resolveUnresolvedAction,
  saveDocumentsAction,
  saveSpecAction,
  updateBasicAction,
  updateUnresolvedAction,
  withdrawUnresolvedAction,
} from "../../actions";

export const metadata: Metadata = { title: "オーダー作成" };

export default async function EditOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; created?: string; adopted?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const r = await loadOrderAccess(user, id);
  if (!r || !r.access.view) notFound();
  const order = await loadOrderDetail(id);
  if (!order) notFound();
  const setting = await getSystemSetting();
  let step = Number(sp.step ?? 1);
  if (![1, 2, 3, 4, 5, 6].includes(step) || (step === 2 && !setting.aiEnabled)) step = 1;

  if (!r.access.edit) {
    return (
      <>
        <PageHeader title={`${order.orderNumber} の編集`} />
        <Alert kind="warn" title="このオーダーは編集できません">
          ステータスが「{orderStatusLabel[order.status]}」のため、作成手順での編集はできません（編集できるのは下書き・差戻しのオーダーの営業担当・営業管理職です）。
          <div className="mt-2">
            <Link href={`/orders/${id}`} className="text-brand-700 underline">
              オーダー詳細へ
            </Link>
          </div>
        </Alert>
      </>
    );
  }

  const users = await userOptions();
  const defaultDue = defaultDueStr();
  const header = (
    <PageHeader
      title={
        <span className="flex flex-wrap items-center gap-2">
          {order.orderNumber} <StatusBadge status={order.status} />
        </span>
      }
      sub={order.title ?? "（件名未入力）"}
      actions={
        <LinkButton href={`/orders/${id}`} variant="secondary">
          オーダー詳細を見る
        </LinkButton>
      }
    />
  );

  let body: React.ReactNode = null;
  if (step === 1) {
    const opts = await basicFormOptions();
    body = (
      <Card title="①基本情報">
        <BasicForm
          action={updateBasicAction.bind(null, id)}
          mode="edit"
          orderNumber={order.orderNumber}
          {...opts}
          canManualNumber={false}
          todayStr={todayStr()}
          defaults={{
            productCategoryId: order.productCategoryId ?? "",
            customerName: order.customer?.name ?? "",
            siteName: order.siteName ?? "",
            endUser: order.endUser ?? "",
            title: order.title ?? "",
            quantity: order.quantity?.toString() ?? "",
            quantityUnit: order.quantityUnit ?? "",
            salesUserId: order.salesUserId,
            salesDepartmentId: order.salesDepartmentId ?? "",
            contractDeliveryDate: dateOnlyStr(order.contractDeliveryDate),
            deliveryType: order.deliveryType ?? "",
            deliveryFixDueDate: dateOnlyStr(order.deliveryFixDueDate),
            shortLeadConsulted: order.shortLeadConsulted === null ? "" : String(order.shortLeadConsulted),
            shortLeadNote: order.shortLeadNote ?? "",
            orderDocType: order.orderDocType ?? "",
            quoteNumber: order.quoteNumber ?? "",
            inquiryNumber: order.inquiryNumber ?? "",
          }}
        />
      </Card>
    );
  } else if (step === 2) {
    body = <AiDraftStep order={order} />;
  } else if (step === 3) {
    const templates = await activeSpecTemplates(prisma, order.productCategoryId);
    const values: Record<string, SpecValueView> = {};
    for (const v of order.specValues) values[v.templateId] = { state: v.state, value: v.value, naReason: v.naReason, aiDerived: v.aiDerived };
    body = (
      <Card title="③要求仕様書">
        <SpecForm
          action={saveSpecAction.bind(null, id)}
          templates={templates.map(specTemplateView)}
          values={values}
          openItems={openItemDefaults(order, "spec")}
          users={users}
          salesUserId={order.salesUserId}
          techUserId={order.techUserId}
          defaultDue={defaultDue}
          categoryName={order.productCategory?.name ?? null}
        />
      </Card>
    );
  } else if (step === 4) {
    const templates = await activeDocumentTemplates(prisma, order.productCategoryId);
    const docs: Record<string, DocView> = {};
    for (const d of order.documents) {
      if (!d.templateId) continue;
      const latest = d.versions.find((v) => v.isLatest);
      docs[d.templateId] = {
        state: d.state,
        naReason: d.naReason,
        latest: latest ? { url: latest.url, version: latest.version, docDate: dateOnlyStr(latest.docDate) } : null,
        historyCount: d.versions.length,
      };
    }
    body = (
      <Card title="④資料チェックリスト">
        {!order.productCategoryId ? (
          <Alert kind="warn">製品区分が未選択です。①基本情報で製品区分を選ぶと、必要な資料が表示されます。</Alert>
        ) : (
          <DocsForm
            action={saveDocumentsAction.bind(null, id)}
            templates={templates.map((t) => ({ id: t.id, name: t.name, requirement: t.requirement, description: t.description, defaultResponsibleType: t.defaultResponsibleType }))}
            docs={docs}
            openItems={openItemDefaults(order, "doc")}
            users={users}
            salesUserId={order.salesUserId}
            techUserId={order.techUserId}
            defaultDue={defaultDue}
          />
        )}
      </Card>
    );
  } else if (step === 5) {
    body = (
      <div className="flex flex-col gap-4">
        <Card title="⑤未確定項目">
          <p className="mb-3 text-slate-600">
            要求仕様書で「未確定」にした項目、「未入手」の資料、納期区分「仮」の納期は自動で登録されています。それ以外に未確定のこと（その他）があればここで追加します。未確定項目が残っていても発令できます。
          </p>
          <UnresolvedList
            items={unresolvedViews(order, user, r.access)}
            users={users}
            actions={{ update: updateUnresolvedAction, resolve: resolveUnresolvedAction, withdraw: withdrawUnresolvedAction }}
            todayStr={todayStr()}
            salesUserId={order.salesUserId}
            techUserId={order.techUserId}
          />
        </Card>
        <Card title="その他の未確定項目を追加">
          <NewUnresolvedForm action={createUnresolvedAction.bind(null, id)} users={users} salesUserId={order.salesUserId} techUserId={order.techUserId} defaultDue={defaultDue} />
        </Card>
        <div className="flex gap-2">
          <LinkButton href={`/orders/${id}/edit?step=4`} variant="secondary">
            前へ
          </LinkButton>
          <LinkButton href={`/orders/${id}/edit?step=6`}>次へ（確認・発令）</LinkButton>
        </div>
      </div>
    );
  } else if (step === 6) {
    const check = await getIssueCheck(user, id);
    const openItems = unresolvedViews(order, user, r.access).filter((i) => i.status === "OPEN" || i.status === "CHECKING");
    const stepName = ["", "①基本情報", "", "③要求仕様書", "④資料チェックリスト", "⑤未確定項目"];
    body = (
      <div className="flex flex-col gap-4">
        {order.status === "RETURNED" && (
          <Alert kind="error" title="差し戻されています">
            {order.statusHistories.filter((h) => h.toStatus === "RETURNED").at(-1)?.comment}
          </Alert>
        )}
        {check.problems.length ? (
          <Alert kind="error" title={`発令できません：不足が${check.problems.length}件あります`}>
            <ul className="mt-1 list-disc pl-5">
              {check.problems.map((p, i) => (
                <li key={i}>
                  <Link className="underline" href={`/orders/${id}/edit?step=${p.step}`}>
                    {stepName[p.step]}
                  </Link>
                  ：{p.message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : (
          <Alert kind="success" title="必須項目・必須資料はすべて揃っています。" />
        )}
        {!!check.warnings.length && (
          <Alert kind="warn" title="確認してください">
            <ul className="list-disc pl-5">
              {check.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Card title={`未確定のまま発令する項目（${openItems.length}件）`}>
          {openItems.length ? (
            <ul className="flex flex-col gap-1">
              {openItems.map((i) => (
                <li key={i.id} className={i.overdue ? "font-medium text-red-700" : ""}>
                  ・{i.title} ／ 担当：{i.assigneeName} ／ 期限：{i.dueDate.replaceAll("-", "/")}
                  {i.overdue && "（期限超過）"}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-slate-600">未確定項目はありません。</div>
          )}
        </Card>
        <Card title="⑥発令">
          <p className="mb-3 text-slate-600">
            発令すると、製品区分の技術受付と通知グループ（関係部門）にアプリ内通知とメールが届きます。内容は{" "}
            <Link href={`/orders/${id}`} className="text-brand-700 underline">
              オーダー詳細
            </Link>{" "}
            で確認できます。
          </p>
          <IssueForm action={issueAction.bind(null, id)} disabled={check.problems.length > 0 || !r.access.issue} reissue={order.status === "RETURNED"} />
        </Card>
      </div>
    );
  }

  return (
    <>
      {header}
      <Stepper current={step} orderId={id} aiEnabled={setting.aiEnabled} />
      {sp.created && (
        <div className="mb-3">
          <Alert kind="success">オーダー番号 {order.orderNumber} を発番しました。続けて入力してください（途中で保存して後から再開できます）。</Alert>
        </div>
      )}
      {sp.adopted && step === 3 && (
        <div className="mb-3">
          <Alert kind="success">AI下書きの採用内容を反映しました。「AI下書き」の印が付いた項目を中心に内容を確認してください。</Alert>
        </div>
      )}
      {order.status === "RETURNED" && step !== 6 && (
        <div className="mb-3">
          <Alert kind="error" title="差し戻されています。修正して再発令してください。">
            {order.statusHistories.filter((h) => h.toStatus === "RETURNED").at(-1)?.comment}
          </Alert>
        </div>
      )}
      {body}
    </>
  );
}
