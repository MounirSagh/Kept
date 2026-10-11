import express, { Router } from "express";
import * as webhooks from "../controllers/webhooks.controller.js";

export const webhooksRouter = Router();

// Signature verification needs the raw body, so this router is mounted before express.json().
webhooksRouter.post("/clerk", express.raw({ type: "application/json" }), webhooks.clerk);
