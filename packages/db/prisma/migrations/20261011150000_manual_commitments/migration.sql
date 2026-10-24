-- CreateEnum
CREATE TYPE "ItemOrigin" AS ENUM ('extracted', 'manual', 'import');

-- AlterTable
ALTER TABLE "extracted_items" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "origin" "ItemOrigin" NOT NULL DEFAULT 'extracted',
ALTER COLUMN "source_item_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "extracted_items" ADD CONSTRAINT "extracted_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

