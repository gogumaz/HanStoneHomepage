CREATE TABLE "OAuthLoginAttempt" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthLoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthLoginAttempt_stateHash_key" ON "OAuthLoginAttempt"("stateHash");
CREATE INDEX "OAuthLoginAttempt_expiresAt_consumedAt_idx" ON "OAuthLoginAttempt"("expiresAt", "consumedAt");
