import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../src/registry.js";
import { canAct, canSendMail, rfc822, sendMail } from "../src/send.js";
import { createHubspotTask } from "../src/providers/hubspot.js";
import { createLinearIssue } from "../src/providers/linear.js";
import { client, fakeFetch } from "./fake.js";

const mail = { to: ["lina@northwind.com", "marc@northwind.com"], subject: "Mise à jour: SSO", body: "Hi Lina,\n\nThe SSO date moved to December. Café ☕" };

describe("sending approved email", () => {
  it("knows which connections are allowed to send", () => {
    expect(canSendMail("google", ["https://www.googleapis.com/auth/gmail.readonly"])).toBe(false);
    expect(canSendMail("google", ["https://www.googleapis.com/auth/gmail.send"])).toBe(true);
    expect(canSendMail("microsoft", ["https://graph.microsoft.com/Mail.Send"])).toBe(true);
    expect(canSendMail("slack", ["chat:write"])).toBe(false);
  });

  it("builds a plain-text message that survives non-ASCII subjects and bodies", () => {
    const raw = rfc822(mail);
    expect(raw).toContain("To: lina@northwind.com, marc@northwind.com");
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString("base64")}?=`);
    const body = raw.split("\r\n\r\n")[1]!.replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe(mail.body);
  });

  it("sends through Gmail as a base64url message", async () => {
    const f = fakeFetch([{ method: "POST", match: ["/gmail/v1/users/me/messages/send"], json: { id: "msg-1" } }]);
    const res = await sendMail("google", client(PROVIDERS.google, f.fetch), mail);
    expect(res).toEqual({ messageId: "msg-1" });
    const sent = JSON.parse(f.calls[0]!.body!) as { raw: string };
    expect(Buffer.from(sent.raw, "base64url").toString("utf8")).toBe(rfc822(mail));
  });

  it("sends through Microsoft Graph and keeps a copy in Sent Items", async () => {
    const f = fakeFetch([{ method: "POST", match: ["/me/sendMail"], status: 202, text: "" }]);
    const res = await sendMail("microsoft", client(PROVIDERS.microsoft, f.fetch), mail);
    expect(res).toEqual({ messageId: null });
    const body = JSON.parse(f.calls[0]!.body!) as { message: { toRecipients: { emailAddress: { address: string } }[]; body: { contentType: string } }; saveToSentItems: boolean };
    expect(body.message.toRecipients.map((r) => r.emailAddress.address)).toEqual(mail.to);
    expect(body.message.body.contentType).toBe("Text");
    expect(body.saveToSentItems).toBe(true);
  });
});

describe("actions in tools", () => {
  it("knows which connections may act", () => {
    expect(canAct("linear", ["read"])).toBe(false);
    expect(canAct("linear", ["read", "issues:create"])).toBe(true);
    expect(canAct("linear", ["read", "write"])).toBe(true);
    expect(canAct("hubspot", ["oauth", "crm.objects.companies.read"])).toBe(false);
    expect(canAct("hubspot", ["crm.objects.contacts.write"])).toBe(true);
  });

  it("files a Linear issue in the team with the given key", async () => {
    const f = fakeFetch([
      { method: "POST", match: ["/graphql"], times: 1, json: { data: { teams: { nodes: [{ id: "team-uuid" }] } } } },
      { method: "POST", match: ["/graphql"], json: { data: { issueCreate: { success: true, issue: { identifier: "ENG-42", url: "https://linear.app/x/issue/ENG-42" } } } } },
    ]);
    const res = await createLinearIssue(client(PROVIDERS.linear, f.fetch), { teamKey: "ENG", title: "SSO for Northwind", description: "Promised by Dec 1." });
    expect(res.identifier).toBe("ENG-42");
    const created = JSON.parse(f.calls[1]!.body!) as { variables: { input: Record<string, string> } };
    expect(created.variables.input).toEqual({ teamId: "team-uuid", title: "SSO for Northwind", description: "Promised by Dec 1." });
  });

  it("refuses a Linear team that doesn't exist", async () => {
    const f = fakeFetch([{ method: "POST", match: ["/graphql"], json: { data: { teams: { nodes: [] } } } }]);
    await expect(createLinearIssue(client(PROVIDERS.linear, f.fetch), { teamKey: "NOPE", title: "t", description: "d" })).rejects.toThrow(/NOPE/);
  });

  it("creates a HubSpot task on the company, assigned to the owner", async () => {
    const f = fakeFetch([
      { method: "GET", match: ["/crm/v3/owners", "email=priya@acme.com"], json: { results: [{ id: "owner-7" }] } },
      { method: "POST", match: ["/crm/v3/objects/tasks"], json: { id: "task-1" } },
    ]);
    const res = await createHubspotTask(client(PROVIDERS.hubspot, f.fetch), {
      companyId: "123", subject: "Confirm SSO date", body: "Lina asked twice.", dueDate: "2026-11-02", ownerEmail: "priya@acme.com",
    });
    expect(res).toEqual({ id: "task-1", ownerAssigned: true });
    const body = JSON.parse(f.calls[1]!.body!) as { properties: Record<string, string>; associations: { to: { id: string }; types: { associationTypeId: number }[] }[] };
    expect(body.properties).toMatchObject({ hs_task_subject: "Confirm SSO date", hubspot_owner_id: "owner-7", hs_timestamp: "2026-11-02T09:00:00.000Z" });
    expect(body.associations[0]).toMatchObject({ to: { id: "123" }, types: [{ associationTypeId: 192 }] });
  });
});
