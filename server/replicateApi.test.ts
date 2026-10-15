import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";

/**
 * These tests exercise the module's behaviour under a given configuration.
 *
 * They previously asserted that REPLICATE_API_TOKEN was set in the ambient
 * environment, which tested the machine rather than the code and failed on
 * every checkout that had not exported a token.
 */

const ORIGINAL_ENV = { ...process.env };

/** getReplicateClient memoises its client, so each case needs a fresh module. */
async function freshModule() {
  vi.resetModules();
  return import("./replicateApi");
}

beforeEach(() => {
  delete process.env.REPLICATE_API_TOKEN;
  delete process.env.REPLICATE_WEBHOOK_SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getReplicateClient", () => {
  it("throws a named error when no token is configured", async () => {
    const { getReplicateClient } = await freshModule();

    expect(() => getReplicateClient()).toThrowError(
      /REPLICATE_API_TOKEN environment variable not set/
    );
  });

  it("returns a client when a token is configured", async () => {
    process.env.REPLICATE_API_TOKEN = "r8_test_token";
    const { getReplicateClient } = await freshModule();

    expect(getReplicateClient()).toBeDefined();
  });

  it("reuses the same client across calls", async () => {
    process.env.REPLICATE_API_TOKEN = "r8_test_token";
    const { getReplicateClient } = await freshModule();

    expect(getReplicateClient()).toBe(getReplicateClient());
  });
});

describe("verifyReplicateWebhook", () => {
  const body = '{"id":"pred_123","status":"succeeded"}';
  const secret = "whsec_test";
  const validSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  it("rejects everything when no secret is configured", async () => {
    const { verifyReplicateWebhook } = await freshModule();

    // Fails closed: an unset secret must not turn into blanket acceptance.
    expect(verifyReplicateWebhook(body, validSignature)).toBe(false);
  });

  it("accepts a correct signature", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const { verifyReplicateWebhook } = await freshModule();

    expect(verifyReplicateWebhook(body, validSignature)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const { verifyReplicateWebhook } = await freshModule();
    const forged = crypto
      .createHmac("sha256", "whsec_wrong")
      .update(body)
      .digest("hex");

    expect(verifyReplicateWebhook(body, forged)).toBe(false);
  });

  it("rejects a signature for a different body", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const { verifyReplicateWebhook } = await freshModule();

    expect(verifyReplicateWebhook('{"id":"pred_999"}', validSignature)).toBe(
      false
    );
  });

  it("rejects an empty or short signature without throwing", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const { verifyReplicateWebhook } = await freshModule();

    // A length mismatch makes crypto.timingSafeEqual throw if handed straight
    // to it, which would surface as a 500 rather than a rejected webhook.
    expect(verifyReplicateWebhook(body, "")).toBe(false);
    expect(verifyReplicateWebhook(body, "abc")).toBe(false);
  });
});
