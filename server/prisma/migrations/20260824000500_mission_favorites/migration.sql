CREATE TABLE "MissionFavorite" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "missionId" VARCHAR(60) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MissionFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MissionFavorite_userId_missionId_key" ON "MissionFavorite"("userId", "missionId");
CREATE INDEX "MissionFavorite_userId_createdAt_idx" ON "MissionFavorite"("userId", "createdAt");
CREATE INDEX "MissionFavorite_missionId_idx" ON "MissionFavorite"("missionId");

ALTER TABLE "MissionFavorite" ADD CONSTRAINT "MissionFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionFavorite" ADD CONSTRAINT "MissionFavorite_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "BadukMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
