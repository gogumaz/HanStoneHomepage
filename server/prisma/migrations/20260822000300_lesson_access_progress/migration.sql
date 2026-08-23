-- CreateEnum
CREATE TYPE "LessonStepType" AS ENUM ('HISTORY_STORY', 'BADUK_CONCEPT', 'BADUK_MISSION', 'HISTORY_MISSION', 'REFLECTION', 'REWARD');
CREATE TYPE "LessonProgressStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PAID', 'CANCELED', 'REFUNDED');

-- CreateTable
CREATE TABLE "LessonStep" (
    "id" VARCHAR(60) NOT NULL,
    "lessonId" VARCHAR(40) NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "LessonStepType" NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LessonStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonProgress" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lessonId" VARCHAR(40) NOT NULL,
    "status" "LessonProgressStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "lastPositionSeconds" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonStepCompletion" (
    "id" UUID NOT NULL,
    "progressId" UUID NOT NULL,
    "stepId" VARCHAR(60) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LessonStepCompletion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionPlan" (
    "id" VARCHAR(40) NOT NULL,
    "label" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planId" VARCHAR(40) NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "planLabelSnapshot" TEXT NOT NULL,
    "monthsSnapshot" INTEGER NOT NULL,
    "amountSnapshot" INTEGER NOT NULL,
    "paymentStatus" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PAID',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LessonStep_lessonId_order_key" ON "LessonStep"("lessonId", "order");
CREATE INDEX "LessonStep_lessonId_order_idx" ON "LessonStep"("lessonId", "order");
CREATE UNIQUE INDEX "LessonProgress_userId_lessonId_key" ON "LessonProgress"("userId", "lessonId");
CREATE INDEX "LessonProgress_userId_status_idx" ON "LessonProgress"("userId", "status");
CREATE INDEX "LessonProgress_lessonId_status_idx" ON "LessonProgress"("lessonId", "status");
CREATE UNIQUE INDEX "LessonStepCompletion_progressId_stepId_key" ON "LessonStepCompletion"("progressId", "stepId");
CREATE INDEX "LessonStepCompletion_stepId_idx" ON "LessonStepCompletion"("stepId");
CREATE INDEX "SubscriptionPlan_active_months_idx" ON "SubscriptionPlan"("active", "months");
CREATE UNIQUE INDEX "AccountSubscription_orderId_key" ON "AccountSubscription"("orderId");
CREATE UNIQUE INDEX "AccountSubscription_paymentId_key" ON "AccountSubscription"("paymentId");
CREATE INDEX "AccountSubscription_userId_paymentStatus_startsAt_endsAt_idx" ON "AccountSubscription"("userId", "paymentStatus", "startsAt", "endsAt");
CREATE INDEX "AccountSubscription_endsAt_idx" ON "AccountSubscription"("endsAt");

-- AddForeignKey
ALTER TABLE "LessonStep" ADD CONSTRAINT "LessonStep_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonStepCompletion" ADD CONSTRAINT "LessonStepCompletion_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "LessonProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonStepCompletion" ADD CONSTRAINT "LessonStepCompletion_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "LessonStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountSubscription" ADD CONSTRAINT "AccountSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountSubscription" ADD CONSTRAINT "AccountSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the fixed account subscription plans used by the catalog and future order API.
INSERT INTO "SubscriptionPlan" ("id", "label", "months", "price", "active", "recommended", "createdAt", "updatedAt") VALUES
  ('subscription-1m', '1개월', 1, 10000, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('subscription-3m', '3개월', 3, 30000, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('subscription-6m', '6개월', 6, 50000, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('subscription-12m', '12개월', 12, 100000, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Seed the six required learning stages for the initial PRE-01 lesson.
INSERT INTO "LessonStep" ("id", "lessonId", "order", "type", "title", "createdAt", "updatedAt") VALUES
  ('PRE-01-01', 'PRE-01', 1, 'HISTORY_STORY', '역사 이야기', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('PRE-01-02', 'PRE-01', 2, 'BADUK_CONCEPT', '오늘의 한 수', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('PRE-01-03', 'PRE-01', 3, 'BADUK_MISSION', '판 위의 미션', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('PRE-01-04', 'PRE-01', 4, 'HISTORY_MISSION', '역사 미션', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('PRE-01-05', 'PRE-01', 5, 'REFLECTION', '생각 한 수', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('PRE-01-06', 'PRE-01', 6, 'REWARD', '보상', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
