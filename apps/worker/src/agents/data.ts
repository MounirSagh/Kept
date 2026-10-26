import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@kept/db";
import type { SourceDoc } from "@kept/agents";
import {
  ZetarisError, accountParams, bindDataset, decryptToken, renderTable, zetarisConfig, zetarisQuery, type ZetarisDataset,
} from "@kept/connectors";

// Live data for the agents, through the org's Zetaris connection. A dataset's result is saved as an
// item routed to the account (kind "dataset"), so a flag can cite it like any message, and replaced
// the next time the dataset is queried.

const ROWS = 50;
const QUERY_TIMEOUT_MS = 45_000;

type Account = { id: string; name: string; domain: string | null; crmExternalId: string | null };

export interface AccountData {
  /** The datasets that apply to this account (it has the values their SQL needs). */
  available: { name: string; description: string }[];
  /** Runs one by name; each dataset is queried at most once per run. */
  query(name: string): Promise<SourceDoc | null>;
}

const NONE: AccountData = { available: [], query: async () => null };

export async function accountData(prisma: PrismaClient, encryptionKey: string | null, orgId: string, account: Account): Promise<AccountData> {
  if (!encryptionKey) return NONE;
  const connection = await prisma.connection.findFirst({ where: { orgId, provider: "zetaris", status: "active" } });
  const config = connection ? zetarisConfig(connection.syncState) : null;
  if (!connection?.accessTokenEnc || !config) return NONE;

  const params = accountParams(account);
  const usable = config.datasets
    .map((d) => ({ dataset: d, sql: bindDataset(d.sql, params) }))
    .filter((d): d is { dataset: ZetarisDataset; sql: string } => d.sql !== null);
  const byName = new Map(usable.map((d) => [d.dataset.name, d]));
  const done = new Map<string, Promise<SourceDoc | null>>();
  let apiKey: string | null = null;

  const run = async (name: string): Promise<SourceDoc | null> => {
    const d = byName.get(name);
    if (!d) return null;
    apiKey ??= decryptToken(connection.accessTokenEnc!, encryptionKey);
    let table: string;
    let rows: number;
    try {
      const result = await zetarisQuery(config, apiKey, d.sql, { limit: ROWS, timeoutMs: QUERY_TIMEOUT_MS });
      table = renderTable(result);
      rows = result.rows.length;
    } catch (err) {
      // A run goes on without the data; the Zetaris settings show why.
      const message = err instanceof ZetarisError ? err.message : (err as Error).message;
      await prisma.connection.update({ where: { id: connection.id }, data: { lastError: `${d.dataset.name}: ${message}`.slice(0, 500) } });
      return null;
    }
    const queriedAt = new Date();
    const title = d.dataset.name;
    const contentHash = createHash("sha256").update(table).digest("hex");
    const item = await prisma.sourceItem.upsert({
      where: { connectionId_externalId: { connectionId: connection.id, externalId: `zetaris:${d.dataset.id}:${account.id}` } },
      create: {
        orgId,
        connectionId: connection.id,
        externalId: `zetaris:${d.dataset.id}:${account.id}`,
        kind: "dataset",
        title,
        occurredAt: queriedAt,
        contentText: table,
        contentHash,
        // Data, not conversation: never read for commitments.
        extractedHash: contentHash,
        matchStatus: "matched",
        accountId: account.id,
        matchReason: "Zetaris data for this company",
        metadata: { pinnedAccountId: account.id, dataset: d.dataset.id, sql: d.sql, rows, queriedAt: queriedAt.toISOString() } as Prisma.InputJsonValue,
      },
      update: {
        title,
        occurredAt: queriedAt,
        contentText: table,
        contentHash,
        extractedHash: contentHash,
        matchStatus: "matched",
        accountId: account.id,
        metadata: { pinnedAccountId: account.id, dataset: d.dataset.id, sql: d.sql, rows, queriedAt: queriedAt.toISOString() } as Prisma.InputJsonValue,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (connection.lastError) await prisma.connection.update({ where: { id: connection.id }, data: { lastError: null } });
    return { id: item.id, provider: "zetaris", title, author: null, occurredAt: queriedAt, content: table };
  };

  return {
    available: usable.map((d) => ({ name: d.dataset.name, description: d.dataset.description })),
    query(name) {
      if (!done.has(name)) done.set(name, run(name));
      return done.get(name)!;
    },
  };
}
