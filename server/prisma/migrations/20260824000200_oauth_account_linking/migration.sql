CREATE TYPE "OAuthAttemptPurpose" AS ENUM ('LOGIN', 'LINK', 'DELETE_ACCOUNT');

ALTER TABLE "OAuthLoginAttempt"
ADD COLUMN "purpose" "OAuthAttemptPurpose" NOT NULL DEFAULT 'LOGIN',
ADD COLUMN "userId" UUID;

CREATE UNIQUE INDEX "OAuthAccount_userId_provider_key" ON "OAuthAccount"("userId", "provider");
CREATE INDEX "OAuthLoginAttempt_userId_purpose_expiresAt_idx"
ON "OAuthLoginAttempt"("userId", "purpose", "expiresAt");

ALTER TABLE "OAuthLoginAttempt" ADD CONSTRAINT "OAuthLoginAttempt_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
