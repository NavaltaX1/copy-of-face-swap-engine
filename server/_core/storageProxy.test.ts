import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";

/**
 * This route served any path to anyone. These cover the two halves of the fix:
 * a session is required at all, and the key must belong to the caller.
 */

let server: Server | undefined;
let baseUrl = "";
let currentUser: { id: number; role: string } | null = null;
let presignCalls: string[] = [];

async function startApp() {
  vi.resetModules();
  presignCalls = [];

  vi.doMock("./sdk", () => ({
    sdk: {
      authenticateRequest: async () => {
        if (!currentUser) throw new Error("Invalid session cookie");
        return currentUser;
      },
    },
  }));

  vi.doMock("./env", () => ({
    ENV: { forgeApiUrl: "https://forge.test", forgeApiKey: "key" },
  }));

  // Stand in for the storage backend's presign endpoint only. Everything else
  // - including the test's own requests to this server - goes to real fetch.
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input instanceof Request ? input.url : input);
      if (!target.startsWith("https://forge.test")) {
        return realFetch(input as RequestInfo | URL, init);
      }
      presignCalls.push(new URL(target).searchParams.get("path") ?? "");
      return {
        ok: true,
        json: async () => ({ url: "https://s3.test/signed-object" }),
        text: async () => "",
      } as unknown as Response;
    }
  );

  const { registerStorageProxy } = await import("./storageProxy");
  const app = express();
  registerStorageProxy(app);

  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function get(key: string) {
  const response = await fetch(`${baseUrl}/manus-storage/${key}`, {
    redirect: "manual",
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
  };
}

beforeEach(async () => {
  currentUser = { id: 7, role: "user" };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await startApp();
});

afterEach(async () => {
  if (server)
    await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("./sdk");
  vi.doUnmock("./env");
});

describe("GET /manus-storage/*", () => {
  it("redirects a user to their own output", async () => {
    const result = await get(
      "outputs/face-swaps/7/job-11-1792084256240_6ec5a8f9.mp4"
    );

    expect(result.status).toBe(307);
    expect(result.location).toBe("https://s3.test/signed-object");
    expect(presignCalls).toEqual([
      "outputs/face-swaps/7/job-11-1792084256240_6ec5a8f9.mp4",
    ]);
  });

  it("redirects a user to their own upload", async () => {
    expect(
      (await get("uploads/source-images/7/1792084256240_ab12cd34.jpg")).status
    ).toBe(307);
  });

  it("refuses an unauthenticated request", async () => {
    currentUser = null;
    await startApp();

    const result = await get(
      "outputs/face-swaps/7/job-11-1792084256240_6ec5a8f9.mp4"
    );

    expect(result.status).toBe(401);
    // Nothing was signed: the backend is never asked on behalf of a stranger.
    expect(presignCalls).toEqual([]);
  });

  it("refuses another user's output", async () => {
    // The whole path is predictable apart from an 8-character suffix, so this
    // is the case that mattered: user 7 asking for user 8's render.
    const result = await get(
      "outputs/face-swaps/8/job-11-1792084256240_6ec5a8f9.mp4"
    );

    expect(result.status).toBe(404);
    expect(presignCalls).toEqual([]);
  });

  it("refuses another user's upload", async () => {
    expect(
      (await get("uploads/source-images/8/1792084256240_ab12cd34.jpg")).status
    ).toBe(404);
    expect(presignCalls).toEqual([]);
  });

  it("lets an admin through", async () => {
    currentUser = { id: 1, role: "admin" };
    await startApp();

    expect(
      (await get("outputs/face-swaps/8/job-11-1792084256240_6ec5a8f9.mp4"))
        .status
    ).toBe(307);
  });

  it("refuses a key shape this app never writes", async () => {
    // The backend signs whatever it is handed, so an unrecognised key is a
    // request to sign something we did not create.
    expect((await get("secrets/credentials.json")).status).toBe(404);
    expect((await get("outputs/face-swaps/7/nested/deeper.mp4")).status).toBe(
      404
    );
    expect(presignCalls).toEqual([]);
  });

  it("refuses traversal, encoded or not", async () => {
    expect((await get("outputs/face-swaps/7/..")).status).toBe(404);
    expect((await get("outputs/face-swaps/7/%2e%2e")).status).toBe(404);
    expect(presignCalls).toEqual([]);
  });

  it("refuses a non-numeric or zero owner segment", async () => {
    expect((await get("outputs/face-swaps/abc/x.mp4")).status).toBe(404);
    expect((await get("outputs/face-swaps/0/x.mp4")).status).toBe(404);
  });

  it("never caches the redirect", async () => {
    const response = await fetch(
      `${baseUrl}/manus-storage/outputs/face-swaps/7/job-11-1792084256240_6ec5a8f9.mp4`,
      { redirect: "manual" }
    );

    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
