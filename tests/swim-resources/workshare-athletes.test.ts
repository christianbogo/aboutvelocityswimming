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
it("requires a removal destination and reviews only currently assigned members", async () => {
  show();
  await screen.findByText("Alex Morgan");
  fireEvent.click(screen.getByRole("button", { name: /Prep.*Avery/ }));
  fireEvent.click(screen.getByRole("button", { name: "Group settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove group" }));
  const remove = screen.getByRole("button", {
    name: "Remove group and move athletes",
  });
  expect(remove.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Move athletes to" }), {
    target: { value: "unassigned" },
  });
  fireEvent.click(remove);
  await waitFor(() =>
    expect(saveRosterAction).toHaveBeenCalledWith({
      action: "removeGroup",
      id: "prep",
      updatedAt: "v1",
      destinationId: "unassigned",
      athleteIds: ["a"],
    }),
  );
});
it("keeps edits after a failed save and supports reload recovery", async () => {
  vi.mocked(saveRosterAction).mockRejectedValueOnce(
    new Error("This group changed."),
  );
  show();
  await screen.findByText("Alex Morgan");
  fireEvent.click(screen.getByRole("button", { name: /Prep.*Avery/ }));
  fireEvent.click(screen.getByRole("button", { name: "Group settings" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Group name" }), {
    target: { value: "New Prep" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save group" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "This group changed.",
  );
  expect(
    (screen.getByRole("textbox", { name: "Group name" }) as HTMLInputElement)
      .value,
  ).toBe("New Prep");
  fireEvent.click(screen.getByRole("button", { name: "Reload roster" }));
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Group name" })).toBeNull(),
  );
});

it("reorders a draft, saves versions in the requested order, and refreshes shared lists", async () => {
  show();
  await screen.findByText("Alex Morgan");
  fireEvent.click(screen.getByRole("button", { name: "Reorder groups" }));
  expect(
    screen
      .getByRole("button", { name: "Move Prep up" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Move Seniors down" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Move Seniors up" }));
  expect(screen.getByRole("list", { name: "Group order" }).textContent).toMatch(
    /Seniors.*Prep/,
  );
  expect(saveRosterAction).not.toHaveBeenCalled();
  vi.mocked(loadAthleteRoster).mockResolvedValueOnce({
    ...roster,
    groups: [...roster.groups].reverse(),
  });
  fireEvent.click(screen.getByRole("button", { name: "Save order" }));
  await screen.findByText("Group order saved.");
  expect(saveRosterAction).toHaveBeenCalledWith({
    action: "reorderGroups",
    groups: [
      { id: "senior", updatedAt: "v2" },
      { id: "prep", updatedAt: "v1" },
    ],
  });
  expect(screen.queryByRole("list", { name: "Group order" })).toBeNull();
  const groupButtons = screen.getByRole("complementary", {
    name: "Practice groups",
  }).textContent!;
  expect(groupButtons.indexOf("Seniors")).toBeLessThan(
    groupButtons.indexOf("Prep"),
  );
});

it("cancels an unsaved order and retains a failed draft until reload", async () => {
  show();
  await screen.findByText("Alex Morgan");
  fireEvent.click(screen.getByRole("button", { name: "Reorder groups" }));
  fireEvent.click(screen.getByRole("button", { name: "Move Prep down" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(saveRosterAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reorder groups" }));
  expect(screen.getByRole("list", { name: "Group order" }).textContent).toMatch(
    /Prep.*Seniors/,
  );
  fireEvent.click(screen.getByRole("button", { name: "Move Prep down" }));
  vi.mocked(saveRosterAction).mockRejectedValueOnce(
    new Error("Groups changed."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save order" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Groups changed.",
  );
  expect(screen.getByRole("list", { name: "Group order" }).textContent).toMatch(
    /Seniors.*Prep/,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reload roster" }));
  await waitFor(() =>
    expect(screen.queryByRole("list", { name: "Group order" })).toBeNull(),
  );
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
