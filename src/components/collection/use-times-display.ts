"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/context";
import { browserClient } from "@/lib/supabase/client";
import { withUpdateHold } from "@/lib/update-safety";

const defaults = {
  show25s: false,
  showTimeStats: false,
  showDateAge: false,
};
type Display = typeof defaults;

export function useTimesDisplay() {
  const { user } = useAuth();
  const userId = user?.uid;
  const [display, setDisplay] = useState(defaults);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const current = useRef(defaults);
  const queue = useRef(Promise.resolve());
  const owner = useRef(userId);

  useEffect(() => {
    let active = true;
    owner.current = userId;
    if (!userId) return;
    void browserClient()
      .auth.getUser()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || data.user?.id !== userId) {
          setStatus("Could not load display preferences. Reload to try again.");
          return;
        }
        const saved = data.user.user_metadata.times_display;
        const next = { ...defaults };
        for (const key of Object.keys(defaults) as (keyof Display)[]) {
          if (typeof saved?.[key] === "boolean") next[key] = saved[key];
        }
        // Keep stats enabled for profiles that used either previous toggle.
        if (typeof saved?.showTimeStats !== "boolean") {
          next.showTimeStats =
            saved?.showTeamRanks === true || saved?.showRankIcon === true;
        }
        current.current = next;
        setDisplay(next);
        setReady(true);
      });
    return () => {
      active = false;
      owner.current = undefined;
    };
  }, [userId]);

  function change(key: keyof Display, checked: boolean) {
    if (!ready || !userId) return;
    const next = { ...current.current, [key]: checked };
    current.current = next;
    setDisplay(next);
    setStatus("Saving display preferences…");
    queue.current = queue.current.then(async () => {
      if (owner.current !== userId) return;
      try {
        await withUpdateHold(async () => {
          const { error } = await browserClient().auth.updateUser({
            data: { times_display: next },
          });
          if (error) throw error;
        });
        if (owner.current === userId && current.current === next)
          setStatus("Display preferences saved to profile.");
      } catch {
        if (owner.current === userId)
          setStatus(
            "Could not save display preferences. Change a toggle to try again.",
          );
      }
    });
  }

  return { ...display, change, status, ready };
}
