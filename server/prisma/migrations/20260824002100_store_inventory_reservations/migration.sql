ALTER TABLE "StoreProduct"
ADD COLUMN "stockQuantity" INTEGER;

UPDATE "StoreProduct"
SET "stockQuantity" = CASE
  WHEN "id" = 'workbook-prehistory' THEN 100
  WHEN "id" = 'starter-kit' THEN 50
  ELSE NULL
END;

ALTER TABLE "StoreProduct"
ADD CONSTRAINT "StoreProduct_stockQuantity_check"
CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0);

ALTER TABLE "StoreOrder"
ADD COLUMN "inventoryReservedAt" TIMESTAMP(3),
ADD COLUMN "inventoryReleasedAt" TIMESTAMP(3);

CREATE INDEX "StoreOrder_inventory_expiry_idx"
ON "StoreOrder"("status", "expiresAt", "inventoryReleasedAt");
