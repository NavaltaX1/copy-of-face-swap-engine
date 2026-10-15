/**
 * Terminal transitions for a face swap job, in one place.
 *
 * Two things drive a job to a terminal state: the webhook Replicate calls, and
 * the status poll in faceSwapRouter. Before this module they were separate, and
 * only the poll existed - so the rules for "what counts as done" lived in one
 * of the two paths. Anything the webhook learned first would have been handled
 * differently, or not at all.
 *
 * Both now call the same functions, so storage handling, idempotency and
 * notifications cannot drift apart.
 */

import type { FaceSwapJob } from "../drizzle/schema";
import { getUserById, getUserSettings, updateFaceSwapJob } from "./db";
import { processCompletedJob } from "./outputHandler";
import {
  sendJobCompletionNotification,
  sendJobFailureNotification,
} from "./notificationService";

export type FinalizeOutcome =
  /** Output copied into our storage and the job closed. */
  | { kind: "completed"; outputUrl: string }
  /** Upstream succeeded but the copy failed; the job stays retryable. */
  | { kind: "storage_retry"; message: string }
  /** Closed as failed. */
  | { kind: "failed"; message: string }
  /** Already terminal, or nothing to do. */
  | { kind: "ignored"; reason: string };

/** Terminal states: reaching one again is a duplicate delivery, not new news. */
function isTerminal(status: FaceSwapJob["status"]): boolean {
  return status === "completed" || status === "failed";
}

/**
 * Notify, but never at the cost of the job record.
 *
 * The status write has already committed by the time this runs, and the job is
 * visible in the UI either way, so a failed email is worth a log line rather
 * than unwinding a finished render. It is logged loudly because a notification
 * system nobody can see failing is how this one came to be dead code.
 */
async function notifyQuietly(
  jobId: number,
  send: () => Promise<void>
): Promise<void> {
  try {
    await send();
  } catch (error) {
    console.error(`[jobCompletion] Job ${jobId}: notification failed:`, error);
  }
}

async function recipient(userId: number) {
  const [user, settings] = await Promise.all([
    getUserById(userId),
    getUserSettings(userId),
  ]);

  return {
    email: user?.email ?? null,
    name: user?.name ?? null,
    // No settings row means the user has never opened preferences. The column
    // defaults are 1/1, so absent settings mean enabled, not disabled.
    emailEnabled: settings ? settings.emailNotifications === 1 : true,
    inAppEnabled: settings ? settings.inAppNotifications === 1 : true,
  };
}

/**
 * Upstream reports the render succeeded. Copy the output into our own storage,
 * close the job, and tell the user.
 */
export async function finalizeSucceededJob(
  job: FaceSwapJob,
  upstreamOutputUrl: string
): Promise<FinalizeOutcome> {
  if (isTerminal(job.status)) {
    return { kind: "ignored", reason: `job is already ${job.status}` };
  }

  try {
    const stored = await processCompletedJob(
      job.id,
      job.userId,
      upstreamOutputUrl
    );

    await updateFaceSwapJob(job.id, {
      status: "completed",
      outputVideoUrl: stored.storageUrl,
      errorMessage: null,
      completedAt: new Date(),
    });

    const who = await recipient(job.userId);
    await notifyQuietly(job.id, () =>
      sendJobCompletionNotification(
        job.userId,
        job.id,
        who.email,
        who.name,
        stored.storageUrl,
        who.emailEnabled,
        who.inAppEnabled
      )
    );

    return { kind: "completed", outputUrl: stored.storageUrl };
  } catch (error) {
    // Marking the job completed against the upstream URL looked fine until that
    // URL expired, after which the download 404'd for good. Stay retryable with
    // the cause recorded, so the next poll copies it while the source is alive.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[jobCompletion] Job ${job.id}: storing output failed:`,
      error
    );

    const detail = `Output storage failed, will retry: ${message}`;
    await updateFaceSwapJob(job.id, {
      status: "processing",
      errorMessage: detail,
    });

    return { kind: "storage_retry", message: detail };
  }
}

/** Upstream reports the render failed or was cancelled. */
export async function finalizeFailedJob(
  job: FaceSwapJob,
  errorMessage: string
): Promise<FinalizeOutcome> {
  if (isTerminal(job.status)) {
    return { kind: "ignored", reason: `job is already ${job.status}` };
  }

  await updateFaceSwapJob(job.id, { status: "failed", errorMessage });

  const who = await recipient(job.userId);
  await notifyQuietly(job.id, () =>
    sendJobFailureNotification(
      job.userId,
      job.id,
      who.email,
      who.name,
      errorMessage,
      who.emailEnabled,
      who.inAppEnabled
    )
  );

  return { kind: "failed", message: errorMessage };
}
