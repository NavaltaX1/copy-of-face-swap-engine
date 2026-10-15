import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createServer, type Server } from "node:http";

/**
 * These run against a real HTTP server with the real signature verification, so
 * the raw-body handling is actually exercised: the route is mounted before any
 * JSON parser precisely because a re-stringified body would not match the
 * signature, and nothing but an end-to-end request proves that holds.
 *
 * Only the database and the completion path are mocked.
 */

const ORIGINAL_ENV = { ...process.env };
const keyB64 = Buffer.from("webhook-test-key").toString("base64");
const SECRET = `whsec_${keyB64}`;
const WEBHOOK_ID = "msg_test";

const job = {
  id: 7,
  userId: 42,
  status: "processing" as const,
  akoolJobId: "pred_abc",
};

let server: Server | undefined;
let baseUrl = "";
let finalizeCalls: Array<{ fn: string; jobId: number; arg: string }> = [];
let knownJob: typeof job | undefined;

async function startApp() {
  vi.resetModules();
  finalizeCalls = [];

  vi.doMock("./db", () => ({
    getFaceSwapJobByPredictionId: async (predictionId: string) =>
      knownJob && knownJob.akoolJobId === predictionId ? knownJob : undefined,
  }));

  vi.doMock("./jobCompletion", () => ({
    finalizeSucceededJob: async (j: typeof job, url: string) => {
      finalizeCalls.push({ fn: "succeeded", jobId: j.id, arg: url });
      return { kind: "completed", outputUrl: "/manus-storage/out.mp4" };
    },
    finalizeFailedJob: async (j: typeof job, message: string) => {
      finalizeCalls.push({ fn: "failed", jobId: j.id, arg: message });
      return { kind: "failed", message };
    },
  }));

  const { registerWebhookRoutes } = await import("./webhookRouter");

  const app = express();
  registerWebhookRoutes(app);
  // Stand-in for the app's terminal error handler.
  app.use(
    (_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: { message: "Internal server error" } });
    }
  );

  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function sign(body: string, timestamp: string, id = WEBHOOK_ID, key = keyB64) {
  const signed = `${id}.${timestamp}.${body}`;
  return `v1,${crypto.createHmac("sha256", Buffer.from(key, "base64")).update(signed).digest("base64")}`;
}

/** POST a correctly signed payload unless told to break something. */
async function post(
  payload: unknown,
  opts: { sign?: boolean; timestamp?: string; rawBody?: string } = {}
) {
  const body = opts.rawBody ?? JSON.stringify(payload);
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString();

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.sign !== false) {
    headers["webhook-id"] = WEBHOOK_ID;
    headers["webhook-timestamp"] = timestamp;
    headers["webhook-signature"] = sign(body, timestamp);
  }

  const response = await fetch(`${baseUrl}/api/webhooks/replicate`, {
    method: "POST",
    headers,
    body,
  });

  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

beforeEach(async () => {
  process.env.REPLICATE_WEBHOOK_SECRET = SECRET;
  knownJob = job;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await startApp();
});

afterEach(async () => {
  if (server)
    await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.doUnmock("./db");
  vi.doUnmock("./jobCompletion");
});

describe("POST /api/webhooks/replicate", () => {
  it("completes a job on a signed succeeded callback", async () => {
    const result = await post({
      id: "pred_abc",
      status: "succeeded",
      output: "https://replicate.delivery/out.mp4",
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ kind: "completed" });
    expect(finalizeCalls).toEqual([
      { fn: "succeeded", jobId: 7, arg: "https://replicate.delivery/out.mp4" },
    ]);
  });

  it("takes the first entry when output is a list", async () => {
    await post({
      id: "pred_abc",
      status: "succeeded",
      output: [
        "https://replicate.delivery/first.mp4",
        "https://replicate.delivery/second.mp4",
      ],
    });

    expect(finalizeCalls[0]?.arg).toBe("https://replicate.delivery/first.mp4");
  });

  it("fails the job when upstream reports success with no output", async () => {
    // Leaving it in processing would strand the job forever.
    const result = await post({
      id: "pred_abc",
      status: "succeeded",
      output: null,
    });

    expect(result.status).toBe(200);
    expect(finalizeCalls).toEqual([
      {
        fn: "failed",
        jobId: 7,
        arg: "Upstream reported success but sent no output",
      },
    ]);
  });

  it("fails the job on a failed callback, carrying the upstream message", async () => {
    await post({
      id: "pred_abc",
      status: "failed",
      error: "CUDA out of memory",
    });

    expect(finalizeCalls).toEqual([
      { fn: "failed", jobId: 7, arg: "CUDA out of memory" },
    ]);
  });

  it("supplies a message when a failed callback carries none", async () => {
    await post({ id: "pred_abc", status: "failed" });

    expect(finalizeCalls[0]?.arg).toBe("Face swap processing failed");
  });

  it("fails the job on a canceled callback", async () => {
    await post({ id: "pred_abc", status: "canceled" });

    expect(finalizeCalls[0]?.arg).toBe("Face swap prediction was canceled");
  });

  it("acknowledges a non-terminal status without touching the job", async () => {
    const result = await post({ id: "pred_abc", status: "processing" });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "ignored" });
    expect(finalizeCalls).toEqual([]);
  });

  it("rejects an unsigned request", async () => {
    const result = await post(
      { id: "pred_abc", status: "succeeded", output: "x" },
      { sign: false }
    );

    expect(result.status).toBe(401);
    expect(finalizeCalls).toEqual([]);
  });

  it("rejects a body altered after signing", async () => {
    // The signature is computed over the original bytes; the route must verify
    // against those same bytes rather than anything it re-serialised.
    const signedBody = JSON.stringify({ id: "pred_abc", status: "failed" });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await fetch(`${baseUrl}/api/webhooks/replicate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": WEBHOOK_ID,
        "webhook-timestamp": timestamp,
        "webhook-signature": sign(signedBody, timestamp),
      },
      body: JSON.stringify({
        id: "pred_abc",
        status: "succeeded",
        output: "evil",
      }),
    });

    expect(response.status).toBe(401);
    expect(finalizeCalls).toEqual([]);
  });

  it("rejects a replayed callback outside the timestamp window", async () => {
    const stale = (Math.floor(Date.now() / 1000) - 10 * 60).toString();
    const result = await post(
      { id: "pred_abc", status: "succeeded", output: "x" },
      { timestamp: stale }
    );

    expect(result.status).toBe(401);
  });

  it("rejects everything when no secret is configured", async () => {
    delete process.env.REPLICATE_WEBHOOK_SECRET;
    await startApp();

    const result = await post({
      id: "pred_abc",
      status: "succeeded",
      output: "x",
    });

    expect(result.status).toBe(401);
    expect(finalizeCalls).toEqual([]);
  });

  it("answers 200 for an unknown prediction so the sender stops retrying", async () => {
    knownJob = undefined;

    const result = await post({
      id: "pred_nope",
      status: "succeeded",
      output: "x",
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "ignored",
      reason: "unknown prediction",
    });
  });

  it("rejects a signed body that is not JSON", async () => {
    const result = await post(null, { rawBody: "not json at all" });

    expect(result.status).toBe(400);
  });

  it("rejects a signed payload missing the prediction id", async () => {
    const result = await post({ status: "succeeded", output: "x" });

    expect(result.status).toBe(400);
    expect(finalizeCalls).toEqual([]);
  });

  it("rejects an empty body", async () => {
    const result = await post(null, { rawBody: "" });

    expect(result.status).toBe(400);
  });

  it("answers 500 when the completion path throws, so the sender retries", async () => {
    vi.resetModules();
    vi.doMock("./db", () => ({
      getFaceSwapJobByPredictionId: async () => job,
    }));
    vi.doMock("./jobCompletion", () => ({
      finalizeSucceededJob: async () => {
        throw new Error("database is down");
      },
      finalizeFailedJob: async () => ({ kind: "failed", message: "" }),
    }));
    const { registerWebhookRoutes } = await import("./webhookRouter");
    if (server)
      await new Promise<void>(resolve => server!.close(() => resolve()));

    const app = express();
    registerWebhookRoutes(app);
    app.use(
      (_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: { message: "Internal server error" } });
      }
    );
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await post({
      id: "pred_abc",
      status: "succeeded",
      output: "x",
    });

    // A fault on our side is the one case worth having Replicate retry.
    expect(result.status).toBe(500);
  });
});
