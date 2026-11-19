"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type {
  DataRecord,
  ManagedRecord,
  RecordKind,
} from "@/lib/results/types";
import {
  formatSwimTime,
  parseSwimTime,
} from "@/features/swim-resources/lib/domain/swim-time";
import { ModerationEditor } from "@/components/collection/ResultModeration";
import { clearTimesCache } from "@/components/collection/times-cache";
import { holdUpdates } from "@/lib/update-safety";
import { requestData } from "./data-api";
import RecordPicker from "./RecordPicker";
import StandardCutsEditor from "./StandardCutsEditor";
import s from "./DataManager.module.css";
const obj = (v: unknown) => (v && typeof v === "object" ? v : {}) as DataRecord;
export default function RecordEditor({
  kind,
  record,
  onSaved,
  onCancel,
}: {
  kind: RecordKind;
  record: ManagedRecord;
  onSaved: (record: ManagedRecord) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<DataRecord>(() =>
      structuredClone(
        kind === "meet"
          ? {
              ...record.data,
              dates: {
                startDate:
                  obj(record.data.dates).startDate ??
                  record.data.startsOn ??
                  record.data.startDate ??
                  "",
                endDate:
                  obj(record.data.dates).endDate ??
                  record.data.endsOn ??
                  record.data.endDate ??
                  record.data.startsOn ??
                  "",
              },
            }
          : record.data,
      ),
    ),
    [time, setTime] = useState(
      record.data.timeMs ? formatSwimTime(Number(record.data.timeMs)) : "",
    ),
    [memberId, setMemberId] = useState("");
  const [error, setError] = useState(""),
    [cutsError, setCutsError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  const [linked, setLinked] = useState<ManagedRecord[]>([]),
    [correctLinked, setCorrectLinked] = useState(false),
    [linkedError, setLinkedError] = useState("");
  useEffect(() => {
    if (kind !== "relay" || record.version === "new") return;
    const controller = new AbortController();
    requestData(
      `/api/times/manage?kind=swim&parentRelayId=${encodeURIComponent(record.id)}`,
      undefined,
      controller.signal,
    )
      .then((r) => {
        if (r.hasMore)
          throw new Error(
            "Too many linked first-leg results for one correction.",
          );
        setLinked(r.rows);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLinkedError(e.message);
      });
    return () => controller.abort();
  }, [kind, record.id, record.version]);
  const race = kind === "swim" || kind === "relay";
  function put(key: string, value: unknown) {
    setData((d) => ({ ...d, [key]: value }));
  }
  function nested(key: string, field: string, value: unknown) {
    setData((d) => ({ ...d, [key]: { ...obj(d[key]), [field]: value } }));
  }
  function field(key: string, title: string, type = "text", optional = false) {
    return (
      <label>
        {title}
        <input
          type={type}
          value={String(data[key] ?? "")}
          required={!optional}
          onChange={(e) => put(key, e.target.value)}
        />
      </label>
    );
  }
  function select(key: string, title: string, options: string[]) {
    return (
      <label>
        {title}
        <select
          value={String(data[key] ?? "")}
          onChange={(e) => put(key, e.target.value)}
        >
          {options.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const release = holdUpdates();
    try {
      if (cutsError) throw new Error(cutsError);
      const next = structuredClone(data);
      if (race) {
        next.timeMs = data.status === "OK" ? parseSwimTime(time) : 0;
        if (data.status === "OK" && !next.timeMs)
          throw new Error("Enter the result time.");
        next.timeDisplay =
          data.status === "OK"
            ? formatSwimTime(Number(next.timeMs))
            : data.status;
        next.distance = Number(next.distance);
        next.eventCode = `${next.distance}_${kind === "relay" ? (next.stroke === "IM" ? "MED-R" : "FR-R") : next.stroke}_${next.course}`;
        if (next.ageAtSwim === "" || next.ageAtSwim == null)
          delete next.ageAtSwim;
        else next.ageAtSwim = Number(next.ageAtSwim);
        let cumulative = 0;
        next.splits = ((next.splits as DataRecord[]) ?? []).map((split) => {
          const current = Number(split.cumulativeMs);
          const result = {
            ...split,
            distance: Number(split.distance),
            cumulativeMs: current,
            ...(split.lapMs !== undefined
              ? { lapMs: current - cumulative }
              : {}),
          };
          cumulative = current;
          return result;
        });
      }
      if (kind === "athlete" && !next.dob) delete next.dob;
      let related: Array<{ data: DataRecord; version: string }> | undefined;
      if (correctLinked && linked.length) {
        const first = (next.members as DataRecord[]).find((m) => m.leg === 1);
        if (
          !first?.athleteId ||
          !first.timeMs ||
          first.leadOffEligible !== true
        )
          throw new Error(
            "Verify the first swimmer and first-leg time in the relay lineup.",
          );
        related = linked.map((r) => {
          const stroke = next.stroke === "IM" ? "BK" : "FR",
            distance = Number(next.distance) / 4;
          const previous = r.data;
          const splits = ((previous.splits as DataRecord[]) ?? []).map(
            (split, i, all) =>
              split.distance === previous.distance &&
              split.cumulativeMs === previous.timeMs
                ? {
                    ...split,
                    distance,
                    cumulativeMs: first.timeMs,
                    ...(split.lapMs !== undefined
                      ? {
                          lapMs:
                            Number(first.timeMs) -
                            Number(all[i - 1]?.cumulativeMs ?? 0),
                        }
                      : {}),
                  }
                : split,
          );
          const preserved = { ...previous };
          if (
            previous.athleteId !== first.athleteId ||
            obj(previous.meet).date !== obj(next.meet).date
          )
            delete preserved.ageAtSwim;
          return {
            version: r.version,
            data: {
              ...preserved,
              splits,
              athleteId: first.athleteId,
              gender: first.gender ?? previous.gender,
              timeMs: first.timeMs,
              timeDisplay: formatSwimTime(Number(first.timeMs)),
              distance,
              stroke,
              course: next.course,
              eventCode: `${distance}_${stroke}_${next.course}`,
              round: next.round,
              meet: next.meet,
            },
          };
        });
      }
      const saved = await requestData("/api/times/manage", {
        kind,
        data: next,
        version: record.version,
        memberId,
        ...(related ? { related } : {}),
      });
      clearTimesCache();
      router.refresh();
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      release();
    }
  }
  const members = (data.members ?? []) as DataRecord[],
    splits = (data.splits ?? []) as DataRecord[];
  return (
    <section className={s.editor} aria-label="Record editor">
      <h2>
        {record.version === "new" ? "Add" : "Edit"}{" "}
        {kind === "athlete"
          ? "swimmer"
          : kind === "swim"
            ? "individual result"
            : kind === "relay"
              ? "relay result"
              : kind}
      </h2>
      <form onSubmit={save}>
        <fieldset disabled={busy} className={s.fields}>
          {kind === "athlete" && (
            <>
              <label>
                First name
                <input
                  required
                  value={String(obj(data.name).first ?? "")}
                  onChange={(e) => nested("name", "first", e.target.value)}
                />
              </label>
              <label>
                Last name
                <input
                  required
                  value={String(obj(data.name).last ?? "")}
                  onChange={(e) => nested("name", "last", e.target.value)}
                />
              </label>
              {select("gender", "Category", ["F", "M", "X"])}
              {field("dob", "Birthday", "date", true)}
              {select("status", "Roster status", [
                "inactive",
                "active",
                "taking_break",
                "alumni",
              ])}
              <label>
                Source swimmer ID (optional)
                <input
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  placeholder="For matching meet files"
                  autoComplete="off"
                />
              </label>
            </>
          )}
          {kind === "meet" && (
            <>
              {field("name", "Meet name")}
              {field("location", "Location", "text", true)}
              {field("sanctionNumber", "Sanction number", "text", true)}
              <label>
                Start date
                <input
                  required
                  type="date"
                  value={String(
                    obj(data.dates).startDate ?? data.startsOn ?? "",
                  )}
                  onChange={(e) => nested("dates", "startDate", e.target.value)}
                />
              </label>
              <label>
                End date
                <input
                  required
                  type="date"
                  value={String(obj(data.dates).endDate ?? data.endsOn ?? "")}
                  onChange={(e) => nested("dates", "endDate", e.target.value)}
                />
              </label>
            </>
          )}
          {kind === "standard" && (
            <>
              {field("name", "Standard name")}
              {select("category", "Standard category", [
                "motivational",
                "championship",
              ])}
              {field("governingBody", "Governing body")}
              {field("seasonYears", "Season years")}
              {field("sourceUrl", "Official source URL", "url")}
              {field("effectiveDate", "Effective date", "date")}
              {field("expirationDate", "Expiration date", "date")}
            </>
          )}
          {race && (
            <>
              {kind === "swim" && (
                <RecordPicker
                  kind="athlete"
                  title="Swimmer"
                  value={String(data.athleteId ?? "")}
                  display={[
                    obj(data.athleteName).first,
                    obj(data.athleteName).last,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onSelect={(r) =>
                    setData((d) => ({
                      ...d,
                      athleteId: r.id,
                      athleteName: r.data.name,
                      gender: r.data.gender ?? d.gender,
                    }))
                  }
                />
              )}
              <RecordPicker
                kind="meet"
                title="Meet"
                value={String(obj(data.meet).id ?? "")}
                display={String(obj(data.meet).name ?? "")}
                onSelect={(r) =>
                  setData((d) => ({
                    ...d,
                    meet: {
                      ...obj(d.meet),
                      id: r.id,
                      name: r.data.name,
                      date:
                        obj(d.meet).date ||
                        obj(r.data.dates).startDate ||
                        r.data.startsOn,
                    },
                  }))
                }
              />
              <label>
                Race date
                <input
                  required
                  type="date"
                  value={String(obj(data.meet).date ?? "")}
                  onChange={(e) => nested("meet", "date", e.target.value)}
                />
              </label>
              {select("course", "Course", ["SCY", "SCM", "LCM"])}
              {select("gender", "Category", ["F", "M", "X"])}
              <label>
                Distance
                <select
                  value={String(data.distance)}
                  onChange={(e) => put("distance", Number(e.target.value))}
                >
                  {(kind === "relay"
                    ? [100, 200, 400, 800]
                    : [25, 50, 100, 200, 400, 500, 800, 1000, 1500, 1650]
                  ).map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              {select(
                "stroke",
                "Stroke",
                kind === "relay"
                  ? ["FR", "IM"]
                  : ["FR", "BK", "BR", "FL", "IM"],
              )}
              {select("round", "Round", ["F", "P", "S", "TT"])}
              {select("status", "Status", [
                "OK",
                "DQ",
                "DFS",
                "NS",
                "DNF",
                "SCR",
              ])}
              <label>
                Time
                <input
                  value={time}
                  disabled={data.status !== "OK"}
                  placeholder="1:02.45"
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
              {kind === "swim" &&
                field("ageAtSwim", "Age at race (optional)", "number", true)}
              {field("ageGroup", "Age group")}
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={data.isOfficial === true}
                  onChange={(e) => put("isOfficial", e.target.checked)}
                />
                Official result
              </label>
              {kind === "relay" && field("relayName", "Relay name")}
              <label>
                Club at race
                <select
                  value={String(
                    obj(obj(data.sourceObservation).affiliation).clubCode ??
                      "VS",
                  )}
                  onChange={(e) =>
                    put("sourceObservation", {
                      ...obj(data.sourceObservation),
                      affiliation: { lscCode: "IE", clubCode: e.target.value },
                    })
                  }
                >
                  <option value="VS">Velocity Swimming (IE-VS)</option>
                  <option value="CUDA">
                    Verified historical program (IE-CUDA)
                  </option>
                </select>
              </label>
            </>
          )}
        </fieldset>
        {kind === "standard" && (
          <StandardCutsEditor
            disabled={busy}
            cuts={obj(data.cuts)}
            onChange={(cuts, message) => {
              setCutsError(message ?? "");
              if (cuts) put("cuts", cuts);
            }}
          />
        )}
        {kind === "relay" && (
          <fieldset disabled={busy}>
            <legend>Relay lineup</legend>
            {members.map((member, index) => (
              <div key={index} className={s.lineup}>
                <label>
                  Leg
                  <select
                    value={String(member.leg)}
                    onChange={(e) =>
                      put(
                        "members",
                        members.map((m, i) =>
                          i === index
                            ? { ...m, leg: Number(e.target.value) }
                            : m,
                        ),
                      )
                    }
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <RecordPicker
                  kind="athlete"
                  title={`Leg ${member.leg} swimmer`}
                  value={String(member.athleteId ?? "")}
                  display={String(member.name ?? "")}
                  onSelect={(r) =>
                    put(
                      "members",
                      members.map((m, i) =>
                        i === index
                          ? {
                              ...m,
                              athleteId: r.id,
                              name: `${obj(r.data.name).first} ${obj(r.data.name).last}`,
                              gender: r.data.gender,
                            }
                          : m,
                      ),
                    )
                  }
                />
                <label>
                  Leg time (optional)
                  <input
                    defaultValue={
                      member.timeMs ? formatSwimTime(Number(member.timeMs)) : ""
                    }
                    onChange={(e) =>
                      put(
                        "members",
                        members.map((m, i) => {
                          if (i !== index) return m;
                          const next = { ...m };
                          if (e.target.value.trim())
                            next.timeMs = parseSwimTime(e.target.value) ?? 0;
                          else delete next.timeMs;
                          return next;
                        }),
                      )
                    }
                  />
                </label>
                {member.leg === 1 && (
                  <label className={s.check}>
                    <input
                      type="checkbox"
                      checked={member.leadOffEligible === true}
                      onChange={(e) =>
                        put(
                          "members",
                          members.map((m, i) =>
                            i === index
                              ? { ...m, leadOffEligible: e.target.checked }
                              : m,
                          ),
                        )
                      }
                    />
                    Verified flat-start first-leg timing
                  </label>
                )}
                <button
                  type="button"
                  onClick={() =>
                    put(
                      "members",
                      members.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove swimmer
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={members.length >= 4}
              onClick={() =>
                put("members", [
                  ...members,
                  { leg: members.length + 1, name: "" },
                ])
              }
            >
              Add relay swimmer
            </button>
          </fieldset>
        )}
        {kind === "relay" && linkedError && (
          <p role="alert" className={s.error}>
            Linked results could not be loaded: {linkedError}
          </p>
        )}
        {linked.length > 0 && (
          <fieldset disabled={busy}>
            <legend>Linked first-leg results</legend>
            <p>
              {linked.length} verified individual result(s) depend on this
              relay’s first swimmer and timing.
            </p>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={correctLinked}
                onChange={(e) => setCorrectLinked(e.target.checked)}
              />
              I verified this correction against the recorded timing evidence.
              Update linked first-leg facts with this relay.
            </label>
          </fieldset>
        )}
        {race && (
          <details>
            <summary>Race splits and occurrence</summary>
            <fieldset disabled={busy}>
              <div className={s.fields}>
                {select("splitCoverage", "Split coverage", [
                  "unavailable",
                  "partial",
                  "complete",
                ])}
                <label>
                  Occurrence
                  <input
                    value={String(
                      obj(data.raceIdentity).occurrence ?? "single",
                    )}
                    onChange={(e) =>
                      nested("raceIdentity", "occurrence", e.target.value)
                    }
                  />
                </label>
              </div>
              {splits.map((split, index) => (
                <div key={index} className={s.lineup}>
                  <label>
                    Distance
                    <input
                      type="number"
                      value={String(split.distance ?? "")}
                      onChange={(e) =>
                        put(
                          "splits",
                          splits.map((v, i) =>
                            i === index
                              ? { ...v, distance: Number(e.target.value) }
                              : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Cumulative time
                    <input
                      defaultValue={formatSwimTime(Number(split.cumulativeMs))}
                      onChange={(e) =>
                        put(
                          "splits",
                          splits.map((v, i) =>
                            i === index
                              ? {
                                  ...v,
                                  cumulativeMs:
                                    parseSwimTime(e.target.value) ?? 0,
                                }
                              : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      put(
                        "splits",
                        splits.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove split
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  put("splits", [...splits, { distance: 0, cumulativeMs: 0 }]);
                  if (data.splitCoverage === "unavailable")
                    put("splitCoverage", "partial");
                }}
              >
                Add split
              </button>
            </fieldset>
          </details>
        )}
        {kind === "swim" && (
          <details>
            <summary>Relay lead-off</summary>
            <fieldset disabled={busy}>
              {data.resultOrigin === "relay_leadoff" &&
              !data.parentRelayResultId ? (
                <p>
                  This historical lead-off retains its verified source evidence.
                  Its identity and timing must continue to match that evidence.
                </p>
              ) : (
                <>
                  <label className={s.check}>
                    <input
                      type="checkbox"
                      checked={data.resultOrigin === "relay_leadoff"}
                      onChange={(e) => {
                        if (e.target.checked)
                          put("resultOrigin", "relay_leadoff");
                        else
                          setData((d) => {
                            const n = { ...d };
                            delete n.resultOrigin;
                            delete n.parentRelayResultId;
                            delete n.leadOffVerification;
                            return n;
                          });
                      }}
                    />
                    This is a verified relay lead-off
                  </label>
                  {data.resultOrigin === "relay_leadoff" && (
                    <>
                      <RecordPicker
                        kind="relay"
                        title="Parent relay"
                        value={String(data.parentRelayResultId ?? "")}
                        onSelect={(r) => put("parentRelayResultId", r.id)}
                      />
                      <label>
                        Timing evidence URL
                        <input
                          type="url"
                          value={String(
                            obj(data.leadOffVerification).sourceUrl ?? "",
                          )}
                          onChange={(e) =>
                            nested(
                              "leadOffVerification",
                              "sourceUrl",
                              e.target.value,
                            )
                          }
                        />
                      </label>
                      <label className={s.check}>
                        <input
                          type="checkbox"
                          checked={
                            obj(data.leadOffVerification).verified === true
                          }
                          onChange={(e) =>
                            put("leadOffVerification", {
                              ...obj(data.leadOffVerification),
                              verified: e.target.checked,
                              flatStart: e.target.checked,
                              timingVerified: e.target.checked,
                              leadOffStatus: "OK",
                            })
                          }
                        />
                        I verified the flat start, timing, and valid first-leg
                        status
                      </label>
                    </>
                  )}
                </>
              )}
            </fieldset>
          </details>
        )}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        <div className={s.actions}>
          <button type="submit" disabled={busy} className={s.primary}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
      {race && record.version !== "new" && (
        <details>
          <summary>Flag or restore this result</summary>
          <ModerationEditor
            resultType={kind === "relay" ? "relay" : "swim"}
            resultId={record.id}
            onChanged={() => router.refresh()}
          />
        </details>
      )}
    </section>
  );
}
