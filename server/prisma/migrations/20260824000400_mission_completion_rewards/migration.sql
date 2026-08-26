CREATE TYPE "RewardType" AS ENUM ('STAR', 'BADGE', 'ARTIFACT_CARD');

CREATE TABLE "Reward" (
  "id" VARCHAR(40) NOT NULL,
  "type" "RewardType" NOT NULL,
  "title" VARCHAR(80) NOT NULL,
  "description" VARCHAR(300),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Reward" ("id", "type", "title", "description")
VALUES ('mission-star', 'STAR', '미션 별', '바둑미션을 완료하면 받는 기본 별 보상입니다.');

ALTER TABLE "BadukMission"
  ADD COLUMN "rewardId" VARCHAR(40) NOT NULL DEFAULT 'mission-star',
  ADD COLUMN "rewardQuantity" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "BadukMission_rewardQuantity_check" CHECK ("rewardQuantity" BETWEEN 1 AND 100);

CREATE TABLE "RewardGrant" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "rewardId" VARCHAR(40) NOT NULL,
  "missionId" VARCHAR(60) NOT NULL,
  "attemptId" UUID NOT NULL,
  "rewardTypeSnapshot" "RewardType" NOT NULL,
  "rewardTitleSnapshot" VARCHAR(80) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardGrant_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100)
);

CREATE INDEX "Reward_type_active_idx" ON "Reward"("type", "active");
CREATE UNIQUE INDEX "RewardGrant_attemptId_key" ON "RewardGrant"("attemptId");
CREATE UNIQUE INDEX "RewardGrant_userId_missionId_key" ON "RewardGrant"("userId", "missionId");
CREATE INDEX "RewardGrant_userId_grantedAt_idx" ON "RewardGrant"("userId", "grantedAt");
CREATE INDEX "RewardGrant_rewardId_grantedAt_idx" ON "RewardGrant"("rewardId", "grantedAt");

ALTER TABLE "BadukMission" ADD CONSTRAINT "BadukMission_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "BadukMission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "MissionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
