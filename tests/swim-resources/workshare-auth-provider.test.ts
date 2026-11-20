// @vitest-environment jsdom
import { useContext } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { User } from "@/lib/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listener: undefined as undefined | ((user: User | null) => Promise<void>),
  membership: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  onAuthStateChanged: (
    _auth: unknown,
    listener: (user: User | null) => Promise<void>,
  ) => {
    mocks.listener = listener;
    return mocks.unsubscribe;
  },
  signOut: vi.fn(),
}));
vi.mock("@/features/workshare/lib/backend", () => ({ auth: {} }));
vi.mock("@/features/workshare/lib/family-membership", () => ({
  findFamilyMembership: mocks.membership,
}));
import { AuthProvider } from "@/features/workshare/contexts/AuthContext";
import { AuthContext } from "@/features/workshare/contexts/auth";
import { updatesBlocked } from "@/lib/update-safety";

const mount = () =>
  renderHook(() => useContext(AuthContext), { wrapper: AuthProvider });
let view: ReturnType<typeof mount>;
const state = () => view.result.current;
function account(uid = "staff", staff = true): User {
  return {
    uid,
    staff,
    email: `${uid}@example.test`,
    emailVerified: true,
    getIdToken: async () => "synthetic-token",
  };
}
function deferred() {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function publish(user: User | null) {
  await act(async () => {
    await mocks.listener!(user);
  });
}
async function beginPublish(user: User | null) {
  let done!: Promise<void>;
  await act(async () => {
    done = mocks.listener!(user);
  });
  return { done };
}
async function complete(
  request: ReturnType<typeof deferred>,
  pending: { done: Promise<void> },
  value: string | null,
) {
  await act(async () => {
    request.resolve(value);
    await pending.done;
  });
}
beforeEach(() => {
  mocks.listener = undefined;
  mocks.membership.mockReset().mockResolvedValue(null);
  mocks.unsubscribe.mockReset();
  view = mount();
});
afterEach(() => {
  cleanup();
  expect(updatesBlocked()).toBe(false);
});

describe("Workshare auth membership lifecycle", () => {
  it("blocks refresh until identity resolves, reacquires for account changes, and releases on unmount", async () => {
    expect(updatesBlocked()).toBe(true);
    const first = deferred();
    mocks.membership.mockReturnValueOnce(first.promise);
    const resolving = await beginPublish(account());
    expect(updatesBlocked()).toBe(true);
    await complete(first, resolving, "staff-family");
    expect(updatesBlocked()).toBe(false);
    const next = deferred();
    mocks.membership.mockReturnValueOnce(next.promise);
    const changing = await beginPublish(account("other"));
    expect(updatesBlocked()).toBe(true);
    view.unmount();
    expect(updatesBlocked()).toBe(false);
    await complete(next, changing, null);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("admits scoped Workshare staff without broad Tools staff authority", async () => {
    await publish({ ...account("domain-coach", false), workshareStaff: true });
    expect(state()).toMatchObject({ isAdmin: true, loading: false });
    const next = deferred();
    mocks.membership.mockReturnValueOnce(next.promise);
    const revoking = await beginPublish({
      ...account("domain-coach", false),
      workshareStaff: false,
    });
    expect(state().isAdmin).toBe(false);
    await complete(next, revoking, null);
    expect(state().isAdmin).toBe(false);
  });

  it("keeps staff authorization independent of family membership", async () => {
    const staff = account();
    await publish(staff);
    expect(state()).toMatchObject({
      user: staff,
      isAdmin: true,
      familyId: null,
      loading: false,
    });
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("refreshes membership without resetting staff access or an active client preview", async () => {
    const staff = account();
    mocks.membership.mockResolvedValueOnce("staff-family");
    await publish(staff);
    await act(async () => {
      state().setClientMode(true);
      state().setPreviewFamilyId("preview-family");
    });
    const next = deferred();
    mocks.membership.mockReturnValueOnce(next.promise);
    const refreshing = await beginPublish({ ...staff });
    expect(state()).toMatchObject({
      isAdmin: true,
      familyId: "preview-family",
      accountFamilyId: "staff-family",
      loading: false,
      clientMode: true,
      previewFamilyId: "preview-family",
    });
    await complete(next, refreshing, "updated-family");
    expect(state().familyId).toBe("preview-family");
    expect(state().accountFamilyId).toBe("updated-family");
    await act(async () => {
      state().setClientMode(false);
    });
    expect(state().familyId).toBe("updated-family");
    expect(mocks.membership).toHaveBeenCalledTimes(2);
  });

  it("ignores an older membership response after the account changes", async () => {
    const first = deferred(),
      second = deferred();
    mocks.membership
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const oldAccount = await beginPublish(account("first"));
    const newUser = account("second", false);
    const newAccount = await beginPublish(newUser);
    await complete(first, oldAccount, "old-family");
    expect(state()).toMatchObject({
      user: newUser,
      isAdmin: false,
      familyId: null,
      loading: true,
    });
    await complete(second, newAccount, "new-family");
    expect(state()).toMatchObject({
      user: newUser,
      isAdmin: false,
      familyId: "new-family",
      loading: false,
    });
  });

  it("clears staff preview when access is revoked and ignores a pending result after logout", async () => {
    const staff = account();
    await publish(staff);
    await act(async () => {
      state().setClientMode(true);
      state().setPreviewFamilyId("preview-family");
    });
    const next = deferred();
    mocks.membership.mockReturnValueOnce(next.promise);
    const revoking = await beginPublish({ ...staff, staff: false });
    expect(state()).toMatchObject({
      isAdmin: false,
      clientMode: false,
      previewFamilyId: null,
      familyId: null,
      loading: true,
    });
    await publish(null);
    await complete(next, revoking, "must-not-restore");
    expect(state()).toMatchObject({
      user: null,
      isAdmin: false,
      familyId: null,
      clientMode: false,
      loading: false,
    });
  });

  it("fails closed on membership errors while preserving verified staff access", async () => {
    const staff = account();
    mocks.membership.mockResolvedValueOnce("staff-family");
    await publish(staff);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Synthetic membership failure");
    mocks.membership.mockRejectedValueOnce(error);
    try {
      await publish({ ...staff });
      expect(state()).toMatchObject({
        user: staff,
        isAdmin: true,
        familyId: null,
        loading: false,
      });
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "Error fetching family membership:",
        error,
      );
    } finally {
      log.mockRestore();
    }
  });

  it("ignores membership completion after unmount", async () => {
    const next = deferred();
    mocks.membership.mockReturnValueOnce(next.promise);
    const pending = await beginPublish(account());
    const previous = state();
    view.unmount();
    await complete(next, pending, "must-not-restore");
    expect(state()).toBe(previous);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("balances update holds during React Strict Mode effect replay", async () => {
    view.unmount();
    mocks.unsubscribe.mockClear();
    view = renderHook(() => useContext(AuthContext), {
      wrapper: AuthProvider,
      reactStrictMode: true,
    });
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(updatesBlocked()).toBe(true);
    await publish(account());
    expect(updatesBlocked()).toBe(false);
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
  });
});
