import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { fileTime, parseMeetFiles } from "@/lib/results/parse-file";
import { validateFileRow } from "@/lib/results/validate";
import { individual, relayPair, hyIndividual } from "../fixtures/results/files";
describe("direct meet files", () => {
  it("reads HY3 individuals and never reuses context after a mismatched entry", async () => {
    const parsed = await parseMeetFiles([hyIndividual(true)]);
    expect(parsed.rows).toHaveLength(1);
    expect(validateFileRow(parsed.rows[0])).toMatchObject({
      kind: "swim",
      timeMs: 65000,
      athlete: { first: "Synthetic", last: "Swimmer" },
    });
    expect(parsed.issues).toHaveLength(2);
    const paired = await parseMeetFiles([hyIndividual(), individual()]);
    expect(paired.rows).toHaveLength(1);
    expect(paired.rows[0].issue).toBeUndefined();
  });
  it("rejects damaged ZIP members before reading their results", async () => {
    const archive = zipSync({ "meet.sd3": individual().bytes }, { level: 0 });
    archive[50] ^= 1;
    await expect(
      parseMeetFiles([{ name: "damaged.zip", bytes: archive }]),
    ).rejects.toThrow(/checksum/);
  });
  it.each(["sd3", "cl2"])(
    "reads %s identities, race dates, outcomes, and hundredths",
    async (format) => {
      const parsed = await parseMeetFiles([individual(format)]);
      expect(parsed.issues).toEqual([]);
      expect(parsed.rows).toHaveLength(1);
      expect(validateFileRow(parsed.rows[0])).toMatchObject({
        date: "2026-11-01",
        timeMs: 65000,
        status: "OK",
        round: "F",
        distance: 100,
        course: "SCY",
        ageAtSwim: 16,
        athlete: { first: "Synthetic", last: "Swimmer", dob: "2010-01-02" },
      });
      expect(parsed.rows[0].athlete?.memberHash).toMatch(/^[a-f0-9]{24}$/);
    },
  );
  it.each(["DQ", "DFS", "NS", "DNF", "SCR"])(
    "keeps %s outcomes",
    async (status) => {
      expect(
        (await parseMeetFiles([individual("sd3", status)])).rows[0],
      ).toMatchObject({ status, timeMs: 0 });
    },
  );
  it("pairs HY3/CL2 without duplicating totals or manufacturing individual lead-offs", async () => {
    const r = await parseMeetFiles(relayPair());
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].issue).toBeUndefined();
    expect(r.rows[0]).toMatchObject({
      kind: "relay",
      timeMs: 120000,
      stroke: "IM",
      gender: "X",
      ageGroup: "12&U",
      splitCoverage: "complete",
    });
    expect(r.rows[0].members).toHaveLength(4);
    expect(r.rows[0].splits.map((s) => s.distance)).toEqual([
      50, 100, 150, 200,
    ]);
    expect(r.rows[0].source.companion?.filename).toBe("synthetic.cl2");
  });
  it("does not invent distances or lap times across missing splits", async () => {
    const pair = relayPair(1);
    const r = await parseMeetFiles(pair);
    expect(r.rows[0].issue).toBeUndefined();
    expect(r.rows[0].splitCoverage).toBe("partial");
    expect(r.rows[0].splits.map((s) => s.distance)).toEqual([50, 150, 200]);
    expect(r.rows[0].splits[1].lapMs).toBeUndefined();
    const h = await parseMeetFiles([pair[0]]);
    expect(h.rows[0].splits).toEqual([]);
    expect(h.issues[0].status).toBe("skipped");
  });
  it("rejects paired disagreements and damaged HY3 checksums", async () => {
    const pair = relayPair();
    pair[1].bytes = new TextEncoder().encode(
      new TextDecoder().decode(pair[1].bytes).replace("2:00.00", "2:01.00"),
    );
    expect((await parseMeetFiles(pair)).rows[0].issue).toMatch(/disagree/);
    pair[0].bytes[11] = 90;
    await expect(parseMeetFiles([pair[0]])).rejects.toThrow(/checksum/);
  });
  it("deduplicates identical files and accepts bounded ZIP containers", async () => {
    const f = individual();
    const r = await parseMeetFiles([
      {
        name: "meet.zip",
        bytes: zipSync({
          "meet.sd3": f.bytes,
          "again.sd3": f.bytes,
          "readme.txt": new TextEncoder().encode("ignored"),
        }),
      },
    ]);
    expect(r.rows).toHaveLength(1);
  });
  it("rejects arbitrary inputs, traversal, unsupported archives, and zip bombs", async () => {
    for (const name of ["data.json", "data.xlsx", "data.pdf"])
      await expect(
        parseMeetFiles([{ name, bytes: new Uint8Array() }]),
      ).rejects.toThrow(/Choose HY3/);
    await expect(
      parseMeetFiles([
        {
          name: "bad.zip",
          bytes: zipSync({ "../meet.sd3": individual().bytes }),
        },
      ]),
    ).rejects.toThrow(/Unsafe/);
    await expect(
      parseMeetFiles([
        { name: "bad.zip", bytes: zipSync({ "data.json": new Uint8Array() }) },
      ]),
    ).rejects.toThrow(/no HY3/);
    await expect(
      parseMeetFiles([
        {
          name: "bad.zip",
          bytes: zipSync({ "large.sd3": new Uint8Array(101 * 1024 * 1024) }),
        },
      ]),
    ).rejects.toThrow(/extraction/);
  });
  it("never rounds imprecise source times", () => {
    for (const time of ["12.3", "8.329998", "1:60.00", "-1.00"])
      expect(() => fileTime(time)).toThrow();
    expect(fileTime("1:02.37").timeMs).toBe(62370);
  });
});
