-- CreateEnum
CREATE TYPE "ClassAssignmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ClassAssignmentItemType" AS ENUM ('LESSON', 'BADUK_MISSION');

-- AlterEnum
ALTER TYPE "UserNotificationKind" ADD VALUE 'ASSIGNMENT_PUBLISHED';
ALTER TYPE "UserNotificationKind" ADD VALUE 'ASSIGNMENT_DUE_SOON';
ALTER TYPE "UserNotificationKind" ADD VALUE 'ASSIGNMENT_COMMENTED';
ALTER TYPE "UserNotificationKind" ADD VALUE 'ASSIGNMENT_CANCELED';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "seatLimit" INTEGER;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_seatLimit_check" CHECK ("seatLimit" IS NULL OR "seatLimit" >= 1);

-- CreateTable
CREATE TABLE "OrganizationSeat" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationSeat_pkey" PRIMARY KEY ("id")
);

-- Backfill one seat per student currently enrolled in each organization.
INSERT INTO "OrganizationSeat" ("id", "organizationId", "studentId", "assignedAt")
SELECT gen_random_uuid(), c."organizationId", e."studentId", MIN(e."startsAt")
FROM "OrganizationClassEnrollment" e
JOIN "OrganizationClass" c ON c."id" = e."organizationClassId"
WHERE e."startsAt" <= CURRENT_TIMESTAMP
  AND (e."endsAt" IS NULL OR e."endsAt" > CURRENT_TIMESTAMP)
GROUP BY c."organizationId", e."studentId";

CREATE UNIQUE INDEX "OrganizationSeat_organizationId_studentId_key" ON "OrganizationSeat"("organizationId", "studentId");
CREATE INDEX "OrganizationSeat_studentId_idx" ON "OrganizationSeat"("studentId");

ALTER TABLE "OrganizationSeat" ADD CONSTRAINT "OrganizationSeat_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationSeat" ADD CONSTRAINT "OrganizationSeat_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "OrganizationClassAssignment" (
    "id" UUID NOT NULL,
    "organizationClassId" UUID NOT NULL,
    "createdByUserId" UUID,
    "reassignedFromId" UUID,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "ClassAssignmentStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationClassAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationClassAssignmentItem" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "type" "ClassAssignmentItemType" NOT NULL,
    "lessonId" VARCHAR(40),
    "missionId" VARCHAR(60),
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationClassAssignmentItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationClassAssignmentItem_resource_check" CHECK (
      ("type" = 'LESSON' AND "lessonId" IS NOT NULL AND "missionId" IS NULL)
      OR
      ("type" = 'BADUK_MISSION' AND "missionId" IS NOT NULL AND "lessonId" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "OrganizationClassAssignmentTarget" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "teacherComment" VARCHAR(1000),
    "commentVersion" INTEGER NOT NULL DEFAULT 0,
    "commentedByUserId" UUID,
    "commentedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationClassAssignmentTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationClassAssignment_organizationClassId_status_dueAt_idx" ON "OrganizationClassAssignment"("organizationClassId", "status", "dueAt");
CREATE INDEX "OrganizationClassAssignment_createdByUserId_createdAt_idx" ON "OrganizationClassAssignment"("createdByUserId", "createdAt");
CREATE INDEX "OrganizationClassAssignment_reassignedFromId_idx" ON "OrganizationClassAssignment"("reassignedFromId");
CREATE UNIQUE INDEX "OrganizationClassAssignmentItem_assignmentId_order_key" ON "OrganizationClassAssignmentItem"("assignmentId", "order");
CREATE INDEX "OrganizationClassAssignmentItem_lessonId_idx" ON "OrganizationClassAssignmentItem"("lessonId");
CREATE INDEX "OrganizationClassAssignmentItem_missionId_idx" ON "OrganizationClassAssignmentItem"("missionId");
CREATE UNIQUE INDEX "OrganizationClassAssignmentTarget_assignmentId_studentId_key" ON "OrganizationClassAssignmentTarget"("assignmentId", "studentId");
CREATE INDEX "OrganizationClassAssignmentTarget_studentId_assignedAt_idx" ON "OrganizationClassAssignmentTarget"("studentId", "assignedAt");
CREATE INDEX "OrganizationClassAssignmentTarget_commentedByUserId_idx" ON "OrganizationClassAssignmentTarget"("commentedByUserId");

-- AddForeignKey
ALTER TABLE "OrganizationClassAssignment" ADD CONSTRAINT "OrganizationClassAssignment_organizationClassId_fkey" FOREIGN KEY ("organizationClassId") REFERENCES "OrganizationClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassAssignment" ADD CONSTRAINT "OrganizationClassAssignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassAssignment" ADD CONSTRAINT "OrganizationClassAssignment_reassignedFromId_fkey" FOREIGN KEY ("reassignedFromId") REFERENCES "OrganizationClassAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassAssignmentItem" ADD CONSTRAINT "OrganizationClassAssignmentItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "OrganizationClassAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassAssignmentItem" ADD CONSTRAINT "OrganizationClassAssignmentItem_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassAssignmentItem" ADD CONSTRAINT "OrganizationClassAssignmentItem_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "BadukMission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassAssignmentTarget" ADD CONSTRAINT "OrganizationClassAssignmentTarget_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "OrganizationClassAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassAssignmentTarget" ADD CONSTRAINT "OrganizationClassAssignmentTarget_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassAssignmentTarget" ADD CONSTRAINT "OrganizationClassAssignmentTarget_commentedByUserId_fkey" FOREIGN KEY ("commentedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
