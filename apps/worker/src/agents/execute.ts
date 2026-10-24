import type { Job, Queue } from "bullmq";
import type { Prisma, PrismaClient } from "@kept/db";
import { canSendMail, sendMail, type ConnectorConfig } from "@kept/connectors";
import type { ActionJobData, AlertPayload, EmailJobData, ReminderPayload, SendEmailPayload } from "@kept/shared";
import { clientForConnection } from "../connection-client.js";

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
        account: { select: { name: true, owner: { select: { id: true, email: true } } } },
        decidedBy: { select: { id: true, email: true } },
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
