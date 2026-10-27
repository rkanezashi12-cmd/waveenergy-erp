import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { Card, ForbiddenView } from "@/components/ui";
import { AdminHeader } from "../_shared";
import { SettingsForm } from "./forms";

export const metadata: Metadata = { title: "システム設定" };

export default async function SettingsPage() {
  const user = await requireUser();
  if (!can.admin(user)) return <ForbiddenView />;
  const setting = await prisma.systemSetting.findUnique({ where: { id: "default" } });
  return (
    <>
      <AdminHeader title="システム設定" />
      <Card title="設定" actions={setting && <span className="text-xs text-slate-500">最終更新：{fmtDateTime(setting.updatedAt)}</span>}>
        <SettingsForm
          setting={{
            aiEnabled: setting?.aiEnabled ?? true,
            acceptReminderBusinessDays: setting?.acceptReminderBusinessDays ?? 2,
            digestDueSoonDays: setting?.digestDueSoonDays ?? 3,
          }}
        />
      </Card>
    </>
  );
}
