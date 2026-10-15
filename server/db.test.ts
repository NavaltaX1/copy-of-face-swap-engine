import { describe, it, expect } from "vitest";
import { writeResultHeader } from "./db";

/**
 * drizzle-orm/mysql2 resolves writes to [ResultSetHeader, FieldPacket[]].
 * Reading `.insertId` off the array itself yields undefined, which is how a
 * submitted job never received its prediction id, and how a sweeper claim
 * reported failure on an UPDATE that had in fact matched a row.
 */
describe("writeResultHeader", () => {
  it("reads the header out of the driver's tuple", () => {
    const insertResult = [{ affectedRows: 1, insertId: 42 }, []];

    expect(writeResultHeader(insertResult)).toEqual({
      affectedRows: 1,
      insertId: 42,
    });
  });

  it("reports a no-match update as zero rows", () => {
    expect(
      writeResultHeader([{ affectedRows: 0, insertId: 0 }, []]).affectedRows
    ).toBe(0);
  });

  it("also accepts a bare header, should the driver stop wrapping it", () => {
    expect(writeResultHeader({ affectedRows: 2, insertId: 0 })).toEqual({
      affectedRows: 2,
      insertId: 0,
    });
  });

  it("throws on the shape the old code assumed, rather than guessing", () => {
    // The exact failure being fixed: the tuple has no top-level insertId, and
    // silently treating that as 0 or undefined is what hid the bug.
    expect(() => writeResultHeader([{ notAHeader: true }, []])).toThrowError(
      /result shape is not what this code expects/
    );
  });

  it("throws on undefined", () => {
    expect(() => writeResultHeader(undefined)).toThrowError(
      /cannot be confirmed/
    );
  });

  it("throws when only one of the two fields is present", () => {
    expect(() => writeResultHeader([{ affectedRows: 1 }, []])).toThrowError();
    expect(() => writeResultHeader([{ insertId: 1 }, []])).toThrowError();
  });
});
