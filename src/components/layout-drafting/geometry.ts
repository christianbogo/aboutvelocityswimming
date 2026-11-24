import {
  compareEvents,
  eventColumn,
  strokeColumns,
} from "@/components/collection/event-layout";

export interface DraftDie {
  id: string;
  tier: string;
  event: string;
  course: string;
  ageGroup: string;
}

export interface AthletePlan {
  id: string;
  name: string;
  dice: DraftDie[];
}

export type LayoutKind = "strings" | "sleeves" | "trays";

/** Every dimension and coordinate in this module is in millimeters. */
export const defaultDimensions = {
  boardWidthMm: 2438.4,
  boardHeightMm: 1219.2,
  dieSizeMm: 16,
  gapMm: 2,
  wallMm: 2,
  marginMm: 25.4,
  nameBandMm: 25.4,
  nameFontMm: 2.5,
  athleteGapMm: 8,
  hangGapMm: 12,
};

export type DraftDimensions = typeof defaultDimensions;

export interface DraftRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedDie extends DraftDie, DraftRect {
  athleteId: string;
}

export interface DraftFrame extends DraftRect {
  id: string;
  athleteId: string;
  kind: "sleeve" | "tray" | "cell" | "slot";
}

export interface DraftLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Render centered text with a middle baseline. Names use a monospace font. */
export interface DraftLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface DraftName extends DraftLabel {
  athleteId: string;
  width: number;
}

export interface DraftLayout {
  kind: LayoutKind;
  dimensions: DraftDimensions;
  board: DraftRect;
  names: DraftName[];
  dice: PlacedDie[];
  frames: DraftFrame[];
  lines: DraftLine[];
  labels: DraftLabel[];
  athletes: {
    id: string;
    name: string;
    diceCount: number;
    sleeves: number;
    width: number;
    drop: number;
    x: number;
  }[];
  extent: DraftRect;
  metrics: {
    diceCount: number;
    sleeveCount: number;
    requiredBoardWidthMm: number;
    pitchMm: number;
    longestDropMm: number;
    overflowMm: number;
    emptyAthletes: number;
  };
}

type Holder = Pick<DraftLayout, "dice" | "frames" | "lines" | "labels"> & {
  width: number;
  height: number;
  sleeves: number;
};

function dimensionsWithDefaults(
  input: Partial<DraftDimensions>,
): DraftDimensions {
  const result = { ...defaultDimensions };
  for (const key of Object.keys(result) as (keyof DraftDimensions)[]) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const positive = [
      "boardWidthMm",
      "boardHeightMm",
      "dieSizeMm",
      "nameFontMm",
      "wallMm",
    ].includes(key);
    if (positive ? value > 0 : value >= 0) result[key] = value;
  }
  result.marginMm = Math.min(result.marginMm, result.boardWidthMm / 2);
  result.nameBandMm = Math.min(result.nameBandMm, result.boardHeightMm);
  return result;
}

function emptyHolder(): Holder {
  return {
    width: 0,
    height: 0,
    sleeves: 0,
    dice: [],
    frames: [],
    lines: [],
    labels: [],
  };
}

function placeDie(
  die: DraftDie,
  athleteId: string,
  x: number,
  y: number,
  size: number,
): PlacedDie {
  return { ...die, athleteId, x, y, width: size, height: size };
}

function stringHolder(plan: AthletePlan, d: DraftDimensions): Holder {
  const holder = emptyHolder();
  if (!plan.dice.length) return holder;
  holder.width = d.dieSizeMm;
  holder.height = plan.dice.length * (d.dieSizeMm + d.gapMm) - d.gapMm;
  holder.lines.push({
    id: `${plan.id}:string`,
    x1: 0,
    x2: 0,
    y1: -d.hangGapMm,
    y2: holder.height,
  });
  holder.dice = plan.dice.map((die, index) =>
    placeDie(
      die,
      plan.id,
      -d.dieSizeMm / 2,
      index * (d.dieSizeMm + d.gapMm),
      d.dieSizeMm,
    ),
  );
  return holder;
}

function sleeveHolder(plan: AthletePlan, d: DraftDimensions): Holder {
  const holder = emptyHolder();
  if (!plan.dice.length) return holder;
  const slotSize = d.dieSizeMm + d.gapMm * 2;
  const sleeveHeight = slotSize * 10 + d.wallMm * 11;
  const connectorHeight = d.gapMm + d.wallMm;
  holder.width = slotSize + d.wallMm * 2;
  holder.sleeves = Math.ceil(plan.dice.length / 10);
  holder.height =
    holder.sleeves * sleeveHeight + (holder.sleeves - 1) * connectorHeight;
  for (let segment = 0; segment < holder.sleeves; segment++) {
    const top = segment * (sleeveHeight + connectorHeight);
    holder.frames.push({
      id: `${plan.id}:sleeve:${segment}`,
      athleteId: plan.id,
      kind: "sleeve",
      x: -holder.width / 2,
      y: top,
      width: holder.width,
      height: sleeveHeight,
    });
    holder.lines.push({
      id: `${plan.id}:link:${segment}`,
      x1: 0,
      x2: 0,
      y1: top - (segment ? connectorHeight : d.hangGapMm),
      y2: top,
    });
    for (let slot = 0; slot < 10; slot++) {
      const slotY = top + d.wallMm + slot * (slotSize + d.wallMm);
      holder.frames.push({
        id: `${plan.id}:slot:${segment}:${slot}`,
        athleteId: plan.id,
        kind: "slot",
        x: -slotSize / 2,
        y: slotY,
        width: slotSize,
        height: slotSize,
      });
      const die = plan.dice[segment * 10 + slot];
      if (die)
        holder.dice.push(
          placeDie(
            die,
            plan.id,
            -d.dieSizeMm / 2,
            slotY + d.gapMm,
            d.dieSizeMm,
          ),
        );
    }
  }
  return holder;
}

function trayEvents(plans: AthletePlan[]) {
  const courses = new Set(
    plans.flatMap((plan) => plan.dice.map((die) => die.course)),
  );
  const events = new Set([
    "200_IM",
    "400_IM",
    ...["FL", "BK", "BR", "FR"].flatMap((stroke) =>
      [50, 100, 200].map((distance) => `${distance}_${stroke}`),
    ),
  ]);
  if (!courses.size || courses.has("SCY") || courses.has("SCM"))
    events.add("100_IM");
  if (!courses.size || courses.has("SCY"))
    [500, 1000, 1650].forEach((distance) => events.add(`${distance}_FR`));
  if (courses.has("LCM") || courses.has("SCM"))
    [400, 800, 1500].forEach((distance) => events.add(`${distance}_FR`));
  plans.forEach((plan) => plan.dice.forEach((die) => events.add(die.event)));
  return strokeColumns.map(([column, heading]) => ({
    column,
    heading,
    events: [...events]
      .filter(
        (event) =>
          eventColumn(event) === column ||
          (column === "DST" &&
            !strokeColumns.some(([known]) => eventColumn(event) === known)),
      )
      .sort(compareEvents),
  }));
}

function trayHolder(
  plan: AthletePlan,
  d: DraftDimensions,
  columns: ReturnType<typeof trayEvents>,
): Holder {
  const holder = emptyHolder();
  if (!plan.dice.length) return holder;
  const slotSize = d.dieSizeMm + d.gapMm * 2;
  const cellWidth = slotSize + 2 * d.wallMm;
  const cellHeader = Math.max(7, d.nameFontMm * 2.5);
  const bucketHeader = Math.max(5, d.nameFontMm * 2);
  const headingHeight = Math.max(8, d.nameFontMm * 3);
  const columnPitch = cellWidth + d.wallMm;
  holder.width = columns.length * columnPitch + d.wallMm;
  const left = -holder.width / 2;
  let tallest = headingHeight;
  for (const [columnIndex, column] of columns.entries()) {
    const cellLeft = left + d.wallMm + columnIndex * columnPitch;
    const center = cellLeft + cellWidth / 2;
    holder.labels.push({
      id: `${plan.id}:column:${column.column}`,
      text: column.heading,
      x: center,
      y: headingHeight / 2,
      fontSize: d.nameFontMm,
    });
    let top = headingHeight;
    for (const event of column.events) {
      const eventDice = plan.dice.filter((die) => die.event === event);
      const buckets = new Map<string, DraftDie[]>();
      for (const die of eventDice) {
        const bucket = `${die.course} · ${die.ageGroup}`;
        buckets.set(bucket, [...(buckets.get(bucket) ?? []), die]);
      }
      let contentY = top + cellHeader;
      holder.labels.push({
        id: `${plan.id}:event:${event}`,
        text: event.split("_")[0],
        x: center,
        y: top + cellHeader / 2,
        fontSize: d.nameFontMm,
      });
      for (const [bucket, dice] of [...buckets.entries()].sort(([a], [b]) =>
        a.localeCompare(b, undefined, { numeric: true }),
      )) {
        holder.labels.push({
          id: `${plan.id}:${event}:${bucket}`,
          text: bucket,
          x: center,
          y: contentY + bucketHeader / 2,
          fontSize: Math.min(d.nameFontMm, 2),
        });
        contentY += bucketHeader;
        for (const die of dice) {
          holder.frames.push({
            id: `${plan.id}:pocket:${die.id}`,
            athleteId: plan.id,
            kind: "slot",
            x: cellLeft + d.wallMm,
            y: contentY,
            width: slotSize,
            height: slotSize,
          });
          holder.dice.push(
            placeDie(
              die,
              plan.id,
              center - d.dieSizeMm / 2,
              contentY + d.gapMm,
              d.dieSizeMm,
            ),
          );
          contentY += slotSize + d.wallMm;
        }
      }
      if (!eventDice.length) contentY += slotSize + d.wallMm;
      const cellHeight = contentY - top + d.wallMm;
      holder.frames.push({
        id: `${plan.id}:cell:${event}`,
        athleteId: plan.id,
        kind: "cell",
        x: cellLeft,
        y: top,
        width: cellWidth,
        height: cellHeight,
      });
      top += cellHeight + d.wallMm;
    }
    tallest = Math.max(tallest, top);
  }
  holder.height = tallest;
  holder.frames.unshift({
    id: `${plan.id}:tray`,
    athleteId: plan.id,
    kind: "tray",
    x: left,
    y: 0,
    width: holder.width,
    height: holder.height,
  });
  holder.frames.sort(
    (a, b) =>
      ({ tray: 0, sleeve: 0, cell: 1, slot: 2 })[a.kind] -
      { tray: 0, sleeve: 0, cell: 1, slot: 2 }[b.kind],
  );
  holder.lines.push({
    id: `${plan.id}:tray-link`,
    x1: 0,
    x2: 0,
    y1: -d.hangGapMm,
    y2: 0,
  });
  return holder;
}

/** Full-size physical geometry. A crowded roster extends beyond the board;
 * dice, holders, and names are never shrunk independently to manufacture a fit. */
export function buildLayout(
  plans: AthletePlan[],
  kind: LayoutKind,
  input: Partial<DraftDimensions> = {},
): DraftLayout {
  const dimensions = dimensionsWithDefaults(input);
  const d = dimensions;
  const columns = kind === "trays" ? trayEvents(plans) : [];
  const holders = plans.map((plan) =>
    kind === "strings"
      ? stringHolder(plan, d)
      : kind === "sleeves"
        ? sleeveHolder(plan, d)
        : trayHolder(plan, d, columns),
  );
  const nameWidths = plans.map(
    (plan) => Array.from(plan.name).length * d.nameFontMm * 0.62,
  );
  const widest = Math.max(
    0,
    ...holders.map((holder, index) =>
      Math.max(holder.width, nameWidths[index]),
    ),
  );
  const minimumPitch = widest + d.athleteGapMm;
  const requiredBoardWidthMm = plans.length
    ? d.marginMm * 2 + plans.length * minimumPitch
    : 0;
  const pitchMm = plans.length
    ? Math.max(minimumPitch, (d.boardWidthMm - d.marginMm * 2) / plans.length)
    : 0;
  const result: DraftLayout = {
    kind,
    dimensions,
    board: { x: 0, y: 0, width: d.boardWidthMm, height: d.boardHeightMm },
    names: [],
    dice: [],
    frames: [],
    lines: [],
    labels: [],
    athletes: [],
    extent: {
      x: 0,
      y: 0,
      width: Math.max(d.boardWidthMm, requiredBoardWidthMm),
      height: d.boardHeightMm,
    },
    metrics: {
      diceCount: 0,
      sleeveCount: 0,
      requiredBoardWidthMm,
      pitchMm,
      longestDropMm: 0,
      overflowMm: Math.max(0, requiredBoardWidthMm - d.boardWidthMm),
      emptyAthletes: 0,
    },
  };
  for (const [index, plan] of plans.entries()) {
    const holder = holders[index];
    const center = d.marginMm + pitchMm * (index + 0.5);
    const top = d.boardHeightMm + d.hangGapMm;
    const drop = holder.height ? holder.height + d.hangGapMm : 0;
    result.names.push({
      id: `${plan.id}:name`,
      athleteId: plan.id,
      text: plan.name,
      x: center,
      y: d.boardHeightMm - d.nameBandMm / 2,
      fontSize: d.nameFontMm,
      width: nameWidths[index],
    });
    result.athletes.push({
      id: plan.id,
      name: plan.name,
      diceCount: plan.dice.length,
      sleeves: holder.sleeves,
      width: holder.width,
      drop,
      x: center,
    });
    result.dice.push(
      ...holder.dice.map((die) => ({
        ...die,
        x: die.x + center,
        y: die.y + top,
      })),
    );
    result.frames.push(
      ...holder.frames.map((frame) => ({
        ...frame,
        x: frame.x + center,
        y: frame.y + top,
      })),
    );
    result.labels.push(
      ...holder.labels.map((label) => ({
        ...label,
        x: label.x + center,
        y: label.y + top,
      })),
    );
    result.lines.push(
      ...holder.lines.map((line) => ({
        ...line,
        x1: line.x1 + center,
        x2: line.x2 + center,
        y1: line.y1 + top,
        y2: line.y2 + top,
      })),
    );
    result.metrics.diceCount += plan.dice.length;
    result.metrics.sleeveCount += holder.sleeves;
    result.metrics.emptyAthletes += Number(plan.dice.length === 0);
    result.metrics.longestDropMm = Math.max(result.metrics.longestDropMm, drop);
  }
  result.extent.height += result.metrics.longestDropMm;
  return result;
}
