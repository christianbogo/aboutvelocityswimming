"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import s from "./TimesSelectionDropdown.module.css";

export default function TimesSelectionDropdown({
  label,
  selection,
  highlighted = false,
  children,
}: {
  label: string;
  selection: string;
  highlighted?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div
      className={s.dropdown}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (
          event.pointerType === "mouse" &&
          !event.currentTarget
            .querySelector('[role="group"]')
            ?.contains(document.activeElement)
        )
          setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          event.currentTarget.querySelector("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        className={`${s.selection} ${highlighted ? s.highlighted : ""}`}
        aria-label={`${label}: ${selection}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => setOpen(event.detail === 0 ? !open : true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={s.selectionLabel}>{label}</span>
        <span className={s.selectionValue}>
          {selection}
          <ChevronDown size={16} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div
          id={id}
          className={s.dropdownOptions}
          role="group"
          aria-label={`${label} options`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
