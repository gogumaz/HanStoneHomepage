CREATE TYPE "TeachingMaterialAccess" AS ENUM ('PUBLIC', 'SUBSCRIBER', 'INSTRUCTOR', 'ORGANIZATION');
CREATE TYPE "TeachingMaterialStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "TeachingMaterialAssetStatus" AS ENUM ('QUARANTINED', 'READY', 'REJECTED');

CREATE TABLE "TeachingMaterial" (
  "id" UUID NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "content" TEXT NOT NULL,
  "lessonId" VARCHAR(40) NOT NULL,
  "version" VARCHAR(30) NOT NULL,
  "accessLevel" "TeachingMaterialAccess" NOT NULL,
  "status" "TeachingMaterialStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeachingMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeachingMaterialAsset" (
  "id" UUID NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "materialId" UUID,
  "objectKey" TEXT NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "size" INTEGER NOT NULL,
  "status" "TeachingMaterialAssetStatus" NOT NULL DEFAULT 'QUARANTINED',
  "scanProvider" VARCHAR(50),
  "scanResult" VARCHAR(100),
  "scannedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeachingMaterialAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeachingMaterial_status_publishedAt_idx" ON "TeachingMaterial"("status", "publishedAt");
CREATE INDEX "TeachingMaterial_lessonId_status_idx" ON "TeachingMaterial"("lessonId", "status");
CREATE INDEX "TeachingMaterial_category_status_idx" ON "TeachingMaterial"("category", "status");
CREATE UNIQUE INDEX "TeachingMaterialAsset_materialId_key" ON "TeachingMaterialAsset"("materialId");
CREATE UNIQUE INDEX "TeachingMaterialAsset_objectKey_key" ON "TeachingMaterialAsset"("objectKey");
CREATE INDEX "TeachingMaterialAsset_ownerUserId_status_createdAt_idx" ON "TeachingMaterialAsset"("ownerUserId", "status", "createdAt");
CREATE INDEX "TeachingMaterialAsset_status_createdAt_idx" ON "TeachingMaterialAsset"("status", "createdAt");

ALTER TABLE "TeachingMaterial" ADD CONSTRAINT "TeachingMaterial_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeachingMaterial" ADD CONSTRAINT "TeachingMaterial_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeachingMaterial" ADD CONSTRAINT "TeachingMaterial_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeachingMaterialAsset" ADD CONSTRAINT "TeachingMaterialAsset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeachingMaterialAsset" ADD CONSTRAINT "TeachingMaterialAsset_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "TeachingMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
