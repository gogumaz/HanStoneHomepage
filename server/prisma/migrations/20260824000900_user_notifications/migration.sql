CREATE TYPE "UserNotificationKind" AS ENUM ('INQUIRY_ANSWERED');

CREATE TABLE "UserNotification" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "kind" "UserNotificationKind" NOT NULL,
  "resourceType" VARCHAR(50) NOT NULL,
  "resourceId" VARCHAR(100) NOT NULL,
  "resourceVersion" INTEGER NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "message" VARCHAR(255) NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserNotification_resourceVersion_check" CHECK ("resourceVersion" > 0)
);

CREATE UNIQUE INDEX "UserNotification_userId_kind_resourceId_resourceVersion_key"
  ON "UserNotification"("userId", "kind", "resourceId", "resourceVersion");
CREATE INDEX "UserNotification_userId_readAt_createdAt_idx"
  ON "UserNotification"("userId", "readAt", "createdAt");
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
