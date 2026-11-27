// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedRecord, RecordKind } from "@/lib/results/types";

const mocks = vi.hoisted(() => ({ search: "view=results", request: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({
    replace: (url: string) => {
      mocks.search = url.split("?")[1] ?? "";
    },
  }),
}));
vi.mock("@/components/data/data-api", async (original) => ({
  ...(await original<typeof import("@/components/data/data-api")>()),
  requestData: mocks.request,
}));
vi.mock("@/components/data/ImportFile", () => ({ default: () => null }));
vi.mock("@/components/collection/FlaggedResults", () => ({
  default: () => null,
}));
vi.mock("@/components/data/RecordEditor", () => ({
  default: ({ kind, record }: { kind: RecordKind; record: ManagedRecord }) =>
    createElement(
      "section",
      { "aria-label": "Record editor" },
      createElement("output", null, `${kind}:${record.id}`),
      createElement("input", {
        "aria-label": "Record draft",
        defaultValue: record.id,
      }),
    ),
}));
import DataManager from "@/components/data/DataManager";

function record(kind: string, id = "existing"): ManagedRecord {
  return {
    id,
    version: "v1",
    data: {
      id,
      name: { first: kind, last: id },
      athleteName: { first: "Swimmer", last: id },
      eventCode: "100_FR_SCY",
      status: "OK",
      timeMs: 60000,
    },
  };
}
function pendingRecord() {
  let resolve!: (record: ManagedRecord) => void;
  const promise = new Promise<ManagedRecord>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let view: ReturnType<typeof render>;
let details: ReturnType<typeof pendingRecord>[];
let signals: AbortSignal[];
async function loadRows() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(201);
  });
}
async function finish(
  pending: ReturnType<typeof pendingRecord>,
  value: ManagedRecord,
) {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}
beforeEach(async () => {
  vi.useFakeTimers();
  mocks.search = "view=results";
  details = [];
  signals = [];
  mocks.request
    .mockReset()
    .mockImplementation((href: string, _body: unknown, signal: AbortSignal) => {
      const params = new URL(href, "http://localhost").searchParams;
      if (params.has("id")) {
        signals.push(signal);
        // Deliberately resolve even when aborted: guards must also reject already
        // completed network responses whose parsing/callback arrives late.
        return (
          details.shift()?.promise ??
          Promise.resolve(record(params.get("kind")!, params.get("id")!))
        );
      }
      return Promise.resolve({
        rows: [
          record(params.get("kind")!, "first"),
          record(params.get("kind")!, "second"),
        ],
        hasMore: false,
      });
    });
  view = render(createElement(DataManager));
  await loadRows();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("data editor request ownership", () => {
  it("keeps the current section and its pending selection on a repeated tab click", async () => {
    const pending = pendingRecord();
    details.push(pending);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(signals[0].aborted).toBe(false);
    await finish(pending, record("swim", "old-swim"));
    expect(
      screen.getByRole("region", { name: "Record editor" }).textContent,
    ).toContain("swim:old-swim");
  });

  it("ignores an Edit response after switching record kinds", async () => {
    const pending = pendingRecord();
    details.push(pending);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Swimmers" }));
    view.rerender(createElement(DataManager));
    expect(signals[0].aborted).toBe(true);
    await finish(pending, record("swim", "old-swim"));
    expect(screen.queryByRole("region", { name: "Record editor" })).toBeNull();
    await loadRows();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    });
    expect(
      screen.getByRole("region", { name: "Record editor" }).textContent,
    ).toContain("athlete:first");
  });

  it("keeps a new draft when an earlier Edit response arrives", async () => {
    const pending = pendingRecord();
    details.push(pending);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Add result" }));
    const editor = screen.getByRole("region", {
      name: "Record editor",
    }).textContent;
    fireEvent.change(screen.getByLabelText("Record draft"), {
      target: { value: "Unsaved new result" },
    });
    expect(signals[0].aborted).toBe(true);
    await finish(pending, record("swim", "old-swim"));
    expect(
      screen.getByRole("region", { name: "Record editor" }).textContent,
    ).toBe(editor);
    expect(
      (screen.getByLabelText("Record draft") as HTMLInputElement).value,
    ).toBe("Unsaved new result");
  });

  it("keeps the latest selection when two Edit requests complete out of order", async () => {
    const first = pendingRecord(),
      second = pendingRecord();
    details.push(first, second);
    const buttons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    await finish(second, record("swim", "second"));
    await finish(first, record("swim", "first"));
    expect(signals[0].aborted).toBe(true);
    expect(
      screen.getByRole("region", { name: "Record editor" }).textContent,
    ).toContain("swim:second");
  });

  it("cancels pending edits when changing individual results to relays", async () => {
    const pending = pendingRecord();
    details.push(pending);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByLabelText("Result type"), {
      target: { value: "relay" },
    });
    await finish(pending, record("swim", "old-swim"));
    expect(signals[0].aborted).toBe(true);
    expect(screen.queryByRole("region", { name: "Record editor" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add relay" })).toBeDefined();
  });

  it("aborts selection requests when the page unmounts", async () => {
    const pending = pendingRecord();
    details.push(pending);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    view.unmount();
    expect(signals[0].aborted).toBe(true);
    await finish(pending, record("swim"));
    expect(screen.queryByRole("region", { name: "Record editor" })).toBeNull();
  });
});
