CREATE TYPE "LessonAssetKind" AS ENUM ('THUMBNAIL', 'MATERIAL');
CREATE TYPE "LessonAssetStatus" AS ENUM ('QUARANTINED', 'READY', 'REJECTED');

CREATE TABLE "LessonAsset" (
    "id" UUID NOT NULL,
    "lessonId" VARCHAR(40) NOT NULL,
    "kind" "LessonAssetKind" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "LessonAssetStatus" NOT NULL DEFAULT 'QUARANTINED',
    "scanProvider" TEXT,
    "scanResult" TEXT,
    "scannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LessonAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LessonAsset_objectKey_key" ON "LessonAsset"("objectKey");
CREATE INDEX "LessonAsset_lessonId_kind_status_idx" ON "LessonAsset"("lessonId", "kind", "status");
CREATE INDEX "LessonAsset_status_createdAt_idx" ON "LessonAsset"("status", "createdAt");
ALTER TABLE "LessonAsset" ADD CONSTRAINT "LessonAsset_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
