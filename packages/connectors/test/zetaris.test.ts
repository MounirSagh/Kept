import { describe, expect, it } from "vitest";
import {
  bindDataset, decodeZetarisSecret, encodeZetarisSecret, gatewayOrigin, paramsProblem, parseResult, readOnlyProblem, renderTable, zetarisQuery,
} from "../src/zetaris.js";
import { fakeFetch } from "./fake.js";

describe("Zetaris queries", () => {
  it("calls the engine's REST API with the key and organization", async () => {
    const f = fakeFetch([{ method: "POST", match: ["/api/v1.0/sql-editor/sqls/run"], json: { headers: [{ name: "month" }, { name: "active" }], data: [["2026-10", 74], ["2026-09", 118]] } }]);
    const res = await zetarisQuery({ restUrl: "http://localhost:8888/api/v1.0/", orgId: "1" }, "key-1", "SELECT 1", { fetch: f.fetch, limit: 50 });
    expect(res).toEqual({ columns: ["month", "active"], rows: [["2026-10", 74], ["2026-09", 118]] });
    expect(f.calls[0]!.headers).toMatchObject({ Authorization: "Bearer key-1", "X-Org-ID": "1" });
    expect(JSON.parse(f.calls[0]!.body!)).toMatchObject({ sql: "SELECT 1", source: "SqlEditor", limit: 50 });
  });

  it("uses the web app's proxy when given its address", async () => {
    const f = fakeFetch([{ method: "POST", match: ["https://zetaris.example.com/api/proxy/sql-editor/sqls/run-query"], json: { data: [{ n: 1 }] } }]);
    const res = await zetarisQuery({ restUrl: "https://zetaris.example.com", orgId: "7" }, "k", "SELECT 1 AS n", { fetch: f.fetch });
    expect(res).toEqual({ columns: ["n"], rows: [[1]] });
  });

  it("explains a refused key and a wrong URL", async () => {
    const denied = fakeFetch([{ match: ["/sqls/run"], status: 401, text: "nope" }]);
    await expect(zetarisQuery({ restUrl: "http://z/api/v1.0", orgId: "1" }, "bad", "SELECT 1", { fetch: denied.fetch })).rejects.toThrow(/refused/);
    const html = fakeFetch([{ match: ["/run-query"], text: "<html></html>", headers: { "content-type": "text/html" } }]);
    await expect(zetarisQuery({ restUrl: "http://z", orgId: "1" }, "k", "SELECT 1", { fetch: html.fetch })).rejects.toThrow(/web page/);
  });

  it("reads the shapes Zetaris answers with", () => {
    expect(parseResult({ result: { columns: ["a"], rows: [[1], [2]] } }, 1)).toEqual({ columns: ["a"], rows: [[1]] });
    expect(parseResult({ data: [[1, "x"]] })).toEqual({ columns: ["col1", "col2"], rows: [[1, "x"]] });
    expect(parseResult(null)).toEqual({ columns: [], rows: [] });
  });
});

describe("datasets", () => {
  it("only reads", () => {
    expect(readOnlyProblem("SELECT * FROM wh.usage WHERE d = {{domain}};")).toBeNull();
    expect(readOnlyProblem("WITH x AS (SELECT 1) SELECT * FROM x")).toBeNull();
    expect(readOnlyProblem("SELECT 'drop table' AS note -- delete me")).toBeNull();
    expect(readOnlyProblem("DROP TABLE wh.usage")).toMatch(/Only SELECT/);
    expect(readOnlyProblem("SELECT 1; DELETE FROM wh.usage")).toMatch(/single statement/);
    expect(readOnlyProblem("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d")).toMatch(/DELETE/);
  });

  it("must be filtered to one company", () => {
    expect(paramsProblem("SELECT * FROM wh.usage")).toMatch(/Filter by the company/);
    expect(paramsProblem("SELECT * FROM wh.usage WHERE x = {{customer}}")).toMatch(/Unknown parameter \{\{customer\}\}/);
    expect(paramsProblem("SELECT * FROM wh.usage WHERE d = {{ domain }}")).toBeNull();
  });

  it("fills in the company as SQL literals, or doesn't apply without the value", () => {
    const sql = "SELECT * FROM wh.t WHERE domain = {{domain}} OR name = {{account_name}};";
    expect(bindDataset(sql, { domain: "halcyonfreight.com", account_name: "O'Brien Freight" })).toBe(
      "SELECT * FROM wh.t WHERE domain = 'halcyonfreight.com' OR name = 'O''Brien Freight'",
    );
    expect(bindDataset(sql, { domain: null, account_name: "Halcyon" })).toBeNull();
  });

  it("renders a table the model can quote", () => {
    expect(renderTable({ columns: ["month", "active"], rows: [["2026-10", 74], ["2026-09", null]] })).toBe("month | active\n2026-10 | 74\n2026-09 | ");
    expect(renderTable({ columns: ["a"], rows: [] })).toBe("a\n(no rows)");
  });
});

describe("signing in with email and password", () => {
  const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

  it("finds the web app for a cluster address", () => {
    expect(gatewayOrigin("https://api.abc.cloud.zetaris.com/api/v1.0")).toBe("https://new-ui.abc.cloud.zetaris.com");
    expect(gatewayOrigin("https://new-ui.abc.cloud.zetaris.com/login")).toBe("https://new-ui.abc.cloud.zetaris.com");
    expect(gatewayOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("stores an API key as is and a sign-in as JSON", () => {
    expect(decodeZetarisSecret(encodeZetarisSecret({ apiKey: "k1" }))).toEqual({ apiKey: "k1" });
    expect(decodeZetarisSecret(encodeZetarisSecret({ username: "a@b.c", password: "p" }))).toEqual({ username: "a@b.c", password: "p" });
  });

  it("signs in, takes the organization from the session, and queries through the web app", async () => {
    const f = fakeFetch([
      { method: "POST", match: ["https://new-ui.c1.cloud.zetaris.com/api/auth/login"], json: { idToken: jwt({ exp: Date.now() / 1000 + 3600 }), orgId: 7 } },
      { method: "POST", match: ["https://new-ui.c1.cloud.zetaris.com/api/proxy/sql-editor/sqls/run-query"], json: { headers: [{ name: "one" }], data: [[1]] } },
    ]);
    const res = await zetarisQuery({ restUrl: "https://api.c1.cloud.zetaris.com/api/v1.0", orgId: "" }, { username: "m@x.com", password: "pw" }, "SELECT 1", { fetch: f.fetch });
    expect(res).toEqual({ columns: ["one"], rows: [[1]] });
    expect(JSON.parse(f.calls[0]!.body!)).toEqual({ username: "m@x.com", password: "pw" });
    expect(f.calls[1]!.headers).toMatchObject({ "X-Org-ID": "7" });
    expect(f.calls[1]!.headers.Authorization).toMatch(/^Bearer h\./);
  });

  it("signs in again when the session ended, and explains a refused sign-in", async () => {
    const f = fakeFetch([
      { method: "POST", match: ["c2.cloud.zetaris.com/api/auth/login"], json: { idToken: jwt({ orgId: 3 }) } },
      { method: "POST", match: ["c2.cloud.zetaris.com/api/proxy/"], status: 401, text: "expired", times: 1 },
      { method: "POST", match: ["c2.cloud.zetaris.com/api/proxy/"], json: { data: [[1]] } },
    ]);
    await zetarisQuery({ restUrl: "https://new-ui.c2.cloud.zetaris.com", orgId: "" }, { username: "m@x.com", password: "pw" }, "SELECT 1", { fetch: f.fetch });
    expect(f.calls.filter((c) => c.url.includes("/api/auth/login"))).toHaveLength(2);
    expect(f.calls[1]!.headers).toMatchObject({ "X-Org-ID": "3" });

    const refused = fakeFetch([{ method: "POST", match: ["/api/auth/login"], status: 404, json: { msg: "Not Allowed" } }]);
    await expect(zetarisQuery({ restUrl: "https://new-ui.c3.cloud.zetaris.com", orgId: "" }, { username: "m@x.com", password: "bad" }, "SELECT 1", { fetch: refused.fetch }))
      .rejects.toThrow("Zetaris refused the sign-in (Not Allowed)");
  });
});
