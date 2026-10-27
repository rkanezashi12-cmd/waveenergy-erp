// メール送信。送信方式は環境変数 MAIL_TRANSPORT で切り替える（SPEC §4.8）
//   db    : 実送信せずDBに保存（デモ）。「送信メール履歴」画面で確認する
//   smtp  : SMTP で送信（デモで任意）
//   graph : Microsoft Graph API で共有メールボックスから送信（本番。M9で検証）
import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import type { EmailResult, MailTransportType } from "@/generated/prisma/enums";

export type MailInput = { to: string; subject: string; body: string };

const FOOTER = "\n\n――\nこのメールはオーダー発令・仕様確定管理アプリから自動送信されています。";

async function sendSmtp(mail: MailInput) {
  const transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
  });
  await transporter.sendMail({ from: env.mailFrom, to: mail.to, subject: mail.subject, text: mail.body });
}

let graphToken: { value: string; expiresAt: number } | null = null;

async function getGraphToken() {
  if (graphToken && graphToken.expiresAt > Date.now() + 60_000) return graphToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${env.graph.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.graph.clientId,
      client_secret: env.graph.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph のトークン取得に失敗しました（HTTP ${res.status}）`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  graphToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return graphToken.value;
}

async function sendGraph(mail: MailInput) {
  const token = await getGraphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.graph.sender)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          body: { contentType: "Text", content: mail.body },
          toRecipients: [{ emailAddress: { address: mail.to } }],
        },
        saveToSentItems: false,
      }),
    },
  );
  if (!res.ok) throw new Error(`Graph のメール送信に失敗しました（HTTP ${res.status}）`);
}

/** メールを送信（または保存）し、送信メール履歴に記録する */
export async function sendMail(mail: MailInput): Promise<{ id: string; result: EmailResult }> {
  const transportType: MailTransportType =
    env.mailTransport === "smtp" ? "SMTP" : env.mailTransport === "graph" ? "GRAPH" : "DB";
  const body = mail.body + FOOTER;
  let result: EmailResult = "SAVED";
  let error: string | null = null;
  try {
    if (transportType === "SMTP") {
      await sendSmtp({ ...mail, body });
      result = "SENT";
    } else if (transportType === "GRAPH") {
      await sendGraph({ ...mail, body });
      result = "SENT";
    }
  } catch (e) {
    result = "FAILED";
    error = e instanceof Error ? e.message : String(e);
    // 宛先・本文はログに出さない（SPEC §8）
    console.error(JSON.stringify({ severity: "ERROR", message: "メール送信に失敗しました", transport: transportType, error }));
  }
  const rec = await prisma.outboundEmail.create({
    data: { to: mail.to, subject: mail.subject, body, transport: transportType, result, error },
  });
  return { id: rec.id, result };
}
