import { describe, expect, it } from "vitest";
import { weekDates } from "./week.ts";

describe("weekDates", () => {
  it("returns Monday to Sunday of the week containing the date", () => {
    expect(weekDates("2026-10-30")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("treats Monday and Sunday as the ends of the same week", () => {
    expect(weekDates("2026-10-26")).toEqual(weekDates("2026-11-01"));
  });

  it("crosses year boundaries", () => {
    expect(weekDates("2027-01-01")[0]).toBe("2026-12-28");
  });

  it("rejects strings that are not calendar dates", () => {
    expect(() => weekDates("2026-02-30")).toThrow(RangeError);
    expect(() => weekDates("30/10/2026")).toThrow(RangeError);
  });
});
