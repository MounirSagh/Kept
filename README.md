# Kept

pnpm + Turborepo monorepo.

```
apps/
  api/      Express 5 REST API — writes to Postgres, enqueues BullMQ jobs
  worker/   BullMQ worker — processes jobs, updates Postgres
  web/      React 19 + Vite — proxies /api to the API
packages/
  db/       Prisma 7 schema, migrations, and client factory (pg driver adapter)
  shared/   Queue names and API types shared across apps
```

All config lives in the root `.env` (see `.env.example`); apps validate it with zod at startup and have no fallback defaults.

## Local development

Requires Node ≥ 20.19, pnpm 9, Docker.

```sh
cp .env.example .env
pnpm install
pnpm infra:up        # postgres + redis in docker
pnpm db:migrate      # apply migrations (and create new ones after schema changes)
pnpm dev             # api, worker, web with hot reload
```

Open http://localhost:5173 (or your `WEB_PORT`).

## Authentication

Clerk handles sign-in only; organizations and roles live in our own `organizations` / `memberships` tables.

- The web app wraps everything in `ClerkProvider` and sends the session token as `Authorization: Bearer`.
- The API verifies it with `clerkMiddleware`, then `requireUser` loads (or creates on first request) the local `User` row.
- Org routes (`/api/orgs/:orgId/...`) go through `requireOrgAccess(check?)`, which resolves the caller's role and team from `memberships` (platform admins get in without one).
- `POST /api/webhooks/clerk` keeps users in sync (`user.created`, `user.updated`, `user.deleted`).

## Roles and permissions

| Who | Scope | Can |
| --- | --- | --- |
| Platform admin (`users.is_platform_admin`) | Every org | Everything an owner can |
| `owner` | One org | Manage teams, invite any role, change roles/teams, remove anyone |
| `manager` | Their team | Invite and remove plain members of their own team |
| `member` | Themselves | Leave the org |

- Each membership belongs to at most one team; a manager must have one.
- An org always keeps at least one owner.
- Accounts: owners see all; managers see accounts owned by anyone on their team; everyone sees accounts they own or were added to via `account_members`. Agent runs follow the same rule.
- The rules live in `can()` in `packages/shared/src/permissions.ts`, used by both the API and the web app.
- Platform admins are granted directly in the database: `UPDATE users SET is_platform_admin = true WHERE email = '…';`

Invitations: `POST /api/orgs/:orgId/invitations` returns an `acceptUrl` (`/invite?token=…`) once; only a hash of the token is stored. The invitee signs in with the invited email and the web app calls `POST /api/invitations/accept`. Invitations expire after 7 days. No email is sent yet, so share the link yourself.

Clerk dashboard setup:

1. Leave **Organizations** disabled.
2. Copy the publishable and secret keys into `.env` (`CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).
3. Add a webhook endpoint pointing at `<public API URL>/api/webhooks/clerk` with the three user events, and copy its signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`. Locally, expose the API with a tunnel such as `ngrok http 4000`.

## Full stack in Docker

```sh
pnpm stack:up        # builds images, runs migrations, starts api/worker/web
pnpm stack:down
```

## Common scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | Build every package (generates the Prisma client first) |
| `pnpm typecheck` | Type-check every package |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:studio` | Open Prisma Studio |

Internal packages export TypeScript source under the `development` condition (used by `tsx` and the editor) and compiled `dist/` otherwise, so `pnpm dev` needs no build step.
