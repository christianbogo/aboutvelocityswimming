import { describe, expect, it } from "vitest";
import {
  buildLayout,
  defaultDimensions,
  type AthletePlan,
  type DraftDie,
  type DraftLayout,
} from "@/components/layout-drafting/geometry";

function die(id: string, values: Partial<DraftDie> = {}): DraftDie {
  return {
    id,
    tier: "A",
    event: "100_FR",
    course: "SCY",
    ageGroup: "11-12",
    ...values,
  };
}

function athlete(count: number, id = "athlete"): AthletePlan {
  return {
    id,
    name: `Swimmer ${id}`,
    dice: Array.from({ length: count }, (_, index) => die(`${id}:${index}`)),
  };
}

function expectContained(layout: DraftLayout) {
  for (const rect of [...layout.dice, ...layout.frames]) {
    expect(rect.x).toBeGreaterThanOrEqual(layout.extent.x);
    expect(rect.y).toBeGreaterThanOrEqual(layout.extent.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(
      layout.extent.width + 0.000001,
    );
    expect(rect.y + rect.height).toBeLessThanOrEqual(
      layout.extent.height + 0.000001,
    );
  }
}

describe("physical layout drafting geometry", () => {
  it("keeps the dice at their measured size and includes the hanging gap in drop", () => {
    const layout = buildLayout([athlete(3)], "strings");
    expect(layout.dice).toHaveLength(3);
    expect(
      layout.dice.every((item) => item.width === 16 && item.height === 16),
    ).toBe(true);
    expect(layout.dice[0].y).toBe(defaultDimensions.boardHeightMm + 12);
    expect(layout.dice[1].y - layout.dice[0].y).toBe(18);
    expect(layout.metrics.longestDropMm).toBe(12 + 16 * 3 + 2 * 2);
    expect(layout.extent.height).toBe(
      layout.board.height + layout.metrics.longestDropMm,
    );
    expectContained(layout);
  });

  it("allocates complete ten-slot modules and links the eleventh die below the first module", () => {
    const layout = buildLayout(
      [athlete(10, "ten"), athlete(11, "eleven"), athlete(0, "zero")],
      "sleeves",
    );
    const eleven = layout.athletes.find((item) => item.id === "eleven")!;
    const modules = layout.frames.filter(
      (frame) => frame.athleteId === "eleven" && frame.kind === "sleeve",
    );
    expect(layout.metrics.sleeveCount).toBe(3);
    expect(eleven.sleeves).toBe(2);
    expect(modules).toHaveLength(2);
    expect(layout.frames.filter((frame) => frame.kind === "slot")).toHaveLength(
      30,
    );
    expect(layout.dice).toHaveLength(21);
    expect(modules[0].width).toBe(24);
    expect(modules[0].height).toBe(222);
    expect(modules[1].y - modules[0].y).toBe(226);
    const lastDie = layout.dice.find((item) => item.id === "eleven:10")!;
    expect(lastDie.y).toBe(modules[1].y + 4);
    expect(eleven.drop).toBe(12 + 222 * 2 + 4);
    expect(layout.frames.some((frame) => frame.athleteId === "zero")).toBe(
      false,
    );
    expect(layout.names).toHaveLength(3);
    expectContained(layout);
  });

  it("shows board overflow without scaling dice or overlapping neighboring holders", () => {
    const plans = Array.from({ length: 20 }, (_, index) =>
      athlete(5, String(index)),
    );
    const layout = buildLayout(plans, "sleeves", {
      boardWidthMm: 300,
      marginMm: 10,
    });
    expect(layout.metrics.overflowMm).toBeGreaterThan(0);
    expect(layout.extent.width).toBe(layout.metrics.requiredBoardWidthMm);
    expect(layout.board.width).toBe(300);
    expect(layout.dice.every((item) => item.width === 16)).toBe(true);
    expect(layout.names[1].x - layout.names[0].x).toBeCloseTo(
      layout.metrics.pitchMm,
    );
    expect(layout.metrics.pitchMm).toBeGreaterThanOrEqual(24 + 8);
    expectContained(layout);
  });

  it("reserves enough physical pitch for the full tiny name", () => {
    const name = "An exceptionally long swimmer name";
    const layout = buildLayout(
      [{ id: "one", name, dice: [] }, athlete(1, "two")],
      "strings",
      { boardWidthMm: 100 },
    );
    expect(layout.names[0].text).toBe(name);
    expect(layout.names[0].width).toBeCloseTo(name.length * 2.5 * 0.62);
    expect(layout.metrics.pitchMm).toBeGreaterThanOrEqual(
      layout.names[0].width + 8,
    );
    expect(layout.names[0].y).toBeCloseTo(layout.board.height - 12.7);
  });

  it("uses My Times stroke order and preserves every event/course/age achievement in trays", () => {
    const plan: AthletePlan = {
      id: "swimmer",
      name: "Swimmer",
      dice: [
        die("im", { event: "200_IM" }),
        die("fly", { event: "100_FL" }),
        die("back", { event: "100_BK" }),
        die("breast", { event: "100_BR" }),
        die("free-young", { event: "100_FR", ageGroup: "10&U" }),
        die("free-older", { event: "100_FR", ageGroup: "11-12" }),
        die("free-lcm", { event: "100_FR", course: "LCM" }),
        die("distance", { event: "500_FR" }),
      ],
    };
    const layout = buildLayout([plan], "trays");
    expect(layout.dice.map((item) => item.id).sort()).toEqual(
      plan.dice.map((item) => item.id).sort(),
    );
    const x = (id: string) => layout.dice.find((item) => item.id === id)!.x;
    expect([
      x("im"),
      x("fly"),
      x("back"),
      x("breast"),
      x("free-young"),
      x("distance"),
    ]).toEqual(
      [
        x("im"),
        x("fly"),
        x("back"),
        x("breast"),
        x("free-young"),
        x("distance"),
      ].sort((a, b) => a - b),
    );
    expect(x("free-young")).toBe(x("free-older"));
    expect(x("free-young")).toBe(x("free-lcm"));
    expect(layout.labels.map((item) => item.text)).toEqual(
      expect.arrayContaining([
        "IM",
        "Fly",
        "Back",
        "Breast",
        "Free",
        "Dist",
        "SCY · 10&U",
        "SCY · 11-12",
        "LCM · 11-12",
      ]),
    );
    const freeCell = layout.frames.find(
      (frame) => frame.id === "swimmer:cell:100_FR",
    )!;
    for (const item of layout.dice.filter((item) => item.event === "100_FR")) {
      expect(item.y).toBeGreaterThan(freeCell.y);
      expect(item.y + item.height).toBeLessThan(freeCell.y + freeCell.height);
    }
    expect(layout.frames[0].kind).toBe("tray");
    expectContained(layout);
  });

  it("extends a tray for all cumulative dice instead of covering or dropping awards", () => {
    const short = buildLayout([athlete(1)], "trays");
    const long = buildLayout([athlete(30)], "trays");
    expect(long.metrics.longestDropMm).toBeGreaterThan(
      short.metrics.longestDropMm,
    );
    expect(long.dice).toHaveLength(30);
    const ys = long.dice.map((item) => item.y);
    expect(new Set(ys).size).toBe(30);
    expectContained(long);
  });

  it("keeps zero-dice athletes on the board without pretending they need sleeves or trays", () => {
    for (const kind of ["strings", "sleeves", "trays"] as const) {
      const layout = buildLayout([athlete(0)], kind);
      expect(layout.names).toHaveLength(1);
      expect(layout.dice).toHaveLength(0);
      expect(layout.frames).toHaveLength(0);
      expect(layout.metrics).toMatchObject({
        diceCount: 0,
        sleeveCount: 0,
        longestDropMm: 0,
        emptyAthletes: 1,
      });
      expect(layout.extent.height).toBe(layout.board.height);
    }
  });

  it("handles an empty roster and invalid control values with finite geometry", () => {
    const layout = buildLayout([], "strings", {
      boardWidthMm: NaN,
      dieSizeMm: -16,
      nameFontMm: Infinity,
      gapMm: 0,
    });
    expect(layout.dimensions.boardWidthMm).toBe(defaultDimensions.boardWidthMm);
    expect(layout.dimensions.dieSizeMm).toBe(16);
    expect(layout.dimensions.gapMm).toBe(0);
    expect(layout.extent).toEqual(layout.board);
    expect(layout.metrics).toMatchObject({
      diceCount: 0,
      requiredBoardWidthMm: 0,
      pitchMm: 0,
      overflowMm: 0,
    });
  });
});
