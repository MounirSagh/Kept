-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'manager', 'member');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('gmail', 'outlook', 'slack', 'teams', 'hubspot', 'gdrive', 'zendesk', 'calendar');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('active', 'expired', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "AccountMemberRole" AS ENUM ('owner', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('email', 'message', 'document', 'ticket', 'deal', 'invoice', 'transcript', 'event');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('commitment', 'obligation', 'decision', 'deadline', 'preference', 'risk');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('open', 'fulfilled', 'broken', 'unknown', 'superseded');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('new_data', 'schedule', 'meeting', 'chat', 'manual');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentName" AS ENUM ('planner', 'investigator', 'critic', 'advisor', 'executor');

-- CreateEnum
CREATE TYPE "CriticVerdict" AS ENUM ('approved', 'needs_evidence', 'rejected');

-- CreateEnum
CREATE TYPE "FlagKind" AS ENUM ('unkept_promise', 'mismatch', 'deadline_risk', 'churn_signal');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('open', 'confirmed', 'dismissed', 'resolved');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "EvidenceStance" AS ENUM ('supports', 'contradicts', 'context');

-- CreateEnum
CREATE TYPE "BriefKind" AS ENUM ('account', 'meeting_prep', 'handover');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('send_email', 'create_ticket', 'update_crm', 'schedule_reminder', 'internal_alert');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('pending', 'approved', 'rejected', 'executing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('scheduled', 'sent', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'member',
    "token_hash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "invited_by_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "owner_user_id" UUID,
    "connected_by_id" UUID,
    "external_account_id" TEXT NOT NULL,
    "access_token_enc" BYTEA,
    "refresh_token_enc" BYTEA,
    "token_key_version" SMALLINT,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'active',
    "sync_cursor" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "crm_external_id" TEXT,
    "owner_user_id" UUID,
    "annual_value_cents" BIGINT,
    "currency" CHAR(3),
    "renewal_date" DATE,
    "health_score" SMALLINT,
    "world_model_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_members" (
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "AccountMemberRole" NOT NULL DEFAULT 'member',

    CONSTRAINT "account_members_pkey" PRIMARY KEY ("account_id","user_id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID,
    "full_name" TEXT,
    "email" TEXT,
    "title" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "world_model_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_items" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "account_id" UUID,
    "kind" "SourceKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "author" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "content_text" TEXT,
    "content_hash" TEXT NOT NULL,
    "visible_to_user_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "source_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "source_item_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_items" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID,
    "type" "ItemType" NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "made_by" TEXT,
    "owner_user_id" UUID,
    "due_date" DATE,
    "status" "ItemStatus" NOT NULL DEFAULT 'open',
    "confidence" DECIMAL(3,2),
    "source_item_id" UUID NOT NULL,
    "source_excerpt" TEXT,
    "visible_to_user_id" UUID,
    "world_model_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "extracted_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID,
    "trigger" "TriggerType" NOT NULL,
    "trigger_ref" TEXT,
    "requested_by_id" UUID,
    "visible_to_user_id" UUID,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "plan" JSONB,
    "critic_iterations" SMALLINT NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "langsmith_trace_id" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "agent" "AgentName" NOT NULL,
    "action" TEXT NOT NULL,
    "input_summary" TEXT,
    "output" JSONB,
    "verdict" "CriticVerdict",
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "status" "RunStatus" NOT NULL DEFAULT 'completed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flags" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "run_id" UUID,
    "kind" "FlagKind" NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "confidence" DECIMAL(3,2),
    "impact_cents" BIGINT,
    "status" "FlagStatus" NOT NULL DEFAULT 'open',
    "visible_to_user_id" UUID,
    "resolved_by_id" UUID,
    "resolution_note" TEXT,
    "hmem_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flag_evidence" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "flag_id" UUID NOT NULL,
    "source_item_id" UUID,
    "extracted_item_id" UUID,
    "stance" "EvidenceStance" NOT NULL,
    "excerpt" TEXT,

    CONSTRAINT "flag_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "run_id" UUID,
    "kind" "BriefKind" NOT NULL,
    "content_md" TEXT NOT NULL,
    "visible_to_user_id" UUID,
    "meeting_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_citations" (
    "brief_id" UUID NOT NULL,
    "marker" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "source_item_id" UUID NOT NULL,

    CONSTRAINT "brief_citations_pkey" PRIMARY KEY ("brief_id","marker")
);

-- CreateTable
CREATE TABLE "proposed_actions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID,
    "flag_id" UUID,
    "run_id" UUID,
    "type" "ActionType" NOT NULL,
    "payload" JSONB NOT NULL,
    "rationale" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "status" "ActionStatus" NOT NULL DEFAULT 'pending',
    "idempotency_key" UUID NOT NULL,
    "visible_to_user_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "edited_payload" JSONB,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "result" JSONB,
    "last_error" TEXT,
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposed_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID,
    "user_id" UUID NOT NULL,
    "extracted_item_id" UUID,
    "action_id" UUID,
    "title" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "bull_job_id" TEXT,
    "status" "ReminderStatus" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_citations" (
    "message_id" UUID NOT NULL,
    "marker" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "source_item_id" UUID NOT NULL,

    CONSTRAINT "message_citations_pkey" PRIMARY KEY ("message_id","marker")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_org_id_user_id_key" ON "memberships"("org_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_org_id_status_idx" ON "invitations"("org_id", "status");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_invited_by_id_idx" ON "invitations"("invited_by_id");

-- CreateIndex
CREATE INDEX "connections_owner_user_id_idx" ON "connections"("owner_user_id");

-- CreateIndex
CREATE INDEX "connections_connected_by_id_idx" ON "connections"("connected_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "connections_id_org_id_key" ON "connections"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "connections_org_id_provider_external_account_id_key" ON "connections"("org_id", "provider", "external_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_connection_id_external_event_id_key" ON "webhook_events"("connection_id", "external_event_id");

-- CreateIndex
CREATE INDEX "accounts_org_id_domain_idx" ON "accounts"("org_id", "domain");

-- CreateIndex
CREATE INDEX "accounts_org_id_renewal_date_idx" ON "accounts"("org_id", "renewal_date");

-- CreateIndex
CREATE INDEX "accounts_owner_user_id_idx" ON "accounts"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_id_org_id_key" ON "accounts"("id", "org_id");

-- CreateIndex
CREATE INDEX "account_members_user_id_idx" ON "account_members"("user_id");

-- CreateIndex
CREATE INDEX "contacts_org_id_email_idx" ON "contacts"("org_id", "email");

-- CreateIndex
CREATE INDEX "contacts_account_id_idx" ON "contacts"("account_id");

-- CreateIndex
CREATE INDEX "source_items_account_id_occurred_at_idx" ON "source_items"("account_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "source_items_org_id_idx" ON "source_items"("org_id");

-- CreateIndex
CREATE INDEX "source_items_visible_to_user_id_idx" ON "source_items"("visible_to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_items_id_org_id_key" ON "source_items"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_items_connection_id_external_id_key" ON "source_items"("connection_id", "external_id");

-- CreateIndex
CREATE INDEX "chunks_org_id_idx" ON "chunks"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "chunks_source_item_id_chunk_index_key" ON "chunks"("source_item_id", "chunk_index");

-- CreateIndex
CREATE INDEX "extracted_items_account_id_type_status_idx" ON "extracted_items"("account_id", "type", "status");

-- CreateIndex
CREATE INDEX "extracted_items_org_id_due_date_idx" ON "extracted_items"("org_id", "due_date");

-- CreateIndex
CREATE INDEX "extracted_items_source_item_id_idx" ON "extracted_items"("source_item_id");

-- CreateIndex
CREATE INDEX "extracted_items_owner_user_id_idx" ON "extracted_items"("owner_user_id");

-- CreateIndex
CREATE INDEX "extracted_items_visible_to_user_id_idx" ON "extracted_items"("visible_to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_items_id_org_id_key" ON "extracted_items"("id", "org_id");

-- CreateIndex
CREATE INDEX "agent_runs_account_id_created_at_idx" ON "agent_runs"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "agent_runs_org_id_status_idx" ON "agent_runs"("org_id", "status");

-- CreateIndex
CREATE INDEX "agent_runs_requested_by_id_idx" ON "agent_runs"("requested_by_id");

-- CreateIndex
CREATE INDEX "agent_runs_visible_to_user_id_idx" ON "agent_runs"("visible_to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_id_org_id_key" ON "agent_runs"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_steps_run_id_step_index_key" ON "agent_steps"("run_id", "step_index");

-- CreateIndex
CREATE INDEX "flags_org_id_account_id_status_idx" ON "flags"("org_id", "account_id", "status");

-- CreateIndex
CREATE INDEX "flags_run_id_idx" ON "flags"("run_id");

-- CreateIndex
CREATE INDEX "flags_resolved_by_id_idx" ON "flags"("resolved_by_id");

-- CreateIndex
CREATE INDEX "flags_visible_to_user_id_idx" ON "flags"("visible_to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "flags_id_org_id_key" ON "flags"("id", "org_id");

-- CreateIndex
CREATE INDEX "flag_evidence_flag_id_idx" ON "flag_evidence"("flag_id");

-- CreateIndex
CREATE INDEX "flag_evidence_source_item_id_idx" ON "flag_evidence"("source_item_id");

-- CreateIndex
CREATE INDEX "flag_evidence_extracted_item_id_idx" ON "flag_evidence"("extracted_item_id");

-- CreateIndex
CREATE INDEX "briefs_account_id_created_at_idx" ON "briefs"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "briefs_org_id_idx" ON "briefs"("org_id");

-- CreateIndex
CREATE INDEX "briefs_run_id_idx" ON "briefs"("run_id");

-- CreateIndex
CREATE INDEX "briefs_visible_to_user_id_idx" ON "briefs"("visible_to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "briefs_id_org_id_key" ON "briefs"("id", "org_id");

-- CreateIndex
CREATE INDEX "brief_citations_source_item_id_idx" ON "brief_citations"("source_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposed_actions_idempotency_key_key" ON "proposed_actions"("idempotency_key");

-- CreateIndex
CREATE INDEX "proposed_actions_org_id_status_created_at_idx" ON "proposed_actions"("org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "proposed_actions_account_id_idx" ON "proposed_actions"("account_id");

-- CreateIndex
CREATE INDEX "proposed_actions_flag_id_idx" ON "proposed_actions"("flag_id");

-- CreateIndex
CREATE INDEX "proposed_actions_run_id_idx" ON "proposed_actions"("run_id");

-- CreateIndex
CREATE INDEX "proposed_actions_decided_by_id_idx" ON "proposed_actions"("decided_by_id");

-- CreateIndex
CREATE INDEX "proposed_actions_visible_to_user_id_idx" ON "proposed_actions"("visible_to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposed_actions_id_org_id_key" ON "proposed_actions"("id", "org_id");

-- CreateIndex
CREATE INDEX "reminders_due_at_status_idx" ON "reminders"("due_at", "status");

-- CreateIndex
CREATE INDEX "reminders_org_id_idx" ON "reminders"("org_id");

-- CreateIndex
CREATE INDEX "reminders_account_id_idx" ON "reminders"("account_id");

-- CreateIndex
CREATE INDEX "reminders_user_id_idx" ON "reminders"("user_id");

-- CreateIndex
CREATE INDEX "reminders_extracted_item_id_idx" ON "reminders"("extracted_item_id");

-- CreateIndex
CREATE INDEX "reminders_action_id_idx" ON "reminders"("action_id");

-- CreateIndex
CREATE INDEX "conversations_user_id_created_at_idx" ON "conversations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_org_id_idx" ON "conversations"("org_id");

-- CreateIndex
CREATE INDEX "conversations_account_id_idx" ON "conversations"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_id_org_id_key" ON "conversations"("id", "org_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_run_id_idx" ON "messages"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_id_org_id_key" ON "messages"("id", "org_id");

-- CreateIndex
CREATE INDEX "message_citations_source_item_id_idx" ON "message_citations"("source_item_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_connected_by_id_fkey" FOREIGN KEY ("connected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_connection_id_org_id_fkey" FOREIGN KEY ("connection_id", "org_id") REFERENCES "connections"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_visible_to_user_id_fkey" FOREIGN KEY ("visible_to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_source_item_id_org_id_fkey" FOREIGN KEY ("source_item_id", "org_id") REFERENCES "source_items"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_items" ADD CONSTRAINT "extracted_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_items" ADD CONSTRAINT "extracted_items_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_items" ADD CONSTRAINT "extracted_items_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_items" ADD CONSTRAINT "extracted_items_source_item_id_org_id_fkey" FOREIGN KEY ("source_item_id", "org_id") REFERENCES "source_items"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_items" ADD CONSTRAINT "extracted_items_visible_to_user_id_fkey" FOREIGN KEY ("visible_to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_visible_to_user_id_fkey" FOREIGN KEY ("visible_to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "agent_runs"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_visible_to_user_id_fkey" FOREIGN KEY ("visible_to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flag_evidence" ADD CONSTRAINT "flag_evidence_flag_id_org_id_fkey" FOREIGN KEY ("flag_id", "org_id") REFERENCES "flags"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flag_evidence" ADD CONSTRAINT "flag_evidence_source_item_id_org_id_fkey" FOREIGN KEY ("source_item_id", "org_id") REFERENCES "source_items"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flag_evidence" ADD CONSTRAINT "flag_evidence_extracted_item_id_org_id_fkey" FOREIGN KEY ("extracted_item_id", "org_id") REFERENCES "extracted_items"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "agent_runs"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_visible_to_user_id_fkey" FOREIGN KEY ("visible_to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_citations" ADD CONSTRAINT "brief_citations_brief_id_org_id_fkey" FOREIGN KEY ("brief_id", "org_id") REFERENCES "briefs"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_citations" ADD CONSTRAINT "brief_citations_source_item_id_org_id_fkey" FOREIGN KEY ("source_item_id", "org_id") REFERENCES "source_items"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_flag_id_org_id_fkey" FOREIGN KEY ("flag_id", "org_id") REFERENCES "flags"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "agent_runs"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_visible_to_user_id_fkey" FOREIGN KEY ("visible_to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_extracted_item_id_org_id_fkey" FOREIGN KEY ("extracted_item_id", "org_id") REFERENCES "extracted_items"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_action_id_org_id_fkey" FOREIGN KEY ("action_id", "org_id") REFERENCES "proposed_actions"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_org_id_fkey" FOREIGN KEY ("account_id", "org_id") REFERENCES "accounts"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_org_id_fkey" FOREIGN KEY ("conversation_id", "org_id") REFERENCES "conversations"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "agent_runs"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_message_id_org_id_fkey" FOREIGN KEY ("message_id", "org_id") REFERENCES "messages"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_source_item_id_org_id_fkey" FOREIGN KEY ("source_item_id", "org_id") REFERENCES "source_items"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Constraints Prisma cannot express in the schema

-- Emails and domains are stored lowercase so uniqueness is case-insensitive
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_domain_lowercase_check" CHECK ("domain" = lower("domain"));

-- Uniqueness that only applies to live rows
CREATE UNIQUE INDEX "invitations_org_id_email_pending_key" ON "invitations"("org_id", "email") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "accounts_org_id_domain_active_key" ON "accounts"("org_id", "domain") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "contacts_org_id_email_active_key" ON "contacts"("org_id", "email") WHERE "deleted_at" IS NULL;

-- Value ranges
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_health_score_check" CHECK ("health_score" BETWEEN 0 AND 100);
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_annual_value_cents_check" CHECK ("annual_value_cents" >= 0);
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_value_currency_check" CHECK (("annual_value_cents" IS NULL) = ("currency" IS NULL));
ALTER TABLE "extracted_items" ADD CONSTRAINT "extracted_items_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1);
ALTER TABLE "flags" ADD CONSTRAINT "flags_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1);
ALTER TABLE "flags" ADD CONSTRAINT "flags_impact_cents_check" CHECK ("impact_cents" >= 0);

-- Encrypted tokens must record which key encrypted them
ALTER TABLE "connections" ADD CONSTRAINT "connections_token_key_version_check" CHECK (("access_token_enc" IS NULL AND "refresh_token_enc" IS NULL) OR "token_key_version" IS NOT NULL);

-- Evidence must point at something
ALTER TABLE "flag_evidence" ADD CONSTRAINT "flag_evidence_target_check" CHECK ("source_item_id" IS NOT NULL OR "extracted_item_id" IS NOT NULL);
