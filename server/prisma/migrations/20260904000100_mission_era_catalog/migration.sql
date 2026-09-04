-- Attach the original sample missions to the prehistoric journey so era-based
-- homepage entry can open the first published mission without hard-coded IDs.
UPDATE "BadukMission"
SET "eraId" = 'era_prehistoric'
WHERE "eraId" IS NULL
  AND "id" IN (
    'MISSION-9-CAPTURE-001',
    'MISSION-13-CAPTURE-001',
    'MISSION-19-BEST-001'
  );

CREATE INDEX "BadukMission_eraId_status_displayOrder_idx"
ON "BadukMission"("eraId", "status", "displayOrder");
