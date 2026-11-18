import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountAutosave } from "@/features/workshare/lib/account-autosave";
import { emptyAccount, WorkshareAccountSaveError } from "@/features/workshare/lib/accounts";
import type { WorkshareAccount } from "@/features/workshare/lib/accounts";

const account = (changes: Partial<WorkshareAccount> = {}): WorkshareAccount => ({
  id: "account-1",
  fullName: "Example Account",
  emails: ["parent@example.test"],
  athletes: [],
  currentSeason: null,
  generalHoursRequired: null,
  starlightHoursRequired: null,
  appleCapitalHoursRequired: null,
  isArchived: false,
  updatedAt: "2026-11-18T19:00:00.000Z",
  ...changes,
});
const athlete = (fullName: string) => ({ fullName, trainingGroup: "Prep", timesAthleteId: null, isArchived: false });
function deferred() {
  let resolve!: (value: WorkshareAccount) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<WorkshareAccount>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("account autosave", () => {
  it("debounces typing and validates account and athlete fields before writing", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async (input: WorkshareAccount) => ({ ...input, athletes: input.athletes.map((entry, index) => ({ ...entry, id: `athlete-${index}` })) }));
    const autosave = createAccountAutosave(account(), persist, vi.fn());
    autosave.setEmails("invalid email");
    await vi.advanceTimersByTimeAsync(600);
    expect(persist).not.toHaveBeenCalled();
    expect(autosave.getSnapshot()).toMatchObject({ dirty: true, busy: false, error: "Email 1 must be a valid email address." });
    autosave.setEmails("Parent@example.test; athlete@example.test");
    autosave.setDraft((draft) => ({ ...draft, athletes: [athlete("")] }));
    expect(await autosave.flush()).toBe(false);
    expect(autosave.getSnapshot().error).toBe("Athlete 1 full name is required.");
    autosave.setDraft((draft) => ({ ...draft, athletes: [athlete("Avery")] }));
    await vi.advanceTimersByTimeAsync(599);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].emails).toEqual(["parent@example.test", "athlete@example.test"]);
    expect(autosave.getSnapshot()).toMatchObject({ dirty: false, saved: true });
  });

  it("serializes edits during a slow save and carries the returned account version forward", async () => {
    const first = deferred();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (input: WorkshareAccount) => account({ ...input, updatedAt: "2026-11-18T19:00:02.000Z" }));
    const onSaved = vi.fn();
    const autosave = createAccountAutosave(account(), persist, onSaved);
    autosave.setDraft((draft) => ({ ...draft, generalHoursRequired: 8 }));
    const saving = autosave.flush();
    autosave.setDraft((draft) => ({ ...draft, generalHoursRequired: 9, isArchived: true }));
    expect(persist).toHaveBeenCalledTimes(1);
    first.resolve(account({ generalHoursRequired: 8, updatedAt: "2026-11-18T19:00:01.000Z" }));
    expect(await saving).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0]).toMatchObject({ generalHoursRequired: 9, isArchived: true, updatedAt: "2026-11-18T19:00:01.000Z" });
    expect(autosave.getSnapshot()).toMatchObject({ dirty: false, busy: false, saved: true });
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("creates once and preserves pending athlete edits when the API sorts athletes", async () => {
    const initial = account();
    delete initial.id;
    delete initial.updatedAt;
    const first = deferred();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (input: WorkshareAccount) => input);
    const autosave = createAccountAutosave(initial, persist, vi.fn());
    autosave.setDraft((draft) => ({ ...draft, athletes: [athlete("Zoe"), athlete("Avery")] }));
    const saving = autosave.flush();
    autosave.setDraft((draft) => ({ ...draft, athletes: draft.athletes.map((entry, index) => index === 0 ? { ...entry, fullName: "Zoe Edited", trainingGroup: "Seniors" } : entry) }));
    first.resolve(account({ athletes: [{ ...athlete("Avery"), id: "athlete-a" }, { ...athlete("Zoe"), id: "athlete-z" }] }));
    expect(await saving).toBe(true);
    expect(persist.mock.calls[0][0].id).toBeUndefined();
    expect(persist.mock.calls[1][0]).toMatchObject({ id: "account-1", updatedAt: "2026-11-18T19:00:00.000Z", athletes: [{ ...athlete("Zoe Edited"), trainingGroup: "Seniors", id: "athlete-z" }, { ...athlete("Avery"), id: "athlete-a" }] });
    expect(autosave.getSnapshot().draft.athletes.map((entry) => entry.fullName)).toEqual(["Zoe Edited", "Avery"]);
  });

  it("keeps a new athlete removal that occurs during its first save", async () => {
    const first = deferred();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (input: WorkshareAccount) => input);
    const autosave = createAccountAutosave(account(), persist, vi.fn());
    autosave.setDraft((draft) => ({ ...draft, athletes: [athlete("Zoe"), athlete("Avery")] }));
    const saving = autosave.flush();
    autosave.setDraft((draft) => ({ ...draft, athletes: draft.athletes.slice(1) }));
    first.resolve(account({ athletes: [{ ...athlete("Avery"), id: "athlete-a" }, { ...athlete("Zoe"), id: "athlete-z" }] }));
    expect(await saving).toBe(true);
    expect(persist.mock.calls[1][0].athletes).toEqual([{ ...athlete("Avery"), id: "athlete-a" }]);
  });

  it("keeps a failed draft and retries only after an edit or explicit flush", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockRejectedValueOnce(new Error("Save unavailable")).mockImplementation(async (input: WorkshareAccount) => input);
    const autosave = createAccountAutosave(account(), persist, vi.fn());
    autosave.setDraft((draft) => ({ ...draft, fullName: "Updated Account" }));
    expect(await autosave.flush()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(autosave.getSnapshot()).toMatchObject({ dirty: true, saved: false, error: "Save unavailable", draft: { fullName: "Updated Account" } });
    expect(await autosave.flush()).toBe(true);
    expect(autosave.getSnapshot()).toMatchObject({ dirty: false, saved: true, error: "" });
  });

  it("persists a return to the original value while another version is saving", async () => {
    const first = deferred();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (input: WorkshareAccount) => input);
    const autosave = createAccountAutosave(account(), persist, vi.fn());
    autosave.setDraft((draft) => ({ ...draft, generalHoursRequired: 5 }));
    const saving = autosave.flush();
    autosave.setDraft((draft) => ({ ...draft, generalHoursRequired: null }));
    first.resolve(account({ generalHoursRequired: 5, updatedAt: "2026-11-18T19:00:01.000Z" }));
    expect(await saving).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0]).toMatchObject({ generalHoursRequired: null, updatedAt: "2026-11-18T19:00:01.000Z" });
  });

  it("cancels a pending new draft and suppresses callbacks after unmount", async () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const autosave = createAccountAutosave(emptyAccount(), persist, vi.fn());
    autosave.setDraft((draft) => ({ ...draft, fullName: "Unsent" }));
    // Explicit Cancel resets a never-created account before unmounting.
    autosave.reset(emptyAccount());
    autosave.deactivate();
    await vi.advanceTimersByTimeAsync(1000);
    expect(persist).not.toHaveBeenCalled();
  });

  it("flushes a pending edit on navigation without notifying the departing editor", async () => {
    const persist = vi.fn(async (input: WorkshareAccount) => input);
    const onSaved = vi.fn();
    const listener = vi.fn();
    const autosave = createAccountAutosave(account(), persist, onSaved);
    autosave.subscribe(listener);
    autosave.setDraft((draft) => ({ ...draft, fullName: "Pending navigation edit" }));
    listener.mockClear();
    autosave.deactivate();
    expect(await autosave.flush()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].fullName).toBe("Pending navigation edit");
    expect(onSaved).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(autosave.getSnapshot()).toMatchObject({ dirty: false, saved: true });
  });

  it("drains in-flight edits when navigation unmounts the editor", async () => {
    const first = deferred();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (input: WorkshareAccount) => input);
    const onSaved = vi.fn();
    const autosave = createAccountAutosave(account(), persist, onSaved);
    autosave.setDraft((draft) => ({ ...draft, fullName: "Sending" }));
    const saving = autosave.flush();
    autosave.setDraft((draft) => ({ ...draft, fullName: "Queued" }));
    autosave.deactivate();
    first.resolve(account({ fullName: "Sending" }));
    expect(await saving).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0].fullName).toBe("Queued");
  });

  it("never repeats an uncertain create after edits, Retry, or navigation", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockRejectedValue(new WorkshareAccountSaveError("Lost response", true));
    const autosave = createAccountAutosave(emptyAccount(), persist, vi.fn());
    autosave.setDraft((draft) => ({ ...draft, fullName: "May already exist" }));
    expect(await autosave.flush()).toBe(false);
    autosave.setDraft((draft) => ({ ...draft, generalHoursRequired: 8 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await autosave.flush()).toBe(false);
    autosave.deactivate();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(autosave.getSnapshot()).toMatchObject({ dirty: true, reloadRequired: true, error: "Could not confirm this new account was saved. Reload accounts before making more changes." });
  });

  it("allows a corrected create after validation or a definite server rejection", async () => {
    const persist = vi.fn().mockRejectedValueOnce(new WorkshareAccountSaveError("Email rejected", false)).mockImplementation(async (input: WorkshareAccount) => account(input));
    const autosave = createAccountAutosave(emptyAccount(), persist, vi.fn());
    autosave.setEmails("not an email");
    expect(await autosave.flush()).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    autosave.setDraft((draft) => ({ ...draft, fullName: "Valid name" }));
    autosave.setEmails("parent@example.test");
    expect(await autosave.flush()).toBe(false);
    expect(autosave.getSnapshot().error).toBe("Email rejected");
    autosave.setEmails("another@example.test");
    expect(await autosave.flush()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("locks a create if its successful response cannot be reconciled", async () => {
    const persist = vi.fn().mockResolvedValue(account({ athletes: [] }));
    const autosave = createAccountAutosave(emptyAccount(), persist, vi.fn());
    autosave.setDraft((draft) => ({ ...draft, fullName: "Valid name", athletes: [athlete("Avery")] }));
    expect(await autosave.flush()).toBe(false);
    expect(await autosave.flush()).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(autosave.getSnapshot().error).toContain("Could not confirm this new account was saved");
  });
});
