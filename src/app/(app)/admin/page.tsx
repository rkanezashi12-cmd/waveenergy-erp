import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Card, ForbiddenView, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "管理" };

const MENU: { href: string; label: string; desc: string }[] = [
  { href: "/admin/users", label: "ユーザー", desc: "アカウントの登録（招待制）、ロール・部署・有効／無効、パスワード再設定" },
  { href: "/admin/departments", label: "部署", desc: "部署名・並び順・上位部署（営業管理職の閲覧範囲）" },
  { href: "/admin/customers", label: "顧客", desc: "顧客名・備考" },
  { href: "/admin/categories", label: "製品区分", desc: "標準納期（短納期判定）、技術受付の通知先、通知グループ" },
  { href: "/admin/spec-templates", label: "要求仕様書テンプレート", desc: "共通項目・製品区分別項目の追加・変更・並べ替え" },
  { href: "/admin/doc-templates", label: "資料チェックリストテンプレート", desc: "製品区分ごとの必要資料（必須／条件付き／任意）" },
  { href: "/admin/task-types", label: "タスク種別", desc: "種別と既定担当（役割分担）" },
  { href: "/admin/notification-groups", label: "通知グループ", desc: "発令・仕様確定などを知らせる関係部門" },
  { href: "/admin/numbering", label: "採番ルール", desc: "オーダー番号の接頭辞・年の表記・桁数・リセット単位" },
  { href: "/admin/settings", label: "システム設定", desc: "AI機能のオン／オフ、受入催促の日数" },
  { href: "/admin/audit-logs", label: "監査ログ", desc: "ログイン・ステータス変更・各種変更の記録" },
];

export default async function AdminPage() {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  return (
    <>
      <PageHeader title="管理" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MENU.map((m) => (
          <Link key={m.href} href={m.href} className="block">
            <Card className="h-full hover:border-brand-600">
              <div className="font-semibold text-brand-700">{m.label}</div>
              <div className="mt-1 text-slate-600">{m.desc}</div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
