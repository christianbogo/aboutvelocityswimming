import { timesViewPaths, type TimesView } from "@/lib/tool-directory";
import { initialFilters, type Filters } from "./times-data";

// Decode only the shape represented by the defaults; malformed shared links
// must not put null arrays or objects into filter controls.
function matchesShape(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(fallback))
    return (
      Array.isArray(value) && value.every((item) => typeof item === "string")
    );
  if (typeof fallback === "object" && fallback !== null)
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.entries(fallback).every(([key, sample]) =>
        matchesShape(
          (value as Record<string, unknown>)[key] ??
            (isOptionalDate(key, sample) && !(key in value) ? "" : undefined),
          sample,
        ),
      )
    );
  if (typeof fallback === "number")
    return (
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    );
  return typeof value === typeof fallback;
}

// Older bookmarks predate season ranges. Only these new fields may be absent;
// malformed or missing existing filter fields still reject the shared state.
function isOptionalDate(key: string, sample: unknown) {
  return (key === "startDate" || key === "endDate") && sample === "";
}

function knownSelection<T>(value: T, fallback: T): T {
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return Object.fromEntries(
      Object.entries(fallback).map(([key, sample]) => [
        key,
        knownSelection(
          (value as Record<string, unknown>)[key] ??
            (isOptionalDate(key, sample) ? "" : undefined),
          sample,
        ),
      ]),
    ) as T;
  }
  return value;
}

function removeTeamSelections(params: URLSearchParams) {
  for (const key of ["team", "recordTeam", "meetTeam"]) params.delete(key);
  for (const key of ["filters"]) {
    const raw = params.get(key);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "team" in value
      ) {
        delete value.team;
        params.set(key, JSON.stringify(value));
      }
    } catch {
      // The selection reader handles malformed shared links.
    }
  }
}

export function readTimesSelection<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    const value: unknown = typeof fallback === "string" ? raw : JSON.parse(raw);
    return matchesShape(value, fallback)
      ? knownSelection(value as T, fallback)
      : fallback;
  } catch {
    return fallback;
  }
}

export function writeTimesSelection<T>(
  url: URL,
  key: string,
  value: T,
  fallback: T,
) {
  value = knownSelection(value, fallback);
  if (JSON.stringify(value) === JSON.stringify(fallback))
    url.searchParams.delete(key);
  else
    url.searchParams.set(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  removeTeamSelections(url.searchParams);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function timesViewHref(view: TimesView, search = "", hash = "") {
  const params = new URLSearchParams(search);
  removeTeamSelections(params);
  for (const key of [
    "view",
    "search",
    "page",
    "filters",
    "fromMyTimes",
    "eventFilters",
  ]) {
    params.delete(key);
  }
  if (view !== "rankings") {
    params.set(
      "filters",
      JSON.stringify({ ...initialFilters, course: "", event: "", genders: [] }),
    );
  }
  const query = params.toString();
  return `${timesViewPaths[view]}${query ? `?${query}` : ""}${hash}`;
}

export function athleteTimesHref(athleteId: string, course = "SCY") {
  const params = new URLSearchParams({
    myAthlete: athleteId,
    myFilters: JSON.stringify({
      course,
      mode: "all",
      age: "",
      startYear: "",
      endYear: "",
    }),
  });
  return `${timesViewPaths["my-times"]}?${params}`;
}

export function rankingsHref(filters: Filters, search = "") {
  const url = new URL(
    timesViewHref("rankings", search, "#times-rankings"),
    "https://local.invalid",
  );
  return writeTimesSelection(
    url,
    "filters",
    normalizeRankingFilters(filters),
    initialFilters,
  );
}

/** Older shared links and bookmarks may contain several or no genders. */
export function normalizeRankingFilters(filters: Filters): Filters {
  const gender =
    filters.genders.find((value) => value === "F" || value === "M") || "F";
  return filters.genders.length === 1 && filters.genders[0] === gender
    ? filters
    : { ...filters, genders: [gender] };
}
