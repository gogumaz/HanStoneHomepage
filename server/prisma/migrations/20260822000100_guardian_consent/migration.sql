-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('ACTIVE', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "GuardianConsent" (
    "id" UUID NOT NULL,
    "guardianLinkId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "consentType" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "scope" TEXT[],
    "verificationMethod" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'ACTIVE',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "auditMetadata" JSONB,
    CONSTRAINT "GuardianConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuardianConsent_guardianLinkId_status_idx" ON "GuardianConsent"("guardianLinkId", "status");
CREATE INDEX "GuardianConsent_studentId_guardianId_idx" ON "GuardianConsent"("studentId", "guardianId");
CREATE INDEX "GuardianConsent_guardianId_status_idx" ON "GuardianConsent"("guardianId", "status");

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_guardianLinkId_fkey" FOREIGN KEY ("guardianLinkId") REFERENCES "GuardianLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
