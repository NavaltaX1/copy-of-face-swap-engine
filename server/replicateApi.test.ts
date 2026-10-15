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
  const keyB64 = Buffer.from("super-secret-key-material").toString("base64");
  const secret = `whsec_${keyB64}`;
  const webhookId = "msg_2kJx9";

  function nowSeconds() {
    return Math.floor(Date.now() / 1000).toString();
  }

  /** Sign exactly the way the Standard Webhooks format specifies. */
  function sign(opts: {
    key?: string;
    id?: string;
    timestamp: string;
    body?: string;
  }) {
    const key = Buffer.from(opts.key ?? keyB64, "base64");
    const signed = `${opts.id ?? webhookId}.${opts.timestamp}.${opts.body ?? body}`;
    return `v1,${crypto.createHmac("sha256", key).update(signed).digest("base64")}`;
  }

  async function verify(
    headers: Partial<{ id: string; timestamp: string; signature: string }>,
    rawBody = body
  ) {
    const { verifyReplicateWebhook } = await freshModule();
    return verifyReplicateWebhook(
      {
        id: headers.id,
        timestamp: headers.timestamp,
        signature: headers.signature,
      },
      rawBody
    );
  }

  it("rejects everything when no secret is configured", async () => {
    const timestamp = nowSeconds();
    // Fails closed: an unset secret must not become blanket acceptance.
    const result = await verify({
      id: webhookId,
      timestamp,
      signature: sign({ timestamp }),
    });

    expect(result.valid).toBe(false);
    expect(result).toHaveProperty(
      "reason",
      expect.stringContaining("REPLICATE_WEBHOOK_SECRET")
    );
  });

  it("accepts a correctly signed callback", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const timestamp = nowSeconds();

    expect(
      await verify({ id: webhookId, timestamp, signature: sign({ timestamp }) })
    ).toEqual({
      valid: true,
    });
  });

  it("accepts a secret given without the whsec_ prefix", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = keyB64;
    const timestamp = nowSeconds();

    expect(
      await verify({ id: webhookId, timestamp, signature: sign({ timestamp }) })
    ).toEqual({
      valid: true,
    });
  });

  it("accepts when any one of several signatures matches, for key rotation", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const timestamp = nowSeconds();
    const stale = sign({
      key: Buffer.from("old-key").toString("base64"),
      timestamp,
    });
    const current = sign({ timestamp });

    expect(
      await verify({
        id: webhookId,
        timestamp,
        signature: `${stale} ${current}`,
      })
    ).toEqual({ valid: true });
  });

  it("rejects a signature made with the wrong key", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const timestamp = nowSeconds();
    const forged = sign({
      key: Buffer.from("wrong-key").toString("base64"),
      timestamp,
    });

    expect(
      await verify({ id: webhookId, timestamp, signature: forged })
    ).toEqual({
      valid: false,
      reason: "no signature matched",
    });
  });

  it("rejects a tampered body", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const timestamp = nowSeconds();
    const signature = sign({ timestamp });

    const result = await verify(
      { id: webhookId, timestamp, signature },
      '{"id":"pred_123","status":"failed"}'
    );

    expect(result.valid).toBe(false);
  });

  it("rejects a signature bound to a different webhook id", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const timestamp = nowSeconds();
    // Signing over id and timestamp, not the body alone, is what stops a
    // captured request being replayed under a new id.
    const signature = sign({ id: "msg_other", timestamp });

    expect(await verify({ id: webhookId, timestamp, signature })).toEqual({
      valid: false,
      reason: "no signature matched",
    });
  });

  it("rejects a timestamp outside the replay window", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const stale = (Math.floor(Date.now() / 1000) - 10 * 60).toString();

    const result = await verify({
      id: webhookId,
      timestamp: stale,
      signature: sign({ timestamp: stale }),
    });

    expect(result.valid).toBe(false);
    expect(result).toHaveProperty(
      "reason",
      expect.stringContaining("tolerance")
    );
  });

  it("rejects a non-numeric timestamp", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;

    expect(
      await verify({
        id: webhookId,
        timestamp: "not-a-time",
        signature: "v1,AAAA",
      })
    ).toEqual({ valid: false, reason: "webhook-timestamp is not a number" });
  });

  it("names whichever header is missing", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const timestamp = nowSeconds();
    const signature = sign({ timestamp });

    expect(await verify({ timestamp, signature })).toHaveProperty(
      "reason",
      "missing webhook-id header"
    );
    expect(await verify({ id: webhookId, signature })).toHaveProperty(
      "reason",
      "missing webhook-timestamp header"
    );
    expect(await verify({ id: webhookId, timestamp })).toHaveProperty(
      "reason",
      "missing webhook-signature header"
    );
  });

  it("rejects a header with no v1 entry", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const timestamp = nowSeconds();

    expect(
      await verify({ id: webhookId, timestamp, signature: "v2,abc" })
    ).toEqual({
      valid: false,
      reason: "no v1 signature in webhook-signature header",
    });
  });

  it("rejects a short or empty signature without throwing", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = secret;
    const timestamp = nowSeconds();

    // A length mismatch makes crypto.timingSafeEqual throw if handed straight
    // to it, which would surface as a 500 rather than a rejected webhook.
    expect(
      (await verify({ id: webhookId, timestamp, signature: "v1," })).valid
    ).toBe(false);
    expect(
      (await verify({ id: webhookId, timestamp, signature: "v1,abc" })).valid
    ).toBe(false);
  });

  it("rejects a secret that is not usable base64", async () => {
    process.env.REPLICATE_WEBHOOK_SECRET = "whsec_!!!!";
    const timestamp = nowSeconds();

    expect(
      await verify({ id: webhookId, timestamp, signature: "v1,AAAA" })
    ).toEqual({
      valid: false,
      reason: "REPLICATE_WEBHOOK_SECRET is not valid base64",
    });
  });
});
