/**
 * Health reporting for the API.
 *
 * Two endpoints, because they answer different questions:
 *
 *   GET /api/health/live  - liveness. Is the process up and serving? Always 200
 *                           if we can answer at all. Used to decide "restart me".
 *   GET /api/health       - readiness. Are the dependencies this app needs
 *                           actually usable? 200 when every required check
 *                           passes, 503 otherwise. Used to decide "send me
 *                           traffic" and by the container healthcheck.
 *
 * The distinction matters: a server that booted with no DATABASE_URL is alive
 * but cannot serve a single job query. Reporting it healthy is how a broken
 * deploy passes its rollout and fails on the first real request instead.
 */

import type { Express, Request, Response } from "express";
import { ENV } from "./env";
import { pingDatabase } from "../db";

export type CheckStatus = "ok" | "error" | "skipped";

export interface DependencyCheck {
  /** Dependency name, stable enough to alert on. */
  name: string;
  status: CheckStatus;
  /** Why it is not ok, or how it was satisfied. Never contains secrets. */
  detail?: string;
  durationMs: number;
}

export interface HealthReport {
  /** ok = every required check passed. error = at least one did not. */
  status: "ok" | "error";
  timestamp: string;
  uptimeSeconds: number;
  environment: "production" | "development";
  checks: DependencyCheck[];
}

/**
 * Flatten an error chain into one line.
 *
 * Drivers wrap the useful part: drizzle reports "Failed query: select 1" and
 * hangs the real cause - getaddrinfo ENOTFOUND, ECONNREFUSED, Access denied -
 * off `cause`. Reporting only the outer message tells an operator that a query
 * failed but not which of those to go and fix.
 */
function describeError(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  // Bounded, because an error chain can be circular.
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const message = current.message.trim();
    if (message && !messages.includes(message)) messages.push(message);
    current = (current as { cause?: unknown }).cause;
  }

  if (messages.length === 0) return String(error);
  return messages.join(": ");
}

async function timed(
  name: string,
  check: () => Promise<Omit<DependencyCheck, "name" | "durationMs">>
): Promise<DependencyCheck> {
  const startedAt = Date.now();
  try {
    const result = await check();
    return { name, ...result, durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      name,
      status: "error",
      detail: describeError(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Config that is absent is only an error in production. Locally, an unset
 * optional integration is a normal state and marking it red trains people to
 * ignore the health endpoint.
 */
function missingConfig(
  detail: string
): Omit<DependencyCheck, "name" | "durationMs"> {
  return ENV.isProduction
    ? { status: "error", detail }
    : { status: "skipped", detail };
}

async function checkDatabase(): Promise<DependencyCheck> {
  return timed("database", async () => {
    const result = await pingDatabase();
    if (result === "unconfigured") {
      return missingConfig("DATABASE_URL is not set");
    }
    return { status: "ok", detail: "SELECT 1 succeeded" };
  });
}

async function checkStorage(): Promise<DependencyCheck> {
  return timed("storage", async () => {
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      return missingConfig(
        "BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY are not set"
      );
    }
    return { status: "ok", detail: "credentials present" };
  });
}

async function checkReplicate(): Promise<DependencyCheck> {
  return timed("replicate", async () => {
    if (!process.env.REPLICATE_API_TOKEN) {
      return missingConfig("REPLICATE_API_TOKEN is not set");
    }
    return { status: "ok", detail: "token present" };
  });
}

/**
 * Run every dependency check. Checks run in parallel and each one owns its own
 * failure, so one slow dependency cannot hide the state of the others.
 */
export async function getHealthReport(): Promise<HealthReport> {
  const checks = await Promise.all([
    checkDatabase(),
    checkStorage(),
    checkReplicate(),
  ]);

  return {
    status: checks.some(check => check.status === "error") ? "error" : "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    environment: ENV.isProduction ? "production" : "development",
    checks,
  };
}

export function registerHealthRoutes(app: Express): void {
  app.get("/api/health/live", (_req: Request, res: Response) => {
    res
      .status(200)
      .json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });

  app.get("/api/health", async (_req: Request, res: Response) => {
    const report = await getHealthReport();
    // 503 so that load balancers, compose healthchecks and rollout gates all
    // read the same signal instead of each parsing the body differently.
    res.status(report.status === "ok" ? 200 : 503).json(report);
  });
}
