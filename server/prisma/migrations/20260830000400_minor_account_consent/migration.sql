CREATE TYPE "AgeBand" AS ENUM ('UNKNOWN', 'UNDER_14', 'AGE_14_TO_18', 'ADULT');
CREATE TYPE "MinorAccountStatus" AS ENUM ('AGE_DECLARATION_REQUIRED', 'GUARDIAN_CONSENT_PENDING', 'ACTIVE', 'NOT_APPLICABLE');

ALTER TABLE "User"
  ADD COLUMN "ageBand" "AgeBand" NOT NULL DEFAULT 'ADULT',
  ADD COLUMN "minorAccountStatus" "MinorAccountStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "guardianConsentVerifiedAt" TIMESTAMP(3);

CREATE INDEX "User_minorAccountStatus_idx" ON "User"("minorAccountStatus");
