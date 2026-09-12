ALTER TABLE "CommunityAttachment"
  ADD COLUMN "editorialContentId" UUID;

CREATE UNIQUE INDEX "CommunityAttachment_editorialContentId_key"
  ON "CommunityAttachment"("editorialContentId");

ALTER TABLE "CommunityAttachment"
  ADD CONSTRAINT "CommunityAttachment_editorialContentId_fkey"
  FOREIGN KEY ("editorialContentId") REFERENCES "EditorialContent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityAttachment"
  ADD CONSTRAINT "CommunityAttachment_single_parent_check"
  CHECK (num_nonnulls("postId", "editorialContentId") <= 1);
