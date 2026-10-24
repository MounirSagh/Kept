import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as teams from "../services/teams.service.js";

const teamParams = z.object({ teamId: z.uuid() });
const teamBody = z.object({ name: z.string().trim().min(1).max(100) });

export async function list(req: Request, res: Response) {
  res.json(await teams.listTeams(currentActor(req).orgId));
}

export async function create(req: Request, res: Response) {
  const { name } = parse(teamBody, req.body);
  res.status(201).json(await teams.createTeam(currentActor(req).orgId, name));
}

export async function rename(req: Request, res: Response) {
  const { teamId } = parse(teamParams, req.params);
  const { name } = parse(teamBody, req.body);
  res.json(await teams.renameTeam(currentActor(req).orgId, teamId, name));
}

export async function remove(req: Request, res: Response) {
  const { teamId } = parse(teamParams, req.params);
  await teams.deleteTeam(currentActor(req).orgId, teamId);
  res.status(204).end();
}

const importBody = z.object({ rows: z.array(z.object({ row: z.number().int().positive(), name: z.string().trim().min(1).max(100) })) });

export async function importRows(req: Request, res: Response) {
  res.json(await teams.importTeams(currentActor(req).orgId, parse(importBody, req.body).rows));
}
