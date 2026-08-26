CREATE TYPE "EditorialContentType" AS ENUM ('NOTICE', 'FAQ');
CREATE TYPE "EditorialContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "EditorialContent" (
  "id" UUID NOT NULL,
  "type" "EditorialContentType" NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "content" TEXT NOT NULL,
  "status" "EditorialContentStatus" NOT NULL DEFAULT 'DRAFT',
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "displayOrder" INTEGER,
  "publishedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EditorialContent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EditorialContent_displayOrder_check" CHECK ("displayOrder" IS NULL OR "displayOrder" BETWEEN 1 AND 10000),
  CONSTRAINT "EditorialContent_type_fields_check" CHECK (
    ("type" = 'NOTICE' AND "displayOrder" IS NULL)
    OR ("type" = 'FAQ' AND "isPinned" = false AND "displayOrder" IS NOT NULL)
  )
);

CREATE INDEX "EditorialContent_type_status_publishedAt_idx"
  ON "EditorialContent"("type", "status", "publishedAt");
CREATE INDEX "EditorialContent_type_status_displayOrder_idx"
  ON "EditorialContent"("type", "status", "displayOrder");

ALTER TABLE "EditorialContent" ADD CONSTRAINT "EditorialContent_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EditorialContent" ADD CONSTRAINT "EditorialContent_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
