CREATE TYPE "InquiryStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'ANSWERED', 'CLOSED');

CREATE TABLE "Inquiry" (
  "id" UUID NOT NULL,
  "requesterUserId" UUID NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "content" TEXT NOT NULL,
  "status" "InquiryStatus" NOT NULL DEFAULT 'SUBMITTED',
  "answer" TEXT,
  "answeredById" UUID,
  "answeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Inquiry_answer_state_check" CHECK (
    ("status" = 'ANSWERED' AND "answer" IS NOT NULL AND "answeredAt" IS NOT NULL)
    OR "status" <> 'ANSWERED'
  )
);

CREATE INDEX "Inquiry_requesterUserId_createdAt_idx" ON "Inquiry"("requesterUserId", "createdAt");
CREATE INDEX "Inquiry_status_createdAt_idx" ON "Inquiry"("status", "createdAt");
CREATE INDEX "Inquiry_answeredById_answeredAt_idx" ON "Inquiry"("answeredById", "answeredAt");

ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_requesterUserId_fkey"
  FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_answeredById_fkey"
  FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
