"use client";

import styles from "./Accounts.module.css";
import { Input } from "@/components/shared/Input";
import {
  categoryLabels,
  defaultTicketDate,
  dateInSeason,
  ticketCategories,
  type WorkshareSeason,
  type WorkshareTicket,
} from "../../lib/tickets";

export interface TicketFieldValues {
  completedOn: string;
  description: string;
  category: WorkshareTicket["category"];
  hours: string;
}

export const fieldClass =
  "grid min-w-0 content-start gap-1 text-xs font-semibold leading-4";
export const selectClass =
  styles.select +
  " h-11 w-full min-w-0 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm text-text-primary transition-all focus-visible:border-[#0A856C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 disabled:opacity-60";

export function categoryLabel(category: WorkshareTicket["category"]) {
  return categoryLabels[category];
}

export function defaultTicketFields(
  season: WorkshareSeason,
  template?: WorkshareTicket,
): TicketFieldValues {
  return {
    completedOn:
      template && dateInSeason(template.completedOn, season)
        ? template.completedOn
        : defaultTicketDate(season),
    description: template?.description ?? "",
    category: template?.category ?? "general",
    hours: template ? String(template.hours) : "",
  };
}

export function displayWorkDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TicketFields({
  value,
  onChange,
  season,
  disabled = false,
}: {
  value: TicketFieldValues;
  onChange: (changes: Partial<TicketFieldValues>) => void;
  season: WorkshareSeason;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
      <div className="flex flex-wrap gap-4">
        <label className={`${fieldClass} w-full max-w-48`}>
          <span>Work date</span>
          <Input
            type="date"
            required
            value={value.completedOn}
            min={season.startsOn}
            max={season.endsOn}
            onChange={(event) => onChange({ completedOn: event.target.value })}
          />
        </label>
        <label className={`${fieldClass} w-full max-w-64`}>
          <span>Category</span>
          <select
            className={selectClass}
            value={value.category}
            onChange={(event) =>
              onChange({
                category: event.target.value as WorkshareTicket["category"],
              })
            }
          >
            {ticketCategories.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${fieldClass} w-full max-w-40`}>
          <span>Hours</span>
          <Input
            type="text"
            inputMode="decimal"
            required
            maxLength={12}
            autoComplete="off"
            placeholder="e.g. 2.5"
            value={value.hours}
            onChange={(event) => onChange({ hours: event.target.value })}
          />
        </label>
      </div>
      <label className={`${fieldClass} w-full max-w-xl`}>
        <span>Description</span>
        <textarea
          aria-label="Description"
          required
          rows={2}
          maxLength={500}
          className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm font-normal text-text-primary focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
          value={value.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </label>
    </fieldset>
  );
}
