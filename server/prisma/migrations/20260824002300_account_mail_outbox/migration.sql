CREATE TYPE "AccountMailKind" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "AccountMailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'SKIPPED', 'ERROR');

CREATE TABLE "AccountMailJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tokenId" UUID NOT NULL,
    "kind" "AccountMailKind" NOT NULL,
    "encryptedToken" TEXT,
    "status" "AccountMailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "messageId" VARCHAR(255),
    "lastError" VARCHAR(100),
    "requestId" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMailJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountMailJob_tokenId_key" ON "AccountMailJob"("tokenId");
CREATE INDEX "AccountMailJob_status_nextAttemptAt_createdAt_idx"
ON "AccountMailJob"("status", "nextAttemptAt", "createdAt");

ALTER TABLE "AccountMailJob"
ADD CONSTRAINT "AccountMailJob_tokenId_fkey"
FOREIGN KEY ("tokenId") REFERENCES "AccountToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
