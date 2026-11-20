// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AccountAthletes from "@/components/shared/AccountAthletes";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/hooks/useUpdateBlocker", () => ({ useUpdateBlocker: vi.fn() }));
vi.mock("@/lib/account-athletes", () => ({
  maxFavoriteAthletes: 10,
  loadAccountAthletes: async () => ({
    primaryAthlete: null,
    favoriteAthletes: [],
  }),
  searchAccountAthletes: async () => [
    { id: "avery", name: "Avery Swimmer", teamName: null },
  ],
  saveAccountAthletes: mocks.save,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("selects and saves a favorite when Safari blurs the search without focusing the result", async () => {
  mocks.save.mockImplementation(async (_user, preferences) => preferences);
  const view = render(createElement(AccountAthletes, { userId: "test-user" }));
  fireEvent.click(
    await view.findByRole("button", { name: "Add favorite athlete" }),
  );
  const input = view.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "Avery" } });
  const result = await view.findByRole("button", {
    name: "Add Avery Swimmer to favorite athletes",
  });
  fireEvent.pointerDown(result);
  fireEvent.blur(input, { relatedTarget: null });
  expect(result.isConnected).toBe(true);
  fireEvent.click(result);
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith("test-user", {
      primaryAthlete: null,
      favoriteAthletes: [
        { id: "avery", name: "Avery Swimmer", teamName: null },
      ],
    }),
  );
  expect(
    await view.findByRole("link", { name: "View Avery Swimmer times" }),
  ).toBeTruthy();
});

it("dismisses athlete search on outside taps and keyboard focus leaving the picker", async () => {
  const view = render(createElement(AccountAthletes, { userId: "test-user" }));
  const add = await view.findByRole("button", { name: "Add favorite athlete" });
  fireEvent.click(add);
  fireEvent.pointerDown(document.body);
  expect(view.queryByRole("searchbox")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Add favorite athlete" }));
  fireEvent.blur(view.getByRole("searchbox"), { relatedTarget: document.body });
  expect(view.queryByRole("searchbox")).toBeNull();
});
