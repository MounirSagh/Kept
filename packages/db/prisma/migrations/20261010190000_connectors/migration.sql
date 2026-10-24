-- AlterEnum
BEGIN;
CREATE TYPE "Provider_new" AS ENUM ('microsoft', 'google', 'slack', 'linear', 'notion', 'hubspot', 'zendesk', 'salesforce');
ALTER TABLE "connections" ALTER COLUMN "provider" TYPE "Provider_new" USING ("provider"::text::"Provider_new");
ALTER TYPE "Provider" RENAME TO "Provider_old";
ALTER TYPE "Provider_new" RENAME TO "Provider";
DROP TYPE "public"."Provider_old";
COMMIT;

-- AlterEnum
ALTER TYPE "SourceKind" ADD VALUE 'crm_record';

-- AlterTable
ALTER TABLE "connections" DROP COLUMN "sync_cursor",
ADD COLUMN     "label" TEXT,
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "sync_state" JSONB NOT NULL DEFAULT '{}';

