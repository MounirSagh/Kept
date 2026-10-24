import type { Prisma } from "@kept/db";
import { canSendMail } from "@kept/connectors";
import type {
  ActionDecisionInput, ActionPayload, ActionsDto, ProposedActionDto, ReminderPayload, SendEmailPayload,
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

export async function listActions(actor: OrgActor, filter: { view: "pending" | "history" }): Promise<ActionsDto> {
  const [actions, canSendEmail] = await Promise.all([
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
  ]);
  return { actions: actions.map(toDto), canSendEmail };
}

const LABEL = { send_email: "email", schedule_reminder: "reminder", internal_alert: "alert" } as const;

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
  if (type === "send_email") {
    const to = Array.isArray(p.to) ? p.to.map((e) => String(e).trim().toLowerCase()).filter(Boolean) : [];
    const subject = typeof p.subject === "string" ? p.subject.trim() : "";
    const body = typeof p.body === "string" ? p.body.trim() : "";
    if (to.length === 0 || to.length > 20 || !to.every((e) => EMAIL.test(e))) throw new HttpError(400, "Add at least one valid recipient");
    if (!subject || subject.length > 300) throw new HttpError(400, "Add a subject");
    if (!body || body.length > 20_000) throw new HttpError(400, "Add a message");
    return { to: [...new Set(to)], subject, body } satisfies SendEmailPayload;
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
