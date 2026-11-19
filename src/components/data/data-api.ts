import type {
  DataRecord,
  ManagedRecord,
  RecordKind,
} from "@/lib/results/types";
export async function requestData(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to load data.");
  return result;
}
export function label(kind: RecordKind, data: DataRecord): string {
  if (kind === "athlete") {
    const name = data.name as { first?: string; last?: string };
    return `${name?.first ?? ""} ${name?.last ?? ""}`.trim();
  }
  if (kind === "meet" || kind === "standard")
    return String(data.name ?? data.id);
  const name = data.athleteName as { first?: string; last?: string };
  return `${kind === "swim" ? `${name?.first ?? ""} ${name?.last ?? ""}` : (data.relayName ?? "Relay")} · ${data.eventCode}`;
}
export function blankRecord(kind: RecordKind): ManagedRecord {
  const id = `${kind}_${crypto.randomUUID()}`,
    common = { id };
  const data: DataRecord =
    kind === "athlete"
      ? {
          ...common,
          name: { first: "", last: "" },
          gender: "F",
          status: "inactive",
          teamId: "velocity-swimming",
        }
      : kind === "meet"
        ? { ...common, name: "", dates: { startDate: "", endDate: "" } }
        : kind === "standard"
          ? {
              ...common,
              name: "",
              category: "motivational",
              governingBody: "",
              seasonYears: "",
              effectiveDate: "",
              expirationDate: "",
              sourceUrl: "",
              cuts: {},
            }
          : {
              ...common,
              teamId: "velocity-swimming",
              course: "SCY",
              distance: 100,
              stroke: "FR",
              eventCode: kind === "relay" ? "100_FR-R_SCY" : "100_FR_SCY",
              gender: "F",
              round: "F",
              status: "OK",
              timeMs: 0,
              timeDisplay: "",
              isOfficial: true,
              meet: { id: "", name: "", date: "" },
              splits: [],
              splitCoverage: "unavailable",
              ageGroup: "Open",
              ...(kind === "relay"
                ? { relayName: "A", members: [] }
                : { athleteId: "", isRelay: false }),
            };
  return { id, data, version: "new" };
}
