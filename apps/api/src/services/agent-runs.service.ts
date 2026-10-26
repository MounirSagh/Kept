import type { Prisma, TriggerType } from "@kept/db";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { agentRunQueue } from "../lib/queues.js";
import type { OrgActor } from "../types/express.js";
import { canSeeAccount, visibleAccountsWhere } from "./accounts.service.js";

interface CreateAgentRunInput {
  accountId?: string;
  trigger: TriggerType;
  triggerRef?: string;
}

/** Runs on accounts the actor can see (or on no account), minus other people's private runs. */
function visibleRunsWhere(actor: OrgActor): Prisma.AgentRunWhereInput {
  return {
    orgId: actor.orgId,
    AND: [
      { OR: [{ visibleToUserId: null }, { visibleToUserId: actor.userId }] },
      { OR: [{ accountId: null }, { account: visibleAccountsWhere(actor) }] },
    ],
  };
}

export async function createAgentRun(actor: OrgActor, input: CreateAgentRunInput) {
  if (input.accountId && !(await canSeeAccount(actor, input.accountId))) {
    throw new HttpError(404, "Account not found");
  }
  // A review of the company already waiting or running covers this request.
  if (input.accountId) {
    const active = await prisma.agentRun.findFirst({ where: { orgId: actor.orgId, accountId: input.accountId, status: { in: ["queued", "running"] } } });
    if (active) return active;
  }
  const run = await prisma.agentRun.create({
    data: { ...input, orgId: actor.orgId, requestedById: actor.userId },
  });
  await agentRunQueue.add("run", { runId: run.id }, { jobId: run.id });
  return run;
}

export function listAgentRuns(actor: OrgActor) {
  return prisma.agentRun.findMany({
    where: visibleRunsWhere(actor),
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export function getAgentRun(actor: OrgActor, runId: string) {
  return prisma.agentRun.findFirst({
    where: { AND: [visibleRunsWhere(actor), { id: runId }] },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
}
