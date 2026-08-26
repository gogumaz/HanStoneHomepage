ALTER TABLE "SubscriptionOrder"
ALTER COLUMN "provider" SET DEFAULT 'toss-payments';

UPDATE "SubscriptionOrder"
SET "provider" = 'toss-payments'
WHERE "provider" <> 'toss-payments';
