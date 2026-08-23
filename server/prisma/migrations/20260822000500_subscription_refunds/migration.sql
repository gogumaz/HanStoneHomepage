CREATE TYPE "SubscriptionRefundStatus" AS ENUM ('COMPLETED');

ALTER TABLE "SubscriptionOrder"
ADD COLUMN "refundedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "refundedAt" TIMESTAMP(3);

ALTER TABLE "AccountSubscription"
ADD COLUMN "refundedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "refundedAt" TIMESTAMP(3);

CREATE TABLE "SubscriptionRefund" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "requestedById" UUID,
    "providerCancellationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "cumulativeAmount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SubscriptionRefundStatus" NOT NULL DEFAULT 'COMPLETED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionRefund_providerCancellationId_key" ON "SubscriptionRefund"("providerCancellationId");
CREATE INDEX "SubscriptionRefund_subscriptionId_completedAt_idx" ON "SubscriptionRefund"("subscriptionId", "completedAt");
CREATE INDEX "SubscriptionRefund_requestedById_requestedAt_idx" ON "SubscriptionRefund"("requestedById", "requestedAt");

ALTER TABLE "SubscriptionRefund" ADD CONSTRAINT "SubscriptionRefund_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AccountSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionRefund" ADD CONSTRAINT "SubscriptionRefund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
