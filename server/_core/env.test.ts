import { describe, it, expect, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function validateWith(env: Record<string, string>) {
  vi.resetModules();
  delete process.env.JWT_SECRET;
  delete process.env.DATABASE_URL;
  Object.assign(process.env, env);
  const module = await import("./env");
  return { ...module, run: () => module.validateEnv() };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("validateEnv", () => {
  it("throws in production when a required secret is missing", async () => {
    const { run, EnvValidationError } = await validateWith({
      NODE_ENV: "production",
    });

    expect(run).toThrowError(EnvValidationError);
  });

  it("names every missing variable rather than only the first", async () => {
    const { run } = await validateWith({ NODE_ENV: "production" });

    expect(run).toThrowError(/JWT_SECRET/);
    expect(run).toThrowError(/DATABASE_URL/);
  });

  it("passes in production once the required variables are set", async () => {
    const { run } = await validateWith({
      NODE_ENV: "production",
      JWT_SECRET: "secret",
      DATABASE_URL: "mysql://user:pass@db:3306/app",
    });

    expect(run).not.toThrow();
  });

  it("warns instead of throwing outside production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { run } = await validateWith({ NODE_ENV: "development" });

    expect(run).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
