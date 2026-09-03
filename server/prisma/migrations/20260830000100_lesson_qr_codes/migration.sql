CREATE TYPE "LessonQrCodeStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "LessonQrCode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codeHash" VARCHAR(64) NOT NULL,
    "lessonId" VARCHAR(40) NOT NULL,
    "status" "LessonQrCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "maxClaims" INTEGER,
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonQrCode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LessonQrCode_claim_count_check" CHECK ("claimCount" >= 0),
    CONSTRAINT "LessonQrCode_max_claims_check" CHECK ("maxClaims" IS NULL OR "maxClaims" > 0),
    CONSTRAINT "LessonQrCode_claim_limit_check" CHECK ("maxClaims" IS NULL OR "claimCount" <= "maxClaims")
);

CREATE UNIQUE INDEX "LessonQrCode_codeHash_key" ON "LessonQrCode"("codeHash");
CREATE INDEX "LessonQrCode_lessonId_status_idx" ON "LessonQrCode"("lessonId", "status");
CREATE INDEX "LessonQrCode_status_expiresAt_idx" ON "LessonQrCode"("status", "expiresAt");

ALTER TABLE "LessonQrCode"
ADD CONSTRAINT "LessonQrCode_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
