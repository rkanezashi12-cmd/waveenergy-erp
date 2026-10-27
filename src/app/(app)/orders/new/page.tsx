import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { todayStr } from "@/lib/dates";
import { Card, ForbiddenView, PageHeader } from "@/components/ui";
import { BasicForm } from "../_components/basic-form";
import { Stepper } from "../_components/stepper";
import { basicFormOptions } from "../_lib/view";
import { createOrderAction } from "../actions";
import { getSystemSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "オーダー作成" };

export default async function NewOrderPage() {
  const user = await requireUser();
  if (!can.createOrder(user) && !can.manualNumber(user)) return <ForbiddenView />;
  const [opts, setting] = await Promise.all([basicFormOptions(), getSystemSetting()]);
  return (
    <>
      <PageHeader title="オーダー作成" />
      <Stepper current={1} aiEnabled={setting.aiEnabled} />
      <Card title="①基本情報・発番">
        <BasicForm
          action={createOrderAction}
          mode="create"
          {...opts}
          canManualNumber={can.manualNumber(user)}
          todayStr={todayStr()}
          defaults={{
            productCategoryId: "",
            customerName: "",
            siteName: "",
            endUser: "",
            title: "",
            quantity: "",
            quantityUnit: "面",
            salesUserId: opts.salesUsers.some((u) => u.id === user.id) ? user.id : opts.salesUsers[0]?.id ?? "",
            salesDepartmentId: user.departmentId ?? "",
            contractDeliveryDate: "",
            deliveryType: "FIXED",
            deliveryFixDueDate: "",
            shortLeadConsulted: "",
            shortLeadNote: "",
            orderDocType: "PURCHASE_ORDER",
            quoteNumber: "",
            inquiryNumber: "",
          }}
        />
      </Card>
    </>
  );
}
