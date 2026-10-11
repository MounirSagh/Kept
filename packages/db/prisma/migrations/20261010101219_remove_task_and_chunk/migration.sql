-- DropForeignKey
ALTER TABLE "chunks" DROP CONSTRAINT "chunks_org_id_fkey";

-- DropForeignKey
ALTER TABLE "chunks" DROP CONSTRAINT "chunks_source_item_id_org_id_fkey";

-- DropTable
DROP TABLE "Task";

-- DropTable
DROP TABLE "chunks";

-- DropEnum
DROP TYPE "TaskStatus";

