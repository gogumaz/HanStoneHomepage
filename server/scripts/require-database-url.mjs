if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL 환경 변수를 먼저 설정해야 합니다.");
  process.exit(1);
}
