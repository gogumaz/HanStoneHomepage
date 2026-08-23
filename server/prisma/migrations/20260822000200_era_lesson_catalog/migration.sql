-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Era" (
    "id" VARCHAR(40) NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Era_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" VARCHAR(40) NOT NULL,
    "eraId" VARCHAR(40) NOT NULL,
    "order" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "course" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "instructor" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "LessonStatus" NOT NULL DEFAULT 'DRAFT',
    "isFreeSample" BOOLEAN NOT NULL DEFAULT false,
    "videoAssetKey" TEXT,
    "thumbnailKey" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Era_order_key" ON "Era"("order");
CREATE UNIQUE INDEX "Lesson_eraId_order_key" ON "Lesson"("eraId", "order");
CREATE INDEX "Lesson_status_eraId_order_idx" ON "Lesson"("status", "eraId", "order");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_eraId_fkey" FOREIGN KEY ("eraId") REFERENCES "Era"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed fixed journey eras. Empty eras intentionally remain without placeholder lessons.
INSERT INTO "Era" ("id", "order", "name", "theme", "description", "createdAt", "updatedAt") VALUES
  ('era_prehistoric', 1, '선사시대', '주변을 살펴라', '자연을 관찰해 도구를 만든 사람들과 바둑돌의 활로를 함께 배웁니다.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('era_gojoseon', 2, '고조선', '내 영역을 만들다', '건국 이야기와 좋은 자리를 먼저 차지하는 포석을 연결합니다.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('era_three_kingdoms', 3, '삼국시대', '연결할수록 강해진다', '세 나라의 성장과 교류를 돌의 연결과 끊기로 배웁니다.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('era_goryeo', 4, '고려', '균형을 지켜라', '고려 문화와 기초 사활을 연결한 여행입니다.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('era_joseon', 5, '조선', '판 전체를 읽어라', '조선의 인물과 사건을 공배와 집 계산으로 살펴봅니다.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('era_modern', 6, '근현대', '한 수의 선택이 미래를 바꾼다', '근현대사의 선택과 종합 바둑 문제를 연결합니다.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- The only initial lesson is the published free sample required by the product policy.
INSERT INTO "Lesson" (
  "id", "eraId", "order", "level", "course", "title", "summary", "instructor",
  "difficulty", "durationMinutes", "status", "isFreeSample", "publishedAt", "createdAt", "updatedAt"
) VALUES (
  'PRE-01', 'era_prehistoric', 1, '입문', '입문 1권', '주먹도끼에서 배운 첫 수',
  '구석기 사람들의 관찰과 바둑돌의 흐름을 연결해 배우는 첫 강의입니다.',
  '김바둑 선생님', '처음 시작', 8, 'PUBLISHED', true,
  '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
);
