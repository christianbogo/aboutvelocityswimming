"use client";

import { useState } from "react";
import { Button } from "@/components/shared/Button";
import {
  deleteTicket,
  saveTicket,
  validateTicketFields,
  type WorkshareSeason,
  type WorkshareTicket,
} from "../../lib/tickets";
import { useVersionedAutosave } from "../../lib/use-versioned-autosave";
import { TicketFields } from "./TicketFields";
import { TicketModal } from "./TicketModal";

type TicketDraft = WorkshareTicket & { hoursText: string };
function ticketValue(value: TicketDraft): WorkshareTicket {
  return {
    ...value,
    hours: Number(value.hoursText),
    description: value.description.trim(),
  };
}
async function persist(value: TicketDraft): Promise<TicketDraft> {
  const result = await saveTicket(ticketValue(value));
  return { ...result, hoursText: String(result.hours) };
}

export function TicketEditor({
  ticket,
  season,
  accountName,
  onChanged,
  onClose,
}: {
  ticket: WorkshareTicket;
  season: WorkshareSeason;
  accountName?: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const {
    draft,
    setDraft,
    busy,
    dirty,
    error,
    saved,
    flush,
    discard,
    getLatest,
  } = useVersionedAutosave<TicketDraft>(
    { ...ticket, hoursText: String(ticket.hours) },
    persist,
    (value) => validateTicketFields(ticketValue(value), season),
    () => onChanged(),
  );
  const [closing, setClosing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function close() {
    if (closing || deleting) return;
    setClosing(true);
    try {
      if (await flush()) onClose();
    } finally {
      setClosing(false);
    }
  }

  async function remove() {
    if (deleting || closing) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await flush();
      await deleteTicket(ticketValue(getLatest()));
      discard();
      onChanged();
      onClose();
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? cause.message : "Unable to delete the ticket.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <TicketModal
      title="Edit ticket"
      subtitle={[accountName, season.name].filter(Boolean).join(" · ")}
      onClose={() => void close()}
      closing={closing || deleting}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void flush();
        }}
        className="space-y-5"
      >
        <TicketFields
          value={{
            completedOn: draft.completedOn,
            description: draft.description,
            category: draft.category,
            hours: draft.hoursText,
          }}
          onChange={(changes) =>
            setDraft((previous) => ({
              ...previous,
              ...changes,
              hours: previous.hours,
              hoursText: changes.hours ?? previous.hoursText,
            }))
          }
          season={season}
          disabled={closing || deleting}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {deleteError && (
          <p role="alert" className="text-sm text-red-600">
            {deleteError}
          </p>
        )}
        {confirmDelete ? (
          <div className="space-y-3 rounded-xl border border-red-500/40 p-4">
            <p className="text-sm">
              Delete this ticket and its completed hours?
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={deleting || closing}
                onClick={() => void remove()}
              >
                {deleting ? "Deleting…" : "Delete ticket"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
              >
                Keep ticket
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={closing || deleting}
              onClick={() => void close()}
            >
              {closing ? "Finishing…" : "Done"}
            </Button>
            {error && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || closing}
                onClick={() => void flush()}
              >
                Retry save
              </Button>
            )}
            <p role="status" className="text-xs text-text-secondary">
              {busy
                ? "Saving…"
                : error
                  ? "Changes not saved"
                  : dirty
                    ? "Waiting to save…"
                    : saved
                      ? "All changes saved"
                      : "Changes save automatically"}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sm:ml-auto"
              disabled={closing}
              onClick={() => setConfirmDelete(true)}
            >
              Delete ticket
            </Button>
          </div>
        )}
        {error && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || closing || deleting}
            onClick={() => {
              discard();
              onClose();
            }}
          >
            Discard unsaved changes
          </Button>
        )}
      </form>
    </TicketModal>
  );
}
