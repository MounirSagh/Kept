# Notice

This package implements the Meterless H-MEM spec and is ported from its reference
implementation and conformance suite:

- Source: https://github.com/meterless/Meterless, `engines/hmem`
- Version: v1.0.6 (commit 0aa7417ba5c826396d91e891328be78c45e6fbf6)
- License: Apache License 2.0 (see `LICENSE-meterless`)

Changes from the reference:

- File persistence is removed. `DurableHMEM` (`@kept/hmem/durable`) persists the engine,
  with Postgres storage in `@kept/hmem/prisma` (one namespace per org, embeddings in a
  pgvector column, the trust ledger append-only in `hmem_ledger`).
- The embedder is pluggable. Records carry `embeddingModel`; cosine of vectors from
  different models (different sizes) is 0, and `DurableHMEM.recall` compares only records
  embedded with the current model.
- `query` accepts a precomputed `queryEmbedding` and a `filter` (used for account scope
  and visibility). Both are optional; without them behaviour matches the reference.
- Ledger entries carry a `seq`. The durable layer does not keep the ledger in memory;
  `DurableHMEM.history()` reads it from storage.
- Services expose `exportState`/`importState`; mining exposes `minedInteractionInput` so
  the durable layer can call the model before taking the store lock.
- `conformance/` is copied unchanged apart from the runner's header.
