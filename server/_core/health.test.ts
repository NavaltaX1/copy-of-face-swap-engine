import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * ENV is captured at import time, so every case re-imports the module with the
 * environment it wants to describe.
 */
const ORIGINAL_ENV = { ...process.env };

const UNSET = [
  "DATABASE_URL",
  "BUILT_IN_FORGE_API_URL",
  "BUILT_IN_FORGE_API_KEY",
  "REPLICATE_API_TOKEN",
] as const;

async function reportWith(env: Record<string, string>) {
  vi.resetModules();
  for (const key of UNSET) delete process.env[key];
  Object.assign(process.env, env);
  const { getHealthReport } = await import("./health");
  return getHealthReport();
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("getHealthReport", () => {
  it("reports every dependency it knows how to check", async () => {
    const report = await reportWith({ NODE_ENV: "development" });

    expect(report.checks.map(check => check.name).sort()).toEqual([
      "database",
      "replicate",
      "storage",
    ]);
  });

  it("treats absent config as skipped outside production", async () => {
    const report = await reportWith({ NODE_ENV: "development" });

    expect(report.status).toBe("ok");
    expect(report.environment).toBe("development");
    expect(report.checks.every(check => check.status === "skipped")).toBe(true);
  });

  it("treats the same absent config as an error in production", async () => {
    const report = await reportWith({ NODE_ENV: "production" });

    // The point of the endpoint: a production server with no database and no
    // storage must not be able to report itself healthy.
    expect(report.status).toBe("error");
    expect(report.environment).toBe("production");

    const database = report.checks.find(check => check.name === "database");
    expect(database?.status).toBe("error");
    expect(database?.detail).toMatch(/DATABASE_URL/);
  });

  it("names the missing variable for each failing check", async () => {
    const report = await reportWith({ NODE_ENV: "production" });

    const byName = Object.fromEntries(
      report.checks.map(check => [check.name, check.detail ?? ""])
    );
    expect(byName.storage).toMatch(/BUILT_IN_FORGE_API_URL/);
    expect(byName.replicate).toMatch(/REPLICATE_API_TOKEN/);
  });

  it("passes a check whose configuration is present", async () => {
    const report = await reportWith({
      NODE_ENV: "production",
      BUILT_IN_FORGE_API_URL: "https://forge.example.com",
      BUILT_IN_FORGE_API_KEY: "forge_key",
      REPLICATE_API_TOKEN: "r8_token",
    });

    const storage = report.checks.find(check => check.name === "storage");
    const replicate = report.checks.find(check => check.name === "replicate");
    expect(storage?.status).toBe("ok");
    expect(replicate?.status).toBe("ok");

    // Still error overall: the database is the one dependency nothing can
    // substitute for.
    expect(report.status).toBe("error");
  });

  it("carries a timestamp, uptime and a duration per check", async () => {
    const report = await reportWith({ NODE_ENV: "development" });

    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(report.checks.every(check => check.durationMs >= 0)).toBe(true);
  });
});

describe("check failure details", () => {
  it("reports the underlying cause, not just the wrapper message", async () => {
    vi.resetModules();
    for (const key of UNSET) delete process.env[key];
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL =
      "mysql://user:pass@nonexistent-host.invalid:3306/db";

    // Drivers wrap: drizzle says "Failed query" and leaves the reason on
    // `cause`. Reporting only the wrapper tells an operator nothing actionable.
    vi.doMock("../db", () => ({
      pingDatabase: async () => {
        throw new Error("Failed query: select 1", {
          cause: new Error("getaddrinfo ENOTFOUND nonexistent-host.invalid"),
        });
      },
    }));

    const { getHealthReport } = await import("./health");
    const report = await getHealthReport();
    const database = report.checks.find(check => check.name === "database");

    expect(database?.status).toBe("error");
    expect(database?.detail).toContain("Failed query");
    expect(database?.detail).toContain("ENOTFOUND");

    vi.doUnmock("../db");
  });
});
