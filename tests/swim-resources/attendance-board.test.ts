// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/attendance", () => ({
  loadAttendanceDay: mocks.load,
  saveAttendance: mocks.save,
}));
vi.mock("@/features/auth/context", () => ({
  useAuth: () => ({ isAdmin: true, loading: false }),
}));
vi.mock("@/lib/dates", () => ({ teamDate: () => "2026-11-19" }));
import AttendanceBoard from "@/features/swim-resources/components/AttendanceBoard";
const mark = {
  id: "mark-a",
  data: { athleteId: "athlete-a", sessionId: "practice-a", status: "absent" },
};
const day = {
  date: "2026-11-19",
  swimmers: [
    {
      id: "athlete-a",
      name: { first: "Avery", last: "Swimmer" },
      group: "Prep",
    },
  ],
  sessions: [
    { id: "practice-a", data: { date: "2026-11-19", trainingGroup: "Prep" } },
  ],
  marks: [mark],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(day);
});
afterEach(cleanup);

it("saves the loaded before-image once and locks edits until the committed state reloads", async () => {
  let finish!: () => void;
  mocks.save.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const screen = render(createElement(AttendanceBoard));
  const status = await screen.findByRole("combobox", {
    name: "Attendance for Avery Swimmer",
  });
  fireEvent.change(status, { target: { value: "present" } });
  fireEvent.click(screen.getByRole("button", { name: "Save attendance" }));
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
    date: day.date,
    group: "Prep",
    session: day.sessions[0],
    changes: [{ athleteId: "athlete-a", status: "present", before: mark }],
  });
  expect((status as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(
    true,
  );
  mocks.load.mockResolvedValue({
    ...day,
    marks: [{ ...mark, data: { ...mark.data, status: "present" } }],
  });
  await act(async () => finish());
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(
    (
      (await screen.findByRole("combobox", {
        name: "Attendance for Avery Swimmer",
      })) as HTMLSelectElement
    ).value,
  ).toBe("present");
  expect(
    (
      screen.getByRole("button", {
        name: "Save attendance",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("keeps a failed draft visible and reloads only when the user chooses to discard it", async () => {
  mocks.save.mockRejectedValue(
    new Error("Attendance changed. Reload the practice."),
  );
  const screen = render(createElement(AttendanceBoard));
  fireEvent.change(
    await screen.findByRole("combobox", {
      name: "Attendance for Avery Swimmer",
    }),
    { target: { value: "late" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save attendance" }));
  await screen.findByRole("alert");
  expect(
    (
      screen.getByRole("combobox", {
        name: "Attendance for Avery Swimmer",
      }) as HTMLSelectElement
    ).value,
  ).toBe("late");
  expect(mocks.load).toHaveBeenCalledOnce();
  expect(
    screen.getByText("Reloading clears your unsaved attendance changes."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reload practice" }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(
    (
      (await screen.findByRole("combobox", {
        name: "Attendance for Avery Swimmer",
      })) as HTMLSelectElement
    ).value,
  ).toBe("absent");
});

it("ignores an earlier date's late response after changing practice day", async () => {
  let finish!: (value: typeof day) => void;
  mocks.load.mockReturnValueOnce(
    new Promise<typeof day>((resolve) => {
      finish = resolve;
    }),
  );
  mocks.load.mockResolvedValueOnce({
    ...day,
    date: "2026-11-20",
    sessions: [],
    marks: [],
  });
  const screen = render(createElement(AttendanceBoard));
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-11-20" },
  });
  const status = await screen.findByRole("combobox", {
    name: "Attendance for Avery Swimmer",
  });
  expect((status as HTMLSelectElement).value).toBe("unmarked");
  await act(async () => finish(day));
  expect(
    (
      screen.getByRole("combobox", {
        name: "Attendance for Avery Swimmer",
      }) as HTMLSelectElement
    ).value,
  ).toBe("unmarked");
  expect(mocks.load.mock.calls[0][1].aborted).toBe(true);
});
