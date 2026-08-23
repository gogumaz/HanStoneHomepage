ALTER TYPE "LessonVideoAssetStatus" ADD VALUE 'PURGED';

CREATE TYPE "ObjectDeletionJobStatus" AS ENUM (
    'PENDING',
    'DELETING',
    'COMPLETED',
    'CANCELLED',
    'ERROR'
);

CREATE TABLE "ObjectDeletionJob" (
    "id" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "status" "ObjectDeletionJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectDeletionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ObjectDeletionJob_objectKey_key" ON "ObjectDeletionJob"("objectKey");
CREATE INDEX "ObjectDeletionJob_status_nextAttemptAt_createdAt_idx"
ON "ObjectDeletionJob"("status", "nextAttemptAt", "createdAt");
