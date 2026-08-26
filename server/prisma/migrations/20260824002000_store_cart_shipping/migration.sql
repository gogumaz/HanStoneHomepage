ALTER TABLE "StoreProduct"
ADD COLUMN "requiresShipping" BOOLEAN NOT NULL DEFAULT true;

UPDATE "StoreProduct"
SET "requiresShipping" = false
WHERE "id" = 'teacher-package';

ALTER TABLE "StoreOrder"
ADD COLUMN "recipientName" TEXT,
ADD COLUMN "recipientPhone" VARCHAR(30),
ADD COLUMN "postalCode" VARCHAR(10),
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT;

CREATE TABLE "StoreCartItem" (
    "userId" UUID NOT NULL,
    "productId" VARCHAR(40) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCartItem_pkey" PRIMARY KEY ("userId", "productId")
);

CREATE INDEX "StoreCartItem_productId_idx" ON "StoreCartItem"("productId");

ALTER TABLE "StoreCartItem"
ADD CONSTRAINT "StoreCartItem_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreCartItem"
ADD CONSTRAINT "StoreCartItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "StoreProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
