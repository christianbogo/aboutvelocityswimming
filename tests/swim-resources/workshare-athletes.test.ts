// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AthletesPanel } from "@/features/workshare/components/admin/AthletesPanel";
import {
  loadAthleteRoster,
  saveRosterAction,
  type AthleteRoster,
} from "@/features/workshare/lib/athletes";
import { emptyAccount } from "@/features/workshare/lib/accounts";
vi.mock("@/features/workshare/lib/athletes", () => ({
  fixedGroupNames: ["Seniors", "Juniors", "Age Groupers", "Prep", "Other"],
  loadAthleteRoster: vi.fn(),
  saveRosterAction: vi.fn(),
}));
vi.stubGlobal("React", React);
const roster: AthleteRoster = {
  groups: [
    {
      id: "prep",
      name: "Prep",
      coach: "Avery",
      updated_at: "v1",
      sort_order: 1,
    },
    {
      id: "senior",
      name: "Seniors",
      coach: "",
      updated_at: "v2",
      sort_order: 2,
    },
  ],
  accounts: [
    {
      ...emptyAccount(),
      id: "account",
      fullName: "Morgan Family",
      updatedAt: "account-v1",
      athletes: [
        {
          id: "a",
          fullName: "Alex Morgan",
          trainingGroup: "Prep",
          timesAthleteId: null,
          isArchived: false,
        },
        {
          id: "b",
          fullName: "Blake Morgan",
          trainingGroup: "",
          timesAthleteId: null,
          isArchived: true,
        },
      ],
    },
  ],
};
beforeEach(() => {
  vi.mocked(loadAthleteRoster).mockResolvedValue(roster);
  vi.mocked(saveRosterAction).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
function show() {
  return render(
    React.createElement(AthletesPanel, {
      onLoaded: vi.fn(),
      onEditingChange: vi.fn(),
    }),
  );
}
it("moves selected athletes with account versions and refreshes the roster", async () => {
  show();
  await screen.findByText("Alex Morgan");
  expect(screen.queryByText("Blake Morgan")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Alex Morgan" }));
  fireEvent.change(
    screen.getByRole("combobox", { name: "Move selected athletes to" }),
    { target: { value: "senior" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Move athletes" }));
  await waitFor(() =>
    expect(saveRosterAction).toHaveBeenCalledWith({
      action: "move",
      destinationId: "senior",
      athletes: [{ id: "a", updatedAt: "account-v1" }],
    }),
  );
  await screen.findByText("1 athlete moved.");
  expect(loadAthleteRoster).toHaveBeenCalledTimes(2);
});
it("clears hidden selection when filtering and explicitly includes archived athletes", async () => {
  show();
  await screen.findByText("Alex Morgan");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Alex Morgan" }));
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Blake" },
  });
  expect(screen.queryByText("1 selected")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Include archived" }));
  await screen.findByText("Blake Morgan");
});
it("offers fixed groups without group management controls", async () => {
  show();
  await screen.findByText("Alex Morgan");
  expect(screen.queryByRole("button", {name:"Add group"})).toBeNull();
  expect(screen.queryByRole("button", {name:"Reorder groups"})).toBeNull();
  expect(screen.queryByText("Coach")).toBeNull();
});

it("opens the athlete's account, hides chosen columns, and offers the Archived list", async () => {
  const onOpenAccount = vi.fn();
  render(
    React.createElement(AthletesPanel, {
      onLoaded: vi.fn(),
      onEditingChange: vi.fn(),
      onOpenAccount,
    }),
  );
  await screen.findByText("Alex Morgan");
  fireEvent.click(screen.getByRole("button", { name: "Alex Morgan" }));
  expect(onOpenAccount).toHaveBeenCalledWith("account");
  fireEvent.click(screen.getByText("Columns", { exact: true }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Account" }));
  expect(screen.queryByRole("columnheader", { name: "Account" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Archived,/ }));
  await screen.findByText("Blake Morgan");
  expect(screen.queryByText("Alex Morgan")).toBeNull();
  expect(
    screen
      .getByRole("checkbox", { name: "Select Blake Morgan" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("shows linked swim counts and allows hiding the Swims column", async () => {
  const linked = structuredClone(roster);
  linked.accounts[0].athletes[0].timesAthleteId = "times-alex";
  linked.swimCounts = { "times-alex": 1234 };
  vi.mocked(loadAthleteRoster).mockResolvedValue(linked);
  show();
  expect(await screen.findByText("1,234")).toBeTruthy();
  fireEvent.click(screen.getByText("Columns"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Swims" }));
  expect(screen.queryByRole("columnheader", { name: "Swims" })).toBeNull();
});
