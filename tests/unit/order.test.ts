import { describe, expect, it } from "vitest";
import { compareNames, compareText } from "../../lib/chat/order";

describe("on-screen ordering is the same for every viewer", () => {
  it("orders names with one fixed locale, so a Swedish-style collation can never reorder them after hydration", () => {
    // sv-SE collation puts Å, Ä, Ö after Z; the pinned order keeps them with their base letters.
    const names = ["ZZ", "Ångström", "alpha", "Zeta 2", "Alpha", "Éclair", "ünder"];
    expect([...names].sort(compareNames)).toEqual(["alpha", "Alpha", "Ångström", "Éclair", "ünder", "Zeta 2", "ZZ"]);
    expect([...names].sort(compareNames)).toEqual([...names].sort((left, right) => new Intl.Collator("en").compare(left, right)));
    expect(compareNames("Ångström", "ZZ")).toBeLessThan(0);
    expect(compareNames("a", "a")).toBe(0);
  });

  it("orders ISO timestamps and ids by code unit, with no locale involved", () => {
    expect(compareText("2026-10-04T00:00:00.000Z", "2026-10-03T23:59:59.999Z")).toBe(1);
    expect(compareText("a", "b")).toBe(-1);
    expect(compareText("same", "same")).toBe(0);
    const ids = ["00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000002"];
    expect([...ids].sort(compareText)).toEqual([ids[1], ids[0]]);
  });
});
