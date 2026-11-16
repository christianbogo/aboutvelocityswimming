import Image from "next/image";
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

export function RankLegend() {
  return (
    <aside className={s.legend} aria-label="USA Swimming motivational ranks">
      <span className={s.heading}>Motivational ranks</span>
      <ul className={s.ranks}>
        {motivationalRanks.map((rank) => (
          <li
            key={rank.tier}
            title={`USA Swimming ${rank.tier} motivational standard`}
          >
            <MotivationalRankIcon tier={rank.tier} size={20} decorative />
            <span>
              {rank.name} <strong>{rank.tier}</strong>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
