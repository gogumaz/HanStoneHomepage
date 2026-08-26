CREATE TYPE "SubscriptionOrderStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED', 'FAILED');

CREATE TABLE "SubscriptionOrder" (
    "id" VARCHAR(80) NOT NULL,
    "userId" UUID NOT NULL,
    "planId" VARCHAR(40) NOT NULL,
    "orderName" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "planLabelSnapshot" TEXT NOT NULL,
    "monthsSnapshot" INTEGER NOT NULL,
    "status" "SubscriptionOrderStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'toss-payments',
    "providerPaymentId" TEXT,
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionOrder_providerPaymentId_key" ON "SubscriptionOrder"("providerPaymentId");
CREATE INDEX "SubscriptionOrder_userId_status_createdAt_idx" ON "SubscriptionOrder"("userId", "status", "createdAt");
CREATE INDEX "SubscriptionOrder_expiresAt_idx" ON "SubscriptionOrder"("expiresAt");

ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionOrder" ADD CONSTRAINT "SubscriptionOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
