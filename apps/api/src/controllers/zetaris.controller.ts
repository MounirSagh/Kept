import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as zetaris from "../services/zetaris.service.js";

const connectBody = z.object({
  restUrl: z.string().min(1).max(500),
  zetarisOrgId: z.string().min(1).max(20),
  apiKey: z.string().max(4000).optional(),
});
const datasetBody = z.object({ name: z.string().max(200), description: z.string().max(2000), sql: z.string().max(10_000) });
const datasetParams = z.object({ datasetId: z.uuid() });
const testBody = z.object({ sql: z.string().max(10_000), accountId: z.uuid() });

export async function get(req: Request, res: Response) {
  res.json(await zetaris.getZetaris(currentActor(req)));
}

export async function connect(req: Request, res: Response) {
  res.json(await zetaris.connectZetaris(currentActor(req), parse(connectBody, req.body)));
}

export async function disconnect(req: Request, res: Response) {
  await zetaris.disconnectZetaris(currentActor(req));
  res.status(204).end();
}

export async function addDataset(req: Request, res: Response) {
  res.status(201).json(await zetaris.addDataset(currentActor(req), parse(datasetBody, req.body)));
}

export async function updateDataset(req: Request, res: Response) {
  const { datasetId } = parse(datasetParams, req.params);
  res.json(await zetaris.updateDataset(currentActor(req), datasetId, parse(datasetBody, req.body)));
}

export async function deleteDataset(req: Request, res: Response) {
  const { datasetId } = parse(datasetParams, req.params);
  res.json(await zetaris.deleteDataset(currentActor(req), datasetId));
}

export async function test(req: Request, res: Response) {
  res.json(await zetaris.testDataset(currentActor(req), parse(testBody, req.body)));
}
