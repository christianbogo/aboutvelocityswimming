// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ManagedRecord } from "@/lib/results/types";
import type { ModerationDetail } from "@/features/swimming/domain/moderation";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=results"),
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/components/data/data-api", async (original) => ({
  ...(await original<typeof import("@/components/data/data-api")>()),
  requestData: mocks.request,
}));
vi.mock("@/components/data/RecordPicker", () => ({ default: () => null }));
vi.mock("@/components/collection/FlaggedResults", () => ({
  default: () => null,
}));
import DataManager from "@/components/data/DataManager";
import { ModerationEditor } from "@/components/collection/ResultModeration";
import { updatesBlocked } from "@/lib/update-safety";

const swim: ManagedRecord = {
  id: "race-one",
  version: "v1",
  data: {
    id: "race-one",
    athleteId: "athlete-one",
    athleteName: { first: "Test", last: "Swimmer" },
    teamId: "velocity-swimming",
    course: "SCY",
    distance: 100,
    stroke: "FR",
    eventCode: "100_FR_SCY",
    gender: "F",
    round: "F",
    status: "OK",
    timeMs: 65000,
    ageGroup: "Open",
    isOfficial: true,
    meet: { id: "meet-one", name: "Meet", date: "2026-11-20" },
  },
};
function review(flagged = false): ModerationDetail {
  return {
    resultType: "swim",
    resultId: swim.id,
    version: flagged ? 1 : 0,
    flagged,
    available: true,
    race: null,
    history: [],
    sources: [],
    sourceData: {},
    originalSnapshot: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function openEditor() {
  render(createElement(DataManager));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(201);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  });
  const details = screen
    .getByText("Flag or restore this result")
    .closest("details")!;
  details.open = true;
}
function editNote() {
  fireEvent.change(screen.getByLabelText("Staff note (optional)"), {
    target: { value: "Check the source time" },
  });
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/tools/data?view=results");
  vi.spyOn(window, "confirm").mockReturnValue(false);
  mocks.request
    .mockReset()
    .mockImplementation((url: string, body?: unknown) =>
      Promise.resolve(
        body || new URL(url, window.location.origin).searchParams.has("id")
          ? swim
          : { rows: [swim], hasMore: false },
      ),
    );
  mocks.fetch
    .mockReset()
    .mockImplementation(async () => Response.json(review()));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  expect(updatesBlocked()).toBe(false);
});

it("protects a moderation note even when the result fields are unchanged", async () => {
  await openEditor();
  expect(updatesBlocked()).toBe(false);
  editNote();
  expect(updatesBlocked()).toBe(true);
  expect(unload()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Meets" }));
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(window.confirm).toHaveBeenCalledOnce();
  expect(
    (screen.getByLabelText("Staff note (optional)") as HTMLTextAreaElement)
      .value,
  ).toBe("Check the source time");
  fireEvent.change(screen.getByLabelText("Staff note (optional)"), {
    target: { value: "" },
  });
  expect(updatesBlocked()).toBe(false);
  expect(unload()).toBe(false);
});

it("treats a changed moderation reason as an unsaved review", async () => {
  await openEditor();
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "duplicate" },
  });
  expect(updatesBlocked()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(window.confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Reason")).toBeDefined();
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "incorrect_time" },
  });
  expect(updatesBlocked()).toBe(false);
});

it("locks Data navigation during a moderation save and retains the draft after failure", async () => {
  await openEditor();
  editNote();
  const save = deferred<Response>();
  mocks.fetch.mockReturnValueOnce(save.promise);
  fireEvent.click(
    screen.getByRole("button", { name: "Flag and exclude result" }),
  );
  for (const name of ["Meets", "Save changes", "Cancel"]) {
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(true);
  }
  expect(screen.getByLabelText("Time").matches(":disabled")).toBe(true);
  expect(unload()).toBe(true);
  await act(async () => {
    save.resolve(
      Response.json({ error: "Review save failed" }, { status: 503 }),
    );
  });
  expect(screen.getByRole("alert").textContent).toContain("Review save failed");
  expect(
    (screen.getByLabelText("Staff note (optional)") as HTMLTextAreaElement)
      .value,
  ).toBe("Check the source time");
  expect(
    (screen.getByRole("button", { name: "Meets" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(updatesBlocked()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Meets" }));
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("releases moderation dirty/busy state after success", async () => {
  await openEditor();
  editNote();
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "duplicate" },
  });
  mocks.fetch.mockResolvedValueOnce(Response.json(review(true)));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Flag and exclude result" }),
    );
  });
  expect(screen.getByText("Result flagged and excluded.")).toBeDefined();
  expect(
    (screen.getByLabelText("Restoration explanation") as HTMLTextAreaElement)
      .value,
  ).toBe("");
  expect(updatesBlocked()).toBe(false);
  expect(unload()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Meets" }));
  expect(mocks.replace).toHaveBeenCalledOnce();
  expect(window.confirm).not.toHaveBeenCalled();
});

it("keeps the result draft protected after a separate review succeeds", async () => {
  await openEditor();
  fireEvent.change(screen.getByLabelText("Time"), {
    target: { value: "1:04.00" },
  });
  editNote();
  mocks.fetch.mockResolvedValueOnce(Response.json(review(true)));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Flag and exclude result" }),
    );
  });
  expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe(
    "1:04.00",
  );
  expect(updatesBlocked()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Meets" }));
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("requires consent before saving the record would discard a separate moderation draft", async () => {
  await openEditor();
  editNote();
  const recordForm = screen
    .getByRole("button", { name: "Save changes" })
    .closest("form")!;
  fireEvent.submit(recordForm);
  expect(window.confirm).toHaveBeenCalledExactlyOnceWith(
    "Discard your unsaved review and save the record?",
  );
  expect(mocks.request.mock.calls.some(([, body]) => Boolean(body))).toBe(
    false,
  );
  vi.mocked(window.confirm).mockReturnValue(true);
  const save = deferred<ManagedRecord>();
  mocks.request.mockReturnValueOnce(save.promise);
  fireEvent.submit(recordForm);
  expect(
    (
      screen.getByRole("button", {
        name: "Flag and exclude result",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Staff note (optional)") as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  await act(async () => {
    save.resolve(swim);
  });
  expect(screen.queryByLabelText("Staff note (optional)")).toBeNull();
  expect(updatesBlocked()).toBe(false);
});

it("keeps standalone moderation behavior when no navigation callback is supplied", async () => {
  const changed = vi.fn();
  await act(async () => {
    render(
      createElement(ModerationEditor, {
        resultType: "swim",
        resultId: swim.id,
        onChanged: changed,
      }),
    );
  });
  editNote();
  const save = deferred<Response>();
  mocks.fetch.mockReturnValueOnce(save.promise);
  fireEvent.click(
    screen.getByRole("button", { name: "Flag and exclude result" }),
  );
  expect(updatesBlocked()).toBe(true);
  await act(async () => {
    save.resolve(Response.json(review(true)));
  });
  expect(changed).toHaveBeenCalledExactlyOnceWith(review(true));
  expect(updatesBlocked()).toBe(false);
});
