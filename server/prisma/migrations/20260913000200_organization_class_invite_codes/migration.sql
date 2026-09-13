CREATE TABLE "OrganizationClassInviteCode" (
    "id" UUID NOT NULL,
    "organizationClassId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByStudentId" UUID,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationClassInviteCode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationClassInviteCode_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "OrganizationClassInviteCode_consumption_check" CHECK (("consumedAt" IS NULL) = ("consumedByStudentId" IS NULL))
);

CREATE UNIQUE INDEX "OrganizationClassInviteCode_codeHash_key"
ON "OrganizationClassInviteCode"("codeHash");
CREATE INDEX "OrganizationClassInviteCode_organizationClassId_expiresAt_idx"
ON "OrganizationClassInviteCode"("organizationClassId", "expiresAt");
CREATE INDEX "OrganizationClassInviteCode_createdByUserId_createdAt_idx"
ON "OrganizationClassInviteCode"("createdByUserId", "createdAt");
CREATE INDEX "OrganizationClassInviteCode_consumedByStudentId_idx"
ON "OrganizationClassInviteCode"("consumedByStudentId");
CREATE UNIQUE INDEX "OrganizationClassInviteCode_one_open_code_per_creator_class_key"
ON "OrganizationClassInviteCode"("organizationClassId", "createdByUserId")
WHERE "consumedAt" IS NULL AND "revokedAt" IS NULL;

ALTER TABLE "OrganizationClassInviteCode"
ADD CONSTRAINT "OrganizationClassInviteCode_organizationClassId_fkey"
FOREIGN KEY ("organizationClassId") REFERENCES "OrganizationClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassInviteCode"
ADD CONSTRAINT "OrganizationClassInviteCode_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassInviteCode"
ADD CONSTRAINT "OrganizationClassInviteCode_consumedByStudentId_fkey"
FOREIGN KEY ("consumedByStudentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
