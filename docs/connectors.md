# Connectors: setup

Kept reads from Microsoft 365, Google Workspace, Slack, Linear, Notion and HubSpot through
its own connectors (`packages/connectors`). Salesforce, Dynamics 365, S3/Azure Blob and data
warehouses will come through Zetaris.

Each provider needs an OAuth app that you register once. Put its client id and secret in `.env`
(`<PROVIDER>_CLIENT_ID`, `<PROVIDER>_CLIENT_SECRET`) and restart `pnpm dev`. Providers without
both values show as "Not set up on the server" on the Integrations page.

**Redirect URI for every provider:** `<WEB_ORIGIN>/oauth/callback`
(locally `http://localhost:5173/oauth/callback`). Providers that only accept HTTPS redirect URIs
need a tunnel in development (for example `ngrok http 5173`, then set `WEB_ORIGIN` to the tunnel
URL and register `https://<tunnel>/oauth/callback`).

`TOKEN_ENCRYPTION_KEY` (32 random bytes, base64) encrypts stored tokens. Generate it once with
`openssl rand -base64 32`. Changing it makes every stored token unreadable, so every account
would have to reconnect.

## How connections work

| Provider | Who connects | What Kept reads |
| --- | --- | --- |
| Microsoft 365 | Each member, their own account | Outlook inbox and sent mail with attachments, calendar, OneDrive files, Teams chats and files shared in them, SharePoint and OneDrive links |
| Google Workspace | Each member, their own account | Gmail with attachments, primary calendar and files attached to events, Drive files, Drive links |
| Slack | An owner, once | Messages, thread replies and shared files in channels the Kept app is added to |
| Linear | An owner, once | Issues and comments; files issues a person approved |
| Notion | An owner, once | Pages shared with Kept in Notion's consent screen |
| HubSpot | An owner, once | Companies, contacts, deals, notes; adds tasks a person approved |

- The first sync reads the last 90 days; after that a sync runs every 15 minutes and only fetches
  what changed. Owners and account holders can trigger "Sync now".
- Items from a member's own account are private to them until matched to a client account.
- If a provider revokes access, the connection shows "Needs reconnecting" and stops syncing.
- Disconnecting deletes everything Kept synced from that account.

### Documents

Files are synced as names only. Kept downloads and reads a file **only once it is routed to a
client**, so files about nobody in particular are never read. A file reaches a client when:

- it's attached to an email, calendar event or Slack message that routes to the client;
- it's shared in Drive or OneDrive with someone at the client (their address or their domain);
- its folder is routed to the client on the Routing page, by an owner or automatically (Drive and
  OneDrive folders appear there);
- a message routed to the client links to it (Google Docs, Sheets, Slides and Drive links; SharePoint,
  OneDrive and 1drv.ms links). The file is read with the connection of whoever posted the link if
  they connected the same tool, otherwise with the first member who did.

Kept reads PDF, Word, Excel, CSV, PowerPoint, Google Docs, Sheets and Slides, text and HTML.
Scanned PDFs (up to 20 pages, 10 MB) and images are read with OpenAI's vision model. Files over
15 MB, tiny attachments (signature logos, under 2 KB, or images under 100 KB) and other formats are
skipped. Each file's status is shown under **Documents** on the company page.

Contracts get one more read: when one states a renewal date or a yearly value that differs from
the company's, Kept suggests the change as a **Company update** on the Approvals page.

## Microsoft 365

1. Microsoft Entra admin center → App registrations → New registration.
2. Supported account types: "Accounts in any organizational directory" (multitenant).
3. Redirect URI: platform **Web**, value `<WEB_ORIGIN>/oauth/callback`.
4. Certificates & secrets → New client secret. Copy the **Value** into `MICROSOFT_CLIENT_SECRET`,
   and the Application (client) ID into `MICROSOFT_CLIENT_ID`.
5. API permissions → Microsoft Graph → **Delegated**: `User.Read`, `Mail.Read`, `Mail.Send`,
   `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`, `Chat.Read`, `offline_access`, `openid`,
   `email`.

`Files.Read.All` and `Sites.Read.All` let Kept open files shared with the member and SharePoint
links posted in client conversations, not just files in their own OneDrive. Accounts connected
before these were added need to disconnect and connect again (until then such files show
"No access").

`Mail.Send` lets Kept send the emails a person approves on the Approvals page, from their own
mailbox. Nothing is sent without that approval. Accounts connected before `Mail.Send` was added
need to disconnect and connect again to grant it.

Some organizations require an admin to approve apps before members can connect. Teams channel
messages need admin-consented permissions and aren't read yet.

## Google Workspace

1. Google Cloud console → create a project → enable the **Gmail API**, **Google Calendar API**
   and **Google Drive API**.
2. OAuth consent screen (**Google Auth Platform → Data access**): add the scopes `gmail.readonly`,
   `gmail.send`, `calendar.readonly`, `drive.readonly`, plus `openid` and `email`. While in
   **Testing**, add each tester's address under **Audience → Test users** (up to 100).
3. Credentials → Create credentials → OAuth client ID → **Web application**, authorized redirect
   URI `<WEB_ORIGIN>/oauth/callback`.

`gmail.send` lets Kept send the emails a person approves on the Approvals page, from their own
Gmail. Nothing is sent without that approval. Accounts connected before `gmail.send` was added
need to disconnect and connect again to grant it.

`gmail.readonly` and `drive.readonly` are **restricted scopes** and `gmail.send` is **sensitive**.
Publishing the app to any Google user requires Google's verification plus an annual third-party
security assessment (CASA), which takes weeks. Start it well before launch; testing mode works
meanwhile.

## Slack

1. api.slack.com/apps → Create New App → From scratch.
2. OAuth & Permissions → Redirect URLs: add `<WEB_ORIGIN>/oauth/callback` (Slack requires HTTPS:
   use a tunnel locally).
3. Bot Token Scopes: `channels:read`, `channels:history`, `groups:read`, `groups:history`,
   `users:read`, `users:read.email`, `team:read`, `files:read`.
4. Basic Information → App Credentials: copy Client ID and Client Secret.
5. After connecting, invite the app to each channel Kept should read (`/invite @YourApp`).

`files:read` lets Kept read files shared in those channels. `users:read.email` gives Kept each
message author's email, so messages from a client's people (in a Slack Connect channel) route to
that client by themselves, and a channel where they talk can be routed automatically. A workspace
connected before either was added needs the app reinstalled (Slack shows "Reinstall to Workspace" after the scope is added),
then a reconnect from the Integrations page.

## Linear

1. Linear → Settings → API → OAuth applications → New.
2. Callback URL `<WEB_ORIGIN>/oauth/callback`. Copy the client id and secret.

Kept requests `read` and `issues:create`. `issues:create` files the issues a person approves on the
Approvals page (in the team they pick, as the member who connected Linear); Kept never edits or
closes issues. A workspace connected before it was added needs to reconnect.

## Notion

1. notion.so/my-integrations → New integration → type **Public**.
2. Redirect URI `<WEB_ORIGIN>/oauth/callback`; capability: **Read content**.
3. Copy the OAuth client id and secret. When connecting, the user picks which pages Kept may read.

## HubSpot

HubSpot no longer offers legacy apps on new developer accounts; Kept's app is a
**project-based app** defined in `hubspot/` (see `hubspot/README.md`):

1. `npm install -g @hubspot/cli`, then in `hubspot/`: `hs init` (once) and `hs project upload`.
2. In the developer account, open the app's **Auth** tab and copy the client ID and secret.
3. Connect a regular HubSpot portal or a free test account (Development → Testing); the
   developer account itself can't install apps.

The app requests `oauth`, `crm.objects.companies.read`, `crm.objects.contacts.read`,
`crm.objects.deals.read`, `crm.objects.contacts.write` and `crm.objects.owners.read`. The last two
let Kept add the tasks a person approves to a company's record (HubSpot requires the contacts write
scope for tasks) and assign them to the account owner's HubSpot user. Kept doesn't change contacts,
companies or deals. After adding them, run `hs project upload` and reconnect HubSpot. Keep `hubspot/src/app/app-hsmeta.json` and
`packages/connectors/src/providers/hubspot.ts` in sync: HubSpot rejects a connection whose
requested scopes differ from the app's required scopes. If notes fail to sync with a scope
error, add the scope it names to both.

## Zetaris

Zetaris is the org's data harness: it reaches warehouses, billing, CRMs and files where they live.
Kept's agents query it **live** during a review, so a flag can quote "2026-10 | 74 | 81" from the
usage table next to a Slack message.

- **Connect:** an owner, on Integrations → Zetaris. Give the engine's REST API address
  (`http://<host>:8888/api/v1.0`) or the Zetaris web app's address, the numeric organization id
  (Management → Organisation) and an API key. Kept checks the connection with `SELECT 1`, then stores
  the key encrypted.
- **Datasets:** owners add read-only queries the agents may run, each filtered to the company under
  review with `{{domain}}`, `{{account_name}}`, `{{crm_id}}` (HubSpot company id) or `{{account_id}}`.
  Kept fills them in as SQL literals. It refuses queries that aren't a single SELECT, or that aren't
  filtered to one company, so one client's flag never shows another client's rows. A company missing
  a value (no domain, say) isn't queried. "Run" previews a dataset for any company before saving.
- **During a review:** the planner sees each dataset's name and description and picks which to check
  for each question. The investigator runs them live and may only quote rows it received. Each result
  is saved on the company as a `dataset` item (labeled "Zetaris" in flag evidence), replaced on the
  next query, and never read for commitments.
- **Registering sources in Zetaris** happens in Zetaris, for example
  `CREATE DATASOURCE … OPTIONS (jdbcdriver "org.postgresql.Driver", jdbcurl "jdbc:postgresql://…", …)`,
  then `REGISTER DATASOURCE TABLES FROM <name>`. Tables are then named `<datasource>.<table>`.

## Verified so far

Every connector is tested against recorded-style API responses (`pnpm --filter @kept/connectors
test`): paging, resumable cursors, incremental runs, token refresh, retries and data mapping.
They have **not** yet run against live accounts; expect small fixes the first time each one does.
Details most likely to need adjusting: Microsoft's `$filter` on message delta queries, Teams chat
filtering, and HubSpot's notes scope.
