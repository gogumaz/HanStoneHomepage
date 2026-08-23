CREATE TYPE "HlsTranscodeJobStatus" AS ENUM ('PENDING', 'TRANSCODING', 'READY', 'SUPERSEDED', 'ERROR');

CREATE TABLE "HlsTranscodeJob" (
    "id" UUID NOT NULL,
    "lessonId" VARCHAR(40) NOT NULL,
    "sourceAssetId" UUID NOT NULL,
    "sourceObjectKey" TEXT NOT NULL,
    "manifestKey" TEXT,
    "status" "HlsTranscodeJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HlsTranscodeJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HlsTranscodeJob_sourceAssetId_key" ON "HlsTranscodeJob"("sourceAssetId");
CREATE UNIQUE INDEX "HlsTranscodeJob_manifestKey_key" ON "HlsTranscodeJob"("manifestKey");
CREATE INDEX "HlsTranscodeJob_status_nextAttemptAt_createdAt_idx" ON "HlsTranscodeJob"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "HlsTranscodeJob_lessonId_createdAt_idx" ON "HlsTranscodeJob"("lessonId", "createdAt");

ALTER TABLE "HlsTranscodeJob" ADD CONSTRAINT "HlsTranscodeJob_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HlsTranscodeJob" ADD CONSTRAINT "HlsTranscodeJob_sourceAssetId_fkey"
FOREIGN KEY ("sourceAssetId") REFERENCES "LessonVideoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
