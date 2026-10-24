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
| Microsoft 365 | Each member, their own account | Outlook inbox and sent mail, calendar, OneDrive file metadata, Teams chats |
| Google Workspace | Each member, their own account | Gmail, primary calendar, Drive (Google Docs as text, other files as metadata) |
| Slack | An owner, once | Messages in channels the Kept app is added to |
| Linear | An owner, once | Issues and comments |
| Notion | An owner, once | Pages shared with Kept in Notion's consent screen |
| HubSpot | An owner, once | Companies, contacts, deals, notes |

- The first sync reads the last 90 days; after that a sync runs every 15 minutes and only fetches
  what changed. Owners and account holders can trigger "Sync now".
- Items from a member's own account are private to them until matched to a client account.
- If a provider revokes access, the connection shows "Needs reconnecting" and stops syncing.
- Disconnecting deletes everything Kept synced from that account.

## Microsoft 365

1. Microsoft Entra admin center → App registrations → New registration.
2. Supported account types: "Accounts in any organizational directory" (multitenant).
3. Redirect URI: platform **Web**, value `<WEB_ORIGIN>/oauth/callback`.
4. Certificates & secrets → New client secret. Copy the **Value** into `MICROSOFT_CLIENT_SECRET`,
   and the Application (client) ID into `MICROSOFT_CLIENT_ID`.
5. API permissions → Microsoft Graph → **Delegated**: `User.Read`, `Mail.Read`, `Calendars.Read`,
   `Files.Read`, `Chat.Read`, `offline_access`, `openid`, `email`.

Some organizations require an admin to approve apps before members can connect. Teams channel
messages need admin-consented permissions and aren't read yet.

## Google Workspace

1. Google Cloud console → create a project → enable the **Gmail API**, **Google Calendar API**
   and **Google Drive API**.
2. OAuth consent screen: add the scopes `gmail.readonly`, `calendar.readonly`, `drive.readonly`,
   plus `openid` and `email`. While in **Testing**, add each tester's address as a test user
   (up to 100).
3. Credentials → Create credentials → OAuth client ID → **Web application**, authorized redirect
   URI `<WEB_ORIGIN>/oauth/callback`.

`gmail.readonly` and `drive.readonly` are **restricted scopes**. Publishing the app to any Google
user requires Google's verification plus an annual third-party security assessment, which takes
weeks. Start it well before launch.

## Slack

1. api.slack.com/apps → Create New App → From scratch.
2. OAuth & Permissions → Redirect URLs: add `<WEB_ORIGIN>/oauth/callback` (Slack requires HTTPS:
   use a tunnel locally).
3. Bot Token Scopes: `channels:read`, `channels:history`, `groups:read`, `groups:history`,
   `users:read`, `team:read`.
4. Basic Information → App Credentials: copy Client ID and Client Secret.
5. After connecting, invite the app to each channel Kept should read (`/invite @YourApp`).

## Linear

1. Linear → Settings → API → OAuth applications → New.
2. Callback URL `<WEB_ORIGIN>/oauth/callback`. Copy the client id and secret.

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

The app requests `oauth`, `crm.objects.companies.read`, `crm.objects.contacts.read` and
`crm.objects.deals.read`. Keep `hubspot/src/app/app-hsmeta.json` and
`packages/connectors/src/providers/hubspot.ts` in sync: HubSpot rejects a connection whose
requested scopes differ from the app's required scopes. If notes fail to sync with a scope
error, add the scope it names to both.

## Verified so far

Every connector is tested against recorded-style API responses (`pnpm --filter @kept/connectors
test`): paging, resumable cursors, incremental runs, token refresh, retries and data mapping.
They have **not** yet run against live accounts; expect small fixes the first time each one does.
Details most likely to need adjusting: Microsoft's `$filter` on message delta queries, Teams chat
filtering, and HubSpot's notes scope.
