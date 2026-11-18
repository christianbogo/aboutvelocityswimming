import type { CSSProperties, ReactNode } from "react";
import s from "./TimesLoading.module.css";

/** Decorative text shape; its parent keeps the final text's line height. */
export function SkeletonText({
  width = "75%",
  height,
  className = "",
  style,
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`${s.bar} ${s.text} ${className}`}
      style={{ width, height, ...style }}
    />
  );
}

export function SkeletonStatus({ children }: { children: ReactNode }) {
  return (
    <p className="sr-only" role="status">
      {children}
    </p>
  );
}
