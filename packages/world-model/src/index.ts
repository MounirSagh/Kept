// Kept's implementation of the Meterless World Model spec. See NOTICE.md.
// The conformance suite (conformance/runner.ts) loads this module directly.

export * from "./types.js";
export { WorldModel, GraphView, FactsView, SnapshotView, TimelineView } from "./world-model.js";
export type { UpsertEntityInput, UpsertContextInput, RelateInput, AssertFactInput } from "./world-model.js";
export { canonicalJson, entityIdFromName, externalId, normalizeName, sha256Hex } from "./stable-ids.js";
export { levenshtein, nameSimilarity, decide, jaccard } from "./resolve.js";
export { worldStateShape } from "./ingest.js";
