-- Which version of a source item commitments were last extracted from.
ALTER TABLE "source_items" ADD COLUMN "extracted_hash" TEXT;
CREATE INDEX "source_items_account_id_extracted_hash_idx" ON "source_items"("account_id", "extracted_hash");

-- Flags carry what they're about, so later agent runs don't raise the same issue twice.
ALTER TABLE "flags" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "flags_org_id_dedupe_key_key" ON "flags"("org_id", "dedupe_key");
