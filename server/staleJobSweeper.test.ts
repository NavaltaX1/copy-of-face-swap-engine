import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The sweeper is the only thing that advances a job nobody is watching, so what
 * matters here is that it claims before working (two replicas, or a sweep
 * racing a client poll, must not both download the same output) and that one
 * bad job does not abandon the rest of the batch.
 */

const ORIGINAL_ENV = { ...process.env };

type Job = {
  id: number;
  userId: number;
  status: string;
  akoolJobId: string | null;
};

let candidates: Job[] = [];
let claimable = new Set<number>();
let claimCalls: number[] = [];
let upstream: Record<
  string,
  { status: string; output?: string; error?: string } | "throw"
> = {};
let finalizeCalls: Array<{ fn: string; jobId: number }> = [];
let succeededOutcome: "completed" | "storage_retry" = "completed";

async function loadModule() {
  vi.resetModules();
  claimCalls = [];
  finalizeCalls = [];

  vi.doMock("./db", () => ({
    findStaleJobs: async (_cutoff: Date, limit: number) =>
      candidates.slice(0, limit),
    claimStaleJob: async (jobId: number) => {
      claimCalls.push(jobId);
      return claimable.has(jobId);
    },
  }));

  vi.doMock("./replicateApi", () => ({
    checkPredictionStatus: async (predictionId: string) => {
      const entry = upstream[predictionId];
      if (entry === "throw") throw new Error("Replicate 503");
      if (!entry) throw new Error(`no stub for ${predictionId}`);
      return entry;
    },
  }));

  vi.doMock("./jobCompletion", () => ({
    finalizeSucceededJob: async (job: Job) => {
      finalizeCalls.push({ fn: "succeeded", jobId: job.id });
      return succeededOutcome === "completed"
        ? { kind: "completed", outputUrl: "/manus-storage/x.mp4" }
        : { kind: "storage_retry", message: "storage down" };
    },
    finalizeFailedJob: async (job: Job) => {
      finalizeCalls.push({ fn: "failed", jobId: job.id });
      return { kind: "failed", message: "x" };
    },
  }));

  return import("./staleJobSweeper");
}

function job(id: number, predictionId: string | null = `pred_${id}`): Job {
  return { id, userId: 1, status: "processing", akoolJobId: predictionId };
}

beforeEach(() => {
  candidates = [];
  claimable = new Set();
  upstream = {};
  succeededOutcome = "completed";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.doUnmock("./db");
  vi.doUnmock("./replicateApi");
  vi.doUnmock("./jobCompletion");
});

describe("sweepStaleJobs", () => {
  it("reports zeros when nothing is stale", async () => {
    const { sweepStaleJobs } = await loadModule();

    expect(await sweepStaleJobs()).toEqual({
      examined: 0,
      claimed: 0,
      completed: 0,
      failed: 0,
      stillWaiting: 0,
      errors: 0,
    });
  });

  it("completes a stale job whose render finished upstream", async () => {
    candidates = [job(1)];
    claimable = new Set([1]);
    upstream.pred_1 = {
      status: "succeeded",
      output: "https://replicate.delivery/o.mp4",
    };
    const { sweepStaleJobs } = await loadModule();

    const result = await sweepStaleJobs();

    expect(result).toMatchObject({ examined: 1, claimed: 1, completed: 1 });
    expect(finalizeCalls).toEqual([{ fn: "succeeded", jobId: 1 }]);
  });

  it("does not touch a job it loses the claim on", async () => {
    candidates = [job(1)];
    claimable = new Set(); // someone else got there first
    upstream.pred_1 = {
      status: "succeeded",
      output: "https://replicate.delivery/o.mp4",
    };
    const { sweepStaleJobs } = await loadModule();

    const result = await sweepStaleJobs();

    expect(result).toMatchObject({ examined: 1, claimed: 0, completed: 0 });
    // The point of claiming: no upstream call, no download, no second store.
    expect(finalizeCalls).toEqual([]);
  });

  it("claims before asking upstream", async () => {
    candidates = [job(1)];
    claimable = new Set([1]);
    upstream.pred_1 = { status: "processing" };
    const { sweepStaleJobs } = await loadModule();

    await sweepStaleJobs();

    expect(claimCalls).toEqual([1]);
  });

  it("closes a job that failed upstream", async () => {
    candidates = [job(1)];
    claimable = new Set([1]);
    upstream.pred_1 = { status: "failed", error: "CUDA OOM" };
    const { sweepStaleJobs } = await loadModule();

    expect(await sweepStaleJobs()).toMatchObject({ claimed: 1, failed: 1 });
    expect(finalizeCalls).toEqual([{ fn: "failed", jobId: 1 }]);
  });

  it("closes a cancelled job", async () => {
    candidates = [job(1)];
    claimable = new Set([1]);
    upstream.pred_1 = { status: "canceled" };
    const { sweepStaleJobs } = await loadModule();

    expect(await sweepStaleJobs()).toMatchObject({ failed: 1 });
  });

  it("leaves a job that is genuinely still running", async () => {
    candidates = [job(1)];
    claimable = new Set([1]);
    upstream.pred_1 = { status: "processing" };
    const { sweepStaleJobs } = await loadModule();

    const result = await sweepStaleJobs();

    expect(result).toMatchObject({
      claimed: 1,
      stillWaiting: 1,
      completed: 0,
      failed: 0,
    });
    expect(finalizeCalls).toEqual([]);
  });

  it("counts a still-failing storage copy as waiting, not completed", async () => {
    candidates = [job(1)];
    claimable = new Set([1]);
    upstream.pred_1 = {
      status: "succeeded",
      output: "https://replicate.delivery/o.mp4",
    };
    succeededOutcome = "storage_retry";
    const { sweepStaleJobs } = await loadModule();

    expect(await sweepStaleJobs()).toMatchObject({
      completed: 0,
      stillWaiting: 1,
    });
  });

  it("keeps going when one job's upstream call throws", async () => {
    candidates = [job(1), job(2), job(3)];
    claimable = new Set([1, 2, 3]);
    upstream.pred_1 = {
      status: "succeeded",
      output: "https://replicate.delivery/1.mp4",
    };
    upstream.pred_2 = "throw";
    upstream.pred_3 = { status: "failed", error: "nope" };
    const { sweepStaleJobs } = await loadModule();

    const result = await sweepStaleJobs();

    expect(result).toMatchObject({
      examined: 3,
      claimed: 3,
      completed: 1,
      failed: 1,
      errors: 1,
    });
    expect(finalizeCalls.map(c => c.jobId).sort()).toEqual([1, 3]);
  });

  it("skips a job with no prediction id", async () => {
    candidates = [job(1, null)];
    const { sweepStaleJobs } = await loadModule();

    const result = await sweepStaleJobs();

    expect(result).toMatchObject({ examined: 1, claimed: 0 });
    expect(claimCalls).toEqual([]);
  });

  it("honours the batch size, so one run cannot stampede upstream", async () => {
    candidates = [job(1), job(2), job(3), job(4)];
    claimable = new Set([1, 2, 3, 4]);
    for (const n of [1, 2, 3, 4])
      upstream[`pred_${n}`] = { status: "processing" };
    const { sweepStaleJobs, DEFAULT_SWEEPER_CONFIG } = await loadModule();

    const result = await sweepStaleJobs({
      ...DEFAULT_SWEEPER_CONFIG,
      batchSize: 2,
    });

    expect(result.examined).toBe(2);
  });
});

describe("startStaleJobSweeper", () => {
  async function start(env: Record<string, string | undefined>) {
    delete process.env.DATABASE_URL;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.STALE_JOB_SWEEP_ENABLED;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const module = await loadModule();
    const stop = module.startStaleJobSweeper();
    return { stop, status: module.getSweeperStatus() };
  }

  it("runs when a database and a token are both configured", async () => {
    const { stop, status } = await start({
      DATABASE_URL: "mysql://u:p@db:3306/app",
      REPLICATE_API_TOKEN: "r8_token",
    });

    expect(status.enabled).toBe(true);
    expect(status.reason).toBeUndefined();
    stop();
  });

  it("stays off with no database, and says so", async () => {
    // Reported rather than silent: a sweep that is not running is exactly the
    // kind of thing that is only noticed once a job has been lost.
    const { status } = await start({ REPLICATE_API_TOKEN: "r8_token" });

    expect(status.enabled).toBe(false);
    expect(status.reason).toContain("DATABASE_URL");
  });

  it("stays off with no Replicate token, and says so", async () => {
    const { status } = await start({ DATABASE_URL: "mysql://u:p@db:3306/app" });

    expect(status.enabled).toBe(false);
    expect(status.reason).toContain("REPLICATE_API_TOKEN");
  });

  it("can be turned off explicitly", async () => {
    const { status } = await start({
      DATABASE_URL: "mysql://u:p@db:3306/app",
      REPLICATE_API_TOKEN: "r8_token",
      STALE_JOB_SWEEP_ENABLED: "false",
    });

    expect(status.enabled).toBe(false);
    expect(status.reason).toContain("STALE_JOB_SWEEP_ENABLED");
  });

  it("reports stopped after its stop function is called", async () => {
    const { stop } = await start({
      DATABASE_URL: "mysql://u:p@db:3306/app",
      REPLICATE_API_TOKEN: "r8_token",
    });
    stop();

    const { getSweeperStatus } = await import("./staleJobSweeper");
    expect(getSweeperStatus()).toMatchObject({
      enabled: false,
      reason: "stopped",
    });
  });
});
