# Notice

This package implements the Meterless World Model spec and is ported from its
reference implementation and conformance suite:

- Source: https://github.com/meterless/Meterless, `engines/world-model`
- Version: v1.0.6 (commit 0aa7417ba5c826396d91e891328be78c45e6fbf6)
- License: Apache License 2.0 (see `LICENSE-meterless`)

Changes from the reference:

- Storage is pluggable: in-memory, or Postgres through `@kept/world-model/prisma`
  (one namespace per org, append-only `wm_events`).
- Fact conflict resolution happens inside the event fold, and entity aggregates
  are rebuilt after every replay, so a reloaded world equals the world that was
  written. The reference resolved both outside the fold, which only holds while
  a single process keeps the world in memory.
- Writes against durable storage run in a transaction that takes a per-namespace
  lock and first replays events written by other processes.
- sha-256 uses `node:crypto` instead of an inline implementation (server only).
- `conformance/runner.ts` is copied unchanged apart from this header.
