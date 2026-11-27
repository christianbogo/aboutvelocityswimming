import { holdUpdates, withUpdateHold } from "./update-safety";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { browserClient, hasBackendConfiguration } from "./supabase/client";
export interface User {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  staff: boolean;
  /** Scoped Admin authority; does not grant access to the other Tools. */
  workshareStaff?: boolean;
  getIdToken(): Promise<string>;
}
export const auth: { currentUser: User | null } = { currentUser: null };
let generation = 0;
async function currentUser(user: SupabaseUser | null): Promise<User | null> {
  if (!user || user.is_anonymous) return null;
  let staff = false;
  let workshareStaff = false;
  if (user.email_confirmed_at) {
    try {
      const client = browserClient();
      const results = await Promise.allSettled([
        client.rpc("is_staff"),
        client.rpc("is_workshare_staff"),
      ]);
      [staff, workshareStaff] = results.map(
        (result) =>
          result.status === "fulfilled" &&
          !result.value.error &&
          result.value.data === true,
      );
    } catch {
      // A failed permission lookup cannot retain an earlier account's authority.
    }
  }
  return {
    uid: user.id,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    staff,
    workshareStaff,
    getIdToken: async () => {
      const { data } = await browserClient().auth.getSession();
      return data.session?.access_token ?? "";
    },
  };
}
type AuthListener = (user: User | null, loading: boolean) => void;
const listeners = new Set<AuthListener>();
let initialized = false;
let loading = true;
let subscription: { unsubscribe(): void } | undefined;
let eventTask: ReturnType<typeof setTimeout> | undefined;

function publish(user: User | null, pending = false) {
  auth.currentUser = user;
  loading = pending;
  listeners.forEach((callback) => callback(user, pending));
  if (!pending) window.dispatchEvent(new Event("velocity-auth"));
}

function sameIdentity(user: SupabaseUser) {
  const current = auth.currentUser;
  return (
    current?.uid === user.id &&
    current.email === (user.email ?? null) &&
    current.emailVerified === Boolean(user.email_confirmed_at) &&
    !user.is_anonymous
  );
}

async function resolveUser(user: SupabaseUser | null, version: number) {
  const result = await currentUser(user);
  if (version === generation) publish(result);
}

function initialize() {
  initialized = true;
  const version = ++generation;
  if (!hasBackendConfiguration) {
    queueMicrotask(() => {
      if (version === generation) publish(null);
    });
    return;
  }
  try {
    const client = browserClient();
    subscription = client.auth.onAuthStateChange((event, session) => {
      // getUser verifies the initial identity with Auth. INITIAL_SESSION is the
      // same startup notification from storage, not a second permission lookup.
      if (event === "INITIAL_SESSION") return;
      const nextVersion = ++generation;
      clearTimeout(eventTask);
      const user = session?.user ?? null;
      if (!user) {
        publish(null);
        return;
      }
      // Hide the previous account immediately, before any deferred RPC can finish.
      if (loading || !sameIdentity(user)) publish(null, true);
      // Keep database work outside the SDK's synchronous auth event callback.
      eventTask = setTimeout(() => {
        if (nextVersion === generation) void resolveUser(user, nextVersion);
      }, 0);
    }).data.subscription;
    void client.auth.getUser().then(
      ({ data, error }) => {
        if (version === generation)
          return resolveUser(error ? null : data.user, version);
      },
      () => {
        if (version === generation) publish(null);
      },
    );
  } catch {
    if (version === generation) publish(null);
  }
}

export function onAuthStateChanged(_auth: typeof auth, callback: AuthListener) {
  listeners.add(callback);
  if (!initialized && typeof window !== "undefined") initialize();
  queueMicrotask(() => {
    if (listeners.has(callback)) callback(auth.currentUser, loading);
  });
  return () => {
    listeners.delete(callback);
    // Strict Mode removes and re-adds the listener in one turn. Reuse that
    // subscription/bootstrap; a genuine unmount releases it and stale work.
    queueMicrotask(() => {
      if (listeners.size) return;
      generation++;
      clearTimeout(eventTask);
      subscription?.unsubscribe();
      subscription = undefined;
      initialized = false;
      auth.currentUser = null;
      loading = true;
    });
  };
}

export async function signOut(_auth = auth) {
  return withUpdateHold(async () => {
    const version = generation;
    const { error } = await browserClient().auth.signOut();
    if (error) throw error;
    // The SDK normally publishes SIGNED_OUT. Also settle a successful logout
    // without that event, but never overwrite a newer sign-in while awaiting it.
    if (version === generation) {
      generation++;
      clearTimeout(eventTask);
      publish(null);
    }
  });
}
export async function signInWithEmailAndPassword(
  _auth: typeof auth,
  email: string,
  password: string,
) {
  return withUpdateHold(async () => {
    const { data, error } = await browserClient().auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return { user: await currentUser(data.user) };
  });
}
export async function signInWithGoogle() {
  const release = holdUpdates();
  try {
    const { error } = await browserClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          window.location.origin +
          "/auth/callback?next=" +
          encodeURIComponent("/tools"),
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) throw error;
    // Successful OAuth navigates away. Keep refresh blocked until that happens.
    window.addEventListener("pageshow", release, { once: true });
  } catch (error) {
    release();
    throw error;
  }
}
