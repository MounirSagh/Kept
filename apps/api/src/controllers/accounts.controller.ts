import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as accounts from "../services/accounts.service.js";

const accountParams = z.object({ accountId: z.uuid() });

export async function list(req: Request, res: Response) {
  res.json(await accounts.listAccounts(currentActor(req)));
}

export async function get(req: Request, res: Response) {
  const { accountId } = parse(accountParams, req.params);
  const account = await accounts.getAccount(currentActor(req), accountId);
  if (!account) throw new HttpError(404, "Not found");
  res.json(account);
}
