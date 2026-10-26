import type { Prisma } from "@kept/db";
import { canAct, canSendMail } from "@kept/connectors";
import type {
  ActionDecisionInput, ActionPayload, ActionsDto, CrmTaskPayload, ProposedActionDto, ReminderPayload, SendEmailPayload, TicketPayload,
} from "@kept/shared";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { actionQueue, learnQueue } from "../lib/queues.js";
import type { OrgActor } from "../types/express.js";
import { visibleAccountsWhere } from "./accounts.service.js";

/** Actions on accounts the actor can see (or on no account), minus other people's private ones. */
function visibleActionsWhere(actor: OrgActor): Prisma.ProposedActionWhereInput {
  return {
    orgId: actor.orgId,
    AND: [
      { OR: [{ visibleToUserId: null }, { visibleToUserId: actor.userId }] },
      { OR: [{ accountId: null }, { account: visibleAccountsWhere(actor) }] },
    ],
  };
}

const include = {
  account: { select: { name: true } },
  flag: { select: { id: true, title: true, severity: true } },
  decidedBy: { select: { fullName: true, email: true } },
} satisfies Prisma.ProposedActionInclude;

type Row = Prisma.ProposedActionGetPayload<{ include: typeof include }>;

function toDto(a: Row): ProposedActionDto {
  return {
    id: a.id,
    type: a.type as ProposedActionDto["type"],
    status: a.status,
    accountId: a.accountId,
    accountName: a.account?.name ?? null,
    flag: a.flag,
    rationale: a.rationale,
    payload: (a.editedPayload ?? a.payload) as unknown as ActionPayload,
    edited: a.editedPayload != null,
    decidedBy: a.decidedBy ? (a.decidedBy.fullName ?? a.decidedBy.email) : null,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decisionNote: a.decisionNote,
    lastError: a.lastError,
    executedAt: a.executedAt?.toISOString() ?? null,
    result: (a.result as Record<string, unknown> | null) ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Whether the user has a mailbox connection allowed to send: approved emails go out from it. */
async function userCanSend(actor: OrgActor) {
  const connections = await prisma.connection.findMany({
    where: { orgId: actor.orgId, ownerUserId: actor.userId, provider: { in: ["google", "microsoft"] }, status: "active" },
    select: { provider: true, scopes: true },
  });
  return connections.some((c) => canSendMail(c.provider, c.scopes));
}

/** Linear teams seen in synced issues, newest first, for choosing where an issue goes. */
async function linearTeams(orgId: string): Promise<ActionsDto["linearTeams"]> {
  const connections = await prisma.connection.findMany({ where: { orgId, provider: "linear", status: "active" }, select: { id: true, scopes: true } });
  const ids = connections.filter((c) => canAct("linear", c.scopes)).map((c) => c.id);
  if (ids.length === 0) return [];
  const groups = await prisma.sourceItem.groupBy({
    by: ["containerId", "containerLabel"],
    where: { orgId, connectionId: { in: ids }, deletedAt: null, containerId: { not: null } },
    _max: { occurredAt: true },
  });
  const teams = new Map<string, { key: string; name: string; last: number }>();
  for (const g of groups) {
    const last = g._max.occurredAt?.getTime() ?? 0;
    const prev = teams.get(g.containerId!);
    if (!prev || prev.last < last) teams.set(g.containerId!, { key: g.containerId!, name: g.containerLabel ?? g.containerId!, last });
  }
  return [...teams.values()].sort((a, b) => b.last - a.last).map(({ key, name }) => ({ key, name }));
}

export async function listActions(actor: OrgActor, filter: { view: "pending" | "history" }): Promise<ActionsDto> {
  const [actions, canSendEmail, teams] = await Promise.all([
    prisma.proposedAction.findMany({
      where: {
        AND: [
          visibleActionsWhere(actor),
          // Failed actions stay in the inbox: they can be approved again once the cause is fixed.
          { status: filter.view === "pending" ? { in: ["pending", "failed"] } : { in: ["approved", "executing", "done", "rejected"] } },
        ],
      },
      include,
      orderBy: filter.view === "pending" ? { createdAt: "asc" } : { updatedAt: "desc" },
      take: 200,
    }),
    userCanSend(actor),
    linearTeams(actor.orgId),
  ]);
  return { actions: actions.map(toDto), canSendEmail, linearTeams: teams };
}

const LABEL = {
  send_email: "email",
  schedule_reminder: "reminder",
  internal_alert: "alert",
  update_account: "company update",
  create_ticket: "Linear issue",
  update_crm: "HubSpot task",
} as const;

export async function decideAction(actor: OrgActor, actionId: string, input: ActionDecisionInput) {
  const action = await prisma.proposedAction.findFirst({
    where: { AND: [visibleActionsWhere(actor), { id: actionId }] },
    include,
  });
  if (!action) throw new HttpError(404, "Action not found");
  const type = action.type as keyof typeof LABEL;
  if (!(type in LABEL)) throw new HttpError(400, "Kept can't carry out this action");
  const note = input.note?.trim() || null;
  const where = action.account ? ` for ${action.account.name}` : "";

  if (input.decision === "reject") {
    if (action.status !== "pending" && action.status !== "failed") throw new HttpError(409, "This action was already decided");
    await prisma.proposedAction.update({
      where: { id: action.id },
      data: { status: "rejected", decidedById: actor.userId, decidedAt: new Date(), decisionNote: note },
    });
    await learnQueue.add("learn", {
      orgId: actor.orgId,
      accountId: action.accountId,
      content: `A proposed ${LABEL[type]}${where} was rejected${note ? `: ${note}` : ""}. It was proposed because: ${action.rationale ?? "no reason given"}.`,
    });
  } else {
    if (action.status !== "pending" && action.status !== "failed") throw new HttpError(409, "This action was already decided");
    const payload = input.payload ? checkPayload(type, input.payload) : null;
    if (type === "send_email" && !(await userCanSend(actor))) {
      throw new HttpError(409, "Connect Gmail or Outlook with permission to send first. Emails go out from your own mailbox.");
    }
    // Claim it: of two people approving at once, only one queues it.
    const claimed = await prisma.proposedAction.updateMany({
      where: { id: action.id, status: action.status },
      data: {
        status: "approved",
        decidedById: actor.userId,
        decidedAt: new Date(),
        decisionNote: note,
        lastError: null,
        ...(payload ? { editedPayload: payload as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    if (claimed.count === 0) throw new HttpError(409, "This action was already decided");
    await actionQueue.add("execute", { actionId: action.id });

    if (payload && JSON.stringify(payload) !== JSON.stringify(action.payload)) {
      await learnQueue.add("learn", {
        orgId: actor.orgId,
        accountId: action.accountId,
        content: describeEdit(type, action.payload as unknown as ActionPayload, payload, where),
      });
    }
  }

  const updated = await prisma.proposedAction.findUniqueOrThrow({ where: { id: action.id }, include });
  return toDto(updated);
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Validates an edited payload against the action's type; the client form can't be trusted to. */
function checkPayload(type: keyof typeof LABEL, raw: ActionPayload): ActionPayload {
  const p = raw as unknown as Record<string, unknown>;
  if (type === "update_account") {
    const renewalDate = typeof p.renewalDate === "string" && p.renewalDate ? p.renewalDate : null;
    const annualValue = typeof p.annualValue === "string" && p.annualValue.trim() ? p.annualValue.trim().replace(/[,\s]/g, "") : null;
    const currency = typeof p.currency === "string" && p.currency.trim() ? p.currency.trim().toUpperCase() : null;
    if (renewalDate && !/^\d{4}-\d{2}-\d{2}$/.test(renewalDate)) throw new HttpError(400, "Use a date for the renewal");
    if (annualValue && !/^\d{1,13}(\.\d{1,2})?$/.test(annualValue)) throw new HttpError(400, "Use a number for the contract value");
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, "Use a 3-letter currency code");
    if (!renewalDate && !annualValue) throw new HttpError(400, "Nothing to update");
    return {
      renewalDate,
      annualValue,
      currency,
      noticeDays: typeof p.noticeDays === "number" ? p.noticeDays : null,
      documentTitle: String(p.documentTitle ?? ""),
      excerpt: String(p.excerpt ?? ""),
    };
  }
  if (type === "send_email") {
    const to = Array.isArray(p.to) ? p.to.map((e) => String(e).trim().toLowerCase()).filter(Boolean) : [];
    const subject = typeof p.subject === "string" ? p.subject.trim() : "";
    const body = typeof p.body === "string" ? p.body.trim() : "";
    if (to.length === 0 || to.length > 20 || !to.every((e) => EMAIL.test(e))) throw new HttpError(400, "Add at least one valid recipient");
    if (!subject || subject.length > 300) throw new HttpError(400, "Add a subject");
    if (!body || body.length > 20_000) throw new HttpError(400, "Add a message");
    return { to: [...new Set(to)], subject, body } satisfies SendEmailPayload;
  }
  if (type === "create_ticket") {
    const teamKey = typeof p.teamKey === "string" ? p.teamKey.trim().toUpperCase() : "";
    const title = typeof p.title === "string" ? p.title.trim() : "";
    const description = typeof p.description === "string" ? p.description.trim() : "";
    if (!/^[A-Z0-9_]{1,10}$/.test(teamKey)) throw new HttpError(400, "Pick a Linear team");
    if (!title || title.length > 250) throw new HttpError(400, "Add a title");
    if (description.length > 20_000) throw new HttpError(400, "The description is too long");
    return { teamKey, title, description } satisfies TicketPayload;
  }
  if (type === "update_crm") {
    const subject = typeof p.subject === "string" ? p.subject.trim() : "";
    const body = typeof p.body === "string" ? p.body.trim() : "";
    const dueDate = typeof p.dueDate === "string" ? p.dueDate : "";
    if (!subject || subject.length > 250) throw new HttpError(400, "Add what the task is");
    if (body.length > 10_000) throw new HttpError(400, "The notes are too long");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < new Date().toISOString().slice(0, 10)) throw new HttpError(400, "Pick today or a later due date");
    return { subject, body, dueDate } satisfies CrmTaskPayload;
  }
  if (type === "schedule_reminder") {
    const title = typeof p.title === "string" ? p.title.trim() : "";
    const remindOn = typeof p.remindOn === "string" ? p.remindOn : "";
    if (!title || title.length > 300) throw new HttpError(400, "Add what to be reminded of");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(remindOn) || remindOn < new Date().toISOString().slice(0, 10)) throw new HttpError(400, "Pick today or a later date");
    return { title, remindOn } satisfies ReminderPayload;
  }
  const message = typeof p.message === "string" ? p.message.trim() : "";
  if (!message || message.length > 2000) throw new HttpError(400, "Add a message");
  return { message };
}

function describeEdit(type: keyof typeof LABEL, before: ActionPayload, after: ActionPayload, where: string): string {
  if (type === "send_email") {
    const b = before as SendEmailPayload;
    const a = after as SendEmailPayload;
    return `A proposed email${where} was edited before sending. Subject "${b.subject}" became "${a.subject}". The draft read: "${b.body.slice(0, 400)}". What was sent: "${a.body.slice(0, 400)}".`;
  }
  return `A proposed ${LABEL[type]}${where} was edited before approval: ${JSON.stringify(before)} became ${JSON.stringify(after)}.`;
}
