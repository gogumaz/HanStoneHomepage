CREATE TYPE "InquiryNotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'SKIPPED', 'ERROR');

ALTER TABLE "Inquiry" ADD COLUMN "answerVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "InquiryNotificationJob" (
  "id" UUID NOT NULL,
  "inquiryId" UUID NOT NULL,
  "recipientUserId" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "answerVersion" INTEGER NOT NULL,
  "status" "InquiryNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "messageId" VARCHAR(255),
  "lastError" VARCHAR(100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InquiryNotificationJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InquiryNotificationJob_answerVersion_check" CHECK ("answerVersion" > 0),
  CONSTRAINT "InquiryNotificationJob_attempts_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "InquiryNotificationJob_inquiryId_answerVersion_key"
  ON "InquiryNotificationJob"("inquiryId", "answerVersion");
CREATE INDEX "InquiryNotificationJob_status_nextAttemptAt_createdAt_idx"
  ON "InquiryNotificationJob"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "InquiryNotificationJob_recipientUserId_createdAt_idx"
  ON "InquiryNotificationJob"("recipientUserId", "createdAt");

ALTER TABLE "InquiryNotificationJob" ADD CONSTRAINT "InquiryNotificationJob_inquiryId_fkey"
  FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InquiryNotificationJob" ADD CONSTRAINT "InquiryNotificationJob_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InquiryNotificationJob" ADD CONSTRAINT "InquiryNotificationJob_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
