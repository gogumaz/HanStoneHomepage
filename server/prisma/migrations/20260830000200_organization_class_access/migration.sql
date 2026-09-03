CREATE TYPE "RoleVerificationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'VERIFIED', 'REVOKED');
CREATE TYPE "OrganizationMembershipRole" AS ENUM ('INSTRUCTOR', 'ADMIN');
CREATE TYPE "OrganizationMembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ENDED');
CREATE TYPE "OrganizationClassStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "UserRoleAssignment"
ADD COLUMN "verificationStatus" "RoleVerificationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN "verifiedAt" TIMESTAMP(3);

CREATE INDEX "UserRoleAssignment_role_verificationStatus_idx"
ON "UserRoleAssignment"("role", "verificationStatus");

CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMembership" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "OrganizationMembershipRole" NOT NULL,
    "status" "OrganizationMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationMembership_period_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE TABLE "OrganizationClass" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "academicYear" INTEGER NOT NULL,
    "status" "OrganizationClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationClass_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationClass_academic_year_check" CHECK ("academicYear" BETWEEN 2000 AND 2200)
);

CREATE TABLE "OrganizationClassTeacherAssignment" (
    "id" UUID NOT NULL,
    "organizationClassId" UUID NOT NULL,
    "teacherMembershipId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationClassTeacherAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationClassTeacherAssignment_period_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE TABLE "OrganizationClassEnrollment" (
    "id" UUID NOT NULL,
    "organizationClassId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationClassEnrollment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationClassEnrollment_period_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");
CREATE INDEX "OrganizationMembership_userId_status_startsAt_endsAt_idx" ON "OrganizationMembership"("userId", "status", "startsAt", "endsAt");
CREATE INDEX "OrganizationMembership_organizationId_role_status_idx" ON "OrganizationMembership"("organizationId", "role", "status");
CREATE UNIQUE INDEX "OrganizationClass_organizationId_academicYear_name_key" ON "OrganizationClass"("organizationId", "academicYear", "name");
CREATE INDEX "OrganizationClass_organizationId_status_idx" ON "OrganizationClass"("organizationId", "status");
CREATE UNIQUE INDEX "OrganizationClassTeacherAssignment_organizationClassId_teacherMembershipId_key" ON "OrganizationClassTeacherAssignment"("organizationClassId", "teacherMembershipId");
CREATE INDEX "OrganizationClassTeacherAssignment_teacherMembershipId_startsAt_endsAt_idx" ON "OrganizationClassTeacherAssignment"("teacherMembershipId", "startsAt", "endsAt");
CREATE UNIQUE INDEX "OrganizationClassEnrollment_organizationClassId_studentId_key" ON "OrganizationClassEnrollment"("organizationClassId", "studentId");
CREATE INDEX "OrganizationClassEnrollment_studentId_startsAt_endsAt_idx" ON "OrganizationClassEnrollment"("studentId", "startsAt", "endsAt");

ALTER TABLE "OrganizationMembership"
ADD CONSTRAINT "OrganizationMembership_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership"
ADD CONSTRAINT "OrganizationMembership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClass"
ADD CONSTRAINT "OrganizationClass_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassTeacherAssignment"
ADD CONSTRAINT "OrganizationClassTeacherAssignment_organizationClassId_fkey"
FOREIGN KEY ("organizationClassId") REFERENCES "OrganizationClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassTeacherAssignment"
ADD CONSTRAINT "OrganizationClassTeacherAssignment_teacherMembershipId_fkey"
FOREIGN KEY ("teacherMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassEnrollment"
ADD CONSTRAINT "OrganizationClassEnrollment_organizationClassId_fkey"
FOREIGN KEY ("organizationClassId") REFERENCES "OrganizationClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationClassEnrollment"
ADD CONSTRAINT "OrganizationClassEnrollment_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
