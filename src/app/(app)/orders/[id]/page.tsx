import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { canUpdateTask, loadOrderAccess } from "@/lib/permissions";
import { loadOrderDetail } from "@/lib/orders/queries";
import { activeDocumentTemplates, activeSpecTemplates } from "@/lib/orders/service";
import { OPEN_UNRESOLVED } from "@/lib/orders/rules";
import { prisma } from "@/lib/db";
import { dateOnlyStr, fmtDate, fmtDateTime, isOverdue, todayStr } from "@/lib/dates";
import {
  deliveryTypeLabel,
  orderDocTypeLabel,
  orderStatusLabel,
  valueStateLabel,
} from "@/lib/labels";
import { Alert, Badge, Card, cx, DL, Empty, LinkButton, OverdueBadge, PageHeader, StatusBadge, Table } from "@/components/ui";
import { StatusActions } from "../_components/status-actions";
import { DocumentsPanel, type DocPanelItem } from "../_components/documents-panel";
import { NewUnresolvedForm, UnresolvedList } from "../_components/unresolved-list";
import { NewTaskForm, TaskList, type TaskView } from "../_components/tasks-panel";
import { MessageForm, MessageThread, type MessageView } from "../_components/messages-panel";
import { parseMulti } from "@/lib/orders/format";
import { defaultDueStr, unresolvedViews, userOptions } from "../_lib/view";
import {
  acceptAction,
  addDocumentVersionAction,
  assignTechAction,
  cancelAction,
  completeAction,
  createTaskAction,
  createUnresolvedAction,
  postMessageAction,
  resolveUnresolvedAction,
  returnAction,
  updateTaskAction,
  updateUnresolvedAction,
  withdrawUnresolvedAction,
} from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await prisma.order.findUnique({ where: { id }, select: { orderNumber: true } });
  return { title: o?.orderNumber ?? "オーダー" };
}

const TABS = [
  ["overview", "概要"],
  ["spec", "要求仕様書"],
  ["documents", "資料"],
  ["unresolved", "未確定項目"],
  ["tasks", "タスク"],
  ["messages", "やり取り"],
  ["history", "履歴"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; issued?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const r = await loadOrderAccess(user, id);
  if (!r || !r.access.view) notFound();
  const order = await loadOrderDetail(id);
  if (!order) notFound();
  const access = r.access;
  const tab: Tab = (TABS.map((t) => t[0]) as string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";

  // 未確定件数・期限超過
  const openItems = order.unresolvedItems.filter((i) => OPEN_UNRESOLVED.includes(i.status));
  const overdueItems = openItems.filter((i) => isOverdue(i.dueDate));
  const openTasks = order.tasks.filter((t) => t.status !== "DONE");
  const overdueTasks = openTasks.filter((t) => isOverdue(t.dueDate));
  const lastReturn = order.statusHistories.filter((h) => h.toStatus === "RETURNED").at(-1);

  const techUsers = await prisma.user.findMany({ where: { active: true, roles: { has: "TECH" } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const users = await userOptions();

  const tabCount: Partial<Record<Tab, string>> = {
    unresolved: openItems.length ? String(openItems.length) : "",
    tasks: openTasks.length ? String(openTasks.length) : "",
    messages: order.messages.length ? String(order.messages.length) : "",
  };

  let content: React.ReactNode = null;
  if (tab === "overview") {
    content = (
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="基本情報">
          <DL
            items={[
              ["オーダー番号", `${order.orderNumber}${order.numberSource === "MANUAL" ? "（既存番号で登録）" : ""}`],
              ["製品区分", order.productCategory?.name],
              ["顧客名", order.customer?.name],
              ["現場名", order.siteName],
              ["エンドユーザー", order.endUser],
              ["件名", order.title],
              ["数量", order.quantity ? `${order.quantity.toString()} ${order.quantityUnit ?? ""}` : null],
              ["営業担当・部署", `${order.salesUser.name}${order.salesDepartment ? `（${order.salesDepartment.name}）` : ""}`],
              ["技術担当", order.techUser?.name],
              [
                "契約納期",
                order.contractDeliveryDate
                  ? `${fmtDate(order.contractDeliveryDate)}（${order.deliveryType ? deliveryTypeLabel[order.deliveryType] : ""}）${order.deliveryType === "TENTATIVE" ? `　確定予定日：${fmtDate(order.deliveryFixDueDate)}` : ""}`
                  : null,
              ],
              [
                "短納期",
                order.shortLeadTime ? (
                  <span className="font-medium text-amber-800">
                    短納期（関係部門と事前協議：{order.shortLeadConsulted === null ? "未入力" : order.shortLeadConsulted ? "協議済み" : "未協議"}）{order.shortLeadNote ? `　${order.shortLeadNote}` : ""}
                  </span>
                ) : (
                  "該当しない"
                ),
              ],
              ["注文書／内示書", order.orderDocType ? orderDocTypeLabel[order.orderDocType] : null],
              ["見積番号", order.quoteNumber],
              ["引合番号", order.inquiryNumber],
            ]}
          />
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="進捗">
            <DL
              items={[
                ["ステータス", orderStatusLabel[order.status]],
                ["作成", `${fmtDateTime(order.createdAt)}（${order.createdBy.name}）`],
                ["発令日時", order.issuedAt ? `${fmtDateTime(order.issuedAt)}${order.issueCount > 1 ? `（${order.issueCount}回目）` : ""}` : null],
                ["発令時点の未確定項目数", order.unresolvedCountAtIssue !== null ? `${order.unresolvedCountAtIssue}件` : null],
                ["受入日時", fmtDateTime(order.acceptedAt)],
                ["仕様確定日時", fmtDateTime(order.specFixedAt)],
                ["未確定項目", `${openItems.length}件（期限超過 ${overdueItems.length}件）`],
                ["未完了のタスク", `${openTasks.length}件（期限超過 ${overdueTasks.length}件）`],
              ]}
            />
          </Card>
          {!!openItems.length && (
            <Card title="未確定項目（期限順）" actions={<Link href={`/orders/${id}?tab=unresolved`} className="text-brand-700 underline">すべて見る</Link>}>
              <ul className="flex flex-col gap-1">
                {[...openItems]
                  .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
                  .map((i) => (
                    <li key={i.id} className={cx(isOverdue(i.dueDate) && "font-medium text-red-700")}>
                      ・{i.title}／{i.assignee.name}／期限 {fmtDate(i.dueDate)}
                      {isOverdue(i.dueDate) && "（期限超過）"}
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    );
  } else if (tab === "spec") {
    const templates = await activeSpecTemplates(prisma, order.productCategoryId);
    const valueBy = new Map(order.specValues.map((v) => [v.templateId, v]));
    const render = (t: (typeof templates)[number]) => {
      const v = valueBy.get(t.id);
      const value = t.inputType === "MULTISELECT" ? parseMulti(v?.value ?? null).join("、") : v?.value;
      const item = openItems.find((i) => i.specTemplateId === t.id);
      return (
        <tr key={t.id} className={cx(v?.state === "UNRESOLVED" && "bg-amber-50/60")}>
          <td className="font-medium whitespace-normal">
            {t.label}
            {t.required && <span className="ml-1 text-xs text-red-600">必須</span>}
          </td>
          <td>
            {v?.state ? (
              <Badge className={v.state === "FILLED" ? "bg-emerald-50 text-emerald-800 ring-emerald-300" : v.state === "UNRESOLVED" ? "bg-amber-50 text-amber-800 ring-amber-300" : "bg-slate-100 text-slate-600 ring-slate-300"}>
                {valueStateLabel[v.state]}
              </Badge>
            ) : (
              <span className="text-slate-400">空欄</span>
            )}
            {v?.aiDerived && <Badge className="ml-1 bg-violet-50 text-violet-700 ring-violet-300">AI</Badge>}
          </td>
          <td className="max-w-xl whitespace-pre-wrap">
            {v?.state === "NOT_APPLICABLE" ? <span className="text-slate-600">理由：{v.naReason}</span> : value}
            {item && (
              <div className="mt-1 text-xs text-amber-800">
                未確定：担当 {item.assignee.name}／期限 {fmtDate(item.dueDate)}
                {isOverdue(item.dueDate) && <OverdueBadge />}
              </div>
            )}
          </td>
        </tr>
      );
    };
    content = (
      <Card title="要求仕様書">
        {!templates.length ? (
          <Empty>項目がありません。</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="w-64">項目</th>
                <th>状態</th>
                <th>値</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={3} className="bg-slate-50 font-semibold">
                  共通項目
                </td>
              </tr>
              {templates.filter((t) => !t.productCategoryId).map(render)}
              <tr>
                <td colSpan={3} className="bg-slate-50 font-semibold">
                  製品区分別項目（{order.productCategory?.name ?? "未選択"}）
                </td>
              </tr>
              {templates.filter((t) => t.productCategoryId).map(render)}
            </tbody>
          </Table>
        )}
      </Card>
    );
  } else if (tab === "documents") {
    const templates = await activeDocumentTemplates(prisma, order.productCategoryId);
    const docBy = new Map(order.documents.filter((d) => d.templateId).map((d) => [d.templateId!, d]));
    const toView = (d: (typeof order.documents)[number] | undefined, t?: (typeof templates)[number]): DocPanelItem => ({
      id: d?.id ?? null,
      templateId: t?.id ?? d?.templateId ?? null,
      name: t?.name ?? d?.template?.name ?? d?.name ?? "資料",
      requirement: t?.requirement ?? d?.template?.requirement ?? null,
      state: d?.state ?? null,
      naReason: d?.naReason ?? null,
      versions: (d?.versions ?? []).map((v) => ({
        id: v.id,
        url: v.url,
        version: v.version,
        docDate: dateOnlyStr(v.docDate),
        isLatest: v.isLatest,
        note: v.note,
        registeredBy: v.registeredBy.name,
        registeredAt: fmtDateTime(v.registeredAt),
      })),
    });
    const docs: DocPanelItem[] = [
      ...templates.map((t) => toView(docBy.get(t.id), t)),
      // テンプレートが無効になった資料・追加資料
      ...order.documents.filter((d) => !d.templateId || !templates.some((t) => t.id === d.templateId)).map((d) => toView(d)),
    ];
    content = (
      <Card title="資料" actions={access.edit ? <LinkButton href={`/orders/${id}/edit?step=4`} variant="secondary">資料チェックリストを編集</LinkButton> : null}>
        <DocumentsPanel docs={docs} canAdd={access.addDocumentVersion} action={addDocumentVersionAction.bind(null, id)} issued={!["DRAFT", "RETURNED"].includes(order.status)} />
      </Card>
    );
  } else if (tab === "unresolved") {
    content = (
      <div className="flex flex-col gap-4">
        <Card title={`未確定項目（未確定 ${openItems.length}件／期限超過 ${overdueItems.length}件）`}>
          <UnresolvedList
            items={unresolvedViews(order, user, access)}
            users={users}
            actions={{ update: updateUnresolvedAction, resolve: resolveUnresolvedAction, withdraw: withdrawUnresolvedAction }}
            todayStr={todayStr()}
            salesUserId={order.salesUserId}
            techUserId={order.techUserId}
          />
        </Card>
        {access.manageUnresolved && (
          <Card title="未確定項目を追加">
            {order.status === "SPEC_FIXED" && (
              <div className="mb-2">
                <Alert kind="warn">仕様確定後に未確定項目を追加すると、ステータスは「仕様確定待ち」に戻ります。</Alert>
              </div>
            )}
            <NewUnresolvedForm action={createUnresolvedAction.bind(null, id)} users={users} salesUserId={order.salesUserId} techUserId={order.techUserId} defaultDue={defaultDueStr()} />
          </Card>
        )}
      </div>
    );
  } else if (tab === "tasks") {
    const types = await prisma.taskType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    const tasks: TaskView[] = order.tasks.map((t) => ({
      id: t.id,
      typeName: t.taskType.name,
      content: t.content,
      assigneeId: t.assigneeId,
      assigneeName: t.assignee.name,
      dueDate: t.dueDate ? dateOnlyStr(t.dueDate) : null,
      status: t.status,
      createdByName: t.createdBy.name,
      createdAt: fmtDateTime(t.createdAt),
      overdue: t.status !== "DONE" && isOverdue(t.dueDate),
      canUpdate: canUpdateTask(user, access, t),
    }));
    content = (
      <div className="flex flex-col gap-4">
        <Card title="タスク">
          <TaskList tasks={tasks} users={users} update={updateTaskAction} />
        </Card>
        {access.createTask && (
          <Card title="タスクを登録（他部署への依頼も含む）">
            <NewTaskForm
              action={createTaskAction.bind(null, id)}
              types={types.map((t) => ({ id: t.id, name: t.name, defaultAssignee: t.defaultAssignee, description: t.description }))}
              users={users}
              salesUserId={order.salesUserId}
              techUserId={order.techUserId}
            />
          </Card>
        )}
      </div>
    );
  } else if (tab === "messages") {
    const messages: MessageView[] = order.messages.map((m) => ({
      id: m.id,
      kind: m.kind,
      body: m.body,
      counterpart: m.counterpart,
      channel: m.channel,
      occurredAt: m.occurredAt ? fmtDateTime(m.occurredAt) : null,
      authorName: m.author.name,
      createdAt: fmtDateTime(m.createdAt),
      mentions: m.mentions.map((u) => u.name),
      unresolvedTitle: m.unresolvedItem?.title ?? null,
      taskLabel: m.task ? `${m.task.taskType.name}：${m.task.content.slice(0, 20)}` : null,
      mine: m.author.id === user.id,
    }));
    content = (
      <div className="flex flex-col gap-4">
        <Card title="やり取り">
          <MessageThread messages={messages} />
        </Card>
        {access.postMessage && (
          <Card title="投稿する">
            <MessageForm
              action={postMessageAction.bind(null, id)}
              users={users}
              unresolvedItems={order.unresolvedItems.map((i) => ({ id: i.id, name: i.title }))}
              tasks={order.tasks.map((t) => ({ id: t.id, name: `${t.taskType.name}：${t.content.slice(0, 20)}` }))}
            />
          </Card>
        )}
      </div>
    );
  } else if (tab === "history") {
    content = (
      <div className="flex flex-col gap-4">
        <Card title="ステータス履歴">
          <Table>
            <thead>
              <tr>
                <th>日時</th>
                <th>変更前</th>
                <th>変更後</th>
                <th>操作者</th>
                <th>コメント</th>
              </tr>
            </thead>
            <tbody>
              {order.statusHistories.map((h) => (
                <tr key={h.id}>
                  <td>{fmtDateTime(h.createdAt)}</td>
                  <td>{h.fromStatus ? orderStatusLabel[h.fromStatus] : "―"}</td>
                  <td>
                    <StatusBadge status={h.toStatus} />
                  </td>
                  <td>{h.actor?.name ?? "（自動）"}</td>
                  <td className="max-w-md whitespace-pre-wrap">{h.comment}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {!!order.aiRuns.length && (
          <Card title="AI下書きの実行記録（最新5件）">
            <Table>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>モデル</th>
                  <th>入力</th>
                  <th>トークン（入力／出力）</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {order.aiRuns.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDateTime(a.createdAt)}</td>
                    <td>{a.model}</td>
                    <td className="max-w-xs whitespace-normal">
                      {((a.inputFiles as { name: string }[] | null) ?? []).map((f) => f.name).join("、")}
                      {a.inputTextChars ? `（テキスト${a.inputTextChars}文字）` : ""}
                    </td>
                    <td>
                      {a.promptTokens ?? "―"}／{a.outputTokens ?? "―"}
                    </td>
                    <td>{a.status === "SUCCEEDED" ? (a.adoptedAt ? "採用済み" : "未採用") : `失敗：${a.error ?? ""}`}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {order.orderNumber}
            <StatusBadge status={order.status} />
            {openItems.length > 0 && <Badge className="bg-amber-50 text-amber-800 ring-amber-300">未確定 {openItems.length}件</Badge>}
            {overdueItems.length + overdueTasks.length > 0 && <Badge className="bg-red-600 text-white ring-red-600">期限超過 {overdueItems.length + overdueTasks.length}件</Badge>}
          </span>
        }
        sub={
          <span>
            {order.customer?.name ? `${order.customer.name}　` : ""}
            {order.title ?? "（件名未入力）"}
            {order.siteName ? `／${order.siteName}` : ""}
          </span>
        }
        actions={
          <>
            {access.edit && <LinkButton href={`/orders/${id}/edit?step=1`} variant="secondary">作成手順で編集</LinkButton>}
            {access.issue && <LinkButton href={`/orders/${id}/edit?step=6`}>{order.status === "RETURNED" ? "再発令へ" : "確認・発令へ"}</LinkButton>}
          </>
        }
      />
      {sp.issued && (
        <div className="mb-3">
          <Alert kind="success">発令しました。技術受付に通知しました。</Alert>
        </div>
      )}
      {order.status === "RETURNED" && lastReturn && (
        <div className="mb-3">
          <Alert kind="error" title={`差し戻されました（${fmtDateTime(lastReturn.createdAt)}　${lastReturn.actor?.name ?? ""}）`}>
            <div className="whitespace-pre-wrap">{lastReturn.comment}</div>
          </Alert>
        </div>
      )}
      {order.orderDocType === "LETTER_OF_INTENT" && !["COMPLETED", "CANCELLED"].includes(order.status) && (
        <div className="mb-3">
          <Alert kind="warn">内示書で発令されたオーダーです。注文書の入手状況を確認してください。</Alert>
        </div>
      )}
      {(access.accept || access.returnOrder || access.assignTech || access.complete || access.cancel) && (
        <div className="mb-4">
          <StatusActions
            access={access}
            techUsers={techUsers}
            currentTechUserId={order.techUserId}
            openCount={openItems.length}
            actions={{
              accept: acceptAction.bind(null, id),
              returnOrder: returnAction.bind(null, id),
              assignTech: assignTechAction.bind(null, id),
              complete: completeAction.bind(null, id),
              cancel: cancelAction.bind(null, id),
            }}
          />
        </div>
      )}
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="タブ">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={`/orders/${id}?tab=${k}`}
            scroll={false}
            aria-current={tab === k ? "page" : undefined}
            className={cx("-mb-px border-b-2 px-3 py-2 whitespace-nowrap", tab === k ? "border-brand-600 font-semibold text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}
          >
            {label}
            {tabCount[k] && <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-xs">{tabCount[k]}</span>}
          </Link>
        ))}
      </nav>
      {content}
    </>
  );
}
