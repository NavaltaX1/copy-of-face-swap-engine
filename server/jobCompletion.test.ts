import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * jobCompletion owns every terminal transition, for both the webhook and the
 * status poll. These cover the parts that were previously either wrong or
 * missing entirely: idempotency on redelivery, keeping a job retryable when the
 * output copy fails, and sending the notifications that nothing used to send.
 */

interface Update {
  jobId: number;
  updates: Record<string, unknown>;
}

let updates: Update[] = [];
let completionNotifications: unknown[][] = [];
let failureNotifications: unknown[][] = [];
let storeBehaviour: "ok" | "throw" = "ok";
let settingsRow:
  | { emailNotifications: number; inAppNotifications: number }
  | undefined;
let notificationBehaviour: "ok" | "throw" = "ok";

const job = {
  id: 11,
  userId: 5,
  status: "processing" as const,
  akoolJobId: "pred_xyz",
};

async function loadModule() {
  vi.resetModules();
  updates = [];
  completionNotifications = [];
  failureNotifications = [];

  vi.doMock("./db", () => ({
    updateFaceSwapJob: async (jobId: number, u: Record<string, unknown>) => {
      updates.push({ jobId, updates: u });
    },
    getUserById: async () => ({
      id: 5,
      email: "user@example.com",
      name: "Ada",
    }),
    getUserSettings: async () => settingsRow,
  }));

  vi.doMock("./outputHandler", () => ({
    processCompletedJob: async (jobId: number, userId: number) => {
      if (storeBehaviour === "throw")
        throw new Error("S3 presign failed (503)");
      return {
        storagePath: `outputs/face-swaps/${userId}/job-${jobId}.mp4`,
        storageUrl: `/manus-storage/outputs/face-swaps/${userId}/job-${jobId}.mp4`,
      };
    },
  }));

  vi.doMock("./notificationService", () => ({
    sendJobCompletionNotification: async (...args: unknown[]) => {
      if (notificationBehaviour === "throw")
        throw new Error("mail gateway down");
      completionNotifications.push(args);
    },
    sendJobFailureNotification: async (...args: unknown[]) => {
      if (notificationBehaviour === "throw")
        throw new Error("mail gateway down");
      failureNotifications.push(args);
    },
  }));

  return import("./jobCompletion");
}

beforeEach(() => {
  storeBehaviour = "ok";
  notificationBehaviour = "ok";
  settingsRow = { emailNotifications: 1, inAppNotifications: 1 };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./db");
  vi.doUnmock("./outputHandler");
  vi.doUnmock("./notificationService");
});

describe("finalizeSucceededJob", () => {
  it("copies the output into our storage and closes the job", async () => {
    const { finalizeSucceededJob } = await loadModule();

    const outcome = await finalizeSucceededJob(
      job as never,
      "https://replicate.delivery/o.mp4"
    );

    expect(outcome).toEqual({
      kind: "completed",
      outputUrl: "/manus-storage/outputs/face-swaps/5/job-11.mp4",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].updates).toMatchObject({
      status: "completed",
      outputVideoUrl: "/manus-storage/outputs/face-swaps/5/job-11.mp4",
      // Cleared, so a storage retry that later succeeds does not leave its
      // own failure message on a finished job.
      errorMessage: null,
    });
  });

  it("notifies the user with the stored URL, not the upstream one", async () => {
    const { finalizeSucceededJob } = await loadModule();

    await finalizeSucceededJob(
      job as never,
      "https://replicate.delivery/o.mp4"
    );

    expect(completionNotifications).toHaveLength(1);
    expect(completionNotifications[0]).toEqual([
      5,
      11,
      "user@example.com",
      "Ada",
      "/manus-storage/outputs/face-swaps/5/job-11.mp4",
      true,
      true,
    ]);
  });

  it("keeps the job retryable when the copy fails, rather than completing it", async () => {
    storeBehaviour = "throw";
    const { finalizeSucceededJob } = await loadModule();

    const outcome = await finalizeSucceededJob(
      job as never,
      "https://replicate.delivery/o.mp4"
    );

    // Completing against the upstream URL looked fine until it expired, after
    // which the download 404'd for good.
    expect(outcome.kind).toBe("storage_retry");
    expect(updates[0].updates).toMatchObject({ status: "processing" });
    expect(updates[0].updates.errorMessage).toContain("S3 presign failed");
    expect(completionNotifications).toEqual([]);
  });

  it("ignores a redelivered callback for a completed job", async () => {
    const { finalizeSucceededJob } = await loadModule();

    const outcome = await finalizeSucceededJob(
      { ...job, status: "completed" } as never,
      "https://replicate.delivery/o.mp4"
    );

    expect(outcome).toEqual({
      kind: "ignored",
      reason: "job is already completed",
    });
    expect(updates).toEqual([]);
    expect(completionNotifications).toEqual([]);
  });

  it("still completes the job when notifying throws", async () => {
    notificationBehaviour = "throw";
    const { finalizeSucceededJob } = await loadModule();

    const outcome = await finalizeSucceededJob(
      job as never,
      "https://replicate.delivery/o.mp4"
    );

    // The status write has already committed and the job is visible either
    // way; a failed email is not worth unwinding a finished render.
    expect(outcome.kind).toBe("completed");
    expect(updates[0].updates).toMatchObject({ status: "completed" });
  });

  it("treats absent settings as both channels enabled", async () => {
    // The columns default to 1, so no settings row means the user has never
    // opened preferences - not that they opted out.
    settingsRow = undefined;
    const { finalizeSucceededJob } = await loadModule();

    await finalizeSucceededJob(
      job as never,
      "https://replicate.delivery/o.mp4"
    );

    expect(completionNotifications[0]?.slice(-2)).toEqual([true, true]);
  });

  it("honours disabled notification channels", async () => {
    settingsRow = { emailNotifications: 0, inAppNotifications: 1 };
    const { finalizeSucceededJob } = await loadModule();

    await finalizeSucceededJob(
      job as never,
      "https://replicate.delivery/o.mp4"
    );

    expect(completionNotifications[0]?.slice(-2)).toEqual([false, true]);
  });
});

describe("finalizeFailedJob", () => {
  it("closes the job and notifies with the reason", async () => {
    const { finalizeFailedJob } = await loadModule();

    const outcome = await finalizeFailedJob(job as never, "CUDA out of memory");

    expect(outcome).toEqual({ kind: "failed", message: "CUDA out of memory" });
    expect(updates[0].updates).toMatchObject({
      status: "failed",
      errorMessage: "CUDA out of memory",
    });
    expect(failureNotifications).toHaveLength(1);
    expect(failureNotifications[0]?.[4]).toBe("CUDA out of memory");
  });

  it("ignores a redelivered failure for an already failed job", async () => {
    const { finalizeFailedJob } = await loadModule();

    const outcome = await finalizeFailedJob(
      { ...job, status: "failed" } as never,
      "whatever"
    );

    expect(outcome).toEqual({
      kind: "ignored",
      reason: "job is already failed",
    });
    expect(updates).toEqual([]);
    expect(failureNotifications).toEqual([]);
  });

  it("does not reopen a completed job", async () => {
    const { finalizeFailedJob } = await loadModule();

    const outcome = await finalizeFailedJob(
      { ...job, status: "completed" } as never,
      "late failure"
    );

    expect(outcome.kind).toBe("ignored");
    expect(updates).toEqual([]);
  });
});
