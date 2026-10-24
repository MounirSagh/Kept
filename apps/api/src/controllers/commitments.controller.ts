import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as commitments from "../services/commitments.service.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const status = z.enum(["open", "fulfilled", "broken"]);
const params = z.object({ commitmentId: z.uuid() });
const listQuery = z.object({
  status: z.enum(["open", "fulfilled", "broken", "unknown", "superseded"]).optional(),
  accountId: z.uuid().optional(),
});
const body = z.object({
  accountId: z.uuid(),
  summary: z.string().trim().min(1).max(2000),
  notes: z.string().trim().max(10_000).nullable().transform((v) => v || null),
  madeBy: z.string().trim().max(200).nullable().transform((v) => v || null),
  ownerUserId: z.uuid().nullable(),
  dueDate: isoDate.nullable(),
  status,
});
const importBody = z.object({
  rows: z.array(
    z.object({
      row: z.number().int().positive(),
      account: z.string().trim().min(1).max(300),
      summary: z.string().trim().min(1).max(2000),
      dueDate: isoDate.nullable(),
      ownerEmail: z.string().trim().toLowerCase().max(320).nullable(),
      madeBy: z.string().trim().max(200).nullable(),
      status,
    }),
  ),
});

export async function list(req: Request, res: Response) {
  res.json(await commitments.listCommitments(currentActor(req), parse(listQuery, req.query)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await commitments.createCommitment(currentActor(req), parse(body, req.body)));
}

export async function update(req: Request, res: Response) {
  const { commitmentId } = parse(params, req.params);
  res.json(await commitments.updateCommitment(currentActor(req), commitmentId, parse(body.partial(), req.body)));
}

export async function remove(req: Request, res: Response) {
  const { commitmentId } = parse(params, req.params);
  await commitments.deleteCommitment(currentActor(req), commitmentId);
  res.status(204).end();
}

export async function importRows(req: Request, res: Response) {
  res.json(await commitments.importCommitments(currentActor(req), parse(importBody, req.body).rows));
}
