-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('pending', 'matched', 'unmatched', 'ambiguous', 'ignored');

-- DropIndex
DROP INDEX "contacts_org_id_email_idx";

-- DropIndex
DROP INDEX "source_items_org_id_idx";

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "crm_external_id" TEXT;

-- AlterTable
ALTER TABLE "source_items" ADD COLUMN     "container_id" TEXT,
ADD COLUMN     "container_label" TEXT,
ADD COLUMN     "match_reason" TEXT,
ADD COLUMN     "match_status" "MatchStatus" NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "source_mappings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "container_id" TEXT NOT NULL,
    "container_label" TEXT,
    "account_id" UUID,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_mappings_org_id_idx" ON "source_mappings"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_mappings_connection_id_container_id_key" ON "source_mappings"("connection_id", "container_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_org_id_crm_external_id_key" ON "accounts"("org_id", "crm_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_org_id_crm_external_id_key" ON "contacts"("org_id", "crm_external_id");

-- CreateIndex
CREATE INDEX "source_items_org_id_match_status_idx" ON "source_items"("org_id", "match_status");

-- CreateIndex
CREATE INDEX "source_items_connection_id_container_id_idx" ON "source_items"("connection_id", "container_id");

-- AddForeignKey
ALTER TABLE "source_mappings" ADD CONSTRAINT "source_mappings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_mappings" ADD CONSTRAINT "source_mappings_connection_id_org_id_fkey" FOREIGN KEY ("connection_id", "org_id") REFERENCES "connections"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_mappings" ADD CONSTRAINT "source_mappings_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "contacts_org_id_email_active_key" RENAME TO "contacts_org_id_email_key";


-- Mappings reference accounts like other business rows do: checked at commit.
ALTER TABLE source_mappings ALTER CONSTRAINT source_mappings_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
