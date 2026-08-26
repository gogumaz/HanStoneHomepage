CREATE TYPE "CommunityPostType" AS ENUM ('CLASS_TIP', 'TRAVEL');
CREATE TYPE "CommunityPostStatus" AS ENUM ('PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED');

CREATE TABLE "CommunityPost" (
  "id" UUID NOT NULL,
  "type" "CommunityPostType" NOT NULL,
  "authorUserId" UUID NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "content" TEXT NOT NULL,
  "targetGrade" VARCHAR(30),
  "era" VARCHAR(30),
  "badukLevel" VARCHAR(20),
  "className" VARCHAR(100),
  "publicationConsentVersion" VARCHAR(80),
  "publicationConsentedAt" TIMESTAMP(3),
  "status" "CommunityPostStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "rejectionReason" VARCHAR(500),
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityPost_type_fields_check" CHECK (
    (
      "type" = 'CLASS_TIP'
      AND "targetGrade" IS NOT NULL
      AND "era" IS NOT NULL
      AND "badukLevel" IS NOT NULL
      AND "className" IS NULL
      AND "publicationConsentVersion" IS NULL
      AND "publicationConsentedAt" IS NULL
    )
    OR (
      "type" = 'TRAVEL'
      AND "targetGrade" IS NULL
      AND "era" IS NOT NULL
      AND "badukLevel" IS NULL
      AND "className" IS NOT NULL
      AND "publicationConsentVersion" IS NOT NULL
      AND "publicationConsentedAt" IS NOT NULL
    )
  )
);

CREATE INDEX "CommunityPost_type_status_publishedAt_idx"
  ON "CommunityPost"("type", "status", "publishedAt");
CREATE INDEX "CommunityPost_authorUserId_status_createdAt_idx"
  ON "CommunityPost"("authorUserId", "status", "createdAt");

ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
