import { describe, it, expect } from "vitest";
import { getReplicateClient } from "./replicateApi";

// These tests exercise real credential wiring rather than pure logic, so they
// only run when REPLICATE_API_TOKEN is actually configured in the environment
// (e.g. CI secrets or a local .env). Without it, they skip instead of failing
// every checkout that doesn't have the secret set.
const hasApiToken = Boolean(process.env.REPLICATE_API_TOKEN);
const describeIfToken = hasApiToken ? describe : describe.skip;

describeIfToken("Replicate API Integration", () => {
  it("should initialize Replicate client with valid API token", () => {
    const client = getReplicateClient();
    expect(client).toBeDefined();
    expect(client).not.toBeNull();
  });
});

describe.skipIf(hasApiToken)("Replicate client error handling", () => {
  it("throws a clear error when REPLICATE_API_TOKEN is not set", () => {
    // Only meaningful when no token is configured: getReplicateClient() caches
    // a singleton once successfully created, so this must run before (or
    // instead of) any test that provides a real token.
    expect(() => getReplicateClient()).toThrow(
      "REPLICATE_API_TOKEN environment variable not set"
    );
  });
});
