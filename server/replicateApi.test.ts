import { describe, it, expect } from "vitest";
import { getReplicateClient } from "./replicateApi";

describe("Replicate API Integration", () => {
  it("should initialize Replicate client with valid API token", async () => {
    // This test validates that the REPLICATE_API_TOKEN is set correctly
    // by attempting to create a client instance
    try {
      const client = getReplicateClient();
      expect(client).toBeDefined();
      expect(client).not.toBeNull();
    } catch (error) {
      expect.fail(`Failed to initialize Replicate client: ${(error as Error).message}`);
    }
  });

  it("should have REPLICATE_API_TOKEN environment variable set", () => {
    // This test validates that the token is properly configured
    expect(process.env.REPLICATE_API_TOKEN).toBeDefined();
    expect(process.env.REPLICATE_API_TOKEN).not.toBe("");
  });
});
