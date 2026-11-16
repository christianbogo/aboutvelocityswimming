import Image from "next/image";
import { formatSwimTime } from "@/features/swim-resources/lib/domain/swim-time";
import {
  motivationalRankForTier,
  motivationalRanks,
} from "./motivational-ranks";
import s from "./MotivationalRankIcon.module.css";

export function MotivationalRankIcon({
  tier,
  size = 24,
  decorative = false,
  className,
}: {
  tier: string;
  size?: number;
  decorative?: boolean;
  className?: string;
}) {
  const rank = motivationalRankForTier(tier);
  if (!rank) return null;
  const label = `${rank.name} rank: USA Swimming ${rank.tier} motivational standard`;
  return (
    <Image
      src={rank.icon}
      width={size}
      height={size}
      alt={decorative ? "" : label}
      title={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      className={`${s.icon}${className ? ` ${className}` : ""}`}
      unoptimized
    />
  );
}

export function RankLegend({
  counts,
  cutoffs,
  description,
}: {
  counts?: Partial<Record<string, number>>;
  cutoffs?: Partial<Record<string, number>>;
  description?: string;
}) {
  return (
    <aside className={s.legend} aria-label="USA Swimming motivational ranks">
      <ul className={s.ranks}>
        {motivationalRanks.map((rank) => {
          const count = counts ? (counts[rank.tier] ?? 0) : undefined;
          const cutoff = cutoffs?.[rank.tier];
          const metric =
            count !== undefined
              ? count.toLocaleString("en-US")
              : cutoffs
                ? cutoff && Number.isFinite(cutoff)
                  ? formatSwimTime(cutoff)
                  : "—"
                : undefined;
          const metricLabel =
            count !== undefined
              ? `${count} ${rank.name} ranks collected`
              : `${rank.name} cutoff: ${metric === "—" ? "unavailable" : metric}`;
          return (
            <li
              key={rank.tier}
              title={`USA Swimming ${rank.tier} motivational standard${metric !== undefined ? ` · ${metricLabel}` : ""}`}
            >
              {metric !== undefined && (
                <span className={s.value} aria-label={metricLabel}>
                  {metric}
                </span>
              )}
              <MotivationalRankIcon tier={rank.tier} size={20} decorative />
              <span className={s.label}>
                {rank.name} <strong>{rank.tier}</strong>
              </span>
            </li>
          );
        })}
      </ul>
      {description && <p className={s.description}>{description}</p>}
    </aside>
  );
}
