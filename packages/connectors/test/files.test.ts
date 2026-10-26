import { describe, expect, it } from "vitest";
import { downloadFile, FileTooLargeError, findFileLinks, MAX_FILE_BYTES } from "../src/files.js";
import { ApiError } from "../src/http.js";
import { mapGmail } from "../src/providers/google.js";
import { PROVIDERS } from "../src/registry.js";
import { client, fakeFetch, sync } from "./fake.js";

const b64url = (s: string) => Buffer.from(s).toString("base64url");

describe("Gmail attachments", () => {
  const message = {
    id: "m1",
    internalDate: String(Date.parse("2026-10-20T10:00:00Z")),
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "Subject", value: "MSA for review" },
        { name: "From", value: "Lina <lina@northwind.com>" },
        { name: "To", value: "priya@acme.com" },
      ],
      parts: [
        { partId: "0", mimeType: "text/plain", body: { data: b64url("Attached is the MSA.") } },
        { partId: "1", mimeType: "application/pdf", filename: "Northwind MSA.pdf", body: { attachmentId: "att-a", size: 250_000 } },
        { partId: "2", mimeType: "image/png", filename: "logo.png", body: { attachmentId: "att-b", size: 8_000 } },
        { partId: "3", mimeType: "image/png", filename: "chart.png", headers: [{ name: "Content-Disposition", value: "inline" }], body: { attachmentId: "att-c", size: 400_000 } },
      ],
    },
  };

  it("reports attached documents next to the email, routed like it", () => {
    const [email, ...docs] = mapGmail(message);
    expect(email!.contentText).toBe("Attached is the MSA.\n\n[Attached: Northwind MSA.pdf]");
    // The logo is too small and the chart is inline: only the MSA is a document.
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      externalId: "gmail:m1:part:1",
      kind: "document",
      title: "Northwind MSA.pdf",
      author: "Lina <lina@northwind.com>",
      metadata: { to: ["priya@acme.com"], parent: "gmail:m1", file: { kind: "gmail-attachment", messageId: "m1", partId: "1" }, contentStatus: "pending" },
    });
  });

  it("downloads an attachment by its part, since attachment ids change between requests", async () => {
    const f = fakeFetch([
      { match: ["/gmail/v1/users/me/messages/m1", "format=full"], json: { ...message, payload: { ...message.payload, parts: message.payload.parts.map((p) => (p.partId === "1" ? { ...p, body: { attachmentId: "fresh-id", size: 9 } } : p)) } } },
      { match: ["/messages/m1/attachments/fresh-id"], json: { data: b64url("%PDF-1.4…") } },
    ]);
    const file = await downloadFile(client(PROVIDERS.google, f.fetch), { kind: "gmail-attachment", messageId: "m1", partId: "1" });
    expect(new TextDecoder().decode(file.bytes)).toBe("%PDF-1.4…");
    expect(file).toMatchObject({ mimeType: "application/pdf", name: "Northwind MSA.pdf" });
  });
});

describe("downloadFile", () => {
  it("exports Google Sheets as a workbook and Docs as text", async () => {
    const f = fakeFetch([
      { match: ["/drive/v3/files/sheet1?", "fields=name"], json: { name: "Rollout plan", mimeType: "application/vnd.google-apps.spreadsheet" } },
      { match: ["/drive/v3/files/sheet1/export", "spreadsheetml"], text: "xlsx-bytes" },
      { match: ["/drive/v3/files/doc1?", "fields=name"], json: { name: "SOW", mimeType: "application/vnd.google-apps.document" } },
      { match: ["/drive/v3/files/doc1/export", "text/plain"], text: "Statement of work" },
    ]);
    const c = client(PROVIDERS.google, f.fetch);
    const sheet = await downloadFile(c, { kind: "gdrive", fileId: "sheet1" });
    expect(sheet.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const doc = await downloadFile(c, { kind: "gdrive", fileId: "doc1" });
    expect(new TextDecoder().decode(doc.bytes)).toBe("Statement of work");
  });

  it("refuses files over the size limit before downloading them", async () => {
    const f = fakeFetch([{ match: ["/drive/v3/files/big?"], json: { name: "scan.pdf", mimeType: "application/pdf", size: String(MAX_FILE_BYTES + 1) } }]);
    await expect(downloadFile(client(PROVIDERS.google, f.fetch), { kind: "gdrive", fileId: "big" })).rejects.toBeInstanceOf(FileTooLargeError);
    expect(f.calls.some((c) => c.url.includes("alt=media"))).toBe(false);
  });

  it("resolves SharePoint and OneDrive links through Graph's shares API", async () => {
    const url = "https://acme.sharepoint.com/:w:/s/sales/EaBc123?e=x";
    const id = `u!${Buffer.from(url).toString("base64url")}`;
    const f = fakeFetch([
      { match: [`/shares/${id}/driveItem?`], json: { name: "Northwind SOW.docx", size: 1200, file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } } },
      { match: [`/shares/${id}/driveItem/content`], text: "docx-bytes" },
    ]);
    const file = await downloadFile(client(PROVIDERS.microsoft, f.fetch), { kind: "ms-share", url });
    expect(file.name).toBe("Northwind SOW.docx");
  });

  it("treats Slack's sign-in page as missing permission", async () => {
    const f = fakeFetch([{ match: ["files.slack.com"], text: "<html>sign in</html>", headers: { "content-type": "text/html" } }]);
    const err = await downloadFile(client(PROVIDERS.slack, f.fetch), { kind: "slack-file", url: "https://files.slack.com/files-pri/T1-F1/download/msa.pdf" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });
});

describe("findFileLinks", () => {
  it("finds Google Drive, OneDrive and SharePoint files in text", () => {
    const text = `Here's the SOW https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit?usp=sharing and the
      pricing https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa/view. Contract: https://acme.sharepoint.com/:b:/s/sales/EaBc123?e=x.
      Same SOW again: https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit`;
    expect(findFileLinks(text)).toEqual([
      { provider: "google", fileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz", url: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit" },
      { provider: "google", fileId: "1ZyXwVuTsRqPoNmLkJiHgFeDcBa", url: "https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa/view." },
      { provider: "microsoft", url: "https://acme.sharepoint.com/:b:/s/sales/EaBc123?e=x" },
    ]);
  });
});

describe("Slack files", () => {
  it("reports files shared in a channel, routed by that channel", async () => {
    const msg = { ts: "1791000000.000100", user: "U1", text: "Signed MSA attached", files: [{ id: "F1", name: "MSA signed.pdf", mimetype: "application/pdf", size: 300_000, url_private_download: "https://files.slack.com/files-pri/T1-F1/download/msa.pdf", permalink: "https://acme.slack.com/files/U1/F1" }] };
    const f = fakeFetch([
      { match: ["users.info"], json: { ok: true, user: { real_name: "Lina Park" } } },
      { match: ["conversations.list"], json: { ok: true, channels: [{ id: "C1", name: "northwind", is_member: true }] } },
      { match: ["conversations.history", "oldest=1783814400"], json: { ok: true, messages: [msg] } },
    ]);
    const { items } = await sync(PROVIDERS.slack, f.fetch);
    expect(items[0]!.contentText).toBe("Signed MSA attached\n\n[Shared file: MSA signed.pdf]");
    expect(items[1]).toMatchObject({
      externalId: "slack-file:F1",
      kind: "document",
      title: "MSA signed.pdf",
      container: { id: "C1", label: "#northwind" },
      metadata: { file: { kind: "slack-file", url: msg.files[0]!.url_private_download }, contentStatus: "pending" },
    });
  });
});
