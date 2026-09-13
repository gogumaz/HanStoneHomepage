CREATE TABLE "OrganizationClassProgressSetting" (
    "organizationClassId" UUID NOT NULL,
    "currentLessonId" VARCHAR(40) NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationClassProgressSetting_pkey" PRIMARY KEY ("organizationClassId")
);

CREATE INDEX "OrganizationClassProgressSetting_currentLessonId_idx"
ON "OrganizationClassProgressSetting"("currentLessonId");
CREATE INDEX "OrganizationClassProgressSetting_updatedByUserId_idx"
ON "OrganizationClassProgressSetting"("updatedByUserId");

ALTER TABLE "OrganizationClassProgressSetting"
ADD CONSTRAINT "OrganizationClassProgressSetting_organizationClassId_fkey"
FOREIGN KEY ("organizationClassId") REFERENCES "OrganizationClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassProgressSetting"
ADD CONSTRAINT "OrganizationClassProgressSetting_currentLessonId_fkey"
FOREIGN KEY ("currentLessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassProgressSetting"
ADD CONSTRAINT "OrganizationClassProgressSetting_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
