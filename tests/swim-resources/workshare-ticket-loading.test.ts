// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TicketsPanel } from "@/features/workshare/components/admin/TicketsPanel";
import { loadTickets, type TicketPage } from "@/features/workshare/lib/tickets";

vi.mock("@/features/workshare/lib/tickets", async (original) => ({
  ...(await original<object>()),
  loadTickets: vi.fn(),
}));
// The repo's test transform uses the classic JSX runtime.
vi.stubGlobal("React", React);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const props = {
  season: {
    id: "season",
    name: "2026–2027",
    startsOn: "2026-09-01",
    endsOn: "2027-08-31",
  },
  accounts: [],
  accountId: "account",
  revision: 0,
  onChanged: vi.fn(),
  onAdd: vi.fn(),
  onReuse: vi.fn(),
};
const emptyPage: TicketPage = { tickets: [], total: 0, page: 1, pageSize: 50 };
it("waits for Load Tickets, shows pending state, then enables search and refreshes loaded tickets", async () => {
  let resolve!: (data: TicketPage) => void;
  vi.mocked(loadTickets).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(React.createElement(TicketsPanel, props));
  expect(loadTickets).not.toHaveBeenCalled();
  expect(screen.queryByRole("searchbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add ticket" }));
  expect(props.onAdd).toHaveBeenCalledWith("account");
  expect(loadTickets).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load Tickets" }));
  expect(
    screen
      .getByRole("button", { name: "Loading tickets…" })
      .hasAttribute("disabled"),
  ).toBe(true);
  resolve(emptyPage);
  await screen.findByRole("searchbox", { name: "Search tickets" });
  vi.mocked(loadTickets).mockResolvedValue(emptyPage);
  view.rerender(React.createElement(TicketsPanel, { ...props, revision: 1 }));
  await waitFor(() => expect(loadTickets).toHaveBeenCalledTimes(2));
});
it("allows retry after a requested ticket load fails", async () => {
  vi.mocked(loadTickets).mockRejectedValueOnce(new Error("Offline"));
  render(React.createElement(TicketsPanel, props));
  fireEvent.click(screen.getByRole("button", { name: "Load Tickets" }));
  await screen.findByText("Offline");
  vi.mocked(loadTickets).mockResolvedValue(emptyPage);
  fireEvent.click(screen.getByRole("button", { name: "Retry tickets" }));
  await screen.findByText("No tickets match these filters.");
  expect(loadTickets).toHaveBeenCalledTimes(2);
});
it("still loads the standalone season ticket list immediately", async () => {
  vi.mocked(loadTickets).mockResolvedValue(emptyPage);
  render(React.createElement(TicketsPanel, { ...props, accountId: undefined }));
  await screen.findByText("No tickets match these filters.");
  expect(loadTickets).toHaveBeenCalledTimes(1);
});

it("keeps account and athlete settings collapsed until requested and preserves edits when collapsed", async () => {
  const { AccountEditor } =
    await import("@/features/workshare/components/admin/AccountEditor");
  const { emptyAccount } = await import("@/features/workshare/lib/accounts");
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const onClose = vi.fn();
  render(
    React.createElement(AccountEditor, {
      account: {
        ...emptyAccount(),
        id: "account",
        fullName: "Test Account",
        athletes: [
          {
            fullName: "Test Athlete",
            trainingGroup: "Prep",
            timesAthleteId: null,
            isArchived: false,
          },
        ],
      },
      onSaved: vi.fn(),
      season: props.season,
      onClose,
      summaryLoading: false,
      onRequirementsSaved: vi.fn(),
      onAddTicket: vi.fn(),
      onReuse: vi.fn(),
      ticketRevision: 0,
      onTicketsChanged: vi.fn(),
      allAccounts: [],
      onTicketEditingChange: vi.fn(),
      ref: React.createRef(),
      switching: false,
    }),
  );
  expect(
    screen.queryByRole("textbox", { name: "Account / athlete emails" }),
  ).toBeNull();
  expect(
    screen.queryByRole("checkbox", { name: "Archive athlete" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Account settings" }));
  const emails = screen.getByRole("textbox", {
    name: "Account / athlete emails",
  });
  fireEvent.change(emails, { target: { value: "parent@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Account settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Account settings" }));
  expect(
    (
      screen.getByRole("textbox", {
        name: "Account / athlete emails",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("parent@example.test");
  expect(screen.queryByLabelText("Account settings summary")).toBeNull();
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "General" }),
    { target: { value: "12" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Account settings" }));
  expect(
    screen.getByLabelText("Account settings summary").textContent,
  ).toContain("General 12");
  expect(
    screen.getByLabelText("Account settings summary").textContent,
  ).toContain("parent@example.test");
  fireEvent.click(
    screen.getByRole("button", { name: "Athlete settings: Test Athlete" }),
  );
  expect(
    screen.getByRole("button", { name: "Archive athlete: Test Athlete" }),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Settings summary: Test Athlete")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Seniors" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Athlete settings: Test Athlete" }),
  );
  expect(
    screen.getByLabelText("Settings summary: Test Athlete").textContent,
  ).toContain("Seniors");
});
