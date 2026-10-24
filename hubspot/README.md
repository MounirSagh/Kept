# HubSpot app

Kept's HubSpot OAuth app, defined as a HubSpot developer project (platform 2026.09,
from HubSpot's `oauth-marketplace` template). The scopes here must match
`packages/connectors/src/providers/hubspot.ts` exactly, or HubSpot rejects the connection.

```sh
npm install -g @hubspot/cli
cd hubspot
hs init             # authenticate the CLI with your developer account (once)
hs project upload   # create or update the app
```

Then open the app in the developer account (Development → Projects → kept → Kept),
copy the client ID and secret from its Auth tab into `.env` as `HUBSPOT_CLIENT_ID` and
`HUBSPOT_CLIENT_SECRET`, and restart `pnpm dev`.

Replace the placeholder support details before submitting to the HubSpot Marketplace.
