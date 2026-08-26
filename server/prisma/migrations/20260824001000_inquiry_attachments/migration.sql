CREATE TYPE "InquiryAttachmentStatus" AS ENUM ('QUARANTINED', 'READY', 'REJECTED');

CREATE TABLE "InquiryAttachment" (
  "id" UUID NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "inquiryId" UUID,
  "objectKey" TEXT NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "size" INTEGER NOT NULL,
  "status" "InquiryAttachmentStatus" NOT NULL DEFAULT 'QUARANTINED',
  "scanProvider" VARCHAR(50),
  "scanResult" VARCHAR(100),
  "scannedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InquiryAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InquiryAttachment_size_check" CHECK ("size" > 0)
);

CREATE UNIQUE INDEX "InquiryAttachment_inquiryId_key" ON "InquiryAttachment"("inquiryId");
CREATE UNIQUE INDEX "InquiryAttachment_objectKey_key" ON "InquiryAttachment"("objectKey");
CREATE INDEX "InquiryAttachment_ownerUserId_status_createdAt_idx" ON "InquiryAttachment"("ownerUserId", "status", "createdAt");
CREATE INDEX "InquiryAttachment_status_createdAt_idx" ON "InquiryAttachment"("status", "createdAt");
ALTER TABLE "InquiryAttachment" ADD CONSTRAINT "InquiryAttachment_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InquiryAttachment" ADD CONSTRAINT "InquiryAttachment_inquiryId_fkey"
  FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
