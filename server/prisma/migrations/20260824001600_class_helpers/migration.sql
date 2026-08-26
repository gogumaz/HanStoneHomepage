CREATE TYPE "ClassHelperStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "ClassHelperAssetKind" AS ENUM ('PROJECTOR_PPT', 'ACTIVITY_PDF', 'HISTORY_QUIZ', 'PROBLEM_MISSION', 'ANSWER', 'TEACHER_GUIDE');
CREATE TYPE "ClassHelperAssetStatus" AS ENUM ('QUARANTINED', 'READY', 'REJECTED');

CREATE TABLE "ClassHelper" (
  "id" UUID NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "lessonId" VARCHAR(40) NOT NULL,
  "badukMissionId" VARCHAR(60) NOT NULL,
  "targetGrade" VARCHAR(30) NOT NULL,
  "lessonDuration" VARCHAR(30) NOT NULL,
  "content" TEXT NOT NULL,
  "introductionContent" TEXT NOT NULL,
  "conceptContent" TEXT NOT NULL,
  "problemContent" TEXT NOT NULL,
  "quizContent" TEXT NOT NULL,
  "wrapUpContent" TEXT NOT NULL,
  "status" "ClassHelperStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClassHelper_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassHelperAsset" (
  "id" UUID NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "classHelperId" UUID,
  "kind" "ClassHelperAssetKind" NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "size" INTEGER NOT NULL,
  "status" "ClassHelperAssetStatus" NOT NULL DEFAULT 'QUARANTINED',
  "scanProvider" VARCHAR(50),
  "scanResult" VARCHAR(100),
  "scannedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClassHelperAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClassHelper_status_publishedAt_idx" ON "ClassHelper"("status", "publishedAt");
CREATE INDEX "ClassHelper_lessonId_status_idx" ON "ClassHelper"("lessonId", "status");
CREATE INDEX "ClassHelper_badukMissionId_status_idx" ON "ClassHelper"("badukMissionId", "status");
CREATE UNIQUE INDEX "ClassHelperAsset_objectKey_key" ON "ClassHelperAsset"("objectKey");
CREATE UNIQUE INDEX "ClassHelperAsset_classHelperId_kind_key" ON "ClassHelperAsset"("classHelperId", "kind");
CREATE INDEX "ClassHelperAsset_ownerUserId_status_createdAt_idx" ON "ClassHelperAsset"("ownerUserId", "status", "createdAt");
CREATE INDEX "ClassHelperAsset_status_createdAt_idx" ON "ClassHelperAsset"("status", "createdAt");

ALTER TABLE "ClassHelper" ADD CONSTRAINT "ClassHelper_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClassHelper" ADD CONSTRAINT "ClassHelper_badukMissionId_fkey" FOREIGN KEY ("badukMissionId") REFERENCES "BadukMission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClassHelper" ADD CONSTRAINT "ClassHelper_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClassHelper" ADD CONSTRAINT "ClassHelper_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClassHelperAsset" ADD CONSTRAINT "ClassHelperAsset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassHelperAsset" ADD CONSTRAINT "ClassHelperAsset_classHelperId_fkey" FOREIGN KEY ("classHelperId") REFERENCES "ClassHelper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
