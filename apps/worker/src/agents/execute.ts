import type { Job, Queue } from "bullmq";
import type { Prisma, PrismaClient } from "@kept/db";
import { canAct, canSendMail, createHubspotTask, createLinearIssue, sendMail, type ConnectorConfig } from "@kept/connectors";
import type {
  AccountUpdatePayload, ActionJobData, AlertPayload, CrmTaskPayload, EmailJobData, ReminderPayload, SendEmailPayload, TicketPayload,
} from "@kept/shared";
import { clientForConnection } from "../connection-client.js";
import { openWorld, recordTermsChange } from "./world.js";

interface Deps {
  prisma: PrismaClient;
  config: ConnectorConfig | null;
  emailQueue: Queue<EmailJobData>;
  webOrigin: string;
}

/** Reminders go out at this hour (UTC) on their day. */
const REMINDER_HOUR_UTC = 9;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function notice(title: string, lines: string[], link: { href: string; label: string }): Pick<EmailJobData, "html" | "text"> {
  return {
    text: [title, "", ...lines, "", `${link.label}: ${link.href}`].join("\n"),
    html: `<p><strong>${escapeHtml(title)}</strong></p>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>`,
  };
}

/**
 * Carries out an approved action. Each action runs at most once: the job claims it
 * (approved → executing) before doing anything, and a failure is recorded, not retried,
 * since a retried send could reach the customer twice.
 */
export function createActionProcessor(deps: Deps) {
  const { prisma } = deps;
  return async (job: Job<ActionJobData>) => {
    const { actionId } = job.data;
    const claimed = await prisma.proposedAction.updateMany({
      where: { id: actionId, status: "approved" },
      data: { status: "executing", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return { skipped: true };

    const action = await prisma.proposedAction.findUniqueOrThrow({
      where: { id: actionId },
      include: {
        org: { select: { slug: true } },
        account: { select: { name: true, crmExternalId: true, currency: true, owner: { select: { id: true, email: true } } } },
        decidedBy: { select: { id: true, email: true, fullName: true } },
      },
    });
    const payload = (action.editedPayload ?? action.payload) as unknown;

    try {
      let result: Record<string, unknown>;
      if (action.type === "send_email") {
        result = await sendApprovedEmail(deps, action.orgId, action.decidedById, payload as SendEmailPayload);
      } else if (action.type === "schedule_reminder") {
        const p = payload as ReminderPayload;
        const user = action.account?.owner ?? action.decidedBy;
        if (!user) throw new Error("Nobody to remind: the account has no owner");
        const dueAt = new Date(`${p.remindOn}T${String(REMINDER_HOUR_UTC).padStart(2, "0")}:00:00Z`);
        const reminder = await prisma.reminder.create({
          data: { orgId: action.orgId, accountId: action.accountId, userId: user.id, actionId: action.id, title: p.title, dueAt },
        });
        const href = `${deps.webOrigin}/o/${action.org.slug}/flags`;
        const job = await deps.emailQueue.add(
          "reminder",
          { to: user.email, subject: `Reminder: ${p.title}`, ...notice(p.title, [action.account ? `Account: ${action.account.name}` : "", action.rationale ?? ""].filter(Boolean), { href, label: "Open Kept" }) },
          { delay: Math.max(0, dueAt.getTime() - Date.now()), jobId: `reminder-${reminder.id}` },
        );
        await prisma.reminder.update({ where: { id: reminder.id }, data: { bullJobId: job.id ?? null } });
        result = { reminderId: reminder.id, dueAt: dueAt.toISOString() };
      } else if (action.type === "internal_alert") {
        const p = payload as AlertPayload;
        const user = action.account?.owner ?? action.decidedBy;
        if (!user) throw new Error("Nobody to alert: the account has no owner");
        const href = `${deps.webOrigin}/o/${action.org.slug}/flags`;
        const subject = action.account ? `Kept: ${action.account.name}` : "Kept alert";
        await deps.emailQueue.add("alert", { to: user.email, subject, ...notice(subject, [p.message], { href, label: "See flags" }) });
        result = { notified: user.email };
      } else if (action.type === "update_account") {
        // Terms read from a contract, applied once a person approved them.
        const p = payload as AccountUpdatePayload;
        if (!action.accountId) throw new Error("No company to update");
        const data: Prisma.AccountUpdateInput = {};
        if (p.renewalDate) data.renewalDate = new Date(`${p.renewalDate}T00:00:00Z`);
        if (p.annualValue) {
          data.annualValueCents = BigInt(Math.round(Number(p.annualValue) * 100));
          if (p.currency) data.currency = p.currency;
        }
        await prisma.account.update({ where: { id: action.accountId }, data });
        result = { updated: Object.keys(data) };
        // The World Model keeps where the terms came from, for the agents' account history. Best effort.
        try {
          const approver = action.decidedBy?.fullName ?? action.decidedBy?.email ?? "someone";
          await recordTermsChange(await openWorld(prisma, action.orgId), action.accountId, {
            renewalDate: data.renewalDate as Date | undefined,
            annualValueCents: data.annualValueCents as bigint | undefined,
            currency: (data.currency as string | undefined) ?? action.account?.currency ?? null,
            via: `from "${p.documentTitle}", approved by ${approver}`,
            at: new Date(),
          });
        } catch (err) {
          console.warn(`world model update for action ${action.id} failed: ${(err as Error).message}`);
        }
      } else if (action.type === "create_ticket") {
        const p = payload as TicketPayload;
        const { client } = await toolClient(deps, action.orgId, "linear");
        const issue = await createLinearIssue(client, { teamKey: p.teamKey, title: p.title, description: p.description });
        result = { issue: issue.identifier, url: issue.url };
      } else if (action.type === "update_crm") {
        const p = payload as CrmTaskPayload;
        const companyId = action.account?.crmExternalId?.match(/^hubspot:(\d+)$/)?.[1];
        if (!companyId) throw new Error("This company isn't linked to a HubSpot company");
        const { client } = await toolClient(deps, action.orgId, "hubspot");
        const task = await createHubspotTask(client, { companyId, subject: p.subject, body: p.body, dueDate: p.dueDate, ownerEmail: action.account?.owner?.email ?? null });
        result = { taskId: task.id, ownerAssigned: task.ownerAssigned };
      } else {
        throw new Error(`Kept can't carry out ${action.type} actions`);
      }

      await prisma.proposedAction.update({
        where: { id: actionId },
        data: { status: "done", executedAt: new Date(), lastError: null, result: result as Prisma.InputJsonValue },
      });
      return result;
    } catch (err) {
      const message = (err as Error).message;
      await prisma.proposedAction.update({ where: { id: actionId }, data: { status: "failed", lastError: message } });
      return { failed: message };
    }
  };
}

/** The org's connection to a tool, allowed to act in it. Never retries: a retry could create the record twice. */
async function toolClient(deps: Deps, orgId: string, provider: "linear" | "hubspot") {
  if (!deps.config) throw new Error("TOKEN_ENCRYPTION_KEY is not set on the worker");
  const name = provider === "linear" ? "Linear" : "HubSpot";
  const connections = await deps.prisma.connection.findMany({ where: { orgId, provider, status: "active" }, orderBy: { updatedAt: "desc" } });
  if (connections.length === 0) throw new Error(`Connect ${name} on the Integrations page, then approve again.`);
  const connection = connections.find((c) => canAct(c.provider, c.scopes));
  if (!connection) throw new Error(`Reconnect ${name} on the Integrations page to allow Kept to create records, then approve again.`);
  return clientForConnection(deps.prisma, deps.config, connection, { maxRetries: 0 });
}

/** Sends from the approver's own Gmail or Outlook, so the customer gets it from the person they know. */
async function sendApprovedEmail(deps: Deps, orgId: string, userId: string | null, mail: SendEmailPayload) {
  if (!deps.config) throw new Error("TOKEN_ENCRYPTION_KEY is not set on the worker");
  if (!userId) throw new Error("The action has no approver to send as");
  const connections = await deps.prisma.connection.findMany({
    where: { orgId, ownerUserId: userId, provider: { in: ["google", "microsoft"] }, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  const connection = connections.find((c) => canSendMail(c.provider, c.scopes));
  if (!connection) throw new Error("Reconnect Gmail or Outlook on the Integrations page to allow sending, then approve again.");

  const { client } = clientForConnection(deps.prisma, deps.config, connection, { maxRetries: 0 });
  const { messageId } = await sendMail(connection.provider, client, mail);
  return { provider: connection.provider, from: connection.label, messageId, to: mail.to };
}
