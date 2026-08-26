ALTER TABLE "TeachingMaterial"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "TeachingMaterialAsset"
ADD COLUMN "detachedAt" TIMESTAMP(3);

ALTER TABLE "ClassHelper"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ClassHelperAsset"
ADD COLUMN "detachedAt" TIMESTAMP(3);

CREATE TABLE "TeachingMaterialRevision" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingMaterialRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassHelperRevision" (
    "id" UUID NOT NULL,
    "classHelperId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassHelperRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeachingMaterialRevision_materialId_revision_key"
ON "TeachingMaterialRevision"("materialId", "revision");

CREATE INDEX "TeachingMaterialRevision_materialId_createdAt_idx"
ON "TeachingMaterialRevision"("materialId", "createdAt");

CREATE INDEX "TeachingMaterialRevision_changedById_createdAt_idx"
ON "TeachingMaterialRevision"("changedById", "createdAt");

CREATE INDEX "TeachingMaterialAsset_materialId_detachedAt_idx"
ON "TeachingMaterialAsset"("materialId", "detachedAt");

CREATE UNIQUE INDEX "ClassHelperRevision_classHelperId_revision_key"
ON "ClassHelperRevision"("classHelperId", "revision");

CREATE INDEX "ClassHelperRevision_classHelperId_createdAt_idx"
ON "ClassHelperRevision"("classHelperId", "createdAt");

CREATE INDEX "ClassHelperRevision_changedById_createdAt_idx"
ON "ClassHelperRevision"("changedById", "createdAt");

CREATE INDEX "ClassHelperAsset_classHelperId_detachedAt_idx"
ON "ClassHelperAsset"("classHelperId", "detachedAt");

ALTER TABLE "TeachingMaterialRevision"
ADD CONSTRAINT "TeachingMaterialRevision_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "TeachingMaterial"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingMaterialRevision"
ADD CONSTRAINT "TeachingMaterialRevision_changedById_fkey"
FOREIGN KEY ("changedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClassHelperRevision"
ADD CONSTRAINT "ClassHelperRevision_classHelperId_fkey"
FOREIGN KEY ("classHelperId") REFERENCES "ClassHelper"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassHelperRevision"
ADD CONSTRAINT "ClassHelperRevision_changedById_fkey"
FOREIGN KEY ("changedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
