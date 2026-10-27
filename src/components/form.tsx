"use client";
// フォーム送信の共通部品（サーバーアクションの結果表示・項目エラー・送信中表示）
import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/errors";
import { Alert, Button, cx } from "@/components/ui";

type AnyResult = ActionResult<unknown> | null;
const DisclosureCtx = createContext<{ close: (message?: string) => void } | null>(null);
type Ctx = { state: AnyResult; pending: boolean };
const FormCtx = createContext<Ctx>({ state: null, pending: false });

export function useFormResult() {
  return useContext(FormCtx);
}

/** 項目エラーの取得 */
export function useFieldError(name: string): string | undefined {
  const { state } = useContext(FormCtx);
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

export function FieldError({ name }: { name: string }) {
  const e = useFieldError(name);
  return e ? <div className="text-xs font-medium text-red-600">{e}</div> : null;
}

export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  resetOnSuccess,
  showSuccess = true,
  confirmMessage,
  id,
  closeOnSuccess = true,
}: {
  action: (fd: FormData) => Promise<AnyResult>;
  children: ReactNode;
  className?: string;
  onSuccess?: (r: AnyResult) => void;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  confirmMessage?: string;
  id?: string;
  closeOnSuccess?: boolean;
}) {
  const [state, setState] = useState<AnyResult>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const disclosure = useContext(DisclosureCtx);
  return (
    <form
      id={id}
      ref={ref}
      className={className}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const fd = new FormData(e.currentTarget, submitter);
        start(async () => {
          const r = await action(fd);
          setState(r);
          if (r?.ok) {
            if (resetOnSuccess) ref.current?.reset();
            onSuccess?.(r);
            router.refresh();
            // 開閉パネルの中のフォームは、成功したら閉じる（警告があるときは内容を見せるため閉じない）
            if (closeOnSuccess && !r.warnings?.length) disclosure?.close(r.message);
          }
        });
      }}
    >
      <FormCtx.Provider value={{ state, pending }}>
        <FormMessages showSuccess={showSuccess} />
        {children}
      </FormCtx.Provider>
    </form>
  );
}

function FormMessages({ showSuccess }: { showSuccess: boolean }) {
  const { state } = useFormResult();
  if (!state) return null;
  if (!state.ok)
    return (
      <div className="mb-3">
        <Alert kind="error">{state.error}</Alert>
      </div>
    );
  return (
    <>
      {showSuccess && state.message && (
        <div className="mb-3">
          <Alert kind="success">{state.message}</Alert>
        </div>
      )}
      {!!state.warnings?.length && (
        <div className="mb-3">
          <Alert kind="warn" title="確認してください">
            <ul className="list-disc pl-5">
              {state.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
    </>
  );
}

export function SubmitButton({
  children,
  pendingText = "処理中…",
  ...props
}: React.ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormResult();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}

/** 開閉できるパネル（ダイアログの代わりに使う）。中のフォームが成功すると閉じる */
export function Disclosure({
  label,
  children,
  variant = "secondary",
  className,
  defaultOpen = false,
}: {
  label: ReactNode;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <div className={cx(className)}>
      {!open && flash && (
        <div className="mb-2">
          <Alert kind="success">{flash}</Alert>
        </div>
      )}
      {!open && (
        <Button
          type="button"
          variant={variant}
          onClick={() => {
            setFlash(null);
            setOpen(true);
          }}
        >
          {label}
        </Button>
      )}
      {open && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <DisclosureCtx.Provider
            value={{
              close: (message) => {
                setFlash(message ?? null);
                setOpen(false);
              },
            }}
          >{children}</DisclosureCtx.Provider>
          <div className="mt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              閉じる
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
