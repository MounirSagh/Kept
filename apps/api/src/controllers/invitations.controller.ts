import type { Request, Response } from "express";
import { z } from "zod";
import { ORG_ROLES } from "@kept/shared";
import { parse } from "../lib/validate.js";
import { currentActor, currentUser } from "../middlewares/auth.js";
import * as invitations from "../services/invitations.service.js";

const invitationParams = z.object({ invitationId: z.uuid() });
const createBody = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(ORG_ROLES),
  teamId: z.uuid().nullable().default(null),
});
const acceptBody = z.object({ token: z.string().min(1) });

export async function list(req: Request, res: Response) {
  res.json(await invitations.listInvitations(currentActor(req)));
}

export async function create(req: Request, res: Response) {
  const { email, ...target } = parse(createBody, req.body);
  res.status(201).json(await invitations.createInvitation(currentActor(req), email, target));
}

export async function resend(req: Request, res: Response) {
  const { invitationId } = parse(invitationParams, req.params);
  res.json(await invitations.resendInvitation(currentActor(req), invitationId));
}

export async function link(req: Request, res: Response) {
  const { invitationId } = parse(invitationParams, req.params);
  res.json(await invitations.resendInvitation(currentActor(req), invitationId, { email: false }));
}

const importBody = z.object({
  rows: z.array(
    z.object({
      row: z.number().int().positive(),
      email: z.email().trim().toLowerCase(),
      role: z.enum(ORG_ROLES),
      team: z.string().trim().max(100).nullable(),
    }),
  ),
});

export async function importRows(req: Request, res: Response) {
  res.json(await invitations.importInvitations(currentActor(req), parse(importBody, req.body).rows));
}

export async function revoke(req: Request, res: Response) {
  const { invitationId } = parse(invitationParams, req.params);
  await invitations.revokeInvitation(currentActor(req), invitationId);
  res.status(204).end();
}

export async function accept(req: Request, res: Response) {
  const { token } = parse(acceptBody, req.body);
  res.json(await invitations.acceptInvitation(currentUser(req), token));
}
