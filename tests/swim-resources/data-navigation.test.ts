// @vitest-environment jsdom
import { createElement, Fragment } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedRecord } from "@/lib/results/types";

const mocks = vi.hoisted(() => ({
  search: "view=meets",
  request: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
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
vi.mock("@/components/collection/ResultModeration", () => ({
  ModerationEditor: () => null,
}));
import DataManager from "@/components/data/DataManager";
import RecordEditor from "@/components/data/RecordEditor";
import { updatesBlocked } from "@/lib/update-safety";

const meet: ManagedRecord = {
  id: "meet-one",
  version: "v1",
  data: {
    id: "meet-one",
    name: "Original meet",
    dates: { startDate: "2026-11-20", endDate: "2026-11-21" },
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function advanceRows() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(201);
  });
}

async function openMeet() {
  const view = render(createElement(DataManager));
  await advanceRows();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  });
  return view;
}

function editMeet() {
  fireEvent.change(screen.getByLabelText("Meet name"), {
    target: { value: "Unsaved meet" },
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
  mocks.search = "view=meets";
  window.history.replaceState(null, "", "/tools/data?view=meets");
  mocks.replace.mockImplementation((url: string) => {
    mocks.search = url.split("?")[1] ?? "";
  });
  mocks.request.mockReset().mockImplementation((url: string) => {
    const params = new URL(url, window.location.origin).searchParams;
    return Promise.resolve(
      params.has("id") ? meet : { rows: [meet], hasMore: false },
    );
  });
  vi.spyOn(window, "confirm").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  expect(updatesBlocked()).toBe(false);
});

describe("Data drafts and section navigation", () => {
  it("keeps a dirty draft when clicking the active section", async () => {
    await openMeet();
    editMeet();
    fireEvent.click(screen.getByRole("button", { name: "Meets" }));
    expect((screen.getByLabelText("Meet name") as HTMLInputElement).value).toBe(
      "Unsaved meet",
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(updatesBlocked()).toBe(true);
  });

  it("changes sections only after the user agrees to discard the draft", async () => {
    const view = await openMeet();
    editMeet();
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Meet name")).toBeDefined();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      "/tools/data?view=results",
    );
    view.rerender(createElement(DataManager));
    expect(screen.queryByLabelText("Meet name")).toBeNull();
    expect(updatesBlocked()).toBe(false);
  });

  it("preserves a draft when Cancel is declined and discards it when accepted", async () => {
    await openMeet();
    editMeet();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Meet name")).toBeDefined();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Meet name")).toBeNull();
    expect(updatesBlocked()).toBe(false);
    expect(unload()).toBe(false);
  });

  it("does not warn for an unchanged record or after restoring the original value", async () => {
    await openMeet();
    expect(updatesBlocked()).toBe(false);
    expect(unload()).toBe(false);
    editMeet();
    expect(unload()).toBe(true);
    fireEvent.change(screen.getByLabelText("Meet name"), {
      target: { value: "Original meet" },
    });
    expect(updatesBlocked()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("keeps tabs locked while saving and releases them after a successful save", async () => {
    await openMeet();
    editMeet();
    const save = deferred<ManagedRecord>();
    mocks.request.mockReturnValueOnce(save.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    for (const label of [
      "Results",
      "Swimmers",
      "Meets",
      "Standards",
      "Import File",
      "Cancel",
    ])
      expect(
        (screen.getByRole("button", { name: label }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => save.resolve({ ...meet, version: "v2" }));
    expect(screen.getByRole("status").textContent).toBe("Changes saved.");
    expect(
      (screen.getByRole("button", { name: "Results" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(updatesBlocked()).toBe(false);
    expect(unload()).toBe(false);
  });

  it("retains navigation protection and edited values after a failed save", async () => {
    await openMeet();
    editMeet();
    mocks.request.mockRejectedValueOnce(new Error("Save failed"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Save failed");
    expect((screen.getByLabelText("Meet name") as HTMLInputElement).value).toBe(
      "Unsaved meet",
    );
    expect(
      (screen.getByRole("button", { name: "Results" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(updatesBlocked()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it("protects an incomplete standard cut that has not entered the valid record data", () => {
    const cancel = vi.fn();
    render(
      createElement(RecordEditor, {
        kind: "standard",
        record: {
          id: "standard-one",
          version: "v1",
          data: { id: "standard-one", cuts: {} },
        },
        onSaved: vi.fn(),
        onCancel: cancel,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add cut" }));
    expect(updatesBlocked()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledOnce();
  });
});

describe("Data page exits", () => {
  function linkAndEditor(
    options: { href?: string; target?: string; download?: string } = {},
  ) {
    const navigate = vi.fn();
    const view = render(
      createElement(
        Fragment,
        null,
        createElement(
          "a",
          {
            href: "/tools/rankings",
            ...options,
            onClick: (event) => {
              event.preventDefault();
              navigate();
            },
          },
          "Leave Data",
        ),
        createElement(RecordEditor, {
          kind: "meet",
          record: meet,
          onSaved: vi.fn(),
          onCancel: vi.fn(),
        }),
      ),
    );
    editMeet();
    return {
      navigate,
      view,
      link: screen.getByRole("link", { name: "Leave Data" }),
    };
  }

  it("guards links outside the editor and cleans up the unload listener on unmount", () => {
    const { link, navigate, view } = linkAndEditor();
    expect(unload()).toBe(true);
    fireEvent.click(link);
    expect(navigate).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledOnce();
    view.unmount();
    expect(unload()).toBe(false);
  });

  it.each([
    [{ href: "#details" }, {}],
    [{ target: "_blank" }, {}],
    [{ download: "results.csv" }, {}],
    [{}, { ctrlKey: true }],
    [{}, { metaKey: true }],
  ])(
    "allows links that keep the current editor open (%j, %j)",
    (options, click) => {
      const { link, navigate } = linkAndEditor(options);
      fireEvent.click(link, click);
      expect(navigate).toHaveBeenCalledOnce();
      expect(window.confirm).not.toHaveBeenCalled();
    },
  );

  it("blocks an internal link during a save even when discard would be accepted", async () => {
    const { link, navigate } = linkAndEditor();
    const save = deferred<ManagedRecord>();
    mocks.request.mockReturnValueOnce(save.promise);
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(link);
    expect(navigate).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    await act(async () => save.resolve(meet));
  });
});

it("blocks Data navigation throughout file parsing and import writes", async () => {
  mocks.search = "view=import";
  const reader = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  vi.stubGlobal(
    "Worker",
    vi.fn(function () {
      return reader;
    }),
  );
  render(createElement(DataManager));
  const file = new File(["synthetic"], "results.hy3");
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new ArrayBuffer(8),
  });
  fireEvent.change(screen.getByLabelText("Result files"), {
    target: { files: [file] },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Import files" }));
  });
  expect(
    (screen.getByRole("button", { name: "Results" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(updatesBlocked()).toBe(true);
  expect(unload()).toBe(true);
  const write = deferred<{ outcomes: [] }>();
  mocks.request.mockReturnValueOnce(write.promise);
  await act(async () => {
    reader.onmessage!({
      data: {
        result: {
          issues: [],
          rows: [{ kind: "swim", course: "SCY", distance: 100, stroke: "FR" }],
        },
      },
    });
  });
  fireEvent.click(screen.getByRole("button", { name: "Results" }));
  expect(mocks.replace).not.toHaveBeenCalled();
  await act(async () => write.resolve({ outcomes: [] }));
  expect(
    (screen.getByRole("button", { name: "Results" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(updatesBlocked()).toBe(false);
  expect(unload()).toBe(false);
});
