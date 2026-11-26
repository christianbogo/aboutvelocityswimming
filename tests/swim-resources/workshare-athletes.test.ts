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
    { id: "prep", name: "Prep", coach: "Avery", updated_at: "v1" },
    { id: "senior", name: "Seniors", coach: "", updated_at: "v2" },
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
          trainingGroup: "Prep",
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
it("requires a removal destination and includes archived membership in the reviewed request", async () => {
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
      athleteIds: ["a", "b"],
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
