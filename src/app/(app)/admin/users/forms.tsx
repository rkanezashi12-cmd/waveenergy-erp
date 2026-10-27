"use client";
import type { EmailPreference, Role } from "@/generated/prisma/enums";
import { ActionForm, FieldError, SubmitButton } from "@/components/form";
import { Field } from "@/components/ui";
import { emailPreferenceLabel, roleLabel } from "@/lib/labels";
import { useCloseEdit } from "../_edit-row";
import { createUser, resetPassword, updateUser } from "./actions";

type DepartmentOption = { id: string; name: string; active: boolean };
type UserRow = {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  roles: Role[];
  active: boolean;
  emailPreference: EmailPreference;
};

const ROLES = Object.keys(roleLabel) as Role[];
const EMAIL_PREFS = Object.keys(emailPreferenceLabel) as EmailPreference[];

export function UserForm({ user, departments, isSelf }: { user?: UserRow; departments: DepartmentOption[]; isSelf?: boolean }) {
  // 無効な部署は、現在の所属である場合だけ選択肢に出す
  const deptOptions = departments.filter((d) => d.active || d.id === user?.departmentId);
  const close = useCloseEdit();
  return (
    <ActionForm action={user ? updateUser : createUser} resetOnSuccess={!user} onSuccess={() => close?.()} className="grid gap-3">
      {user && <input type="hidden" name="id" value={user.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="氏名" required>
          <input name="name" className="input" defaultValue={user?.name} autoComplete="off" />
          <FieldError name="name" />
        </Field>
        <Field label="メールアドレス" required hint="ログインに使います（小文字に揃えて保存します）">
          <input name="email" type="email" className="input" defaultValue={user?.email} autoComplete="off" />
          <FieldError name="email" />
        </Field>
        <Field label="部署">
          <select name="departmentId" className="input" defaultValue={user?.departmentId ?? ""}>
            <option value="">（未設定）</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.active ? "" : "（無効）"}
              </option>
            ))}
          </select>
          <FieldError name="departmentId" />
        </Field>
      </div>
      <Field label="ロール（複数選択可）" required>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="roles" value={r} defaultChecked={user ? user.roles.includes(r) : false} />
              {roleLabel[r]}
            </label>
          ))}
        </div>
        <FieldError name="roles" />
        {isSelf && <div className="text-xs text-slate-500">自分自身の管理者ロールは外せません。</div>}
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="メール通知">
          <select name="emailPreference" className="input" defaultValue={user?.emailPreference ?? "ALL"}>
            {EMAIL_PREFS.map((p) => (
              <option key={p} value={p}>
                {emailPreferenceLabel[p]}
              </option>
            ))}
          </select>
        </Field>
        {user ? (
          <div className="pb-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" defaultChecked={user.active} disabled={isSelf && user.active} /> 有効
            </label>
            {/* 自分自身は無効にできないため、チェックを外せないようにして値を送る */}
            {isSelf && user.active && <input type="hidden" name="active" value="on" />}
            <FieldError name="active" />
          </div>
        ) : (
          <span />
        )}
        <SubmitButton>{user ? "保存" : "登録して初期パスワードを発行"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ResetPasswordForm({ user }: { user: { id: string; name: string } }) {
  return (
    <ActionForm
      action={resetPassword}
      closeOnSuccess={false}
      confirmMessage={`${user.name}さんのパスワードを再設定します。よろしいですか？`}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={user.id} />
      <p className="text-sm text-slate-600">新しい初期パスワードを発行します。本人は次回ログイン時にパスワードの変更を求められます。</p>
      <div>
        <SubmitButton variant="danger">パスワードを再設定</SubmitButton>
      </div>
    </ActionForm>
  );
}
