import { clerkMiddleware, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { Actor } from "@kept/shared";
import { env } from "../env.js";
import { clerk } from "../lib/clerk.js";
import { prisma } from "../lib/prisma.js";
import type { OrgActor } from "../types/express.js";
import { findOrSyncUser } from "../services/users.service.js";

export const authenticate = clerkMiddleware({
  clerkClient: clerk,
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  authorizedParties: [env.WEB_ORIGIN],
});

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  req.user = await findOrSyncUser(userId);
  next();
}

const orgParams = z.object({ orgId: z.uuid() });

/**
 * Resolves the caller's standing in `:orgId`. Members get their role and team;
 * platform admins get through without a membership. Pass a permission check to
 * reject everyone else with 403.
 */
export function requireOrgAccess(check?: (actor: Actor) => boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const params = orgParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const { orgId } = params.data;
    const user = currentUser(req);
    const membership = await prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    });
    const orgExists =
      membership !== null ||
      (user.isPlatformAdmin && (await prisma.organization.count({ where: { id: orgId } })) > 0);
    if (!orgExists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const actor: OrgActor = {
      orgId,
      userId: user.id,
      isPlatformAdmin: user.isPlatformAdmin,
      role: membership?.role ?? null,
      teamId: membership?.teamId ?? null,
    };
    if (check && !check(actor)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    req.actor = actor;
    next();
  };
}

export function currentUser(req: Request) {
  if (!req.user) throw new Error("requireUser middleware missing");
  return req.user;
}

export function currentActor(req: Request) {
  if (!req.actor) throw new Error("requireOrgAccess middleware missing");
  return req.actor;
}
