// Stable, deterministic, content-addressable IDs (Meterless World Model, docs/stable-ids.md).
// Same input, same ID, on every machine, every re-run, every backfill.

import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Deterministic JSON: object keys sorted, undefined members dropped. The
 * idempotency diff compares these strings, so insertion order must not matter.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalJson(v)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/**
 * NFKD -> strip combining marks -> strip zero-width chars -> lowercase -> collapse whitespace -> trim.
 * Never abbreviates or stems: "Acme Corp" and "Acme Corporation" stay different.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[​-‍﻿]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Externally keyed entity or context: the literal grammar `type:system:externalId`. */
export function externalId(type: string, system: string, id: string): string {
  return `${type}:${system}:${id}`;
}

/** Name-keyed entity: ent_<first 16 hex of sha256(`${type}:${normalizeName(name)}`)>. */
export function entityIdFromName(type: string, name: string): string {
  return `ent_${sha256Hex(`${type}:${normalizeName(name)}`).slice(0, 16)}`;
}

/** Attr-keyed contexts hash their attrs WITH the parent, so the same attrs under different parents differ. */
export function contextIdFromAttrs(type: string, attrs: Record<string, unknown>, parent?: string): string {
  return `ctx_${sha256Hex(`${type}:${canonicalJson(attrs)}:${parent ?? ""}`).slice(0, 16)}`;
}

/** Re-adding the same edge is a no-op because its id is content-addressed. */
export function relationshipId(from: string, type: string, to: string, context?: string, validFrom?: string): string {
  return `rel_${sha256Hex(`${from}|${type}|${to}|${context ?? ""}|${validFrom ?? ""}`).slice(0, 16)}`;
}

/** Asserting the identical fact twice is a no-op. */
export function factId(
  about: string,
  predicate: string,
  value: unknown,
  assertedAt: string,
  sourceKind: string,
  sourceUrl?: string,
): string {
  return `fact_${sha256Hex(
    `${about}|${predicate}|${canonicalJson(value)}|${assertedAt}|${sourceKind}|${sourceUrl ?? ""}`,
  ).slice(0, 16)}`;
}
