CREATE TYPE "ConsultationStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'CONTACTED', 'CLOSED');

CREATE TABLE "Consultation" (
  "id" UUID NOT NULL,
  "requesterUserId" UUID,
  "category" VARCHAR(30) NOT NULL,
  "organizationName" VARCHAR(100) NOT NULL,
  "contactName" VARCHAR(50) NOT NULL,
  "phone" VARCHAR(30) NOT NULL,
  "email" VARCHAR(254),
  "expectedStudents" INTEGER NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "content" TEXT NOT NULL,
  "privacyConsentVersion" VARCHAR(50) NOT NULL,
  "privacyConsentedAt" TIMESTAMP(3) NOT NULL,
  "status" "ConsultationStatus" NOT NULL DEFAULT 'SUBMITTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Consultation_expectedStudents_check" CHECK ("expectedStudents" BETWEEN 1 AND 10000)
);

CREATE INDEX "Consultation_requesterUserId_createdAt_idx" ON "Consultation"("requesterUserId", "createdAt");
CREATE INDEX "Consultation_status_createdAt_idx" ON "Consultation"("status", "createdAt");

ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_requesterUserId_fkey"
  FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
