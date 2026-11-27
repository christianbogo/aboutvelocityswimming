// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TeamData, TeamMeetData } from "@/components/collection/team-data";
import TeamPage from "@/components/collection/TeamPage";

const standards = vi.hoisted(() => ({
  sets: [],
  loading: false,
  error: "",
  retry: vi.fn(),
}));
vi.mock("@/components/collection/use-standards", () => ({
  useStandards: () => standards,
}));
const meets = ["latest", "older", "oldest"].map((id) => ({
  id,
  name: id,
  start: "2026-11-01",
  date: "2026-11-01",
}));
const data: TeamData = {
  asOf: "2026-11-27",
  seasonStart: "2026-09-01",
  seasonSwims: [],
  roster: [
    { id: "member", name: "Taylor Swimmer", group: "Prep", athleteId: null },
  ],
  bests: [],
  meets,
  meet: meets[0],
  before: [],
  swims: [],
};
const fetchMock = vi.fn();
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function openTeam() {
  render(createElement(TeamPage));
  await screen.findByRole("heading", { name: "Rank Counts" });
}
beforeEach(() => {
  standards.error = "";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(respond(data));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("switches rank views and focuses the window without fetching again", async () => {
  await openTeam();
  fireEvent.click(screen.getByRole("button", { name: "Competitive Profile" }));
  expect(screen.getByText("10&U")).toBeTruthy();
  expect(screen.getByText("15&O")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Season Progress" }));
  expect(screen.getByText(/since September 1, 2026/)).toBeTruthy();
  fireEvent(window, new Event("focus"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("keeps the overview and expanded roster mounted during meet loads, and reuses visited meets", async () => {
  await openTeam();
  const group = screen.getByText("Prep").closest("details")!;
  group.open = true;
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise);
  fireEvent.change(screen.getByRole("combobox", { name: "Meet" }), {
    target: { value: "older" },
  });
  expect(screen.getByText("Loading meet breakdown…")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Rank Counts" })).toBeTruthy();
  expect(group.open).toBe(true);
  expect(fetchMock.mock.calls[1][0]).toContain("scope=meet&meet=older");
  await act(async () =>
    pending.resolve(respond({ meet: meets[1], before: [], swims: [] })),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Meet" }), {
    target: { value: "latest" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Meet" }), {
    target: { value: "older" },
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Prep").closest("details")).toBe(group);
});

it("ignores late responses when the meet selection changes quickly", async () => {
  await openTeam();
  const pending = deferred();
  fetchMock
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(respond({ meet: meets[2], before: [], swims: [] }));
  const select = screen.getByRole("combobox", { name: "Meet" });
  fireEvent.change(select, { target: { value: "older" } });
  fireEvent.change(select, { target: { value: "oldest" } });
  await waitFor(() =>
    expect(screen.queryByText("Loading meet breakdown…")).toBeNull(),
  );
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () =>
    pending.resolve(respond({ meet: null, before: [], swims: [] })),
  );
  expect((select as HTMLSelectElement).value).toBe("oldest");
  expect(screen.getByRole("heading", { name: "Ranks added" })).toBeTruthy();
});

it("isolates meet failures and retries without replacing the overview", async () => {
  await openTeam();
  fetchMock.mockResolvedValueOnce(respond({ error: "Meet unavailable" }, 503));
  fireEvent.change(screen.getByRole("combobox", { name: "Meet" }), {
    target: { value: "older" },
  });
  await screen.findByRole("button", { name: "Retry meet" });
  expect(screen.getByRole("heading", { name: "Rank Counts" })).toBeTruthy();
  fetchMock.mockResolvedValueOnce(
    respond({ meet: meets[1], before: [], swims: [] } satisfies TeamMeetData),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry meet" }));
  await waitFor(() =>
    expect(screen.queryByText("Meet unavailable")).toBeNull(),
  );
  expect(screen.getByRole("heading", { name: "Ranks added" })).toBeTruthy();
});

it("preserves data on failed background refresh and invalidates meet cache after a successful refresh", async () => {
  await openTeam();
  const group = screen.getByText("Prep").closest("details")!;
  group.open = true;
  fetchMock.mockResolvedValueOnce(
    respond({ meet: meets[1], before: [], swims: [] }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Meet" }), {
    target: { value: "older" },
  });
  await waitFor(() =>
    expect(screen.queryByText("Loading meet breakdown…")).toBeNull(),
  );
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise);
  fireEvent(window, new Event("ies-times-changed"));
  fireEvent(window, new Event("ies-times-changed"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(group.open).toBe(true);
  await act(async () =>
    pending.resolve(respond({ error: "Refresh unavailable" }, 503)),
  );
  expect(screen.getByRole("heading", { name: "Rank Counts" })).toBeTruthy();
  expect(group.open).toBe(true);
  fetchMock
    .mockResolvedValueOnce(respond(data))
    .mockResolvedValueOnce(respond({ meet: meets[1], before: [], swims: [] }));
  fireEvent.click(
    within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }),
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
  expect(
    (screen.getByRole("combobox", { name: "Meet" }) as HTMLSelectElement).value,
  ).toBe("older");
  expect(screen.getByText("Prep").closest("details")).toBe(group);
});

it("does not present zero ranks when standards failed to load without a cached copy", async () => {
  standards.error = "Standards unavailable";
  render(createElement(TeamPage));
  await screen.findByText("Standards unavailable");
  expect(screen.queryByRole("heading", { name: "Rank Counts" })).toBeNull();
});
