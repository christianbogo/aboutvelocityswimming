"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  Info,
  LoaderCircle,
  RefreshCw,
  Ruler,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/features/workshare/contexts/auth";
import { isToolsAdmin } from "@/lib/tools-access";
import { hasBackendConfiguration } from "@/lib/supabase/client";
import type { DraftingSnapshot } from "@/lib/layout-drafting/types";
import { eventLabel } from "@/components/collection/times-data";
import {
  awardRules,
  countColors,
  planAwards,
  type AwardRule,
  type CourseScope,
} from "./awards";
import { buildLayout, defaultDimensions, type LayoutKind } from "./geometry";
import DraftCanvas, { layoutOptions, measure } from "./DraftCanvas";
import s from "./LayoutDrafting.module.css";

const number = (value: number) => value.toLocaleString("en-US");

function NumericField({
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft !== null && draft.trim() && Number.isFinite(Number(draft)))
      onChange(Math.min(max, Math.max(min, Number(draft))));
    setDraft(null);
  }
  return (
    <label className={s.field}>
      <span>{label}</span>
      <div className={s.numberInput}>
        <input
          aria-label={label}
          type="number"
          value={draft ?? Number(value.toFixed(3))}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className={s.page}>
      <header className={s.header}>
        <div>
          <div className={s.eyebrow}>
            <Ruler size={15} /> THE PHYSICAL PROJECT <span>ADMIN TOOL</span>
          </div>
          <h1>
            Layout Drafting<span>.</span>
          </h1>
          <p>A little planning before you build something big.</p>
        </div>
        <span className={s.draftBadge}>
          <span /> Planning only
        </span>
      </header>
      {children}
    </main>
  );
}

function Planner() {
  const [result, setResult] = useState<{
    data?: DraftingSnapshot;
    error?: string;
  }>({});
  const [attempt, setAttempt] = useState(0);
  const [rule, setRule] = useState<AwardRule>("age-best");
  const [course, setCourse] = useState<CourseScope>("all");
  const [kind, setKind] = useState<LayoutKind>("strings");
  const [group, setGroup] = useState("");
  const [dimensions, setDimensions] = useState(defaultDimensions);
  const [inventory, setInventory] = useState(2000);
  const [view, setView] = useState<"board" | "edge">("board");
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/times/layout-drafting", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.data)
          throw new Error(body.error || "The roster could not be loaded.");
        if (!controller.signal.aborted) setResult({ data: body.data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            error:
              error instanceof Error
                ? error.message
                : "The roster could not be loaded.",
          });
      });
    return () => controller.abort();
  }, [attempt]);
  const data = result.data;
  const athletes = useMemo(
    () =>
      data?.athletes.filter(
        (athlete) => !group || athlete.trainingGroups.includes(group),
      ) ?? [],
    [data, group],
  );
  const plans = useMemo(
    () => planAwards(athletes, rule, course),
    [athletes, rule, course],
  );
  const layouts = useMemo(
    () =>
      layoutOptions.map((option) => ({
        ...option,
        layout: buildLayout(plans, option.id, dimensions),
      })),
    [plans, dimensions],
  );
  const layout = layouts.find((option) => option.id === kind)!.layout;
  const colors = useMemo(() => countColors(plans), [plans]);
  const comparisons = useMemo(
    () =>
      awardRules.map((option) => {
        const awards = planAwards(athletes, option.id, course);
        return {
          ...option,
          string: buildLayout(awards, "strings", dimensions),
          sleeve: buildLayout(awards, "sleeves", dimensions),
          tray: buildLayout(awards, "trays", dimensions),
        };
      }),
    [athletes, course, dimensions],
  );
  const selection =
    plans.find((athlete) => athlete.id === selected) ?? plans[0];
  const selectedSource = athletes.find(
    (athlete) => athlete.id === selection?.id,
  );
  const selectedLayout = layout.athletes.find(
    (athlete) => athlete.id === selection?.id,
  );
  const count = layout.metrics.diceCount;
  const totalHeight = dimensions.boardHeightMm + layout.metrics.longestDropMm;
  const updateDimension = (key: keyof typeof dimensions, value: number) =>
    setDimensions((current) => ({ ...current, [key]: value }));
  const selectedRule = awardRules.find((item) => item.id === rule)!;

  function exportSvg() {
    if (!svg.current) return;
    const clone = svg.current.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute("style");
    const description = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "desc",
    );
    description.textContent = `${selectedRule.description} ${course === "all" ? "All courses" : "SCY only"}; ${athletes.length} athletes; board ${measure(dimensions.boardWidthMm)} × ${measure(dimensions.boardHeightMm)}; ${dimensions.dieSizeMm} mm dice; as of ${data?.asOf}. ${data?.basis.standards}`;
    clone.prepend(description);
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], {
        type: "image/svg+xml;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `velocity-layout-${kind}-${rule}-${course}.svg`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportStatus(
      "SVG exported with physical dimensions. Print at 100% to retain scale.",
    );
  }

  if (!data)
    return (
      <section className={s.notice} role={result.error ? "alert" : "status"}>
        {result.error ? (
          <>
            <Info size={22} />
            <h2>We couldn’t load the roster</h2>
            <p>{result.error}</p>
            <button
              className={s.button}
              onClick={() => {
                setResult({});
                setAttempt((value) => value + 1);
              }}
            >
              <RefreshCw size={15} /> Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className={s.spin} size={25} />
            <h2>Measuring up the team…</h2>
            <p>
              Loading the active competitive roster and published achievement
              history.
            </p>
          </>
        )}
      </section>
    );

  return (
    <>
      <div className={s.rosterBar}>
        <div>
          <UsersRound size={19} />
          <strong>{number(data.athletes.length)} competitive athletes</strong>
          <span>Prep · Age Groupers · Juniors · Seniors</span>
        </div>
        <span>Roster as of {data.asOf}</span>
      </div>
      <div className={s.workspace}>
        <aside className={s.controls} aria-label="Draft settings">
          <div className={s.panelHeading}>
            <SlidersHorizontal size={17} />
            <h2>Set up your draft</h2>
          </div>
          <section className={s.controlSection}>
            <div className={s.step}>
              <span>01</span>
              <h3>What earns a die?</h3>
            </div>
            <div className={s.ruleList}>
              {awardRules.map((option) => (
                <label
                  key={option.id}
                  className={s.rule}
                  data-selected={rule === option.id}
                >
                  <input
                    type="radio"
                    name="award-rule"
                    value={option.id}
                    checked={rule === option.id}
                    onChange={() => setRule(option.id)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
            <label className={s.switch}>
              <input
                type="checkbox"
                checked={course === "SCY"}
                onChange={(event) =>
                  setCourse(event.target.checked ? "SCY" : "all")
                }
              />
              <span>SCY achievements only</span>
            </label>
            <p className={s.hint}>
              {course === "all"
                ? "SCY, LCM, and SCM each earn their own dice."
                : "LCM and SCM achievements are excluded."}
            </p>
          </section>
          <section className={s.controlSection}>
            <div className={s.step}>
              <span>02</span>
              <h3>The physical pieces</h3>
            </div>
            <div className={s.fields}>
              <NumericField
                label="Board width"
                unit="in"
                value={dimensions.boardWidthMm / 25.4}
                min={12}
                max={600}
                onChange={(value) =>
                  updateDimension("boardWidthMm", value * 25.4)
                }
              />
              <NumericField
                label="Board height"
                unit="in"
                value={dimensions.boardHeightMm / 25.4}
                min={12}
                max={120}
                onChange={(value) =>
                  updateDimension("boardHeightMm", value * 25.4)
                }
              />
              <NumericField
                label="Die size"
                unit="mm"
                value={dimensions.dieSizeMm}
                min={4}
                max={40}
                onChange={(value) => updateDimension("dieSizeMm", value)}
              />
              <NumericField
                label="Dice on hand"
                unit="dice"
                value={inventory}
                min={0}
                max={100000}
                onChange={setInventory}
              />
            </div>
            <p className={s.hint}>
              16 mm blank dice confirmed. The starting 96 × 48″ board is an
              adjustable assumption.
            </p>
            <details className={s.details}>
              <summary>
                Spacing &amp; fabrication <ChevronDown size={14} />
              </summary>
              <div className={s.fields}>
                <NumericField
                  label="Die gap / clearance"
                  unit="mm"
                  value={dimensions.gapMm}
                  min={0}
                  max={10}
                  step={0.5}
                  onChange={(value) => updateDimension("gapMm", value)}
                />
                <NumericField
                  label="Printed wall"
                  unit="mm"
                  value={dimensions.wallMm}
                  min={0.5}
                  max={8}
                  step={0.5}
                  onChange={(value) => updateDimension("wallMm", value)}
                />
                <NumericField
                  label="Between athletes"
                  unit="mm"
                  value={dimensions.athleteGapMm}
                  min={0}
                  max={100}
                  onChange={(value) => updateDimension("athleteGapMm", value)}
                />
                <NumericField
                  label="Name text"
                  unit="pt"
                  value={(dimensions.nameFontMm * 72) / 25.4}
                  min={4}
                  max={24}
                  step={0.5}
                  onChange={(value) =>
                    updateDimension("nameFontMm", (value * 25.4) / 72)
                  }
                />
              </div>
              <p className={s.hint}>
                Names are evenly spaced; minimum width uses the widest holder or
                name for every swimmer. Pocket clearance is on each side of the
                die. A front-view size study. Hole diameter, fit tolerance,
                connectors, and print strength still need a prototype.
              </p>
            </details>
          </section>
          <section className={s.controlSection}>
            <div className={s.step}>
              <span>03</span>
              <h3>Who’s on the board?</h3>
            </div>
            <label className={s.field}>
              <span>Training group</span>
              <select
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <option value="">All competitive athletes</option>
                {data.groups.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <p className={s.hint}>
              Every active swimmer gets a name, including swimmers with no
              assigned dice.
            </p>
          </section>
        </aside>
        <div className={s.drafting}>
          <div className={s.layoutCards} aria-label="Physical layout">
            {layouts.map((option) => (
              <button
                key={option.id}
                className={s.layoutCard}
                data-selected={kind === option.id}
                onClick={() => setKind(option.id)}
                aria-pressed={kind === option.id}
              >
                <div className={s.cardTop}>
                  <MiniLayout kind={option.id} />
                  <span className={s.radioMark}>
                    {kind === option.id && <Check size={11} />}
                  </span>
                </div>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
                <div className={s.cardDimensions}>
                  <span>
                    {measure(option.layout.metrics.requiredBoardWidthMm)} min.
                    width
                  </span>
                  <span>
                    {measure(option.layout.metrics.longestDropMm)} drop
                  </span>
                </div>
              </button>
            ))}
          </div>
          <section className={s.preview} aria-label="To-scale board preview">
            <div className={s.previewToolbar}>
              <div>
                <span className={s.liveDot} />
                <strong>Your board, to scale</strong>
              </div>
              <div className={s.previewActions}>
                <div className={s.segment}>
                  <button
                    aria-pressed={view === "board"}
                    onClick={() => setView("board")}
                  >
                    Full board
                  </button>
                  <button
                    aria-pressed={view === "edge"}
                    onClick={() => setView("edge")}
                  >
                    Names &amp; dice
                  </button>
                </div>
                <select
                  aria-label="Preview zoom"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                >
                  {[1, 2, 4, 8, 16].map((value) => (
                    <option key={value} value={value}>
                      {value === 1 ? "Fit" : `${value}× zoom`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={s.canvasViewport}>
              <div
                className={s.canvas}
                data-fit={zoom === 1}
                style={{ width: `${zoom * 100}%` }}
              >
                <DraftCanvas
                  ref={svg}
                  layout={layout}
                  kind={kind}
                  detail={view === "edge"}
                  selectedId={selection?.id}
                  onSelect={setSelected}
                />
              </div>
            </div>
            <div className={s.previewFooter}>
              <span>
                1 grid square = 1 inch · proportions preserved at every zoom
              </span>
              <button onClick={exportSvg}>
                <ArrowDownToLine size={14} /> Export SVG
              </button>
            </div>
          </section>
          <div
            className={s.fitNotice}
            data-overflow={layout.metrics.overflowMm > 0}
          >
            {layout.metrics.overflowMm > 0 ? (
              <>
                <ArrowUpRight size={19} />
                <div>
                  <strong>
                    This layout needs{" "}
                    {measure(layout.metrics.requiredBoardWidthMm)} of board
                    width.
                  </strong>
                  <p>
                    That’s {measure(layout.metrics.overflowMm)} beyond this
                    board. The preview keeps the dice at their true size. Try a
                    wider board, a smaller group, or another layout.
                  </p>
                </div>
              </>
            ) : (
              <>
                <Check size={19} />
                <div>
                  <strong>
                    All {plans.length} names and holders fit across this board.
                  </strong>
                  <p>
                    {measure(layout.metrics.pitchMm)} between athlete centers ·
                    allow {measure(totalHeight)} total wall height, including
                    the hanging dice.
                  </p>
                </div>
              </>
            )}
          </div>
          <div className={s.metrics}>
            <Metric
              label="Dice needed"
              value={number(count)}
              detail={
                count > inventory
                  ? `${number(count - inventory)} more than on hand`
                  : `${number(inventory - count)} left from ${number(inventory)}`
              }
              warning={count > inventory}
            />
            <Metric
              label="Longest drop"
              value={measure(layout.metrics.longestDropMm)}
              detail="Below the board’s bottom edge"
            />
            <Metric
              label={
                kind === "sleeves" ? "Sleeves to print" : "Athletes with dice"
              }
              value={number(
                kind === "sleeves"
                  ? layout.metrics.sleeveCount
                  : plans.filter((athlete) => athlete.dice.length).length,
              )}
              detail={
                kind === "sleeves"
                  ? `${number(layout.metrics.sleeveCount * 10 - count)} spare slots in 10-slot segments`
                  : `${number(layout.metrics.emptyAthletes)} names without assigned dice`
              }
            />
          </div>
          <section className={s.palette} aria-label="Dice by standard">
            <div>
              <h2>The color count</h2>
              <p>Required dice, using the site’s rank icon colors.</p>
            </div>
            <div className={s.colorCounts}>
              {colors.map((rank) => (
                <div key={rank.tier}>
                  <span
                    className={s.colorDie}
                    style={{ background: rank.color }}
                    aria-hidden="true"
                  />
                  <strong>{number(rank.count)}</strong>
                  <span>
                    {rank.tier} <small>{rank.name}</small>
                  </span>
                </div>
              ))}
            </div>
            <p className={s.hint}>
              The 2,000-die order is tracked as a total; color-by-color
              availability is not assumed.
            </p>
          </section>
        </div>
      </div>
      {selection && (
        <section className={s.inspector}>
          <div className={s.inspectorHeader}>
            <div>
              <div className={s.eyebrow}>A CLOSER LOOK</div>
              <h2>One swimmer’s setup</h2>
              <p>Check the details that disappear at board scale.</p>
            </div>
            <label className={s.field}>
              <span>Athlete</span>
              <select
                value={selection.id}
                onChange={(event) => setSelected(event.target.value)}
              >
                {plans.map((athlete) => (
                  <option key={athlete.id} value={athlete.id}>
                    {athlete.name} · {athlete.dice.length} dice
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={s.inspectorBody}>
            <div className={s.athletePreview}>
              {selection.dice.length ? (
                <DraftCanvas
                  layout={layout}
                  kind={kind}
                  athleteId={selection.id}
                />
              ) : (
                <div className={s.noDice}>
                  <UsersRound size={28} />
                  <strong>{selection.name}</strong>
                  <p>
                    {selectedSource?.athleteId
                      ? "No qualifying achievements in this selection."
                      : "This roster entry needs a linked Times profile."}
                  </p>
                  <small>The name is still included on the board.</small>
                </div>
              )}
            </div>
            <div className={s.athleteInfo}>
              <h3>{selection.name}</h3>
              <p>{selectedSource?.trainingGroups.join(" · ")}</p>
              <div className={s.athleteStats}>
                <span>
                  <strong>{selection.dice.length}</strong> dice
                </span>
                <span>
                  <strong>{measure(selectedLayout?.width ?? 0)}</strong> holder
                  width
                </span>
                <span>
                  <strong>{measure(selectedLayout?.drop ?? 0)}</strong> drop
                </span>
              </div>
              <p className={s.hint}>
                {kind === "strings"
                  ? "Dice are ordered by course, age group, stroke, event, and standard."
                  : kind === "sleeves"
                    ? "Every outlined pocket is a real slot. A new 10-slot sleeve is added when the previous one fills."
                    : "The tray follows My Times: IM, Fly, Back, Breast, Free, and Distance. Dice for the same event stack in its pocket; labels retain course and age group."}
              </p>
              <div className={s.awardTable}>
                <table>
                  <caption>Dice in this setup</caption>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Course</th>
                      <th>Age earned</th>
                      <th>Standard</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selection.dice.map((die) => (
                      <tr key={die.id}>
                        <td>{eventLabel(die.event)}</td>
                        <td>{die.course}</td>
                        <td>{die.ageGroup}</td>
                        <td>{die.tier}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!selection.dice.length && (
                  <p className={s.hint}>No dice assigned.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
      <section className={s.ruleComparison}>
        <h2>How much does the award rule change things?</h2>
        <p>
          Same roster, board dimensions, and{" "}
          {course === "all" ? "all courses" : "SCY-only selection"}. Choose a
          row to explore it.
        </p>
        <div className={s.tableScroll}>
          <table>
            <thead>
              <tr>
                <th>Award rule</th>
                <th>Total dice</th>
                <th>Longest string</th>
                <th>10-slot sleeves</th>
                <th>Minimum tray-board width</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map(({ string, sleeve, tray, ...option }) => {
                return (
                  <tr key={option.id} data-selected={rule === option.id}>
                    <th>
                      <button onClick={() => setRule(option.id)}>
                        {option.label}
                        {rule === option.id && <Check size={14} />}
                      </button>
                    </th>
                    <td>{number(string.metrics.diceCount)}</td>
                    <td>{measure(string.metrics.longestDropMm)}</td>
                    <td>{number(sleeve.metrics.sleeveCount)}</td>
                    <td>{measure(tray.metrics.requiredBoardWidthMm)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <footer className={s.coverage}>
        <Info size={19} />
        <div>
          <h2>What this draft is based on</h2>
          <p>
            {data.basis.roster} {data.basis.results} {data.basis.standards}
          </p>
          <p>
            {number(data.coverage.validSwims)} eligible swims reviewed ·{" "}
            {number(data.coverage.unlinkedEntries)} roster entries without a
            linked Times profile · {number(data.coverage.missingAgeSwims)} swims
            missing age · {number(data.coverage.missingStandardsSwims)} without
            a matching historical standard ·{" "}
            {number(data.coverage.belowStandardSwims)} below B. Published
            history may be incomplete; these are planning counts, not an award
            ledger.
          </p>
          {data.coverage.duplicateLinks > 0 && (
            <p>
              {data.coverage.duplicateLinks} duplicate roster links were
              combined into one swimmer.
            </p>
          )}
          <p>
            “Every standard” includes the lower standards satisfied by the
            highest tier (for example, an A earns B, BB, and A). Higher tiers
            replace lower dice in the two “highest” rules. No awards or swimmer
            records are changed.
          </p>
        </div>
      </footer>
      <p className={s.exportStatus} role="status">
        {exportStatus}
      </p>
    </>
  );
}

function Metric({
  label,
  value,
  detail,
  warning,
}: {
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div className={s.metric} data-warning={warning}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function MiniLayout({ kind }: { kind: LayoutKind }) {
  return (
    <svg width="72" height="37" viewBox="0 0 72 37" aria-hidden="true">
      {kind === "strings" ? (
        <>
          {[10, 32, 54].map((x, index) => (
            <g key={x}>
              <line x1={x + 4} y1="0" x2={x + 4} y2="36" stroke="#96aaa1" />
              {Array.from({ length: 3 - index }, (_, i) => (
                <rect
                  key={i}
                  x={x}
                  y={5 + i * 10}
                  width="8"
                  height="8"
                  rx="1.7"
                  fill={["#9e613b", "#687c98", "#a37312"][i]}
                />
              ))}
            </g>
          ))}
        </>
      ) : kind === "sleeves" ? (
        <>
          {[8, 30, 52].map((x, index) => (
            <g key={x}>
              <rect x={x} y="1" width="13" height="35" rx="2" fill="#d8dfd8" />
              {Array.from({ length: 3 }, (_, i) => (
                <rect
                  key={i}
                  x={x + 3}
                  y={5 + i * 9}
                  width="7"
                  height="7"
                  rx="1"
                  fill={
                    i <= index
                      ? ["#9e613b", "#687c98", "#087f74"][i]
                      : "#f6f7f2"
                  }
                />
              ))}
            </g>
          ))}
        </>
      ) : (
        <>
          <rect x="3" y="3" width="64" height="31" rx="3" fill="#d8dfd8" />
          {Array.from({ length: 12 }, (_, i) => (
            <rect
              key={i}
              x={8 + (i % 6) * 9}
              y={8 + Math.floor(i / 6) * 12}
              width="7"
              height="8"
              rx="1"
              fill={
                [
                  "#9e613b",
                  "#f6f7f2",
                  "#687c98",
                  "#a37312",
                  "#087f74",
                  "#4b74d2",
                ][i % 6]
              }
            />
          ))}
        </>
      )}
    </svg>
  );
}

export default function LayoutDrafting() {
  const { user, loading } = useAuth();
  return (
    <Frame>
      {loading ? (
        <section className={s.notice} role="status">
          Loading your account…
        </section>
      ) : !user ? (
        <section className={s.notice}>
          <Link href="/login">Sign in</Link> to use Layout Drafting.
        </section>
      ) : !isToolsAdmin(user.email, user.emailVerified) ? (
        <section className={s.notice}>
          Layout Drafting is available to the tools administrator.
        </section>
      ) : !hasBackendConfiguration ? (
        <section className={s.notice}>
          The roster is unavailable while the database is disconnected.
        </section>
      ) : (
        <Planner key={user.uid} />
      )}
    </Frame>
  );
}
