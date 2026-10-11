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
- `apps/worker`: BullMQ worker. The agent-run processor is a stub (`planner → investigator → critic → advisor` is a TODO).
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

### 1b. Assigning items to clients

An org's Outlook, Teams, Drive, S3 and Salesforce mix all of its clients together. Kept splits them:

- Signals: sender and recipient email domains, CRM account and contact IDs, Salesforce ownership, folder or bucket conventions in Drive and S3, and names mentioned in the text.
- The World Model resolves those signals to an `Account` entity using the spec's merge bands: confident matches are assigned, borderline ones go to a review queue in the UI, and the rest stay unassigned.
- Once assigned, account visibility (owner, team manager, account members) controls who sees the item, through the existing permission rules.

### 2. Extraction

- `extract` reads new source items and asks the model (OpenAI, strict JSON-schema output) for commitments, obligations, decisions, deadlines and risks, each with the excerpt it came from. Output goes to `extracted_items` and, as observations, to the World Model.

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

### 4. H-MEM (`packages/hmem`)

Implements the Meterless H-MEM spec on Postgres with pgvector, namespaced by `org_id` (and by account where relevant).

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

The existing `agent_runs` / `agent_steps` tables stay. Each step assembles context from:
- the World Model: the account's entities, open commitments, relationships and timeline
- H-MEM: relevant memories
- Zetaris: full source text, on demand

**Markovian** (phase 2) bounds each step's context so long account histories don't grow token cost.

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
| `packages/llm` | New. `Generator` and `Embedder` over OpenAI, shared by extraction, agents and both engines. |
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
