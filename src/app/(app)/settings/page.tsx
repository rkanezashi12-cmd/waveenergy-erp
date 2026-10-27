import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { env } from "@/lib/env";
import { roleLabel } from "@/lib/labels";
import { Card, DL, LinkButton, PageHeader } from "@/components/ui";
import { EmailPreferenceForm } from "./forms";

export const metadata: Metadata = { title: "個人設定" };

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="個人設定" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="アカウント">
          <DL
            items={[
              ["氏名", user.name],
              ["メールアドレス", user.email],
              ["部署", user.departmentName],
              ["ロール", user.roles.map((r) => roleLabel[r]).join("、")],
            ]}
          />
          <p className="mt-3 text-xs text-slate-500">氏名・部署・ロールの変更は管理者に依頼してください。</p>
          {env.passwordLoginEnabled && (
            <div className="mt-3">
              <LinkButton href="/change-password" variant="secondary">
                パスワードを変更
              </LinkButton>
            </div>
          )}
        </Card>
        <Card title="メール通知">
          <EmailPreferenceForm current={user.emailPreference} />
        </Card>
      </div>
    </>
  );
}
