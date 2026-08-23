CREATE TYPE "LessonVideoAssetStatus" AS ENUM (
    'UPLOADING',
    'QUARANTINED',
    'SCANNING',
    'READY',
    'REJECTED',
    'ERROR'
);

CREATE TABLE "LessonVideoAsset" (
    "id" UUID NOT NULL,
    "lessonId" VARCHAR(40) NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "expectedSize" BIGINT NOT NULL,
    "actualSize" BIGINT,
    "status" "LessonVideoAssetStatus" NOT NULL DEFAULT 'UPLOADING',
    "scanProvider" TEXT,
    "scanResult" TEXT,
    "scannedAt" TIMESTAMP(3),
    "attachedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "previousAssetKey" TEXT,
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LessonVideoAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LessonVideoAsset_objectKey_key" ON "LessonVideoAsset"("objectKey");
CREATE INDEX "LessonVideoAsset_lessonId_createdAt_idx" ON "LessonVideoAsset"("lessonId", "createdAt");
CREATE INDEX "LessonVideoAsset_status_nextAttemptAt_createdAt_idx" ON "LessonVideoAsset"("status", "nextAttemptAt", "createdAt");

ALTER TABLE "LessonVideoAsset"
ADD CONSTRAINT "LessonVideoAsset_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
