import { sourceSyncQueue } from "./queues.js";

const EVERY_MS = 15 * 60 * 1000;

// BullMQ ids can't contain ":".
const schedulerId = (connectionId: string) => `sync-${connectionId}`;

/** Syncs now, then every 15 minutes. */
export async function scheduleSync(connectionId: string) {
  await sourceSyncQueue.upsertJobScheduler(
    schedulerId(connectionId),
    { every: EVERY_MS },
    { name: "sync", data: { connectionId } },
  );
  await syncNow(connectionId);
}

export async function syncNow(connectionId: string) {
  // Deduplicated while one is already waiting; the worker also refuses to overlap two syncs.
  await sourceSyncQueue.add("sync", { connectionId }, { jobId: `now-${connectionId}`, removeOnComplete: true, removeOnFail: true });
}

export async function unscheduleSync(connectionId: string) {
  await sourceSyncQueue.removeJobScheduler(schedulerId(connectionId));
}
