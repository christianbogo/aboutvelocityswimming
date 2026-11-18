import { afterEach, describe, expect, it, vi } from "vitest";
import { createVersionedAutosave } from "@/features/workshare/lib/versioned-autosave";
import {
  defaultSeason,
  defaultTicketDate,
  validateTicketFields,
  saveTicket,
  saveRequirements,
} from "@/features/workshare/lib/tickets";
import {
  emptyAccount,
  saveWorkshareAccount,
} from "@/features/workshare/lib/accounts";

const season = {
  id: "season",
  name: "2026–2027",
  startsOn: "2026-09-01",
  endsOn: "2027-08-31",
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ticket and requirement saves", () => {
  it("carries the acknowledged version into queued edits without replacing newer typing", async () => {
    let finish!: (value: { hours: number; updatedAt: string | null }) => void;
    const persist = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async (value) => ({
        ...value,
        updatedAt: "version-3",
      }));
    const queue = createVersionedAutosave(
      { hours: 1, updatedAt: "version-1" },
      persist,
      () => "",
      vi.fn(),
    );
    queue.setDraft((draft) => ({ ...draft, hours: 4 }));
    const saving = queue.flush();
    queue.setDraft((draft) => ({ ...draft, hours: 5 }));
    queue.setDraft((draft) => ({ ...draft, hours: 6 }));
    finish({ hours: 4, updatedAt: "version-2" });
    expect(await saving).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith({
      hours: 6,
      updatedAt: "version-2",
    });
    expect(queue.getSnapshot()).toMatchObject({
      draft: { hours: 6 },
      dirty: false,
      saved: true,
    });
  });

  it("drains valid edits on navigation and keeps failed edits available for retry", async () => {
    const saved = vi.fn();
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockImplementation(async (value) => ({ ...value, updatedAt: "next" }));
    const queue = createVersionedAutosave(
      { hours: 1, updatedAt: null },
      persist,
      () => "",
      saved,
    );
    queue.setDraft((draft) => ({ ...draft, hours: 4 }));
    expect(await queue.flush()).toBe(false);
    expect(queue.getSnapshot()).toMatchObject({
      dirty: true,
      error: "Connection lost",
    });
    queue.deactivate();
    expect(await queue.flush()).toBe(true);
    expect(saved).not.toHaveBeenCalled();
    expect(queue.getSnapshot()).toMatchObject({
      dirty: false,
      draft: { hours: 4 },
    });
  });

  it("does not send invalid drafts and does not revive a discarded failed edit", async () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const queue = createVersionedAutosave(
      { hours: 1, updatedAt: "version" },
      persist,
      (value) => (value.hours > 0 ? "" : "Enter positive hours"),
      vi.fn(),
    );
    queue.setDraft((draft) => ({ ...draft, hours: 0 }));
    await vi.advanceTimersByTimeAsync(600);
    expect(queue.getSnapshot().error).toBe("Enter positive hours");
    queue.discard();
    queue.deactivate();
    await vi.advanceTimersByTimeAsync(1000);
    expect(persist).not.toHaveBeenCalled();
  });

  it("keeps season selection deterministic and never invents a historical work date", () => {
    const previous = {
      ...season,
      id: "previous",
      startsOn: "2025-09-01",
      endsOn: "2026-08-31",
    };
    const future = {
      ...season,
      id: "future",
      startsOn: "2027-09-01",
      endsOn: "2028-08-31",
    };
    expect(defaultSeason([future, previous, season], "2026-11-18")?.id).toBe(
      "season",
    );
    expect(defaultSeason([previous, future], "2026-11-18")?.id).toBe(
      "previous",
    );
    expect(defaultSeason([future, season], "2020-11-18")?.id).toBe("season");
    expect(defaultTicketDate(previous)).toBe("");
    expect(
      validateTicketFields(
        {
          completedOn: "2026-02-30",
          description: "Timing",
          category: "general",
          hours: 4,
        },
        season,
      ),
    ).toMatch(/valid work date/);
    expect(
      validateTicketFields(
        {
          completedOn: "2026-08-31",
          description: "Timing",
          category: "general",
          hours: 4,
        },
        season,
      ),
    ).toMatch(/selected season/);
    expect(
      validateTicketFields(
        {
          completedOn: "2026-11-18",
          description: "Timing",
          category: "general",
          hours: 4,
        },
        season,
      ),
    ).toBe("");
  });

  it("serializes only writable core, ticket, and requirement fields", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    const core = {
      ...emptyAccount(),
      id: "account",
      updatedAt: "version",
      fullName: "Family",
      generalHoursRequired: 99,
      completed: { general: 5 },
    };
    await saveWorkshareAccount(core);
    const coreBody = JSON.parse(fetch.mock.calls[0][1]?.body as string);
    expect(coreBody).toEqual({
      id: "account",
      updatedAt: "version",
      fullName: "Family",
      emails: [],
      athletes: [],
      isArchived: false,
    });
    await saveTicket({
      id: "ticket",
      accountId: "account",
      seasonId: "season",
      completedOn: "2026-11-18",
      description: "Timing",
      category: "general",
      hours: 4,
      createdAt: "created",
      updatedAt: "version",
    });
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      updatedAt: "version",
      completedOn: "2026-11-18",
      description: "Timing",
      category: "general",
      hours: 4,
    });
    await saveRequirements({
      accountId: "account",
      seasonId: "season",
      updatedAt: null,
      generalHoursRequired: null,
      starlightHoursRequired: 0,
      appleCapitalHoursRequired: 16,
    });
    expect(JSON.parse(fetch.mock.calls[2][1]?.body as string)).toEqual({
      seasonId: "season",
      updatedAt: null,
      generalHoursRequired: null,
      starlightHoursRequired: 0,
      appleCapitalHoursRequired: 16,
    });
  });
});
