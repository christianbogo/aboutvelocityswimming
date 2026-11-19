"use client";

import { useRef, useState, type RefObject } from "react";
import styles from "./Accounts.module.css";

export function AccountPaneDivider({
  container,
  value,
  onChange,
  editorId,
}: {
  container: RefObject<HTMLDivElement | null>;
  value: number;
  onChange: (value: number) => void;
  editorId: string;
}) {
  const pointer = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  function resize(next: number) {
    const width = container.current?.getBoundingClientRect().width;
    if (!width) return;
    const minimum = Math.max(25, (340 / width) * 100);
    const maximum = Math.min(65, ((width - 388) / width) * 100);
    onChange(Math.max(minimum, Math.min(maximum, next)));
  }
  function stop() {
    pointer.current = null;
    setDragging(false);
  }
  return (
    <div
      role="separator"
      aria-label="Resize account editor"
      aria-orientation="vertical"
      aria-controls={editorId}
      aria-valuemin={25}
      aria-valuemax={65}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} percent account list`}
      tabIndex={0}
      className={styles.paneDivider}
      data-dragging={dragging}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = event.pointerId;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (pointer.current !== event.pointerId) return;
        const bounds = container.current?.getBoundingClientRect();
        if (bounds)
          resize(((event.clientX - bounds.left) / bounds.width) * 100);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => resize(45)}
      onKeyDown={(event) => {
        if (
          !["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        resize(
          event.key === "Home"
            ? 25
            : event.key === "End"
              ? 65
              : event.key === "Enter"
                ? 45
                : value + (event.key === "ArrowLeft" ? -3 : 3),
        );
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
