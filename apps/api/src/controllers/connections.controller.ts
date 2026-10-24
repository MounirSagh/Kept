import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/validate.js";
import { currentActor, currentUser } from "../middlewares/auth.js";
import * as connections from "../services/connections.service.js";

const providerParams = z.object({ provider: z.string().min(1) });
const connectionParams = z.object({ connectionId: z.uuid() });
const callbackBody = z.object({ code: z.string().min(1), state: z.string().min(1) });

export async function list(req: Request, res: Response) {
  res.json(await connections.listConnections(currentActor(req)));
}

export async function authorize(req: Request, res: Response) {
  const { provider } = parse(providerParams, req.params);
  res.json(connections.startAuthorization(currentActor(req), provider));
}

export async function callback(req: Request, res: Response) {
  const { code, state } = parse(callbackBody, req.body);
  res.json(await connections.completeAuthorization(currentUser(req), code, state));
}

export async function sync(req: Request, res: Response) {
  const { connectionId } = parse(connectionParams, req.params);
  await connections.syncConnection(currentActor(req), connectionId);
  res.status(202).end();
}

export async function remove(req: Request, res: Response) {
  const { connectionId } = parse(connectionParams, req.params);
  await connections.removeConnection(currentActor(req), connectionId);
  res.status(204).end();
}
