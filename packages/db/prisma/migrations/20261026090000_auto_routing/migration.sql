-- Automatic routing: mappings record who made them and, for Kept's, why.
ALTER TABLE "source_mappings" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE "source_mappings" ADD COLUMN "reason" TEXT;
