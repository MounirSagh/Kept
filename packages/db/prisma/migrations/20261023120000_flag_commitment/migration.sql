-- A flag about a promise points at it, so the commitment can show it's at risk.
ALTER TABLE "flags" ADD COLUMN "extracted_item_id" UUID;
CREATE INDEX "flags_extracted_item_id_idx" ON "flags"("extracted_item_id");
ALTER TABLE "flags" ADD CONSTRAINT "flags_extracted_item_id_org_id_fkey"
  FOREIGN KEY ("extracted_item_id", "org_id") REFERENCES "extracted_items"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Existing flags carried the commitment in their dedupe key: "<account>:<kind>:<commitment id>".
UPDATE "flags" f SET "extracted_item_id" = e."id"
FROM "extracted_items" e
WHERE split_part(f."dedupe_key", ':', 3) ~ '^[0-9a-f-]{36}$'
  AND e."id" = split_part(f."dedupe_key", ':', 3)::uuid
  AND e."org_id" = f."org_id";
