ALTER TYPE "CommunityPostStatus" ADD VALUE 'HIDDEN';

CREATE TYPE "CommunityReportReason" AS ENUM ('SPAM', 'PERSONAL_INFO', 'HARASSMENT', 'ILLEGAL', 'COPYRIGHT', 'OTHER');
CREATE TYPE "CommunityReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
CREATE TYPE "CommunityReportResolution" AS ENUM ('HIDDEN', 'DISMISSED');

CREATE TABLE "CommunityPostReport" (
  "id" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "reporterUserId" UUID NOT NULL,
  "reason" "CommunityReportReason" NOT NULL,
  "detail" VARCHAR(500),
  "status" "CommunityReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolution" "CommunityReportResolution",
  "resolvedById" UUID,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CommunityPostReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityPostReport_postId_reporterUserId_key" ON "CommunityPostReport"("postId", "reporterUserId");
CREATE INDEX "CommunityPostReport_status_createdAt_idx" ON "CommunityPostReport"("status", "createdAt");
CREATE INDEX "CommunityPostReport_postId_status_idx" ON "CommunityPostReport"("postId", "status");

ALTER TABLE "CommunityPostReport"
  ADD CONSTRAINT "CommunityPostReport_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityPostReport"
  ADD CONSTRAINT "CommunityPostReport_reporterUserId_fkey"
  FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityPostReport"
  ADD CONSTRAINT "CommunityPostReport_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
