CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "hmem_memories" (
    "org_id" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "record" JSONB NOT NULL,
    "embedding" vector,
    "embedding_model" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hmem_memories_pkey" PRIMARY KEY ("org_id","id")
);

-- CreateTable
CREATE TABLE "hmem_ledger" (
    "org_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "memory_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "previous_state" JSONB,
    "new_state" JSONB,
    "details" JSONB,

    CONSTRAINT "hmem_ledger_pkey" PRIMARY KEY ("org_id","seq")
);

-- CreateTable
CREATE TABLE "hmem_state" (
    "org_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "side" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hmem_state_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "hmem_backups" (
    "org_id" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hmem_backups_pkey" PRIMARY KEY ("org_id","id")
);

-- CreateIndex
CREATE INDEX "hmem_ledger_org_id_memory_id_idx" ON "hmem_ledger"("org_id", "memory_id");

-- AddForeignKey
ALTER TABLE "hmem_memories" ADD CONSTRAINT "hmem_memories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hmem_ledger" ADD CONSTRAINT "hmem_ledger_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hmem_state" ADD CONSTRAINT "hmem_state_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hmem_backups" ADD CONSTRAINT "hmem_backups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

