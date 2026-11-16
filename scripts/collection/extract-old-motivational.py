"""Extract the verified 2001–2012 USA Swimming historical age-group PDFs using Poppler pdftotext."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import re
import subprocess

RULEBOOK = "https://www.usaswimming.org/docs/default-source/governance/governance-lsc-website/rules_policies/rulebooks/"
TIERS = ["B", "BB", "A", "AA", "AAA", "AAAA"]
AGES = ("10&U", "11-12", "13-14", "15-16", "17-18")
COURSES = {"long course meters": "LCM", "short course yards": "SCY", "short course meters": "SCM"}
STROKES = {"free": "FR", "back": "BK", "breast": "BR", "fly": "FL", "im": "IM"}
GROUP = r"(10\s*&\s*(?:under|u)|11-12|13-14|15-16|17-18)"
EVENT = re.compile(r"(\d{2,4})\s+([MY])\s+(Free|Back|Breast|Fly|IM)\b", re.I)
TOKEN = re.compile(r"(?:(\d{1,2}):)?(\d{1,2})\.(\d\d)\*?")

def expected_keys(age, course):
    freestyle = ("50", "100", "200", "500" if course == "SCY" else "400")
    if age != "10&U":
        freestyle += ("1000", "1650") if course == "SCY" else ("800", "1500")
    strokes = ("50", "100") if age == "10&U" else ("50", "100", "200") if age == "11-12" else ("100", "200")
    medley = ("200",) if age == "10&U" else ("200", "400")
    if course != "LCM" and age in {"10&U", "11-12"}:
        medley = ("100",) + medley
    return {f"{distance}_{stroke}_{course}"
            for stroke, distances in {"FR": freestyle, "BK": strokes, "BR": strokes, "FL": strokes, "IM": medley}.items()
            for distance in distances}

def parse_lines(lines, course, notes):
    result = collections.defaultdict(dict)
    age = None
    for i, line in enumerate(lines):
        heading = re.search(rf"^{GROUP}\s+Girls\s+{GROUP}\s+Boys$", line, re.I)
        alternate = re.search(rf"^Girls\s+{GROUP}\s+Boys\s+{GROUP}$", line, re.I)
        if heading or alternate:
            matched = heading or alternate
            assert matched[1] == matched[2], line
            age = "10&U" if matched[1].startswith("10") else matched[1]
            assert age not in result, line
            continue
        event = EVENT.search(line)
        if not event:
            assert len(TOKEN.findall(line)) < 3, f"Unparsed row: {line}"
            continue
        assert event[2] == ("Y" if course == "SCY" else "M"), line
        assert age, line
        event_code = f"{event[1]}_{STROKES[event[3].lower()]}_{course}"
        assert event_code not in result[age], (course, age, event_code)
        cuts_by_gender = {}
        for gender, cells, labels, descending in (
            ("F", line[:event.start()].split(), TIERS, True),
            ("M", line[event.end():].split(), TIERS[::-1], False),
        ):
            assert len(cells) == 6, line
            cuts = []
            for token, tier in zip(cells, labels):
                numbers = TOKEN.fullmatch(token)
                assert numbers and (not numbers[1] or int(numbers[2]) < 60), line
                time_ms = (int(numbers[1] or 0) * 60 + int(numbers[2])) * 1000 + int(numbers[3]) * 10
                cuts.append(dict(tierName=tier, timeDisplay=token.rstrip("*"), timeMs=time_ms))
            ordered = sorted(cuts, key=lambda c: c["timeMs"])
            if (list(reversed(cuts)) if descending else cuts) != ordered:
                notes.append(f"{course} {age} {event[1]} {event[3]} {gender}: {' '.join(cells)}")
            cuts_by_gender[gender] = {"cutsByTier": ordered}
        result[age][event_code] = cuts_by_gender
    for age, events in result.items():
        assert set(events) == expected_keys(age, course), (course, age, sorted(set(events) ^ expected_keys(age, course)))
    assert set(result) == set(AGES), (course, result.keys())
    return result

def parse_pdf(path, expected_date):
    table = {}
    notes = []
    pages = {}
    layout = subprocess.check_output(["pdftotext", "-layout", path, "-"], text=True)
    for page, raw in enumerate(layout.split("\f"), 1):
        if expected_date not in raw:
            continue
        lines = [" ".join(line.split()) for line in raw.splitlines()]
        headings = [line for line in lines if line.lower().replace("course-", "course ") in COURSES]
        assert len(headings) == 1, (path, page, headings)
        course = COURSES[headings[0].lower().replace("course-", "course ")]
        columns = [line for line in lines if line.startswith("B Min")]
        assert len(columns) == 1 and columns[0].replace(" Min", "").split() == TIERS + TIERS[::-1], (path, page, columns)
        assert course not in table, (path, page, course)
        table[course] = parse_lines(lines, course, notes)
        pages[course] = page
    return table, pages, notes

def emit(start, end, matrix, pages, source, source_url, notes, method, evidence, output):
    assert set(matrix) == set(COURSES.values())
    cuts = {course: {g: {age: {event: cut[g] for event, cut in events.items()}
                         for age, events in ages.items()} for g in ("F", "M")}
            for course, ages in matrix.items()}
    rows = [{"page": pages[course], "ageGroup": age, "eventCode": event}
            for course, ages in matrix.items() for age, events in ages.items() for event in events]
    assert len(rows) == 214, len(rows)
    start_year, end_year = int(start[:4]) + 1, int(end[:4])
    name = f"{start_year}–{end_year} USA Swimming Age Group Motivational Standards"
    record = dict(id=f"usas_motivational_{start_year}_{end_year}", name=name, category="motivational",
                  governingBody="USA_Swimming", standardType="age-group", seasonYears=f"{start_year}–{end_year}",
                  effectiveDate=start, expirationDate=end, sourceUrl=source_url, cuts=cuts)
    data = dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), sourceUrl=source_url,
                sourcePdf=source.name, pages=3, pdfPages=pages, eventRows=len(rows), cutCount=len(rows)*12,
                rows=rows, method=method, observedTierOrderExceptions=notes, **evidence)
    output.write_text(json.dumps(record, indent=2) + "\n")
    output.with_suffix(".json.evidence.json").write_text(json.dumps(data, indent=2) + "\n")
    print(output, len(rows), "rows:", "non-monotonic cells:", notes)


EDITIONS = {
    "2001-2004": {
        "verifiedSha256": "d0969f3858c337f603d887651682487fd021aed91781dbdb1ed1ed563763ef6c",
        "sourceUrl": "https://www.gomotionapp.com/czosdrsc/UserFiles/Image/Time%20Standards/National%20Time%20Standards/2001_National.pdf",
        "sourceEditionDate": "2000-10-10",
        "dateLabel": "10/10/2000",
        "start": "2000-09-01",
        "end": "2004-08-31",
        "method": "Extracted the original TOP16BAS.PDF, a USA Swimming chart preserved by the Dayton Raiders Swim Club.",
        "corroboration": RULEBOOK + "2003-rulebook.pdf#page=101",
        "validityNote": "The source titles this cycle 2001–2004 and dates the chart October 10, 2000. "
                        "September 2000 through August 2004 is inferred from the corresponding USA Swimming season years. "
                        "Exact effective dates are not printed on the chart.",
    },
    "2005-2008": {
        "verifiedSha256": "f38ebbffd0cd4f53692ae2ea412d98f6668b40027b047048f7e4c635972dd608",
        "sourceUrl": "https://files.pvswim.org/time_stds/2008MotivationalTimes-Top16.pdf",
        "sourceEditionDate": "2004-09-13",
        "dateLabel": "9/13/04",
        "start": "2004-09-01",
        "end": "2008-08-31",
        "method": "Extracted embedded text from USA Swimming’s Top 16 based age-group charts archived by its Potomac Valley LSC.",
        "corroboration": RULEBOOK + "2007-rulebook.pdf",
        "validityNote": "The source titles this cycle 2005–2008 and dates the chart September 13, 2004. "
                        "September 2004 through August 2008 is inferred from the corresponding USA Swimming season years. "
                        "Exact effective dates are not printed on the chart.",
    },
    "2009-2012": {
        "verifiedSha256": "cf1eae0fd519680b519eae935784036394e65b644c0aae384aa0ea5f73329192",
        "sourceUrl": RULEBOOK + "2012-rulebook.pdf#page=85",
        "sourceEditionDate": "2008-10-22",
        "dateLabel": "10/22/2008",
        "start": "2008-09-01",
        "end": "2012-08-31",
        "method": "Extracted embedded text from the official 2012 USA Swimming Rulebook, printed pages 83–85.",
        "validityNote": "The source titles this cycle 2009–2012 and dates the chart October 22, 2008. "
                        "September 1, 2008 is the inferred start of the 2008–2009 USA Swimming season, not a date printed on the chart. "
                        "The succeeding edition took effect September 1, 2012.",
    },
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("edition", choices=EDITIONS)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--cross-check", nargs=3, action="append", default=[], metavar=("PDF", "URL", "DATE_LABEL"))
    args = parser.parse_args()

    info = EDITIONS[args.edition].copy()
    start, end = info.pop("start"), info.pop("end")
    source_url, date_label = info.pop("sourceUrl"), info.pop("dateLabel")
    expected_hash = info.pop("verifiedSha256")
    actual_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    if actual_hash != expected_hash:
        parser.error(f"Source does not match the verified {args.edition} PDF (SHA-256 {actual_hash})")
    matrix, pages, notes = parse_pdf(args.source, date_label)
    cross_checks = []
    for path, url, cross_date in args.cross_check:
        pdf = Path(path)
        other, _, _ = parse_pdf(pdf, cross_date)
        assert other and all(course in matrix and matrix[course] == data for course, data in other.items()), (
            f"Cut tables missing or different in {pdf}"
        )
        cross_checks.append(dict(sourceUrl=url, sourceSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),
                                 courses=list(other), dateLabel=cross_date))

    method = (info.pop("method") + " Checked exact event coverage, course and age headings, "
              "six female and six male tier positions, and all numeric cut cells. "
              "Printed asterisks were preserved in the source, with numeric cut values in the data.")
    if cross_checks:
        method += " Matched every cut in the courses provided by the listed cross-check sources."
        info["crossChecks"] = cross_checks
    emit(start, end, matrix, pages, args.source, source_url, notes, method, info, args.output)


if __name__ == "__main__":
    main()
