import { describe, it, expect } from "vitest";
import { validateFileSize } from "./outputHandler";

describe("validateFileSize", () => {
  it("accepts a size within the limit", () => {
    expect(validateFileSize(5 * 1024 * 1024, 25)).toBe(true);
  });

  it("accepts a size exactly at the limit", () => {
    expect(validateFileSize(25 * 1024 * 1024, 25)).toBe(true);
  });

  it("rejects a size above the limit", () => {
    expect(validateFileSize(26 * 1024 * 1024, 25)).toBe(false);
  });

  it("rejects an unknown size", () => {
    // getFileSizeFromUrl returns null when it cannot determine the size. It
    // used to return 0, which passed this check as a 0-byte file.
    expect(validateFileSize(null, 25)).toBe(false);
  });
});
