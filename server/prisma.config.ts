import "dotenv/config";
import { defineConfig } from "prisma/config";

// Client 생성과 타입 검사에는 실제 DB 연결이 필요하지 않습니다. 서버 실행과
// 마이그레이션은 app-config 및 배포 절차에서 DATABASE_URL을 필수로 검사합니다.
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://prisma-generate:prisma-generate@127.0.0.1:5432/prisma-generate?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
