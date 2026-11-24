import { forwardRef, useId } from "react";
import { motivationalRankForTier } from "@/components/collection/motivational-ranks";
import type { buildLayout, LayoutKind } from "./geometry";

type Layout = ReturnType<typeof buildLayout>;

export const layoutOptions: {
  id: LayoutKind;
  label: string;
  description: string;
}[] = [
  {
    id: "strings",
    label: "Drilled dice strings",
    description: "One hanging string per swimmer",
  },
  {
    id: "sleeves",
    label: "10-slot sleeves",
    description: "Vertical segments, joined end to end",
  },
  {
    id: "trays",
    label: "My Times trays",
    description: "Six stroke columns with event pockets",
  },
];

export function measure(mm: number) {
  return `${(mm / 25.4).toLocaleString("en-US", { maximumFractionDigits: 1 })}″`;
}

const DraftCanvas = forwardRef<
  SVGSVGElement,
  {
    layout: Layout;
    kind: LayoutKind;
    detail?: boolean;
    athleteId?: string;
    selectedId?: string;
    onSelect?: (id: string) => void;
  }
>(({ layout, kind, detail = false, athleteId, selectedId, onSelect }, ref) => {
  const id = useId().replaceAll(":", "");
  const { board, dimensions: d, metrics } = layout;
  const member = athleteId
    ? layout.athletes.find((athlete) => athlete.id === athleteId)
    : undefined;
  const name = member
    ? layout.names.find((item) => item.athleteId === member.id)
    : undefined;
  const padding = member ? 8 : 36;
  const contentWidth = Math.max(member?.width ?? 0, name?.width ?? 0);
  const left = member && name ? name.x - contentWidth / 2 - padding : -padding;
  const top =
    member || detail ? board.height - d.nameBandMm - padding : -padding;
  const width = member
    ? contentWidth + padding * 2
    : layout.extent.width + padding * 2;
  const height = member
    ? member.drop + d.nameBandMm + padding * 2
    : layout.extent.height - top + padding;
  const visible = (entry: { athleteId: string }) =>
    !athleteId || entry.athleteId === athleteId;
  const title = member
    ? `${member.name}: ${member.diceCount} dice; ${measure(member.width)} holder width; ${measure(member.drop)} drop`
    : `${layoutOptions.find((option) => option.id === kind)?.label}: ${metrics.diceCount} dice; ${measure(metrics.requiredBoardWidthMm)} minimum board width; ${measure(metrics.longestDropMm)} longest drop`;
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${left} ${top} ${width} ${height}`}
      width={`${width}mm`}
      height={`${height}mm`}
      role="img"
      aria-labelledby={`${id}-title`}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <title id={`${id}-title`}>{title}</title>
      <defs>
        <clipPath id={`${id}-bounds`}>
          <rect x={left} y={top} width={width} height={height} />
        </clipPath>
        <pattern
          id={`${id}-grid`}
          width="25.4"
          height="25.4"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 25.4 0 L 0 0 0 25.4"
            fill="none"
            stroke="#dce4e8"
            strokeWidth="0.45"
          />
        </pattern>
      </defs>
      <g clipPath={`url(#${id}-bounds)`}>
        <rect x={left} y={top} width={width} height={height} fill="#f2f5f5" />
        <rect
          x={left}
          y={top}
          width={width}
          height={height}
          fill={`url(#${id}-grid)`}
        />
        <rect {...board} fill="#123d45" stroke="#0a2d35" strokeWidth="2" />
        {!detail && !member && (
          <g fontFamily="Arial, sans-serif">
            <text
              x={d.marginMm * 2}
              y={board.height * 0.14}
              fontSize={board.width * 0.037}
              fontWeight="800"
              letterSpacing={board.width * 0.001}
              fill="#f4f7e9"
            >
              VELOCITY
            </text>
            <text
              x={d.marginMm * 2}
              y={board.height * 0.195}
              fontSize={board.width * 0.01}
              letterSpacing="3"
              fill="#a8c2be"
            >
              OUR TEAM. OUR NEXT CHAPTER.
            </text>
            <rect
              x={d.marginMm * 2}
              y={board.height * 0.25}
              width={board.width * 0.59}
              height={board.height * 0.55}
              rx="8"
              fill="#33565b"
              stroke="#749092"
              strokeWidth="1"
            />
            <path
              d={`M${board.width * 0.17},${board.height * 0.6} l${board.width * 0.09},-${board.height * 0.16} l${board.width * 0.08},${board.height * 0.11} l${board.width * 0.06},-${board.height * 0.06} l${board.width * 0.1},${board.height * 0.18}`}
              fill="none"
              stroke="#7a9695"
              strokeWidth="3"
            />
            <text
              x={board.width * 0.32}
              y={board.height * 0.73}
              textAnchor="middle"
              fontSize={board.width * 0.008}
              letterSpacing="2"
              fill="#b6caca"
            >
              TEAM PHOTOS
            </text>
            <rect
              x={board.width * 0.65}
              y={board.height * 0.25}
              width={board.width * 0.31}
              height={board.height * 0.255}
              rx="8"
              fill="#edf0df"
            />
            <text
              x={board.width * 0.68}
              y={board.height * 0.32}
              fontSize={board.width * 0.012}
              fontWeight="700"
              fill="#163d44"
            >
              JOIN THE TEAM
            </text>
            <text
              x={board.width * 0.68}
              y={board.height * 0.37}
              fontSize={board.width * 0.008}
              fill="#64736b"
            >
              Registration information
            </text>
            {[0, 1, 2].map((n) => (
              <rect
                key={n}
                x={board.width * 0.68}
                y={board.height * (0.41 + n * 0.022)}
                width={board.width * (0.2 - n * 0.025)}
                height="2"
                fill="#b9c3b1"
              />
            ))}
            <rect
              x={board.width * 0.65}
              y={board.height * 0.54}
              width={board.width * 0.31}
              height={board.height * 0.26}
              rx="8"
              fill="#50746b"
            />
            <text
              x={board.width * 0.68}
              y={board.height * 0.615}
              fontSize={board.width * 0.01}
              fontWeight="700"
              fill="#eef4e5"
            >
              NEWS &amp; WHAT’S NEXT
            </text>
            <text
              x={board.width * 0.68}
              y={board.height * 0.665}
              fontSize={board.width * 0.0075}
              fill="#d0dfd2"
            >
              Marketing · meets · team updates
            </text>
            <text
              x={board.width / 2}
              y={board.height * 0.9}
              textAnchor="middle"
              fontSize={board.width * 0.006}
              fill="#9fb9b6"
            >
              CONTENT AREAS ARE PLACEHOLDERS · NAMES AND DICE USE REAL
              DIMENSIONS
            </text>
          </g>
        )}
        <rect
          x="0"
          y={board.height - d.nameBandMm}
          width={board.width}
          height={d.nameBandMm}
          fill="#edf0df"
        />
        {metrics.overflowMm > 0 && !member && (
          <g>
            <rect
              x={board.width}
              y={board.height - d.nameBandMm}
              width={metrics.overflowMm}
              height={d.nameBandMm}
              fill="#ffe4dc"
              stroke="#c34c38"
              strokeDasharray="4 3"
              strokeWidth="1"
            />
            <text
              x={board.width + metrics.overflowMm / 2}
              y={board.height - d.nameBandMm - 6}
              fill="#a63226"
              textAnchor="middle"
              fontSize="8"
              fontFamily="Arial"
            >
              BEYOND BOARD · {measure(metrics.overflowMm)}
            </text>
          </g>
        )}
        {layout.frames.filter(visible).map((frame) => (
          <rect
            key={frame.id}
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            rx={frame.kind === "slot" ? 0.7 : 1.5}
            fill={
              frame.kind === "slot" || frame.kind === "cell"
                ? "#f1f3ed"
                : "#c6d0c8"
            }
            stroke="#83978c"
            strokeWidth={frame.kind === "slot" ? 0.35 : 0.7}
          />
        ))}
        {layout.lines
          .filter((line) => !athleteId || line.id.startsWith(`${athleteId}:`))
          .map((line) => (
            <line
              key={line.id}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="#70817c"
              strokeWidth="0.7"
            />
          ))}
        {layout.labels
          .filter((label) => !athleteId || label.id.startsWith(`${athleteId}:`))
          .map((label) => (
            <text
              key={label.id}
              x={label.x}
              y={label.y}
              fontSize={label.fontSize}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#415650"
              fontFamily="monospace"
            >
              {label.text}
            </text>
          ))}
        {layout.dice.filter(visible).map((die) => {
          const rank = motivationalRankForTier(die.tier);
          return (
            <g key={die.id}>
              <title>{`${layout.athletes.find((athlete) => athlete.id === die.athleteId)?.name}: ${die.event.replace("_", " ")} ${die.course}, ${die.ageGroup}, ${die.tier}`}</title>
              <rect
                x={die.x}
                y={die.y}
                width={die.width}
                height={die.height}
                rx={die.width * 0.16}
                fill={rank?.color ?? "#64748b"}
                stroke="#192c35"
                strokeOpacity="0.3"
                strokeWidth="0.4"
              />
            </g>
          );
        })}
        {layout.names.filter(visible).map((item) => (
          <g
            key={item.athleteId}
            onClick={onSelect ? () => onSelect(item.athleteId) : undefined}
            style={{ cursor: onSelect ? "pointer" : undefined }}
          >
            {selectedId === item.athleteId && (
              <rect
                x={item.x - item.width / 2 - 2}
                y={item.y - item.fontSize}
                width={item.width + 4}
                height={item.fontSize * 2}
                rx="1"
                fill="#cae4bf"
              />
            )}
            <text
              x={item.x}
              y={item.y}
              fontSize={item.fontSize}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="monospace"
              fill="#1e3e37"
            >
              {item.text}
            </text>
          </g>
        ))}
        {!member && (
          <g
            fill="#526a6c"
            stroke="#869b9c"
            strokeWidth="0.6"
            fontFamily="Arial"
            fontSize="8"
            textAnchor="middle"
          >
            {!detail && (
              <>
                <path
                  d={`M0,-12 V-22 M0,-17 H${board.width} M${board.width},-12 V-22`}
                  fill="none"
                />
                <text x={board.width / 2} y="-23" stroke="none">
                  BOARD WIDTH · {measure(board.width)}
                </text>
              </>
            )}
            <line
              x1="0"
              y1={layout.extent.height + 12}
              x2="254"
              y2={layout.extent.height + 12}
              strokeWidth="2"
            />
            <text x="127" y={layout.extent.height + 24} stroke="none">
              10 inches / 254 mm
            </text>
          </g>
        )}
      </g>
    </svg>
  );
});
DraftCanvas.displayName = "DraftCanvas";
export default DraftCanvas;
