import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../src/registry.js";
import { fakeFetch, sync } from "./fake.js";

const enc = (s: string) => Buffer.from(s).toString("base64url");

describe("Microsoft 365", () => {
  const msg = (id: string, subject: string) => ({
    id, subject, receivedDateTime: "2026-10-01T10:00:00Z", sentDateTime: "2026-10-01T10:00:00Z",
    from: { emailAddress: { name: "Sara", address: "sara@acme.com" } }, toRecipients: [{ emailAddress: { address: "ops@northwind.com" } }],
    body: { content: `body of ${subject}` }, webLink: `https://outlook/${id}`, conversationId: "c1",
  });
  const routes = (deltaRound: number) => [
    // Inbox: two pages, then a deltaLink. On the next run the deltaLink returns one new message and a removal.
    { match: ["/me/mailFolders/inbox/messages/delta?$select", "receivedDateTime ge 2026-07-12"], json: { value: [msg("m1", "Renewal")], "@odata.nextLink": "https://graph.microsoft.com/v1.0/inbox-page-2" } },
    { match: ["/inbox-page-2"], json: { value: [msg("m2", "SSO")], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/inbox-delta-1" } },
    { match: ["/inbox-delta-1"], json: deltaRound === 1 ? { value: [msg("m3", "Follow-up"), { id: "m1", "@removed": {} }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/inbox-delta-2" } : {} },
    { match: ["/me/mailFolders/sentitems/messages/delta"], json: { value: [msg("s1", "Promise: SSO by Friday")], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/sent-delta-1" } },
    { match: ["/sent-delta-1"], json: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/sent-delta-1" } },
    { match: ["/me/calendarView/delta"], json: { value: [{ id: "e1", subject: "QBR", start: { dateTime: "2026-10-20T15:00:00.0000000" }, attendees: [{ emailAddress: { address: "ops@northwind.com" } }] }, { id: "e2", isCancelled: true }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/cal-delta-1" } },
    { match: ["/cal-delta-1"], json: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/cal-delta-1" } },
    { match: ["/me/drive/root/delta"], json: { value: [{ id: "f1", name: "SOW.docx", file: { mimeType: "x" }, lastModifiedDateTime: "2026-09-01T00:00:00Z" }, { id: "f0", name: "old.docx", file: {}, lastModifiedDateTime: "2025-01-01T00:00:00Z" }, { id: "d", folder: {} }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drive-delta-1" } },
    { match: ["/drive-delta-1"], json: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drive-delta-1" } },
    { match: ["/me/chats?$top=50"], json: { value: [{ id: "chat1", topic: "Northwind war room" }] } },
    { match: ["/me/chats/chat1/messages", "lastModifiedDateTime gt 2026-07-12"], json: { value: [{ id: "cm1", messageType: "message", createdDateTime: "2026-10-02T09:00:00Z", lastModifiedDateTime: "2026-10-02T09:00:00Z", from: { user: { displayName: "Omar" } }, body: { contentType: "html", content: "<p>We&#39;ll ship it <b>Friday</b></p>" } }, { id: "sys", messageType: "systemEventMessage", lastModifiedDateTime: "2026-10-02T08:00:00Z" }] } },
    { match: ["/me/chats/chat1/messages", "lastModifiedDateTime gt 2026-10-02T09:00:00Z"], json: { value: [] } },
  ];

  it("syncs mail, calendar, files and chats, then only changes", async () => {
    const first = await sync(PROVIDERS.microsoft, fakeFetch(routes(0)).fetch);
    expect(first.complete).toBe(true);
    const ids = first.items.map((i) => i.externalId);
    expect(ids).toEqual(["mail:m1", "mail:m2", "mail:s1", "event:e1", "file:f1", "chat:chat1:cm1"]);
    const sent = first.items.find((i) => i.externalId === "mail:s1")!;
    expect(sent).toMatchObject({ kind: "email", author: "Sara <sara@acme.com>", metadata: { folder: "sentitems", to: ["ops@northwind.com"] } });
    expect(first.items.find((i) => i.kind === "event")!.occurredAt.toISOString()).toBe("2026-10-20T15:00:00.000Z");
    expect(first.items.find((i) => i.kind === "message")!.contentText).toBe("We'll ship it Friday");

    const f = fakeFetch(routes(1));
    const second = await sync(PROVIDERS.microsoft, f.fetch, first.state);
    expect(second.items.map((i) => i.externalId)).toEqual(["mail:m3"]);
    expect(f.calls.some((c) => c.url.includes("inbox-page-2") || c.url.includes("receivedDateTime ge"))).toBe(false);
    expect(f.calls.some((c) => c.url.includes("lastModifiedDateTime gt 2026-10-02T09:00:00Z"))).toBe(true);
  });

  it("starts over when Graph expires a delta token (410)", async () => {
    const f = fakeFetch([
      { match: ["/stale-delta"], status: 410 },
      { match: ["/me/mailFolders/inbox/messages/delta?$select"], json: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/fresh" } },
      { match: ["/delta"], json: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/x" } },
      { match: ["/me/chats?$top=50"], json: { value: [] } },
    ]);
    const { state } = await sync(PROVIDERS.microsoft, f.fetch, { mail_inbox: { cursor: { delta: "https://graph.microsoft.com/v1.0/stale-delta" } } });
    expect(state.mail_inbox?.cursor).toEqual({ delta: "https://graph.microsoft.com/v1.0/fresh" });
  });
});

describe("Google Workspace", () => {
  const gmail = (id: string, subject: string, labels = ["INBOX"]) => ({
    id, threadId: "t", labelIds: labels, internalDate: "1759312800000",
    payload: { headers: [{ name: "Subject", value: subject }, { name: "From", value: "Sara <sara@acme.com>" }, { name: "To", value: "a@x.com, b@y.com" }],
      parts: [{ mimeType: "text/html", body: { data: enc("<p>html</p>") } }, { mimeType: "text/plain", body: { data: enc(`plain ${subject}`) } }] },
  });
  const routes = [
    { match: ["/gmail/v1/users/me/profile"], json: { historyId: "100" } },
    { match: ["/gmail/v1/users/me/messages?", "q=after:1783814400"], json: { messages: [{ id: "g1" }, { id: "g2" }] } },
    { match: ["/gmail/v1/users/me/messages/g1"], json: gmail("g1", "Renewal") },
    { match: ["/gmail/v1/users/me/messages/g2"], json: gmail("g2", "Draft", ["DRAFT"]) },
    { match: ["/gmail/v1/users/me/messages/g3"], json: gmail("g3", "New", ["INBOX", "SENT"]) },
    { match: ["/gmail/v1/users/me/history", "startHistoryId=100"], json: { history: [{ messagesAdded: [{ message: { id: "g3" } }] }], historyId: "150" } },
    { match: ["/gmail/v1/users/me/history", "startHistoryId=150"], json: { historyId: "150" } },
    { match: ["/calendar/v3/calendars/primary/events", "timeMin="], json: { items: [{ id: "c1", summary: "QBR", updated: "2026-10-05T00:00:00Z", start: { dateTime: "2026-10-20T15:00:00Z" } }] } },
    { match: ["/calendar/v3/calendars/primary/events", "updatedMin=2026-10-10T00:00:00.000Z"], json: { items: [{ id: "c2", summary: "Moved", updated: "2026-10-10T05:00:00Z", start: { date: "2026-10-21" } }] } },
    { match: ["/calendar/v3/calendars/primary/events", "updatedMin=2026-10-10T05:00:00Z"], json: { items: [] } },
    { match: ["/drive/v3/files/doc1/export"], text: "Statement of work: SSO by Nov 1" },
    { match: ["/drive/v3/files?", "modifiedTime > '2026-07-12"], json: { files: [{ id: "doc1", name: "SOW", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-09-01T00:00:00Z" }, { id: "pdf1", name: "deck.pdf", mimeType: "application/pdf", modifiedTime: "2026-09-02T00:00:00Z" }] } },
    { match: ["/drive/v3/files?", "modifiedTime > '2026-09-02"], json: { files: [] } },
  ];

  it("backfills Gmail, then follows history from where the backfill began", async () => {
    const first = await sync(PROVIDERS.google, fakeFetch(routes).fetch);
    // The calendar backfill hands over to updates in the same run, which picks up c2.
    expect(first.items.map((i) => i.externalId)).toEqual(["gmail:g1", "gmail:g3", "gcal:c1", "gcal:c2", "gdrive:doc1", "gdrive:pdf1"]);
    expect(first.items[0]).toMatchObject({ title: "Renewal", contentText: "plain Renewal", metadata: { to: ["a@x.com", "b@y.com"] } });
    expect(first.items.find((i) => i.externalId === "gdrive:doc1")!.contentText).toBe("Statement of work: SSO by Nov 1");
    expect(first.state.gmail?.cursor).toEqual({ phase: "history", historyId: "150" });

    expect(first.state.calendar?.cursor).toEqual({ phase: "updates", watermark: "2026-10-10T05:00:00Z" });

    const f = fakeFetch(routes);
    const second = await sync(PROVIDERS.google, f.fetch, first.state);
    expect(second.items).toEqual([]);
    expect(f.calls.some((c) => c.url.includes("q=after:"))).toBe(false);
  });
});

describe("Slack", () => {
  it("reads only channels the bot is in, and resumes after the last message", async () => {
    const routes = [
      { match: ["conversations.list"], json: { ok: true, channels: [{ id: "C1", name: "northwind", is_member: true }, { id: "C2", name: "random", is_member: false }] } },
      { match: ["conversations.history", "channel=C1", "oldest=1783814400"], json: { ok: true, messages: [{ ts: "1791000000.000200", user: "U1", text: "<@U2> we'll have the fix out Friday" }, { ts: "1791000000.000100", subtype: "channel_join", text: "joined" }], response_metadata: { next_cursor: "p2" } }, times: 1 },
      { match: ["users.info", "user=U1"], json: { ok: true, user: { name: "sara", profile: { real_name: "Sara Lee" } } } },
      { match: ["users.info", "user=U2"], json: { ok: true, user: { name: "omar", real_name: "Omar Haddad" } } },
      { match: ["conversations.history", "cursor=p2"], json: { ok: true, messages: [{ ts: "1790900000.000100", user: "U2", text: "&gt; Can you confirm the date? Q&amp;A in <https://kept.app/n|the doc>" }] } },
      { match: ["conversations.history", "oldest=1791000000.000200"], json: { ok: true, messages: [] } },
    ];
    const f1 = fakeFetch(routes);
    const first = await sync(PROVIDERS.slack, f1.fetch);
    expect(first.items.map((i) => i.externalId)).toEqual(["slack:C1:1791000000.000200", "slack:C1:1790900000.000100"]);
    expect(f1.calls.some((c) => c.url.includes("channel=C2"))).toBe(false);
    expect(first.items[0]!.container).toEqual({ id: "C1", label: "#northwind" });
    // Ids become names, in the author and in mentions; each person is looked up once.
    expect(first.items.map((i) => i.author)).toEqual(["Sara Lee", "Omar Haddad"]);
    expect(first.items[0]!.contentText).toBe("@Omar Haddad we'll have the fix out Friday");
    expect(first.items[1]!.contentText).toBe("> Can you confirm the date? Q&A in the doc (https://kept.app/n)");
    expect(f1.calls.filter((c) => c.url.includes("users.info"))).toHaveLength(2);
    const f2 = fakeFetch(routes);
    expect((await sync(PROVIDERS.slack, f2.fetch, first.state)).items).toEqual([]);
    expect(f2.calls.some((c) => c.url.includes("oldest=1791000000.000200"))).toBe(true);
    expect(f2.calls.some((c) => c.url.includes("users.info"))).toBe(false);
  });

  it("surfaces Slack's ok:false errors", async () => {
    const f = fakeFetch([{ match: ["conversations.list"], json: { ok: false, error: "missing_scope" } }]);
    await expect(sync(PROVIDERS.slack, f.fetch)).rejects.toThrow("missing_scope");
  });
});

describe("Linear", () => {
  it("pages issues updated since the watermark, then advances it", async () => {
    const issue = (id: string, updatedAt: string) => ({ id, identifier: `ENG-${id}`, title: "SSO for Northwind", description: "Promised by Nov 1", url: `https://linear.app/i/${id}`, createdAt: "2026-09-01T00:00:00Z", updatedAt, creator: { name: "Sara" }, state: { name: "In Progress", type: "started" }, comments: { nodes: [{ body: "On track", createdAt: "2026-10-01", user: { name: "Omar" } }] } });
    const page = (nodes: unknown[], hasNextPage: boolean, endCursor?: string) => ({ data: { issues: { nodes, pageInfo: { hasNextPage, endCursor } } } });
    const f = fakeFetch([
      { method: "POST", match: ["/graphql"], json: page([issue("1", "2026-10-01T00:00:00Z")], true, "c1"), times: 1 },
      { method: "POST", match: ["/graphql"], json: page([issue("2", "2026-10-03T00:00:00Z")], false), times: 1 },
      { method: "POST", match: ["/graphql"], json: page([], false) },
    ]);
    const first = await sync(PROVIDERS.linear, f.fetch);
    expect(first.items.map((i) => i.title)).toEqual(["ENG-1 SSO for Northwind", "ENG-2 SSO for Northwind"]);
    expect(first.items[0]!.contentText).toContain("Omar");
    expect(first.state.issues?.cursor).toEqual({ watermark: "2026-10-03T00:00:00Z" });
    expect(JSON.parse(f.calls[1]!.body!).variables).toEqual({ after: "c1", since: "2026-07-12T00:00:00.000Z" });
  });
});

describe("Notion", () => {
  it("reads pages newest-first and stops at already-synced edits", async () => {
    const page = (id: string, edited: string) => ({ id, url: `https://notion.so/${id}`, last_edited_time: edited, properties: { Name: { type: "title", title: [{ plain_text: `Plan ${id}` }] } } });
    const routes = [
      { method: "POST", match: ["/v1/search"], json: { results: [page("p2", "2026-10-05T00:00:00.000Z"), page("p1", "2026-09-01T00:00:00.000Z"), page("old", "2026-01-01T00:00:00.000Z")], has_more: true, next_cursor: "n" } },
      { match: ["/v1/blocks/p2/children"], json: { results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Deliver SSO" }] } }, { type: "to_do", to_do: { rich_text: [{ plain_text: "Send QBR deck" }], checked: true } }, { type: "image", image: {} }] } },
      { match: ["/v1/blocks/p1/children"], json: { results: [] } },
    ];
    const f = fakeFetch(routes);
    const first = await sync(PROVIDERS.notion, f.fetch);
    expect(first.items.map((i) => i.title)).toEqual(["Plan p2", "Plan p1"]);
    expect(first.items[0]!.contentText).toBe("Deliver SSO\n[x] Send QBR deck");
    expect(f.calls[0]!.headers["Notion-Version"]).toBe("2022-06-28");
    expect(first.state.pages?.cursor).toEqual({ watermark: "2026-10-05T00:00:00.000Z" });
    expect((await sync(PROVIDERS.notion, fakeFetch(routes).fetch, first.state)).items).toEqual([]);
  });
});

describe("HubSpot", () => {
  it("searches each object by its own modified-date property and pages through results", async () => {
    const obj = (id: string, props: Record<string, string>) => ({ id, properties: props, createdAt: "2026-09-01T00:00:00Z" });
    const f = fakeFetch([
      { method: "POST", match: ["/crm/v3/objects/companies/search"], json: { results: [obj("1", { name: "Northwind", hs_lastmodifieddate: "2026-10-01T00:00:00Z" })], paging: { next: { after: "100" } } }, times: 1 },
      { method: "POST", match: ["/crm/v3/objects/companies/search"], json: { results: [obj("2", { name: "Initech", hs_lastmodifieddate: "2026-10-02T00:00:00Z" })] } },
      { method: "POST", match: ["/crm/v3/objects/contacts/search"], json: { results: [obj("3", { firstname: "Lina", lastname: "Haddad", lastmodifieddate: "2026-10-03T00:00:00Z" })] } },
      { method: "POST", match: ["/crm/v3/objects/deals/search"], json: { results: [obj("4", { dealname: "Northwind renewal", amount: "48000", hs_lastmodifieddate: "2026-10-04T00:00:00Z" })] } },
      { method: "POST", match: ["/crm/v3/objects/notes/search"], json: { results: [obj("5", { hs_note_body: "<p>Promised SSO by <b>Nov 1</b></p>", hs_timestamp: "2026-10-04T12:00:00Z", hs_lastmodifieddate: "2026-10-04T12:00:00Z" })] } },
    ]);
    const { items, state } = await sync(PROVIDERS.hubspot, f.fetch);
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ["crm_record", "Northwind"], ["crm_record", "Initech"], ["crm_record", "Lina Haddad"], ["deal", "Northwind renewal"], ["document", "Note"],
    ]);
    expect(items.at(-1)!.contentText).toBe("Promised SSO by Nov 1");
    const contactsBody = JSON.parse(f.calls.find((c) => c.url.includes("contacts"))!.body!);
    expect(contactsBody.filterGroups[0].filters[0].propertyName).toBe("lastmodifieddate");
    expect(state.companies?.cursor).toEqual({ watermark: String(Date.parse("2026-10-02T00:00:00Z")) });
  });
});
