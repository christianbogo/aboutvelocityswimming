// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type {
  AuthChangeEvent,
  Session,
  User as SupabaseUser,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  signOut: vi.fn(),
  listeners: new Set<
    (event: AuthChangeEvent, session: Session | null) => void
  >(),
}));
vi.mock("@/lib/supabase/client", () => ({
  hasBackendConfiguration: true,
  browserClient: () => ({
    auth: {
      getUser: mocks.getUser,
      onAuthStateChange: mocks.subscribe,
      signOut: mocks.signOut,
    },
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));
import { AuthProvider } from "@/features/auth/AuthProvider";
import { AuthContext, useAuth } from "@/features/auth/context";
import { AuthContext as LegacyContext } from "@/features/workshare/contexts/auth";
import { AuthProvider as LegacyProvider } from "@/features/workshare/contexts/AuthContext";
import { auth } from "@/lib/auth";
import { updatesBlocked } from "@/lib/update-safety";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function user(id = "first"): SupabaseUser {
  return {
    id,
    email: `${id}@example.test`,
    email_confirmed_at: "2026-01-01",
    is_anonymous: false,
  } as SupabaseUser;
}
function emit(event: AuthChangeEvent, account: SupabaseUser | null) {
  const session = account ? ({ user: account } as Session) : null;
  mocks.listeners.forEach((listener) => listener(event, session));
}
const mount = (reactStrictMode = false) =>
  renderHook(useAuth, { wrapper: AuthProvider, reactStrictMode });
type IdentityResult = {
  data: { user: SupabaseUser | null };
  error: Error | null;
};
let bootstrap: ReturnType<typeof deferred<IdentityResult>>;
let view: ReturnType<typeof mount>;
async function resolveBootstrap(account = user()) {
  await act(async () => {
    bootstrap.resolve({ data: { user: account }, error: null });
  });
}
async function event(event: AuthChangeEvent, account: SupabaseUser | null) {
  await act(async () => {
    emit(event, account);
    await vi.advanceTimersByTimeAsync(0);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  bootstrap = deferred<IdentityResult>();
  mocks.getUser.mockReturnValue(bootstrap.promise);
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mocks.subscribe.mockImplementation((listener) => {
    mocks.listeners.add(listener);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            mocks.unsubscribe();
            mocks.listeners.delete(listener);
          },
        },
      },
    };
  });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  expect(mocks.listeners.size).toBe(0);
  expect(updatesBlocked()).toBe(false);
  vi.useRealTimers();
});

describe("application authentication", () => {
  it("verifies bootstrap once and ignores duplicate INITIAL_SESSION permission work", async () => {
    view = mount();
    expect(view.result.current.loading).toBe(true);
    expect(updatesBlocked()).toBe(true);
    await event("INITIAL_SESSION", user("stored"));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(view.result.current.user).toBeNull();
    await resolveBootstrap();
    expect(view.result.current).toMatchObject({
      loading: false,
      isAdmin: true,
      user: { uid: "first" },
    });
    await event("INITIAL_SESSION", user("stored"));
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "is_staff",
      "is_workshare_staff",
    ]);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(updatesBlocked()).toBe(false);
  });

  it("shares the pending bootstrap across Strict Mode effect replay", async () => {
    view = mount(true);
    await act(async () => {});
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(view.result.current.loading).toBe(true);
    await resolveBootstrap();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    view.unmount();
    await Promise.resolve();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not restore a user when sign-out supersedes a pending server bootstrap", async () => {
    view = mount();
    await event("SIGNED_OUT", null);
    await resolveBootstrap();
    expect(view.result.current).toMatchObject({
      user: null,
      isAdmin: false,
      loading: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses the newer sign-in when a different bootstrap identity completes later", async () => {
    view = mount();
    await event("SIGNED_IN", user("new"));
    await resolveBootstrap(user("old"));
    expect(view.result.current.user?.uid).toBe("new");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("hides the old account immediately and ignores its pending permission response", async () => {
    view = mount();
    await resolveBootstrap();
    const oldPermission = deferred<{ data: boolean; error: null }>();
    mocks.rpc
      .mockReturnValueOnce(oldPermission.promise)
      .mockReturnValueOnce(oldPermission.promise);
    await event("TOKEN_REFRESHED", user());
    act(() => emit("SIGNED_IN", user("new")));
    expect(view.result.current).toMatchObject({
      user: null,
      isAdmin: false,
      loading: true,
    });
    expect(auth.currentUser).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.result.current.user?.uid).toBe("new");
    await act(async () => {
      oldPermission.resolve({ data: true, error: null });
    });
    expect(view.result.current.user?.uid).toBe("new");
    expect(auth.currentUser?.uid).toBe("new");
  });

  it.each(["SIGNED_IN", "TOKEN_REFRESHED"] as const)(
    "keeps an editor ready during same-identity %s, then applies permission revocation",
    async (name) => {
      view = mount();
      await resolveBootstrap();
      const permission = deferred<{ data: boolean; error: null }>();
      mocks.rpc
        .mockReturnValueOnce(permission.promise)
        .mockReturnValueOnce(permission.promise);
      await event(name, user());
      expect(view.result.current).toMatchObject({
        loading: false,
        isAdmin: true,
        user: { uid: "first" },
      });
      expect(updatesBlocked()).toBe(false);
      await act(async () => {
        permission.resolve({ data: false, error: null });
      });
      expect(view.result.current).toMatchObject({
        loading: false,
        isAdmin: false,
        user: { uid: "first", staff: false, workshareStaff: false },
      });
    },
  );

  it("cannot restore revoked permissions from an older same-user request", async () => {
    view = mount();
    await resolveBootstrap();
    const oldPermission = deferred<{ data: boolean; error: null }>();
    mocks.rpc
      .mockReturnValueOnce(oldPermission.promise)
      .mockReturnValueOnce(oldPermission.promise);
    await event("TOKEN_REFRESHED", user());
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await event("USER_UPDATED", user());
    expect(view.result.current.isAdmin).toBe(false);
    await act(async () => {
      oldPermission.resolve({ data: true, error: null });
    });
    expect(view.result.current.isAdmin).toBe(false);
  });

  it("sign-out invalidates queued events and in-flight permission RPCs", async () => {
    view = mount();
    const permission = deferred<{ data: boolean; error: null }>();
    mocks.rpc.mockReturnValue(permission.promise);
    await resolveBootstrap();
    act(() => {
      emit("SIGNED_IN", user("queued"));
      emit("SIGNED_OUT", null);
    });
    await act(async () => {
      permission.resolve({ data: true, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.result.current).toMatchObject({
      user: null,
      isAdmin: false,
      loading: false,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("finishes loading when bootstrap rejects and can recover on a later sign-in", async () => {
    view = mount();
    await act(async () => {
      bootstrap.reject(new Error("offline"));
    });
    expect(view.result.current).toMatchObject({ user: null, loading: false });
    expect(updatesBlocked()).toBe(false);
    await event("SIGNED_IN", user());
    expect(view.result.current).toMatchObject({
      isAdmin: true,
      loading: false,
    });
  });

  it("does not accept bootstrap user data returned alongside an Auth error", async () => {
    view = mount();
    await act(async () => {
      bootstrap.resolve({
        data: { user: user() },
        error: new Error("invalid session"),
      });
    });
    expect(view.result.current).toMatchObject({ user: null, loading: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("clears permissions on rejected or failed RPCs without trapping the account in loading", async () => {
    view = mount();
    await resolveBootstrap();
    mocks.rpc
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        data: true,
        error: { message: "Permission query failed" },
      });
    await event("TOKEN_REFRESHED", user());
    expect(view.result.current).toMatchObject({
      loading: false,
      isAdmin: false,
      user: { uid: "first", staff: false, workshareStaff: false },
    });
    expect(updatesBlocked()).toBe(false);
  });

  it("preserves scoped Workshare authority when broad staff lookup fails", async () => {
    mocks.rpc
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: true, error: null });
    view = mount();
    await resolveBootstrap();
    expect(view.result.current).toMatchObject({
      isAdmin: true,
      user: { staff: false, workshareStaff: true },
    });
  });

  it("does not restore a session after the final subscriber unmounts", async () => {
    view = mount();
    view.unmount();
    await Promise.resolve();
    await resolveBootstrap();
    expect(auth.currentUser).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("settles successful sign-out even if the SDK sends no event", async () => {
    view = mount();
    await resolveBootstrap();
    mocks.signOut.mockResolvedValue({ error: null });
    await act(async () => {
      await view.result.current.logout();
    });
    expect(view.result.current).toMatchObject({
      user: null,
      isAdmin: false,
      loading: false,
    });
    expect(auth.currentUser).toBeNull();
  });

  it("does not overwrite a newer sign-in when an older sign-out request finishes", async () => {
    view = mount();
    await resolveBootstrap();
    const logout = deferred<{ error: null }>();
    mocks.signOut.mockReturnValue(logout.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.logout();
    });
    await event("SIGNED_OUT", null);
    await event("SIGNED_IN", user("new"));
    await act(async () => {
      logout.resolve({ error: null });
      await pending;
    });
    expect(view.result.current.user?.uid).toBe("new");
    expect(auth.currentUser?.uid).toBe("new");
  });

  it("rejects anonymous identities and never grants unverified staff authority", async () => {
    view = mount();
    await resolveBootstrap({ ...user(), is_anonymous: true });
    expect(view.result.current).toMatchObject({
      user: null,
      isAdmin: false,
      loading: false,
    });
    await event("USER_UPDATED", { ...user(), email_confirmed_at: undefined });
    expect(view.result.current).toMatchObject({
      isAdmin: false,
      user: { emailVerified: false },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps compatibility exports on the same application context", () => {
    expect(LegacyContext).toBe(AuthContext);
    expect(LegacyProvider).toBe(AuthProvider);
  });
});
