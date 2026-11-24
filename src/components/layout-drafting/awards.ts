import type { DraftingSnapshot } from "@/lib/layout-drafting/types";
import { motivationalRanks } from "@/components/collection/motivational-ranks";
import {
  compareEvents,
  eventColumn,
  strokeColumns,
} from "@/components/collection/event-layout";
import type { AthletePlan, DraftDie } from "./geometry";

export const awardRules = [
  {
    id: "age-best",
    label: "Highest per age group",
    description:
      "One die for the highest standard in each event, course, and age group.",
  },
  {
    id: "age-series",
    label: "Every standard per age group",
    description:
      "Keep every color from B through the highest earned standard in each event, course, and age group.",
  },
  {
    id: "lifetime-best",
    label: "Highest across all ages",
    description:
      "One die for the highest standard ever earned in each event and course.",
  },
] as const;
export type AwardRule = (typeof awardRules)[number]["id"];
export type CourseScope = "all" | "SCY";
const level = (tier: string) =>
  motivationalRanks.findIndex((rank) => rank.tier === tier);

export function planAwards(
  athletes: DraftingSnapshot["athletes"],
  rule: AwardRule,
  course: CourseScope,
): AthletePlan[] {
  return athletes.map((athlete) => {
    const best = new Map<string, (typeof athlete.achievements)[number]>();
    for (const achievement of athlete.achievements) {
      if (course !== "all" && achievement.course !== course) continue;
      if (level(achievement.tier) < 0) continue;
      const key = JSON.stringify([
        achievement.event,
        achievement.course,
        rule === "lifetime-best" ? "all" : achievement.ageGroup,
      ]);
      const previous = best.get(key);
      if (!previous || level(achievement.tier) > level(previous.tier))
        best.set(key, achievement);
    }
    const dice: DraftDie[] = [...best.entries()].flatMap(
      ([key, achievement]) => {
        const ranks =
          rule === "age-series"
            ? motivationalRanks.slice(0, level(achievement.tier) + 1)
            : motivationalRanks.filter(
                (rank) => rank.tier === achievement.tier,
              );
        return ranks.map((rank) => ({
          ...achievement,
          id: `${athlete.id}:${key}:${rank.tier}`,
          tier: rank.tier,
        }));
      },
    );
    dice.sort(
      (a, b) =>
        a.course.localeCompare(b.course) ||
        a.ageGroup.localeCompare(b.ageGroup, undefined, { numeric: true }) ||
        strokeColumns.findIndex(([code]) => code === eventColumn(a.event)) -
          strokeColumns.findIndex(([code]) => code === eventColumn(b.event)) ||
        compareEvents(a.event, b.event) ||
        level(a.tier) - level(b.tier),
    );
    return { id: athlete.id, name: athlete.name, dice };
  });
}

export function countColors(plans: AthletePlan[]) {
  return motivationalRanks.map((rank) => ({
    ...rank,
    count: plans.reduce(
      (total, athlete) =>
        total + athlete.dice.filter((die) => die.tier === rank.tier).length,
      0,
    ),
  }));
}
