import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run 用に必要なファイルだけをまとめる
  output: "standalone",
  // 社内向けの認証付き業務アプリのため、ページはすべて動的に描画する（Cache Components は使わない）
  cacheComponents: false,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
