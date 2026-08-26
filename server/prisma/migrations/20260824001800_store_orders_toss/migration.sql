CREATE TYPE "StoreOrderStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED', 'FAILED');

CREATE TABLE "StoreProduct" (
    "id" VARCHAR(40) NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreOrder" (
    "id" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "orderName" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "StoreOrderStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'toss-payments',
    "providerPaymentId" TEXT,
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreOrderItem" (
    "id" UUID NOT NULL,
    "orderId" VARCHAR(64) NOT NULL,
    "productId" VARCHAR(40) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceSnapshot" INTEGER NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "lineAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoreOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreProduct_active_sortOrder_idx" ON "StoreProduct"("active", "sortOrder");
CREATE UNIQUE INDEX "StoreOrder_providerPaymentId_key" ON "StoreOrder"("providerPaymentId");
CREATE INDEX "StoreOrder_userId_status_createdAt_idx" ON "StoreOrder"("userId", "status", "createdAt");
CREATE INDEX "StoreOrder_expiresAt_idx" ON "StoreOrder"("expiresAt");
CREATE UNIQUE INDEX "StoreOrderItem_orderId_productId_key" ON "StoreOrderItem"("orderId", "productId");
CREATE INDEX "StoreOrderItem_productId_idx" ON "StoreOrderItem"("productId");

ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreOrderItem" ADD CONSTRAINT "StoreOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreOrderItem" ADD CONSTRAINT "StoreOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StoreProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "StoreProduct" ("id", "name", "price", "active", "sortOrder", "updatedAt") VALUES
('workbook-prehistory', '선사·고조선 편 워크북', 18000, true, 10, CURRENT_TIMESTAMP),
('teacher-package', '교사용 수업 패키지', 25000, true, 20, CURRENT_TIMESTAMP),
('starter-kit', '첫 여행 체험 키트', 39000, true, 30, CURRENT_TIMESTAMP);
