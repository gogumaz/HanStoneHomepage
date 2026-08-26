CREATE TYPE "CommunityAttachmentKind" AS ENUM ('MATERIAL', 'PHOTO');
CREATE TYPE "CommunityAttachmentStatus" AS ENUM ('QUARANTINED', 'READY', 'REJECTED');

CREATE TABLE "CommunityAttachment" (
  "id" UUID NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "postId" UUID,
  "kind" "CommunityAttachmentKind" NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "size" INTEGER NOT NULL,
  "status" "CommunityAttachmentStatus" NOT NULL DEFAULT 'QUARANTINED',
  "scanProvider" VARCHAR(50),
  "scanResult" VARCHAR(100),
  "scannedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CommunityAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityAttachment_postId_key" ON "CommunityAttachment"("postId");
CREATE UNIQUE INDEX "CommunityAttachment_objectKey_key" ON "CommunityAttachment"("objectKey");
CREATE INDEX "CommunityAttachment_ownerUserId_status_createdAt_idx" ON "CommunityAttachment"("ownerUserId", "status", "createdAt");
CREATE INDEX "CommunityAttachment_status_createdAt_idx" ON "CommunityAttachment"("status", "createdAt");

ALTER TABLE "CommunityAttachment"
  ADD CONSTRAINT "CommunityAttachment_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityAttachment"
  ADD CONSTRAINT "CommunityAttachment_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
