CREATE TYPE "BadukMissionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "MissionAttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');
CREATE TYPE "MissionMoveActor" AS ENUM ('PLAYER', 'OPPONENT');
CREATE TYPE "MissionMoveResult" AS ENUM ('CORRECT', 'ACCEPTABLE', 'INCORRECT', 'FORBIDDEN', 'ILLEGAL', 'TIMEOUT');

CREATE TABLE "BadukMission" (
  "id" VARCHAR(60) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "title" VARCHAR(120) NOT NULL,
  "instruction" VARCHAR(500) NOT NULL,
  "status" "BadukMissionStatus" NOT NULL DEFAULT 'DRAFT',
  "level" VARCHAR(20) NOT NULL,
  "volume" INTEGER NOT NULL,
  "lessonNumber" INTEGER NOT NULL,
  "problemGroup" VARCHAR(30) NOT NULL,
  "category" VARCHAR(40) NOT NULL,
  "difficulty" INTEGER NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "eraId" VARCHAR(40),
  "lessonId" VARCHAR(40),
  "textbookPage" VARCHAR(40),
  "boardSize" INTEGER NOT NULL,
  "ruleset" VARCHAR(40) NOT NULL DEFAULT 'japanese_simple_ko',
  "playerColor" VARCHAR(10) NOT NULL,
  "initialBlackStones" JSONB NOT NULL,
  "initialWhiteStones" JSONB NOT NULL,
  "missionType" VARCHAR(40) NOT NULL,
  "successCondition" JSONB,
  "solutionTree" JSONB NOT NULL,
  "hints" JSONB NOT NULL,
  "correctExplanation" TEXT NOT NULL,
  "feedbacks" JSONB NOT NULL,
  "baseScore" INTEGER NOT NULL DEFAULT 100,
  "timeLimitSeconds" INTEGER,
  "retryLimit" INTEGER,
  "isFreeSample" BOOLEAN NOT NULL DEFAULT false,
  "scheduledAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  "publishedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BadukMission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BadukMission_boardSize_check" CHECK ("boardSize" IN (9, 13, 19)),
  CONSTRAINT "BadukMission_playerColor_check" CHECK ("playerColor" IN ('black', 'white')),
  CONSTRAINT "BadukMission_volume_check" CHECK ("volume" BETWEEN 1 AND 6),
  CONSTRAINT "BadukMission_lessonNumber_check" CHECK ("lessonNumber" BETWEEN 1 AND 8),
  CONSTRAINT "BadukMission_difficulty_check" CHECK ("difficulty" BETWEEN 1 AND 5),
  CONSTRAINT "BadukMission_baseScore_check" CHECK ("baseScore" BETWEEN 0 AND 10000)
);

CREATE TABLE "MissionAttempt" (
  "id" UUID NOT NULL,
  "missionId" VARCHAR(60) NOT NULL,
  "missionVersion" INTEGER NOT NULL,
  "userId" UUID,
  "source" VARCHAR(30) NOT NULL,
  "status" "MissionAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "currentNodeId" VARCHAR(80) NOT NULL,
  "missionSnapshot" JSONB NOT NULL,
  "boardState" JSONB NOT NULL,
  "boardHash" VARCHAR(64) NOT NULL,
  "moveCount" INTEGER NOT NULL DEFAULT 0,
  "wrongMoveCount" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "hintLevel" INTEGER NOT NULL DEFAULT 0,
  "hintUseCount" INTEGER NOT NULL DEFAULT 0,
  "score" INTEGER NOT NULL DEFAULT 0,
  "clientAttemptId" VARCHAR(80),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastPlayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "MissionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MissionMove" (
  "id" UUID NOT NULL,
  "attemptId" UUID NOT NULL,
  "clientMoveId" VARCHAR(80) NOT NULL,
  "moveNumber" INTEGER NOT NULL,
  "actor" "MissionMoveActor" NOT NULL,
  "color" VARCHAR(10) NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "result" "MissionMoveResult" NOT NULL,
  "capturedStones" JSONB NOT NULL,
  "nodeId" VARCHAR(80),
  "boardHash" VARCHAR(64) NOT NULL,
  "response" JSONB,
  "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MissionMove_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MissionMove_color_check" CHECK ("color" IN ('black', 'white'))
);

CREATE INDEX "BadukMission_status_displayOrder_idx" ON "BadukMission"("status", "displayOrder");
CREATE INDEX "BadukMission_level_volume_lessonNumber_problemGroup_idx" ON "BadukMission"("level", "volume", "lessonNumber", "problemGroup");
CREATE INDEX "BadukMission_boardSize_category_difficulty_idx" ON "BadukMission"("boardSize", "category", "difficulty");
CREATE INDEX "BadukMission_lessonId_status_idx" ON "BadukMission"("lessonId", "status");
CREATE UNIQUE INDEX "MissionAttempt_clientAttemptId_key" ON "MissionAttempt"("clientAttemptId");
CREATE INDEX "MissionAttempt_missionId_missionVersion_status_idx" ON "MissionAttempt"("missionId", "missionVersion", "status");
CREATE INDEX "MissionAttempt_userId_status_lastPlayedAt_idx" ON "MissionAttempt"("userId", "status", "lastPlayedAt");
CREATE UNIQUE INDEX "MissionMove_attemptId_clientMoveId_key" ON "MissionMove"("attemptId", "clientMoveId");
CREATE UNIQUE INDEX "MissionMove_attemptId_moveNumber_key" ON "MissionMove"("attemptId", "moveNumber");
CREATE INDEX "MissionMove_attemptId_playedAt_idx" ON "MissionMove"("attemptId", "playedAt");

ALTER TABLE "BadukMission" ADD CONSTRAINT "BadukMission_eraId_fkey" FOREIGN KEY ("eraId") REFERENCES "Era"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BadukMission" ADD CONSTRAINT "BadukMission_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BadukMission" ADD CONSTRAINT "BadukMission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BadukMission" ADD CONSTRAINT "BadukMission_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BadukMission" ADD CONSTRAINT "BadukMission_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MissionAttempt" ADD CONSTRAINT "MissionAttempt_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "BadukMission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MissionAttempt" ADD CONSTRAINT "MissionAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MissionMove" ADD CONSTRAINT "MissionMove_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "MissionAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "BadukMission" (
  "id", "title", "instruction", "status", "level", "volume", "lessonNumber", "problemGroup",
  "category", "difficulty", "displayOrder", "boardSize", "playerColor", "initialBlackStones",
  "initialWhiteStones", "missionType", "solutionTree", "hints", "correctExplanation", "feedbacks",
  "baseScore", "isFreeSample", "publishedAt"
) VALUES
(
  'MISSION-9-CAPTURE-001', '9줄 마지막 활로 막기', '백돌 한 점의 마지막 활로를 찾아 흑돌을 놓아 보세요.',
  'PUBLISHED', '입문', 1, 1, '개념 확인', '따내기', 1, 1, 9, 'black',
  '[{"x":3,"y":4},{"x":4,"y":3},{"x":5,"y":4}]'::jsonb,
  '[{"x":4,"y":4}]'::jsonb, 'capture',
  '{"rootNodeId":"n0","nodes":{"n0":{"actor":"player","acceptedMoves":[{"x":4,"y":5,"result":"correct","nextNodeId":"success"}],"forbiddenMoves":[]},"success":{"terminal":"success"}}}'::jsonb,
  '["돌을 잡으려면 모든 활로를 막아야 합니다.","백돌 아래쪽을 살펴보세요.",{"x":4,"y":5}]'::jsonb,
  '백돌의 마지막 활로를 막아 한 점을 잡았습니다.', '{"incorrect":"백돌의 남은 활로를 먼저 찾아보세요."}'::jsonb,
  100, true, CURRENT_TIMESTAMP
),
(
  'MISSION-13-CAPTURE-001', '13줄 두 점 따내기', '연결된 백돌 두 점의 공통 활로를 막아 보세요.',
  'PUBLISHED', '기초', 1, 1, '반복 훈련', '따내기', 2, 2, 13, 'black',
  '[{"x":5,"y":6},{"x":7,"y":6},{"x":5,"y":7},{"x":7,"y":7},{"x":6,"y":5}]'::jsonb,
  '[{"x":6,"y":6},{"x":6,"y":7}]'::jsonb, 'capture',
  '{"rootNodeId":"n0","nodes":{"n0":{"actor":"player","acceptedMoves":[{"x":6,"y":8,"result":"correct","nextNodeId":"success"}],"forbiddenMoves":[]},"success":{"terminal":"success"}}}'::jsonb,
  '["두 돌을 하나의 돌무리로 보고 활로를 세어 보세요.","아래쪽 활로가 하나 남았습니다.",{"x":6,"y":8}]'::jsonb,
  '두 점으로 연결된 백돌의 마지막 활로를 막았습니다.', '{"incorrect":"연결된 돌 전체의 활로를 세어 보세요."}'::jsonb,
  120, true, CURRENT_TIMESTAMP
),
(
  'MISSION-19-BEST-001', '19줄 천원에 두기', '넓은 판의 중심인 천원에 흑돌을 놓아 보세요.',
  'PUBLISHED', '기본', 1, 1, '도전', '포석', 1, 3, 19, 'black',
  '[]'::jsonb, '[]'::jsonb, 'best_move',
  '{"rootNodeId":"n0","nodes":{"n0":{"actor":"player","acceptedMoves":[{"x":9,"y":9,"result":"correct","nextNodeId":"success"}],"forbiddenMoves":[]},"success":{"terminal":"success"}}}'::jsonb,
  '["19줄 판의 가로와 세로 한가운데를 찾아보세요.","10번째 줄끼리 만나는 곳입니다.",{"x":9,"y":9}]'::jsonb,
  '천원은 19줄 바둑판의 정확한 중심입니다.', '{"incorrect":"가로와 세로의 중앙 교차점을 다시 세어 보세요."}'::jsonb,
  100, true, CURRENT_TIMESTAMP
);
