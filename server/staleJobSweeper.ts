/**
 * Background sweep for abandoned jobs.
 *
 * Until this existed, a job only advanced when a client asked about it. Two
 * ways that left work stranded:
 *
 *  - The output copy into our storage fails. The job is deliberately left
 *    retryable, but the only thing that retries it is the next poll - and the
 *    upstream URL expires within the hour. Close the tab and the render is
 *    lost even though it succeeded.
 *  - The webhook never arrives (not configured, secret unset, delivery lost)
 *    and nobody reopens the page. The job sits in `processing` forever.
 *
 * The sweep asks upstream about anything in flight that has gone quiet and
 * pushes it through the same jobCompletion path the webhook and the poll use.
 *
 * Deliberately in-process rather than on the platform's heartbeat cron
 * (server/_core/heartbeat.ts): that would need a new publicly reachable
 * /api/scheduled/ endpoint with no documented request signature to verify, and
 * it does not exist at all in a self-hosted container. A timer needs no new
 * attack surface and behaves the same in both deployments.
 */

import { checkPredictionStatus } from "./replicateApi";
import { claimStaleJob, findStaleJobs } from "./db";
import { finalizeFailedJob, finalizeSucceededJob } from "./jobCompletion";

export interface SweeperConfig {
  /** How often to sweep. */
  intervalMs: number;
  /** How quiet a job must be before it is considered abandoned. */
  staleAfterMs: number;
  /** Most jobs touched per sweep, so one run cannot stampede the upstream API. */
  batchSize: number;
}

export const DEFAULT_SWEEPER_CONFIG: SweeperConfig = {
  intervalMs: 5 * 60 * 1000,
  // Comfortably longer than a client's own poll interval, so the sweep picks up
  // only what nothing else is already driving.
  staleAfterMs: 10 * 60 * 1000,
  batchSize: 10,
};

export interface SweepResult {
  examined: number;
  claimed: number;
  completed: number;
  failed: number;
  stillWaiting: number;
  errors: number;
}

export interface SweeperStatus {
  enabled: boolean;
  /** Why it is off, when it is off. */
  reason?: string;
  lastRunAt?: string;
  lastRunMs?: number;
  lastResult?: SweepResult;
  /** Most recent run-level failure, e.g. the database being unreachable. */
  lastError?: string;
  runs: number;
}

const status: SweeperStatus = { enabled: false, runs: 0 };
let timer: NodeJS.Timeout | undefined;
/** A sweep can outlast its interval; never let two overlap. */
let inFlight = false;

export function getSweeperStatus(): SweeperStatus {
  return { ...status };
}

function configFromEnv(): SweeperConfig {
  const read = (name: string, fallback: number) => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      console.warn(
        `[sweeper] ${name}=${raw} is not a positive number; using ${fallback}`
      );
      return fallback;
    }
    return value;
  };

  return {
    intervalMs: read(
      "STALE_JOB_SWEEP_INTERVAL_MS",
      DEFAULT_SWEEPER_CONFIG.intervalMs
    ),
    staleAfterMs: read(
      "STALE_JOB_STALE_AFTER_MS",
      DEFAULT_SWEEPER_CONFIG.staleAfterMs
    ),
    batchSize: read("STALE_JOB_SWEEP_BATCH", DEFAULT_SWEEPER_CONFIG.batchSize),
  };
}

/**
 * One pass. Exported so it can be tested, and so it can be driven from
 * elsewhere (a platform cron, a one-off script) without the timer.
 */
export async function sweepStaleJobs(
  config: SweeperConfig = DEFAULT_SWEEPER_CONFIG
): Promise<SweepResult> {
  const result: SweepResult = {
    examined: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    stillWaiting: 0,
    errors: 0,
  };

  const cutoff = new Date(Date.now() - config.staleAfterMs);
  const candidates = await findStaleJobs(cutoff, config.batchSize);
  result.examined = candidates.length;

  for (const job of candidates) {
    if (!job.akoolJobId) continue;

    // Claim first: between the query and here, a client poll or another
    // replica may already have taken this job.
    if (!(await claimStaleJob(job.id, cutoff))) continue;
    result.claimed++;

    try {
      const upstream = await checkPredictionStatus(job.akoolJobId);

      if (upstream.status === "succeeded" && upstream.output) {
        const outcome = await finalizeSucceededJob(job, upstream.output);
        if (outcome.kind === "completed") result.completed++;
        else result.stillWaiting++;
      } else if (upstream.status === "failed") {
        await finalizeFailedJob(
          job,
          upstream.error || "Face swap processing failed"
        );
        result.failed++;
      } else if (upstream.status === "canceled") {
        await finalizeFailedJob(job, "Face swap prediction was canceled");
        result.failed++;
      } else {
        // Genuinely still running upstream. The claim already moved it out of
        // the window, so it will be looked at again next interval.
        result.stillWaiting++;
      }
    } catch (error) {
      // One job's upstream failure must not abandon the rest of the batch.
      result.errors++;
      console.error(`[sweeper] Job ${job.id}: sweep failed:`, error);
    }
  }

  return result;
}

/**
 * Start the periodic sweep. Returns a stop function.
 *
 * Off when there is nothing to sweep with: no database means no jobs to read,
 * and no Replicate token means nothing to ask. Both are reported through
 * getSweeperStatus so the health endpoint can say the sweep is not running
 * rather than leaving it to be discovered.
 */
export function startStaleJobSweeper(
  config: SweeperConfig = configFromEnv()
): () => void {
  const noop = () => {};

  if (process.env.STALE_JOB_SWEEP_ENABLED === "false") {
    status.enabled = false;
    status.reason = "disabled by STALE_JOB_SWEEP_ENABLED=false";
    return noop;
  }
  if (!process.env.DATABASE_URL) {
    status.enabled = false;
    status.reason = "DATABASE_URL is not set";
    return noop;
  }
  if (!process.env.REPLICATE_API_TOKEN) {
    status.enabled = false;
    status.reason = "REPLICATE_API_TOKEN is not set";
    return noop;
  }

  status.enabled = true;
  delete status.reason;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    const startedAt = Date.now();

    try {
      const result = await sweepStaleJobs(config);
      status.lastResult = result;
      delete status.lastError;

      if (result.claimed > 0) {
        console.log(
          `[sweeper] examined ${result.examined}, claimed ${result.claimed}, ` +
            `completed ${result.completed}, failed ${result.failed}, ` +
            `still waiting ${result.stillWaiting}, errors ${result.errors}`
        );
      }
    } catch (error) {
      // A whole-run failure (the database being down, say) is recorded and
      // retried next interval. It must never take the server down with it.
      status.lastError = error instanceof Error ? error.message : String(error);
      console.error("[sweeper] Sweep failed:", error);
    } finally {
      status.lastRunAt = new Date().toISOString();
      status.lastRunMs = Date.now() - startedAt;
      status.runs++;
      inFlight = false;
    }
  };

  timer = setInterval(tick, config.intervalMs);
  // Unreferenced, so a pending interval cannot be the reason the process
  // refuses to exit.
  timer.unref();

  console.log(
    `[sweeper] Started: every ${Math.round(config.intervalMs / 1000)}s, ` +
      `jobs quiet for ${Math.round(config.staleAfterMs / 1000)}s, ` +
      `up to ${config.batchSize} per run`
  );

  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    status.enabled = false;
    status.reason = "stopped";
  };
}
