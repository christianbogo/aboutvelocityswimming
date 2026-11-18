"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { Input } from "@/components/shared/Input";
import { Button } from "@/components/shared/Button";
import {
  saveRequirements,
  loadAccountSummaries,
  validateRequirements,
  type SeasonRequirements,
} from "../../lib/tickets";
import { useVersionedAutosave } from "../../lib/use-versioned-autosave";

export interface RequirementsHandle {
  flush: () => Promise<boolean>;
}
export const RequirementsEditor = forwardRef<
  RequirementsHandle,
  {
    requirements: SeasonRequirements;
    onSaved: (requirements: SeasonRequirements) => void;
  }
>(function RequirementsEditor({ requirements, onSaved }, ref) {
  const autosave = useVersionedAutosave(
    requirements,
    saveRequirements,
    validateRequirements,
    onSaved,
  );
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState("");
  async function reload() {
    if (autosave.busy || reloading) return;
    autosave.discard();
    setReloading(true);
    setReloadError("");
    try {
      const summaries = await loadAccountSummaries(requirements.seasonId);
      const latest = summaries.find(
        (item) => item.account.id === requirements.accountId,
      )?.requirements;
      if (!latest) throw new Error("This account is no longer available.");
      autosave.reset(latest);
      onSaved(latest);
    } catch (cause) {
      setReloadError(
        cause instanceof Error
          ? cause.message
          : "Unable to reload required hours.",
      );
    } finally {
      setReloading(false);
    }
  }
  useImperativeHandle(ref, () => ({ flush: autosave.flush }), [autosave.flush]);
  return (
    <fieldset disabled={reloading} className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ["generalHoursRequired", "General"],
            ["starlightHoursRequired", "Starlight"],
            ["appleCapitalHoursRequired", "Apple Capital"],
          ] as const
        ).map(([field, label]) => (
          <label
            key={field}
            className="grid w-full min-w-0 max-w-xs content-start gap-1 text-xs font-semibold leading-4"
          >
            <span>{label} hours required</span>
            <Input
              className="max-w-40"
              type="number"
              min={0}
              max={10000}
              step="0.01"
              placeholder="Unset"
              value={autosave.draft[field] ?? ""}
              onChange={(event) =>
                autosave.setDraft((draft) => ({
                  ...draft,
                  [field]:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>
      {(autosave.error || reloadError) && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-red-600"
        >
          <p>{reloadError || autosave.error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={autosave.busy}
            onClick={() => void autosave.flush()}
          >
            Retry required hours
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={autosave.busy || reloading}
            onClick={() => void reload()}
          >
            Reload required hours
          </Button>
        </div>
      )}
      {(autosave.busy || autosave.dirty || autosave.saved) && (
        <p role="status" className="text-xs text-text-secondary">
          {autosave.busy
            ? "Saving required hours…"
            : autosave.error
              ? "Required hours not saved"
              : autosave.dirty
                ? "Waiting to save required hours…"
                : "Required hours saved"}
        </p>
      )}
      {reloading && (
        <p role="status" className="text-xs text-text-secondary">
          Reloading required hours…
        </p>
      )}
    </fieldset>
  );
});
