# Kept

Kept watches what your team promises customers, in email, Slack, tickets, CRM notes and documents, and warns you before a promise is broken.

It reads your tools, finds every commitment ("we'll have the fix live by Friday"), keeps them in one list per client, and flags the ones at risk with the evidence behind them. For each flag it drafts the next step (an email to the customer, a reminder, an alert), and nothing happens until a person approves it.

---

## What you need

| Tool | Version | Why |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 20.19 or newer | Runs the API, worker and web app |
| [pnpm](https://pnpm.io) | 9 | Package manager (`corepack enable` installs the right version) |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | any recent | Runs Postgres and Redis locally |

And these accounts:

| Service | Needed? | What for |
| --- | --- | --- |
| [Clerk](https://clerk.com) | **Required** | Sign-in and sign-up |
| [OpenAI](https://platform.openai.com) | **Required** for the AI features | Reading messages for commitments, the agents, memory. Needs API credits |
| [Resend](https://resend.com) | Optional | Sending invitation, reminder and alert emails. Without it, emails are printed in the worker's log |
| [ngrok](https://ngrok.com) | Optional | A public HTTPS address for your laptop. Slack only connects over HTTPS |
| OAuth apps for your tools | Optional | Connecting Microsoft 365, Google, Slack, Linear, Notion and HubSpot. See [docs/connectors.md](docs/connectors.md) |

---

## Setup in 5 steps

**1. Install dependencies**

```sh
git clone https://github.com/MounirSagh/Kept.git
cd Kept
corepack enable
pnpm install
```

**2. Create your `.env`**

```sh
cp .env.example .env
```

Then fill in at least these values (each is explained in [Environment variables](#environment-variables) below):

| Variable | Where to get it |
| --- | --- |
| `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → **API keys** → Publishable key (same value in both) |
| `CLERK_SECRET_KEY` | Clerk dashboard → **API keys** → Secret key |
| `OPENAI_API_KEY` | OpenAI dashboard → **API keys** |
| `TOKEN_ENCRYPTION_KEY` | Run `openssl rand -base64 32` and paste the result. **Never change it afterwards** |

**3. Start Postgres and Redis**

```sh
pnpm infra:up
```

**4. Create the database tables**

```sh
pnpm db:deploy
```

**5. Start the app**

```sh
pnpm dev
```

This starts three processes with hot reload: the **web app**, the **API** and the **worker**. Open **http://localhost:5173**, sign up, and create your organization.

To stop Postgres and Redis later: `pnpm infra:down` (your data is kept).

---

## Environment variables

Everything is configured in one `.env` file at the root of the repo. The apps check it when they start and stop with a clear error if something required is missing.

### Required

| Variable | What it is |
| --- | --- |
| `DATABASE_URL`, `REDIS_URL` | Where the apps find Postgres and Redis. The defaults match `pnpm infra:up` |
| `POSTGRES_*`, `REDIS_PORT` | Used by Docker to create Postgres and Redis. Keep them consistent with the two URLs above |
| `API_PORT`, `WEB_PORT` | Ports for the API (4000) and the web app (5173) |
| `WEB_ORIGIN` | The address you open the app at, e.g. `http://localhost:5173`, or your ngrok URL (see [Connecting your tools](#connecting-your-tools)) |
| `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk keys |
| `OPENAI_API_KEY` | OpenAI key. Without it the app runs, but nothing is read for commitments and no agents run |
| `TOKEN_ENCRYPTION_KEY` | Encrypts the access tokens of connected tools. Changing it means reconnecting every tool |
| `WORKER_CONCURRENCY` | How many agent runs the worker handles at once (5 is fine) |

### Optional

| Variable | What it is |
| --- | --- |
| `OPENAI_FAST_MODEL`, `OPENAI_SMART_MODEL` | Models for bulk reading (default `gpt-5-mini`) and for judgment (default `gpt-5`) |
| `OPENAI_REASONING_EFFORT` | How long the models think: `minimal`, `low` (default), `medium`, `high`. Higher is slower and costs more |
| `OPENAI_EMBEDDING_MODEL` | Model for memory search. Pick it once: changing it means re-embedding all memories |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email sending. Resend's default sender only delivers to your own Resend account address; verify a domain in Resend to email anyone |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | Set tracing to `true` to see every agent run step by step in [LangSmith](https://smith.langchain.com) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Lets Clerk notify Kept when a user changes their profile or is deleted. Not needed to sign in |
| `<PROVIDER>_CLIENT_ID`, `<PROVIDER>_CLIENT_SECRET` | OAuth app for each tool. A tool without both shows as "Not set up" on the Integrations page |

---

## Setting up the services

### Clerk (sign-in)

1. Create an application in the [Clerk dashboard](https://dashboard.clerk.com).
2. Copy the keys into `.env` (see step 2 above).
3. Leave Clerk's **Organizations** feature turned **off**: Kept manages organizations and roles itself.
4. Optional: for Google and Microsoft sign-in, enable them under **User & authentication → Social connections**.

### OpenAI

1. Create an API key and put it in `OPENAI_API_KEY`.
2. Add credits under **Settings → Billing**. Without credits every call fails with `429 You have no credits remaining`.

A typical agent run for one account costs a few cents.

### Connecting your tools

Each tool needs its own OAuth app. [docs/connectors.md](docs/connectors.md) walks through each one: Microsoft 365, Google Workspace, Slack, Linear, Notion and HubSpot. Two rules apply to all of them:

- **The redirect URI to register is `<WEB_ORIGIN>/oauth/callback`**, e.g. `http://localhost:5173/oauth/callback`.
- **Slack requires HTTPS**, so for Slack (and to be safe, for all tools) run the app behind ngrok:

```sh
ngrok http --url=<your-static-domain>.ngrok-free.dev 5173
```

Then set `WEB_ORIGIN=https://<your-static-domain>.ngrok-free.dev` in `.env`, restart `pnpm dev`, and **open the app at that ngrok address** when connecting tools.

After connecting, Kept syncs every 15 minutes. Use **Sync now** on the Integrations page to sync straight away.

---

## How it works

```
Your tools ──► Sync ──► Routing ──► Extraction ──► Agents ──► Flags + Approvals ──► Executor
 (Slack,       every    each item   commitments,    plan,      evidence and          sends what a
  email...)    15 min   to a client deadlines,      check,     drafted next steps    person approved
                        company     risks           advise
```

1. **Sync.** The worker pulls new messages, emails, issues, notes and CRM records from connected tools.
2. **Routing.** Each item is assigned to a client company by email domain, contacts, or the channel mappings you set on the **Routing** page. Slack channels and Linear teams are routed by hand once.
3. **Extraction.** OpenAI reads each new item and records commitments, customer obligations, deadlines, decisions and risks. Every result must quote its source exactly, or it's discarded.
4. **Agents.** For each company with new activity, four agents run (LangGraph):
   - **Planner:** decides what to check.
   - **Investigator:** searches that company's messages and answers with quotes.
   - **Critic:** rejects anything the quotes don't support.
   - **Advisor:** raises flags and drafts actions.
5. **Approvals.** Every suggested email, reminder and alert waits on the **Approvals** page to be edited, approved or rejected.
6. **Executor.** Approved emails go out from the approver's own Gmail or Outlook. Reminders and alerts are emailed to the account owner.
7. **Memory.** When you dismiss a flag or reject a suggestion, Kept remembers why (H-MEM) and takes it into account next time.

---

## Roles

| Role | Sees | Can |
| --- | --- | --- |
| **Owner** | Every company in the organization | Everything: tools, routing, teams, invitations, settings |
| **Manager** | Companies owned by people on their team | Invite and manage members of their team |
| **Member** | Companies they own or were added to | Work on their own companies |

A platform admin (set directly in the database: `UPDATE users SET is_platform_admin = true WHERE email = '…';`) can see every organization.

---

## Project layout

```
apps/
  web/        React 19 + Vite + Tailwind: the app people use
  api/        Express 5 REST API: reads and writes the database, queues jobs
  worker/     BullMQ worker: sync, routing, extraction, agent runs, sending
packages/
  db/         Prisma schema, migrations and database client
  shared/     Types, queue names and permission rules shared by all apps
  agents/     Extraction and the LangGraph agents (OpenAI)
  connectors/ Microsoft 365, Google, Slack, Linear, Notion and HubSpot connectors
  world-model/ Shared account graph (Meterless World Model)
  hmem/       Long-term memory (Meterless H-MEM)
  llm/        OpenAI embeddings
docs/         Architecture and connector setup
```

---

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts web, API and worker with hot reload |
| `pnpm infra:up` / `pnpm infra:down` | Starts / stops Postgres and Redis in Docker |
| `pnpm db:deploy` | Applies database migrations |
| `pnpm db:migrate` | After editing `packages/db/prisma/schema.prisma`: creates and applies a new migration |
| `pnpm db:studio` | Opens Prisma Studio to browse the database |
| `pnpm typecheck` | Type-checks everything |
| `pnpm test` | Runs the tests |
| `pnpm build` | Builds everything for production |

### Running everything in Docker

To run the whole app in containers instead of `pnpm dev` (closer to production):

```sh
pnpm stack:up     # builds images, applies migrations, starts api, worker and web
pnpm stack:down
```

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| **`401 Unauthorized` on `/api/me`** after signing in | Open the app at the address in `WEB_ORIGIN` (or `http://localhost:<WEB_PORT>`). If you just changed `.env`, restart `pnpm dev` |
| **`429 You have no credits remaining`** in the worker log | Add credits to your OpenAI account. Nothing is lost: items are read once credits are back |
| **A tool says "Not set up"** on Integrations | Both its `_CLIENT_ID` and `_CLIENT_SECRET` must be in `.env`; then restart `pnpm dev` |
| **Slack messages don't show up** | Invite the bot to the channel (`/invite @Kept`), post top-level messages (thread replies aren't read yet), then **Sync now** |
| **A channel's messages have no company** | Map the channel to a company on the **Routing** page |
| **Approving an email fails** | Connect Gmail or Outlook with permission to send (reconnect it if it was connected before sending was added) |
| **Emails don't arrive** | Without `RESEND_API_KEY` they're only printed in the worker log. With Resend's default sender they only reach your own Resend address |
| **An agent run shows "Interrupted"** | The worker restarted mid-run (in development, saving a file restarts it). The next new activity on that company starts a fresh run |
| **Database errors after pulling new code** | Run `pnpm db:deploy` to apply new migrations |

More detail: [docs/architecture.md](docs/architecture.md) (how the system is built) and [docs/connectors.md](docs/connectors.md) (tool setup).
