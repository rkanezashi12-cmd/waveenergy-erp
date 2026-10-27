import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // prisma generate（npm install・Docker ビルド・CI）では DATABASE_URL が無くても動くようにする。
    // migrate・seed では必須。
    url: process.env.DATABASE_URL,
  },
});
