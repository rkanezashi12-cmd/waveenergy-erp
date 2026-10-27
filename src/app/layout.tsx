import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "オーダー発令・仕様確定管理", template: "%s｜オーダー発令・仕様確定管理" },
  description: "オーダー発令・仕様確定管理アプリ",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full font-sans text-sm">{children}</body>
    </html>
  );
}
