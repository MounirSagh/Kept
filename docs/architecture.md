# Kept architecture: sources, context layer, agents

Status: proposal, decisions agreed 2026-10-10. Nothing here is implemented yet beyond what the "Today" section describes.

## Decisions

| Decision | Choice |
| --- | --- |
| Deployment | Multi-tenant cloud SaaS. Every org's data lives in our Postgres, scoped by `org_id`. |
| Customer data access | **Zetaris** first: one Kept-owned Zetaris account with a catalog per org. Where Zetaris can't reach a tool, Kept ships a **direct connector** behind the same source interface. |
| Client separation | Each org's tools hold all of its clients' data together. Kept assigns every item to an `Account` (a client) via World Model entity resolution; unclear matches go to a review queue. |
| Speed | Source content is synced into Kept's Postgres (encrypted at rest). Zetaris and direct connectors are only used by background sync, never on the request path. |
| Kept's own analytics | **Zetaris** as well, querying Kept's data (read replica) alongside the org's sources for reporting. |
| Context layer | **Meterless** open-source engines, implemented in our stack against their specs and conformance suites. Phase 1: **World Model** and **H-MEM**. **Markovian** arrives with the agent pipeline; **Scout Intent** later (spec only today). |
| Models | **OpenAI** for all generation and embeddings, behind the `Generator` and `Embedder` interfaces the Meterless engines already expect, so the provider is swappable in one package. |

## Today

- `apps/api`: Express. Clerk auth, orgs, roles, teams, invitations, accounts and agent-run endpoints. Permission rules in `packages/shared/src/permissions.ts`.
- `apps/worker`: BullMQ worker. Sync, matching, extraction, agent runs (`planner → investigator → critic → advisor`), the executor for approved actions, and H-MEM learning.
- `packages/agents`: the OpenAI model wrapper (structured output, LangSmith tracing), extraction, and the LangGraph agent graph.
- `apps/web`: React app shell with owner, manager and member views.
- `packages/db`: Prisma schema. It already reserves `world_model_ref` on accounts, contacts and extracted items, and `hmem_ref` on flags.

None of this changes. Everything below is additive.

## How data flows

```text
 Customer tools (Outlook, Teams, Drive, S3, Salesforce...)
        │
        ├── via Zetaris (per-org catalog, SQL over JDBC / REST)
        └── via direct connector (only where Zetaris has no access)
        │
        ▼
 worker: source-sync ─────────► source_items (full content cached, encrypted at rest)
        │
        ▼
 World Model resolution ──────► each item assigned to a client Account (or review queue)
        │
        ▼
 worker: extract (OpenAI) ────► extracted_items (commitments, deadlines, risks)
        │                        │
        ▼                        ▼
 World Model ingest ◄──── observations: accounts, contacts, people, commitments, relationships
        │
        ▼
 worker: agent-run (planner → investigator → critic → advisor)
        │   reads context from World Model + H-MEM
        ▼
 flags, briefs, proposed_actions ──► web app
        │
        ▼   outcomes: flag confirmed/dismissed, action approved/edited/rejected
 H-MEM mining ──► memories that shape the next run
```

### 1. Sources: Zetaris first, direct connectors to fill gaps

- Every source implements one `Source` interface: `listChanges(cursor)` returns new or changed items and the next cursor; `fetch(externalId)` returns full content. Two implementations:
  - **ZetarisSource:** incremental SQL through the org's Zetaris catalog (REST or JDBC).
  - **DirectSource:** our own connector, for example Microsoft Graph for Outlook and Teams, or the S3 API, used only where Zetaris has no access.
- A `connections` row records which implementation serves each provider for the org, plus encrypted credentials (the Zetaris catalog reference, or OAuth tokens for direct connectors).
- `source-sync` runs per connection, using `connections.sync_cursor`, and writes `source_items` with **full content** in `content_text`, so extraction and citations never wait on a remote call.
- Disconnecting a source deletes its synced content. A retention policy caps how long raw content is kept.
- The Integrations page lists the org's sources, each marked "via Zetaris" or "direct".

### 1a. Which sources go where (decided 2026-10-10)

Zetaris documents connectors for CRMs, file stores and warehouses, not for communication tools, and its REST tables fetch one page per request with no incremental sync. So:

- **Direct connectors (built, `packages/connectors`, setup in `docs/connectors.md`):** Microsoft 365 (Outlook, calendar, OneDrive, Teams chats), Google Workspace (Gmail, Calendar, Drive), Slack, Linear, Notion, HubSpot. OAuth tokens are encrypted at rest; the worker syncs every 15 minutes, resuming from per-stream cursors stored in `connections.sync_state`.
- **Through Zetaris (next):** Salesforce, Dynamics 365, S3 / Azure Blob, data warehouses.

### 1b. Routing items to clients (built, deterministic)

An org's tools mix all of its clients together; Kept routes every synced item to **one client account or none**, with explicit rules only (no model decides who can see what). Each item records `match_status` and `match_reason`. Code: `apps/worker/src/matching/`.

1. **Container mappings:** a Slack channel, Linear team, Notion parent or Drive/OneDrive folder mapped to an account, or marked "not about a client". Set by an owner on the Routing page, or automatically (below).
2. **CRM identity:** HubSpot companies are imported as accounts and contacts as contacts (linked to their company); HubSpot records route to their company.
3. **Participants:** a known contact's email, else an account's email domain (subdomains included). The org's own domains and free-mail domains are never evidence.

One account → matched. Several → ambiguous (owners review). None → unmatched. Matching runs after each sync with new items, and over every item when accounts or mappings change.

**Automatic routing (built, `matching/auto.ts`, still rule-based):** after each matching pass, containers nobody mapped are routed when the evidence is explicit, and their items matched again:
- **Name:** the container's name contains exactly one account's name (suffixes like Inc. dropped, words also run together) or domain stem, as whole words: `#ext-northwind`, `Drive › Clients › Northwind`. One-word names under four letters and generic words (`support`, `general`, `sales`...) never count. The longest matching name wins; a tie routes nothing.
- **People:** at least 3 of the container's items were routed by their own people (contact or domain, rule 3) and at least 80% of those point to one account. Slack messages carry the author's email (`users:read.email`) for this.
- Name and people must not disagree: a channel named after one client where another client's people dominate is left for an owner.
- Mappings record `origin` (`owner` or `auto`) and, for automatic ones, the `reason`, shown on the Routing page where owners confirm or change them. Kept never changes an owner's mapping, and an owner's "not routed" stops it routing that container. Owners can turn automatic routing off (`organizations.settings.routing.auto`).

**Who can read a synced item** (`visibleSourceItemsWhere`, which every reader of `source_items` must use): matched items follow their account's visibility; unmatched items from a member's own mailbox stay private to that member; unmatched workspace items are visible to owners only.

**Files** route like everything else, plus two rules of their own: Drive and OneDrive files carry who they're shared with (addresses and domains count as participants), and their folder is a mappable container (`folder:<id>`). After matching, `linkFiles` (`matching/links.ts`) routes files linked from matched messages to the message's account, creating the file item when no connector synced it (forward), and routes unmatched files a matched message links to (backward).

Not yet: HubSpot deals and notes (need association lookups), Slack Connect channels routed by the partner's domain, private Slack channels limited to their members.

### 1c. Documents (built, lazy)

Connectors emit files as `document` items with only a name and a `metadata.file` source (Gmail or Graph attachment, Slack file, Drive or OneDrive item, SharePoint share link) and `contentStatus: "pending"`. Nothing is downloaded at sync time. The extract job first runs `readPendingDocuments` (`apps/worker/src/agents/documents.ts`) on **matched** pending files: download (`downloadFile`, 15 MB cap, Google files exported), read (`packages/documents`: unpdf, mammoth, exceljs, pptx XML, with `[Page N]`/`[Slide N]` markers), OCR through the vision model for scans (20 pages, 10 MB). The text becomes the item's content and its new hash queues extraction. Outcomes: `read`, `ocr`, `unsupported`, `too_large`, `no_access`, `needs_ocr`, `empty`, `failed` (after 3 attempts), shown on the company page.

### 2. Extraction

- `extract` reads new source items and asks the model (OpenAI, strict JSON-schema output) for commitments, obligations, decisions, deadlines and risks, each with the excerpt it came from. Output goes to `extracted_items` and, as observations, to the World Model. **Built** (`packages/agents/src/extract.ts`, `apps/worker/src/agents/extract.ts`):
  - Runs after every matching job, on matched items whose `content_hash` differs from `extracted_hash` (new, or changed since last read). CRM records are skipped (structured data, imported by matching).
  - The account's open items are shown to the model as known refs, so it reports status changes (fulfilled, broken, superseded) instead of duplicates. Broken means the due date passed undelivered; a slip announced earlier stays open and is reported as a risk (enforced in code).
  - Every result must quote its source: excerpts are checked against the content and anything not found is dropped, as is anything below 0.5 confidence.
  - Owners resolve from emails and names of org members; commitments default to the account owner.
  - Documents are read in overlapping 12k-character sections (up to 15) with extra rules for contracts, SOWs and plans; each finding records the page its quote is on (`details.page`).
  - Contracts (`looksLikeContract`) are also read for renewal date, notice period and yearly value (`packages/agents/src/contract.ts`, quote checked). Differences from the account become an `update_account` proposed action, never twice for the same terms; the executor applies it once approved.
  - Each account that got new or changed items gets an agent run queued (one waiting run per account at most).

### 3. World Model (`packages/world-model`)

Implements the Meterless World Model spec on Postgres, namespaced by `org_id`. **Built**: passes the Meterless conformance suite (8/8) plus durability tests for reloads, concurrent writers and failed writes (`pnpm --filter @kept/world-model test`). See the package's `NOTICE.md` for what changed from the reference.

- **Key people and companies by external IDs, never by name alone.** Name-keyed entities go through the resolver, which auto-merges names at 0.85 similarity or above ("Contact 1" and "Contact 2" merge). Contacts use their email address, users their Kept user id, accounts their CRM id or email domain.

- **Storage:** an append-only `wm_events` log and `wm_audit` log per org, plus `wm_state` for the side stores the spec keeps outside the log (observations, stories, scores, merge queue). State is a fold over the log, loaded per job; re-ingesting the same observation is a no-op (the spec's idempotency contract). Every write runs in a transaction holding a per-org advisory lock and first replays other processes' writes, so the API and worker extend one gap-free log. Projection tables for SQL querying can come later if reads outgrow the in-memory fold.
- **Kept's shape of the world:**
  - Entities: account, contact, person (our users), commitment.
  - Contexts: thread, meeting, ticket, deal, quarter.
  - Relationships: `promised_to`, `made_by`, `owned_by`, `works_at`, `mentioned_in`, `contradicts`, `fulfils`.
- **Bitemporal relationships:** when an account changes owner, the old `owned_by` edge is closed, not deleted. This gives "who owned this account when the promise was made" for free.
- `world_model_ref` on accounts, contacts and extracted items points at the matching entity. Postgres rows stay the source of truth for the UI and permissions; the World Model is what agents reason over.
- **Entity resolution:** the reference implementation matches names by spelling similarity. We replace that with OpenAI embeddings plus external keys (CRM ids, email domains) and keep the spec's merge bands: auto-merge, review queue, or new entity. This is also what assigns source items to clients (section 1b).
- **Done when:** the Meterless World Model conformance suite passes against our implementation in CI.
- **What agents read from it (built, `apps/worker/src/agents/world.ts`):** before each run, `syncAccountWorld` writes the account's terms (renewal date, yearly value, owner), its contacts (`person` keyed by email, `works_at` the account) and its commitments' statuses, only where they differ, so a steady state writes nothing. Approved contract terms are recorded by the executor with their source ("from "Order form.pdf", approved by Priya"). `accountHistory` then reads back what Postgres's current state can't show, as the run context's `history`, seen by the planner and the advisor:
  - how the renewal date and yearly value changed, when, and from where;
  - the track record across all time: promises kept, broken and replaced, both ways, with the latest broken ones;
  - contacts who joined from, or left for, another client (a closed `works_at` edge). The other client is named only when it has the same owner, since a flag's readers may not see it.

### 4. H-MEM (`packages/hmem`)

Implements the Meterless H-MEM spec on Postgres with pgvector, namespaced by `org_id` (and by account where relevant). **Built**: passes the Meterless conformance suite (13/13) plus durability tests (`pnpm --filter @kept/hmem test`). `DurableHMEM` persists the engine: changed records only, embeddings in a pgvector column, the trust ledger append-only in `hmem_ledger` (read on demand, not held in memory), sleep backups in `hmem_backups`. OpenAI embeddings are computed before the per-org lock is taken; records the engine creates itself are re-embedded right after. Each record stores its embedding model, and recall only compares records from the current model.

- **Tiers:** short-term, working and long-term memory, plus a trust ledger recording where each memory came from and how it changed.
- **What Kept remembers:**
  - Flag outcomes: "flags like this on Northwind were false alarms twice".
  - Approval edits: "owners always soften this kind of follow-up".
  - Customer patterns: "Initech escalates through the CEO when deadlines slip".
- **Mining:** flag resolutions, action decisions and user feedback become memories. `hmem_ref` on a flag points at the memory its resolution created.
- **Retrieval:** agent runs pull relevant memories into context before planning.
- **Dreaming and sleep cycles:** nightly BullMQ jobs per org consolidate and prune memories, as the spec describes.
- **Done when:** the H-MEM conformance suite passes in CI.

### 5. Agent runs

**Built** as a LangGraph state graph (`packages/agents/src/graph.ts`), run per account by the `agent-runs` worker:

- **Planner** (smart model): reads the account (tracked items, recent activity, open flags, H-MEM lessons) and asks up to five checkable questions, each with keyword searches. No questions ends the run.
- **Investigator** (fast model): per question, reads the items behind the commitments in question plus Postgres full-text search hits over the account's matched items, and answers with cited excerpts. Citations that aren't in the cited item are dropped.
- **Critic** (smart model): approves, rejects, or sends findings back with more searches (one extra round by default). Later rounds review only the findings that were re-investigated, and a question whose follow-up searches find nothing new is dropped instead of re-reviewed. Citations carry their item's date and source. Its verdict is stored on the step.
- **Advisor** (smart model): turns approved findings into flags (with evidence) and proposed actions: an email to the customer, a reminder for the account owner, or an alert for the team.
- The model never sees database ids, only refs (C1, S2...) mapped back afterwards; flags without checkable evidence are dropped; emails can only go to the account's contacts or domain.
- Flags carry a `dedupe_key` (account, kind, commitment or topic): a later run never raises the same issue twice, including ones a person dismissed.
- Every step is an `agent_steps` row with tokens, cost and duration, and adds its cost to the run as it goes; with `LANGSMITH_TRACING=true` the run's LangSmith trace id is the run id.
- Reasoning models run at `OPENAI_REASONING_EFFORT` (default low); each call times out after 3 minutes.
- A run that throws goes back to queued for BullMQ's retry. A run found still "running" when its job comes back (the worker died mid-run) is closed as interrupted rather than re-run, so a crash never silently pays for a second full run.

**Approvals and the executor.** Proposed actions wait on the Approvals page, where people edit, approve or reject them. Approved actions run once in the `actions` queue: emails are sent from the approver's own Gmail or Outlook (`gmail.send` / `Mail.Send`, so connections made before need reconnecting), reminders become `reminders` rows plus a delayed email to the account owner, alerts email the account owner, company updates set the account's terms. **Actions in tools:** `create_ticket` files a Linear issue in a team Kept has seen in synced issues (`issues:create`), `update_crm` adds a task to the account's HubSpot company, assigned to the owner's HubSpot user by email (`crm.objects.contacts.write`, `crm.objects.owners.read`). The advisor is offered each only when the org has a connection allowed to act and, for HubSpot, the account came from HubSpot; at most one waiting per flag (or per title). A failed action is recorded, never retried automatically, since a retry could send or create twice.

**Learning.** Dismissed, resolved and confirmed flags, rejected actions and edited emails become H-MEM memories (the `learn` queue), tagged with their account; the planner recalls them on the next run.

**Daily jobs** (`apps/worker/src/agents/daily.ts`, the `daily` queue, ticking hourly). In each org's time zone (its profile, UTC by default), once per local day:
- from 6:00, the **sweep** queues agent runs (trigger `schedule`) for accounts with open promises due within 7 days or overdue up to 30, or renewing within 30 days, unless the account was analyzed in the last 12 hours. Without it, a promise nobody mentions again would never be reviewed;
- from 8:00, each member's **digest**: open flags on accounts they can see (same visibility rules as the API, shared in `packages/db/src/rules.ts`), suggestions waiting, their own promises due within two days or overdue, and what customers owe on accounts they own. Nobody gets an empty digest.
`organizations.last_sweep_on` and `memberships.last_digest_on` are claimed atomically, so overlapping ticks never send twice.

**Flags close themselves.** When extraction sees a promise kept or replaced, or someone marks it fulfilled or deletes it, its open flags resolve with the reason and their waiting suggestions are withdrawn (`closeFlagsForCommitment`). A broken promise keeps its flag.

The original design for context, which the built pipeline follows:
- the World Model: the account's entities, open commitments, relationships and timeline
- H-MEM: relevant memories
- Zetaris: full source text, on demand

**Markovian** (phase 2) bounds each step's context so long account histories don't grow token cost.

### 5a. Live data through Zetaris (built)

Owners connect Zetaris (REST, API key, encrypted) and define **datasets**: single read-only SELECTs filtered to one account with `{{domain}}`, `{{account_name}}`, `{{crm_id}}` or `{{account_id}}`, bound as SQL literals (`packages/connectors/src/zetaris.ts`). For each run, `accountData` (`apps/worker/src/agents/data.ts`) lists the datasets that apply to the account. The planner picks datasets per question; the investigator calls `queryData`, which runs the query live (once per run per dataset) and saves the table as a `dataset` source item pinned to the account (`metadata.pinnedAccountId`; matching keeps it there, extraction skips it). Citations from tables are checked like any excerpt, so a flag's evidence is a real row. A failed query leaves the run going and records the error on the connection.

### 6. Analytics through Zetaris

Zetaris queries a read replica of Kept's Postgres next to the org's own sources. Reports like "commitments kept vs broken by team, against renewal outcomes in the CRM" don't need data copied anywhere.

## Tenancy, permissions and security

- Every engine table carries `org_id`. Every query filters on it.
- Customer content is sent to OpenAI for extraction and embeddings. Sign OpenAI's data processing agreement and enable zero data retention before the first real customer.
- Context assembly applies the same visibility rules as the API (owners see the org, managers their team's accounts, members their own and shared) before anything reaches a model. Agents must never see more than the user they act for.
- `visible_to_user_id` (private source items, runs, flags) is honoured in World Model and H-MEM retrieval.
- Zetaris credentials and any provider tokens are encrypted at rest (`connections` already has encrypted token columns and a key version).

## Repo changes

| Area | Change |
| --- | --- |
| `packages/world-model` | New. TypeScript implementation of the spec, plus its conformance suite in CI. |
| `packages/hmem` | New. Same, for H-MEM. |
| `packages/sources` | New. The `Source` interface, `ZetarisSource` (typed client over Zetaris REST/JDBC) and direct connectors as needed. |
| `packages/llm` | `Embedder` over OpenAI (built) and the deterministic hash embedder for tests; `Generator` comes with extraction. |
| `packages/db` | Migrations for the `wm_*` and `hmem_*` tables, `connections` changes for Zetaris, the pgvector extension. |
| `apps/worker` | New queues and jobs: `source-sync`, `extract`, `wm-ingest`, `hmem-mine`, `hmem-consolidate` (nightly); the agent-run processor gets real steps. |
| `docker-compose.yml` | Switch the Postgres image to one with pgvector (`pgvector/pgvector`). |
| `apps/web` | Integrations page driven by the org's Zetaris catalog; Commitments, Flags and Approvals pages read real data. |

## Build order

1. **Spike Zetaris (1–2 days).**
   - Get an account and API access.
   - For each tool customers use (Outlook, Teams, Drive, S3, Salesforce...), confirm whether Zetaris can query it. Salesforce is documented; **email and Teams are not confirmed**. Every "no" becomes a direct connector.
   - Confirm that catalogs in one Zetaris account are hard-isolated from each other, plus auth, rate limits and pricing per query.
2. **World Model on Postgres.** Package, migrations and conformance suite green. Seeded from accounts and contacts.
3. **First source end to end.** One CRM through Zetaris: accounts, contacts and owners into the World Model and the Accounts page.
4. **Email through Zetaris** (or a direct connector if Zetaris can't reach email). Then source items, extraction, commitments, and the Commitments page with citations.
5. **H-MEM.** Package and conformance; mining from flag and approval outcomes; retrieval in agent runs; nightly consolidation.
6. **Agent pipeline with Markovian.** Flags and proposed actions with evidence.
7. **Analytics through Zetaris** over a read replica.

Steps 2 and 3 can overlap with the Zetaris spike.

## Open questions

1. **Zetaris catalog isolation.** Confirm in the spike that one Kept-owned account with a catalog per org isolates customers well enough. If a large customer requires its own Zetaris tenant, the `Source` interface lets that org point at it.
2. **Embedding model.** The vector dimension is fixed in the pgvector column; switching models later means re-embedding everything. Choose the OpenAI embedding model once, during the World Model step.
3. **Generation models.** Choose OpenAI models by testing on real customer emails: a cheaper model for bulk extraction, a stronger one for the critic and advisor steps.
4. **Meterless engine versions.** The engines release monthly. Pin to a tagged release and re-run conformance on upgrade.

## Resolved

- Tools Zetaris can't reach get a direct connector.
- One catalog per Kept org; client separation happens inside Kept (section 1b).
- Full source content is cached in Postgres for speed.
- OpenAI for all generation and embeddings.
