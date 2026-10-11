import type { Job } from "bullmq";
import type { PrismaClient } from "@kept/db";
import type { AgentRunJobData } from "@kept/shared";

export function createAgentRunProcessor(prisma: PrismaClient) {
  return async (job: Job<AgentRunJobData>) => {
    const { runId } = job.data;
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: "running", startedAt: new Date() },
    });

    // TODO: planner → investigator → critic → advisor

    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: "completed", finishedAt: new Date() },
    });
  };
}
