import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bookmark as BookmarkIcon, Pencil } from "lucide-react";
import { useAuth } from "@/features/workshare/contexts/auth";
import { browserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { eventLabel, initialFilters, rounds, type Filters } from "./times-data";
import { timesUrl } from "./times-api";
import { normalizeRankingFilters, readTimesSelection } from "./times-url-state";
import s from "./RankingFilters.module.css";
import times from "./TimesDatabase.module.css";
import { SkeletonText } from "./LoadingSkeleton";

type Bookmark = Pick<
  Database["public"]["Tables"]["times_ranking_bookmarks"]["Row"],
  "id" | "name" | "filters" | "search"
>;
const bookmarkFields = "id,name,filters,search";

interface Props {
  filters: Filters;
  search: string;
  onApply: (filters: Filters, search: string) => void;
  children: ReactNode;
}

function filterKey(filters: Filters, search: string) {
  return timesUrl("rankings", {
    ...filters,
    search: search.trim().toLowerCase(),
  });
}

function selectionName(filters: Filters, search: string) {
  return [
    filters.event ? eventLabel(filters.event) : "All events",
    filters.course || "All courses",
    filters.genders
      .map((gender) => ({ F: "Girls", M: "Boys", X: "Mixed" })[gender])
      .join(" / "),
    filters.ageGroups.length ? filters.ageGroups.join(", ") : "All ages",
    filters.year ||
      (filters.startDate || filters.endDate
        ? `${filters.startDate || "All dates"}–${filters.endDate || "Present"}`
        : "All-time"),
    filters.round ? rounds[filters.round] || filters.round : "",
    search.trim(),
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 60);
}

export default function RankingFilters(props: Props) {
  const { user, loading } = useAuth();
  return (
    <RankingFilterPanel
      key={user?.uid}
      userId={user?.uid}
      authLoading={loading}
      {...props}
    />
  );
}

export function RankingFiltersSkeleton() {
  return (
    <div className={s.heading} aria-hidden="true">
      <span className={s.save}>
        <SkeletonText width={112} height={13} />
      </span>
    </div>
  );
}

function RankingFilterPanel({
  filters,
  search,
  onApply,
  children,
  userId,
  authLoading,
}: Props & { userId?: string; authLoading: boolean }) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [listRequest, setListRequest] = useState(0);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const addBookmark = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    async function loadBookmarks(ownerId: string) {
      try {
        const { data, error } = await browserClient()
          .from("times_ranking_bookmarks")
          .select(bookmarkFields)
          .eq("user_id", ownerId)
          .order("created_at")
          .order("id")
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error) throw error;
        setBookmarks(data);
        setListStatus("ready");
      } catch {
        if (!controller.signal.aborted) setListStatus("error");
      }
    }
    void loadBookmarks(userId);
    return () => controller.abort();
  }, [userId, listRequest]);

  function openEditor(bookmark: Bookmark | null) {
    setEditing(bookmark);
    setName(bookmark?.name ?? selectionName(filters, search));
    setError("");
    dialog.current?.showModal();
    nameInput.current?.focus();
  }

  async function saveBookmark(remove = false) {
    if (!userId || busy || (remove ? !editing : !name.trim())) return;
    setBusy(true);
    setError("");
    try {
      const table = browserClient().from("times_ranking_bookmarks");
      const query = editing
        ? (remove ? table.delete() : table.update({ name: name.trim() }))
            .eq("id", editing.id)
            .eq("user_id", userId)
        : table.insert({
            user_id: userId,
            name: name.trim(),
            filters: { ...filters },
            search,
          });
      const result = await query.select(bookmarkFields).single();
      if (result.error) throw result.error;
      const saved = result.data;
      setBookmarks((current) =>
        remove
          ? current.filter((bookmark) => bookmark.id !== saved.id)
          : editing
            ? current.map((bookmark) =>
                bookmark.id === saved.id ? saved : bookmark,
              )
            : [...current, saved],
      );
      setNotice(
        remove
          ? "Bookmark deleted."
          : editing
            ? "Bookmark renamed."
            : "Bookmark saved.",
      );
      dialog.current?.close();
      if (remove) addBookmark.current?.focus();
    } catch {
      setError(
        remove
          ? "Couldn’t delete this bookmark. Try again."
          : "Couldn’t save this bookmark. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const active = filterKey(filters, search);
  return (
    <section aria-label="Event ranking filters">
      {userId && listStatus === "error" && (
        <p className={times.notice} role="alert">
          Couldn’t load your bookmarks.{" "}
          <button
            type="button"
            className={times.link}
            onClick={() => {
              setListStatus("loading");
              setListRequest((request) => request + 1);
            }}
          >
            Try again
          </button>
        </p>
      )}
      <div className={s.heading}>
        <div className={s.bookmarkActions}>
          {bookmarks.length > 0 && (
            <ul className={s.bookmarks} aria-label="Bookmarked selections">
              {bookmarks.map((bookmark) => {
                const saved = normalizeRankingFilters(
                  readTimesSelection(
                    JSON.stringify(bookmark.filters),
                    initialFilters,
                  ),
                );
                return (
                  <li className={s.chip} key={bookmark.id}>
                    <button
                      type="button"
                      aria-pressed={
                        active === filterKey(saved, bookmark.search)
                      }
                      onClick={() => onApply(saved, bookmark.search)}
                    >
                      {bookmark.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit bookmark ${bookmark.name}`}
                      onClick={() => openEditor(bookmark)}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {authLoading || userId ? (
            <button
              ref={addBookmark}
              type="button"
              className={s.save}
              disabled={authLoading || listStatus !== "ready"}
              onClick={() => openEditor(null)}
            >
              <BookmarkIcon size={16} fill="currentColor" aria-hidden="true" />
              Add Bookmark
            </button>
          ) : (
            <Link className={times.link} href="/login">
              Sign in to bookmark selection
            </Link>
          )}
        </div>
      </div>
      {children}
      <p role="status" className="sr-only">
        {notice}
      </p>
      <dialog
        ref={dialog}
        className={`${times.eventDialog} ${s.dialog}`}
        aria-labelledby={`${id}-title`}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveBookmark();
          }}
        >
          <h2 id={`${id}-title`}>
            {editing ? "Rename bookmark" : "Add Bookmark"}
          </h2>
          <label className={times.field}>
            Bookmark name
            <input
              ref={nameInput}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              required
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          <div className={s.actions}>
            {editing && (
              <button
                type="button"
                className={s.delete}
                disabled={busy}
                onClick={() => void saveBookmark(true)}
              >
                Delete bookmark
              </button>
            )}
            <button
              type="button"
              className={times.button}
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={s.save}
              disabled={busy || !name.trim()}
            >
              {editing ? "Save name" : "Save bookmark"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
