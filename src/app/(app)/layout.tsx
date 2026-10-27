import { requireUser } from "@/lib/session";
import { signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { roleLabel } from "@/lib/labels";
import { AppNav, type NavItem } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  const items: NavItem[] = [
    { href: "/", label: "ホーム" },
    { href: "/orders", label: "オーダー一覧" },
  ];
  if (can.createOrder(user)) items.push({ href: "/orders/new", label: "オーダー作成" });
  if (can.viewReports(user)) {
    items.push({ href: "/reports/unresolved", label: "未確定項目レポート" });
    items.push({ href: "/reports/quality", label: "発令品質レポート" });
  }
  items.push({ href: "/notifications", label: "通知", badge: unread });
  if (env.isDemo) items.push({ href: "/mails", label: "送信メール履歴" });
  if (can.admin(user)) items.push({ href: "/admin", label: "管理" });
  items.push({ href: "/settings", label: "個人設定" });

  const logout = (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit" className="text-slate-200 underline hover:text-white">
        ログアウト
      </button>
    </form>
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppNav items={items} user={{ name: user.name, roles: user.roles.map((r) => roleLabel[r]).join("・") }} logout={logout} />
      <main className="min-w-0 flex-1 p-4 lg:p-6">
        {env.isDemo && (
          <div className="mb-3 rounded bg-amber-100 px-3 py-1 text-xs text-amber-900">デモ環境：架空のデータのみを登録してください。</div>
        )}
        {children}
      </main>
    </div>
  );
}
