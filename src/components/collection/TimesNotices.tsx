import { hasBackendConfiguration } from "@/lib/supabase/client";
import type { useTimes } from "./use-times";
import s from "./TimesDatabase.module.css";

export function TimesConfigurationNotice() {
  return hasBackendConfiguration ? null : (
    <div className={s.notice} role="status">
      The times database is not connected yet. Approved results will appear here
      once it is available.
    </div>
  );
}

export function QueryNotice({ query }: { query: ReturnType<typeof useTimes> }) {
  return query.loading ? (
    <p className="sr-only" role="status">
      Loading results…
    </p>
  ) : query.error ? (
    <p className={s.notice} role="alert">
      {query.error}{" "}
      <button className={s.link} onClick={query.retry}>
        Try again
      </button>
    </p>
  ) : null;
}
