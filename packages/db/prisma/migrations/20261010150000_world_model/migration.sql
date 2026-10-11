-- CreateTable
CREATE TABLE "wm_events" (
    "org_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "event_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "schema_version" SMALLINT NOT NULL,
    "at" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wm_events_pkey" PRIMARY KEY ("org_id","seq")
);

-- CreateTable
CREATE TABLE "wm_audit" (
    "org_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "at" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "event_id" TEXT,
    "run_id" TEXT,

    CONSTRAINT "wm_audit_pkey" PRIMARY KEY ("org_id","seq")
);

-- CreateTable
CREATE TABLE "wm_state" (
    "org_id" UUID NOT NULL,
    "side" JSONB NOT NULL,
    "schema_version" SMALLINT NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wm_state_pkey" PRIMARY KEY ("org_id")
);

-- AddForeignKey
ALTER TABLE "wm_events" ADD CONSTRAINT "wm_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wm_audit" ADD CONSTRAINT "wm_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wm_state" ADD CONSTRAINT "wm_state_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

