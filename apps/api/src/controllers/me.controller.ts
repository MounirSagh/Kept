import type { Request, Response } from "express";
import type { MeDto } from "@kept/shared";
import { currentUser } from "../middlewares/auth.js";
import { listMemberships } from "../services/orgs.service.js";

export async function get(req: Request, res: Response) {
  const { id, email, fullName, avatarUrl, isPlatformAdmin } = currentUser(req);
  const memberships = await listMemberships(id);
  const body: MeDto = {
    user: { id, email, fullName, avatarUrl, isPlatformAdmin },
    orgs: memberships.map((m) => ({ ...m.org, role: m.role, teamId: m.teamId })),
  };
  res.json(body);
}
