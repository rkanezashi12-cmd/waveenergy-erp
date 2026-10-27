-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SALES', 'SALES_MANAGER', 'TECH_RECEPTION', 'TECH', 'VIEWER', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmailPreference" AS ENUM ('ALL', 'DIGEST_ONLY', 'NONE');

-- CreateEnum
CREATE TYPE "ResponsibleType" AS ENUM ('SALES', 'TECH');

-- CreateEnum
CREATE TYPE "TaskDefaultAssignee" AS ENUM ('SALES', 'TECH', 'NONE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'ACCEPT_PENDING', 'RETURNED', 'SPEC_PENDING', 'SPEC_FIXED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NumberSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('FIXED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "OrderDocType" AS ENUM ('PURCHASE_ORDER', 'LETTER_OF_INTENT');

-- CreateEnum
CREATE TYPE "SpecInputType" AS ENUM ('TEXT', 'TEXTAREA', 'TEXTAREA_NONE', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT');

-- CreateEnum
CREATE TYPE "ValueState" AS ENUM ('FILLED', 'UNRESOLVED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "DocRequirement" AS ENUM ('REQUIRED', 'CONDITIONAL', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "DocState" AS ENUM ('ATTACHED', 'NOT_OBTAINED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "UnresolvedTarget" AS ENUM ('SPEC_FIELD', 'DOCUMENT', 'DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "ConfirmTarget" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "DesignImpact" AS ENUM ('CAN_START', 'PARTIAL_START', 'CANNOT_START');

-- CreateEnum
CREATE TYPE "UnresolvedStatus" AS ENUM ('OPEN', 'CHECKING', 'RESOLVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('INTERNAL', 'CUSTOMER_RECORD');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('PHONE', 'EMAIL', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_ISSUED', 'ORDER_ACCEPTED', 'ORDER_RETURNED', 'TECH_ASSIGNED', 'UNRESOLVED_ASSIGNED', 'TASK_ASSIGNED', 'UNRESOLVED_RESOLVED', 'DOCUMENT_VERSION', 'SPEC_FIXED', 'MENTION', 'ACCEPT_REMINDER', 'DAILY_DIGEST');

-- CreateEnum
CREATE TYPE "EmailResult" AS ENUM ('NOT_REQUIRED', 'SAVED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "MailTransportType" AS ENUM ('DB', 'SMTP', 'GRAPH');

-- CreateEnum
CREATE TYPE "YearFormat" AS ENUM ('YYYY', 'YY', 'NONE');

-- CreateEnum
CREATE TYPE "ResetUnit" AS ENUM ('NONE', 'YEAR', 'FISCAL_YEAR');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "departmentId" TEXT,
    "roles" "Role"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "emailPreference" "EmailPreference" NOT NULL DEFAULT 'ALL',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "standardLeadTimeMonths" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecFieldTemplate" (
    "id" TEXT NOT NULL,
    "productCategoryId" TEXT,
    "label" TEXT NOT NULL,
    "inputType" "SpecInputType" NOT NULL DEFAULT 'TEXTAREA',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[],
    "description" TEXT,
    "defaultResponsibleType" "ResponsibleType" NOT NULL DEFAULT 'SALES',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecFieldTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "productCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requirement" "DocRequirement" NOT NULL DEFAULT 'OPTIONAL',
    "description" TEXT,
    "defaultResponsibleType" "ResponsibleType" NOT NULL DEFAULT 'SALES',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultAssignee" "TaskDefaultAssignee" NOT NULL DEFAULT 'SALES',
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberingRule" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "prefix" TEXT NOT NULL DEFAULT 'WE-',
    "yearFormat" "YearFormat" NOT NULL DEFAULT 'YYYY',
    "separator" TEXT NOT NULL DEFAULT '-',
    "digits" INTEGER NOT NULL DEFAULT 4,
    "resetUnit" "ResetUnit" NOT NULL DEFAULT 'YEAR',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberingCounter" (
    "ruleId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberingCounter_pkey" PRIMARY KEY ("ruleId","periodKey")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "acceptReminderBusinessDays" INTEGER NOT NULL DEFAULT 2,
    "digestDueSoonDays" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "numberSource" "NumberSource" NOT NULL DEFAULT 'AUTO',
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "productCategoryId" TEXT,
    "customerId" TEXT,
    "siteName" TEXT,
    "endUser" TEXT,
    "title" TEXT,
    "quantity" DECIMAL(12,2),
    "quantityUnit" TEXT,
    "salesUserId" TEXT NOT NULL,
    "salesDepartmentId" TEXT,
    "techUserId" TEXT,
    "contractDeliveryDate" DATE,
    "deliveryType" "DeliveryType",
    "deliveryFixDueDate" DATE,
    "shortLeadTime" BOOLEAN NOT NULL DEFAULT false,
    "shortLeadConsulted" BOOLEAN,
    "shortLeadNote" TEXT,
    "orderDocType" "OrderDocType",
    "quoteNumber" TEXT,
    "inquiryNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "firstIssuedAt" TIMESTAMP(3),
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "unresolvedCountAtIssue" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "specFixedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastAcceptReminderAt" TIMESTAMP(3),
    "plannedDrawingDate" DATE,
    "actualDrawingDate" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecValue" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "value" TEXT,
    "state" "ValueState",
    "naReason" TEXT,
    "aiDerived" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDocument" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT,
    "state" "DocState",
    "naReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "docDate" DATE NOT NULL,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "registeredById" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnresolvedItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "targetType" "UnresolvedTarget" NOT NULL,
    "specTemplateId" TEXT,
    "documentId" TEXT,
    "title" TEXT NOT NULL,
    "knownInfo" TEXT,
    "confirmTarget" "ConfirmTarget" NOT NULL DEFAULT 'CUSTOMER',
    "responsibleType" "ResponsibleType" NOT NULL DEFAULT 'SALES',
    "assigneeId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "designImpact" "DesignImpact" NOT NULL DEFAULT 'PARTIAL_START',
    "status" "UnresolvedStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedDate" DATE,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnresolvedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "dueDate" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'INTERNAL',
    "body" TEXT NOT NULL,
    "counterpart" TEXT,
    "channel" "ContactChannel",
    "occurredAt" TIMESTAMP(3),
    "unresolvedItemId" TEXT,
    "taskId" TEXT,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actorId" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "orderId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "emailResult" "EmailResult" NOT NULL DEFAULT 'NOT_REQUIRED',
    "emailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundEmail" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "transport" "MailTransportType" NOT NULL,
    "result" "EmailResult" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "inputFiles" JSONB NOT NULL,
    "inputTextChars" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "outputJson" JSONB,
    "adoption" JSONB,
    "adoptedAt" TIMESTAMP(3),
    "status" "AiRunStatus" NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_NotificationGroupDepartments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_NotificationGroupDepartments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CategoryReception" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CategoryReception_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_NotificationGroupUsers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_NotificationGroupUsers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_CategoryNotificationGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CategoryNotificationGroups_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_MessageMentions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_MessageMentions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_code_key" ON "ProductCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationGroup_name_key" ON "NotificationGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TaskType_name_key" ON "TaskType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_salesUserId_idx" ON "Order"("salesUserId");

-- CreateIndex
CREATE INDEX "Order_techUserId_idx" ON "Order"("techUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecValue_orderId_templateId_key" ON "SpecValue"("orderId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderDocument_orderId_templateId_key" ON "OrderDocument"("orderId", "templateId");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_isLatest_idx" ON "DocumentVersion"("documentId", "isLatest");

-- CreateIndex
CREATE INDEX "UnresolvedItem_orderId_status_idx" ON "UnresolvedItem"("orderId", "status");

-- CreateIndex
CREATE INDEX "UnresolvedItem_assigneeId_status_idx" ON "UnresolvedItem"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_orderId_idx" ON "Task"("orderId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Message_orderId_createdAt_idx" ON "Message"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "StatusHistory_orderId_createdAt_idx" ON "StatusHistory"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "OutboundEmail_createdAt_idx" ON "OutboundEmail"("createdAt");

-- CreateIndex
CREATE INDEX "AiRun_orderId_createdAt_idx" ON "AiRun"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "_NotificationGroupDepartments_B_index" ON "_NotificationGroupDepartments"("B");

-- CreateIndex
CREATE INDEX "_CategoryReception_B_index" ON "_CategoryReception"("B");

-- CreateIndex
CREATE INDEX "_NotificationGroupUsers_B_index" ON "_NotificationGroupUsers"("B");

-- CreateIndex
CREATE INDEX "_CategoryNotificationGroups_B_index" ON "_CategoryNotificationGroups"("B");

-- CreateIndex
CREATE INDEX "_MessageMentions_B_index" ON "_MessageMentions"("B");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecFieldTemplate" ADD CONSTRAINT "SpecFieldTemplate_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberingCounter" ADD CONSTRAINT "NumberingCounter_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "NumberingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_salesUserId_fkey" FOREIGN KEY ("salesUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_salesDepartmentId_fkey" FOREIGN KEY ("salesDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_techUserId_fkey" FOREIGN KEY ("techUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecValue" ADD CONSTRAINT "SpecValue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecValue" ADD CONSTRAINT "SpecValue_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SpecFieldTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDocument" ADD CONSTRAINT "OrderDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDocument" ADD CONSTRAINT "OrderDocument_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OrderDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnresolvedItem" ADD CONSTRAINT "UnresolvedItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnresolvedItem" ADD CONSTRAINT "UnresolvedItem_specTemplateId_fkey" FOREIGN KEY ("specTemplateId") REFERENCES "SpecFieldTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnresolvedItem" ADD CONSTRAINT "UnresolvedItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OrderDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnresolvedItem" ADD CONSTRAINT "UnresolvedItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnresolvedItem" ADD CONSTRAINT "UnresolvedItem_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnresolvedItem" ADD CONSTRAINT "UnresolvedItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "TaskType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_unresolvedItemId_fkey" FOREIGN KEY ("unresolvedItemId") REFERENCES "UnresolvedItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "OutboundEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NotificationGroupDepartments" ADD CONSTRAINT "_NotificationGroupDepartments_A_fkey" FOREIGN KEY ("A") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NotificationGroupDepartments" ADD CONSTRAINT "_NotificationGroupDepartments_B_fkey" FOREIGN KEY ("B") REFERENCES "NotificationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryReception" ADD CONSTRAINT "_CategoryReception_A_fkey" FOREIGN KEY ("A") REFERENCES "ProductCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryReception" ADD CONSTRAINT "_CategoryReception_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NotificationGroupUsers" ADD CONSTRAINT "_NotificationGroupUsers_A_fkey" FOREIGN KEY ("A") REFERENCES "NotificationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NotificationGroupUsers" ADD CONSTRAINT "_NotificationGroupUsers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryNotificationGroups" ADD CONSTRAINT "_CategoryNotificationGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "NotificationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryNotificationGroups" ADD CONSTRAINT "_CategoryNotificationGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "ProductCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MessageMentions" ADD CONSTRAINT "_MessageMentions_A_fkey" FOREIGN KEY ("A") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MessageMentions" ADD CONSTRAINT "_MessageMentions_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
