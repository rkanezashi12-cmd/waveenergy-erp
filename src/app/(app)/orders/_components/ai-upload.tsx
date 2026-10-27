"use client";
// AI下書き：ファイル・テキストの入力と実行
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field } from "@/components/ui";

export function AiUpload({ orderId }: { orderId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [seconds, setSeconds] = useState(0);
  const router = useRouter();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        setSeconds(0);
        const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
        start(async () => {
          try {
            const res = await fetch(`/api/orders/${orderId}/ai-draft`, { method: "POST", body: fd });
            const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
            if (!json?.ok) setError(json?.error ?? "AIによる読み取りに失敗しました。");
            else router.refresh();
          } catch {
            setError("通信に失敗しました。時間をおいて再度お試しください。");
          } finally {
            clearInterval(timer);
          }
        });
      }}
    >
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="ファイル（PDF・画像・メール .eml）" hint="見積書・顧客仕様書・メールなど。5ファイル・1ファイル10MBまで。ファイルは30日で自動的に削除されます。">
        <input type="file" name="files" multiple accept=".pdf,.png,.jpg,.jpeg,.eml,application/pdf,image/png,image/jpeg,message/rfc822" className="input" disabled={pending} />
      </Field>
      <Field label="テキストの貼り付け（メール本文など）">
        <textarea name="text" rows={6} className="input" disabled={pending} placeholder="メール本文や仕様の記載を貼り付けます" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "AIが読み取り中です…" : "AI下書きを作成"}
        </Button>
        {pending && (
          <span className="text-slate-600" role="status">
            処理中（{seconds}秒）。最大60秒ほどかかります。この画面のままお待ちください。
          </span>
        )}
      </div>
    </form>
  );
}
