// 環境固有値はすべて環境変数から読む（SPEC §0-6）。既定値はローカル開発用。

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const env = {
  /** demo / production */
  get appEnv() {
    return process.env.APP_ENV === "production" ? "production" : "demo";
  },
  get isDemo() {
    return this.appEnv === "demo";
  },
  /** 通知メールのリンクに使うアプリのURL */
  get appBaseUrl() {
    return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  /** パスワードログインを有効にするか（本番では false） */
  get passwordLoginEnabled() {
    return bool(process.env.AUTH_PASSWORD_LOGIN, true);
  },
  /** Microsoft Entra ID ログインが設定されているか */
  get entraEnabled() {
    return Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET);
  },
  /** メール送信方式：db / smtp / graph */
  get mailTransport(): "db" | "smtp" | "graph" {
    const v = (process.env.MAIL_TRANSPORT ?? "db").toLowerCase();
    return v === "smtp" || v === "graph" ? v : "db";
  },
  get mailFrom() {
    return process.env.MAIL_FROM ?? "no-reply@example.com";
  },
  smtp: {
    get host() {
      return process.env.SMTP_HOST ?? "";
    },
    get port() {
      return Number(process.env.SMTP_PORT ?? 587);
    },
    get secure() {
      return bool(process.env.SMTP_SECURE, false);
    },
    get user() {
      return process.env.SMTP_USER ?? "";
    },
    get password() {
      return process.env.SMTP_PASSWORD ?? "";
    },
  },
  graph: {
    get tenantId() {
      return process.env.GRAPH_TENANT_ID ?? "";
    },
    get clientId() {
      return process.env.GRAPH_CLIENT_ID ?? "";
    },
    get clientSecret() {
      return process.env.GRAPH_CLIENT_SECRET ?? "";
    },
    /** 送信元の共有メールボックス */
    get sender() {
      return process.env.GRAPH_SENDER ?? "";
    },
  },
  /** AIの呼び出し先：vertex / mock */
  get aiProvider(): "vertex" | "mock" {
    return (process.env.AI_PROVIDER ?? "vertex").toLowerCase() === "mock" ? "mock" : "vertex";
  },
  get gcpProject() {
    return process.env.GOOGLE_CLOUD_PROJECT ?? "";
  },
  get geminiModel() {
    return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  },
  get vertexLocation() {
    return process.env.VERTEX_LOCATION ?? "asia-northeast1";
  },
  /** AI入力ファイルの一時保存先バケット。未設定ならローカルディレクトリに保存 */
  get uploadBucket() {
    return process.env.UPLOAD_BUCKET ?? "";
  },
  get localUploadDir() {
    return process.env.LOCAL_UPLOAD_DIR ?? ".local-uploads";
  },
  /** 定期処理エンドポイントの認証 */
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  get cronOidcAudience() {
    return process.env.CRON_OIDC_AUDIENCE ?? "";
  },
  get cronServiceAccount() {
    return process.env.CRON_SERVICE_ACCOUNT ?? "";
  },
};
