-- AlterEnum
BEGIN;
CREATE TYPE "OrgRole_new" AS ENUM ('owner', 'manager', 'member');
ALTER TABLE "public"."invitations" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."memberships" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "OrgRole_new" USING ("role"::text::"OrgRole_new");
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "OrgRole_new" USING ("role"::text::"OrgRole_new");
ALTER TYPE "OrgRole" RENAME TO "OrgRole_old";
ALTER TYPE "OrgRole_new" RENAME TO "OrgRole";
DROP TYPE "public"."OrgRole_old";
ALTER TABLE "invitations" ALTER COLUMN "role" SET DEFAULT 'member';
ALTER TABLE "memberships" ALTER COLUMN "role" SET DEFAULT 'member';
COMMIT;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "team_id" UUID;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "team_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_platform_admin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_org_id_key" ON "teams"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_org_id_name_key" ON "teams"("org_id", "name");

-- CreateIndex
CREATE INDEX "invitations_team_id_idx" ON "invitations"("team_id");

-- CreateIndex
CREATE INDEX "memberships_team_id_idx" ON "memberships"("team_id");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_id_org_id_fkey" FOREIGN KEY ("team_id", "org_id") REFERENCES "teams"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_team_id_org_id_fkey" FOREIGN KEY ("team_id", "org_id") REFERENCES "teams"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Team references are checked at commit, like the other business references,
-- so deleting an org cascades through teams and memberships in any order
ALTER TABLE memberships ALTER CONSTRAINT memberships_team_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE invitations ALTER CONSTRAINT invitations_team_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
