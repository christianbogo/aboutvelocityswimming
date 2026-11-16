"""Extract the 2021–2024 national age-group report preserved by Potomac Valley Swimming.

Usage: python3 extract-motivational-2021-2024.py source.pdf hytek.zip record.json
Requires pdftotext (Poppler). HY-TEK's November 2020 distribution cross-checks
the printed matrix independently.
"""

import argparse
import hashlib
import json
import re
import struct
import subprocess
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

SOURCE_URL = "https://files.pvswim.org/time_stds/2024MotivationalTimes.pdf"
SOURCE_SHA = "533852478c1a6fcd00bd2f8f27564d21a8a00b2e0a60c7fdef419c3145461ee9"
HYTEK_URL = "https://hytek.active.com/Updates/USA-S-2021-2024-TimeStds.zip"
TIERS = ("AAAA", "AAA", "AA", "A", "BB", "B")
COURSES = {"Short Course Meters": "SCM", "Long Course Meters": "LCM", "Short Course Yards": "SCY"}
AGES = {"10 & under": "10&U", **{f"{n}-{n+1}": f"{n}-{n+1}" for n in (11, 13, 15, 17)}}
STROKES = {"Free": "FR", "Back": "BK", "Breast": "BR", "Fly": "FL", "IM": "IM"}
TIME = re.compile(r"(?:(\d+):)?(\d{1,2})\.(\d{2})")
EVENT = re.compile(r"\b(\d+) ([MY]) (Free|Back|Breast|Fly|IM)\b")
AGE = re.compile(r"\s*(10 & under|11-12|13-14|15-16|17-18) Girls\s+\1 Boys\s*")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def time_ms(value):
    minutes, seconds, centiseconds = value.groups()
    return (int(minutes or 0) * 60 + int(seconds)) * 1000 + int(centiseconds) * 10


def read_pdf(source):
    if sha256(source) != SOURCE_SHA:
        raise ValueError("Expected the verified October 1 report from Potomac Valley Swimming")
    pages = subprocess.check_output(["pdftotext", "-layout", str(source), "-"], text=True).strip().split("\f")
    if len(pages) != 6:
        raise ValueError(f"Expected six pages, read {len(pages)}")
    course, age = None, None
    rows = {}
    locations = []
    for page_number, page in enumerate(pages, 1):
        age = None
        for line in page.splitlines():
            label = line.strip()
            if label in COURSES:
                course = COURSES[label]
            elif heading := AGE.fullmatch(line):
                age = AGES[heading[1]]
            elif event := EVENT.search(line):
                distance, unit, stroke = event.groups()
                if not course or not age or (unit == "Y") != (course == "SCY"):
                    raise ValueError(f"Invalid event context on page {page_number}: {line}")
                key = f"{distance}_{STROKES[stroke]}_{course}"
                female = list(TIME.finditer(line[:event.start()]))
                male = list(TIME.finditer(line[event.end():]))
                for gender, times in (("F", female[::-1]), ("M", male)):
                    row = (course, gender, age, key)
                    cuts = [(time_ms(time), time[0]) for time in times]
                    if len(cuts) != 6 or row in rows or not all(a[0] < b[0] for a, b in zip(cuts, cuts[1:])):
                        raise ValueError(f"Invalid cuts on page {page_number} for {row}: {line}")
                    rows[row] = cuts
                locations.append({"page": page_number, "ageGroup": age, "eventCode": key})
            elif TIME.search(line):
                raise ValueError(f"Unrecognized timing row on page {page_number}: {line}")
    counts = Counter((course, age) for course, gender, age, _ in rows if gender == "F")
    expected = {(course, age): 11 + (course != "LCM") if age == "10&U"
                else 17 + (course != "LCM") if age == "11-12" else 14
                for course in COURSES.values() for age in AGES.values()}
    if counts != expected:
        raise ValueError(f"Unexpected course/age coverage: {counts}")
    return rows, locations


def hytek_milliseconds(value):
    # STD stores positive times as Microsoft Binary Format single precision seconds.
    if value == 0:
        return 0
    exponent = (value >> 24) - 2
    if exponent <= 0 or value & 0x800000:
        raise ValueError("Unexpected HY-TEK time encoding")
    ieee = struct.pack("<I", (exponent << 23) | (value & 0x7fffff))
    return round(struct.unpack("<f", ieee)[0] * 100) * 10


def read_hytek(source):
    with ZipFile(source) as archive:
        data = archive.read("TUSS.STD")
    if len(data) % 260 or not data.startswith(b"STD 170111620"):
        raise ValueError("Expected the November 2020 HY-TEK distribution")
    if tuple(data[i:i+4].decode().strip() for i in range(20, 44, 4)) != TIERS:
        raise ValueError("Unexpected HY-TEK tier columns")
    genders = {"1": "M", "2": "F"}
    strokes = dict(zip("12345", STROKES.values()))
    ages = {re.sub(r"\D", "", age): age for age in AGES.values()}
    rows = {}
    for start in range(260, len(data), 260):
        header = data[start:start+11].decode()
        if header[10] != "I":
            raise ValueError(f"Unexpected HY-TEK event type: {header!r}")
        gender, stroke, distance, age = (
            genders[header[0]], strokes[header[1]], int(header[2:6]), ages[header[6:10].strip()]
        )
        for offset, course in ((140, "SCM"), (180, "LCM"), (220, "SCY")):
            values = [hytek_milliseconds(n) for n in struct.unpack_from("<6I", data, start + offset)]
            if not any(values):
                continue
            key = (course, gender, age, f"{distance}_{stroke}_{course}")
            if not all(values) or key in rows:
                raise ValueError(f"Partial or duplicate HY-TEK row: {key}")
            rows[key] = values
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("hytek", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows, locations = read_pdf(args.source)
    crosscheck = read_hytek(args.hytek)
    if rows.keys() != crosscheck.keys():
        raise ValueError(f"Coverage differs: PDF-only {rows.keys()-crosscheck.keys()}, HY-TEK-only {crosscheck.keys()-rows.keys()}")
    differences = [(key, values, crosscheck[key]) for key, values in rows.items()
                   if [ms for ms, _ in values] != crosscheck[key]]
    if differences:
        raise ValueError(f"PDF differs from HY-TEK: {differences}")
    edition = {
        "id": "usas_motivational_2021_2024",
        "name": "2021–2024 USA Swimming Age Group Motivational Standards",
        "category": "motivational",
        "standardType": "age-group",
        "governingBody": "USA_Swimming",
        "seasonYears": "2021–2024",
        "effectiveDate": "2020-09-01",
        "expirationDate": "2024-08-31",
        "sourceUrl": SOURCE_URL,
        "cuts": {},
    }
    for (course, gender, age, event), cuts in rows.items():
        events = edition["cuts"].setdefault(course, {}).setdefault(gender, {}).setdefault(age, {})
        events[event] = {"cutsByTier": [
            {"tierName": tier, "timeMs": ms, "timeDisplay": display}
            for tier, (ms, display) in zip(TIERS, cuts)
        ]}
    evidence = {
        "sourceSha256": SOURCE_SHA,
        "originalPublisherUrl": "https://www.usaswimming.org/docs/default-source/timesdocuments/time-standards/2024/2021-2024-national-age-group-motivational-times.pdf",
        "crosscheckUrl": HYTEK_URL,
        "crosscheckSha256": sha256(args.hytek),
        "validitySourceUrl": "https://www.usaswimming.org/times/",
        "validityNote": "USA Swimming's Times FAQ states September 1, 2020 through August 31, 2024.",
        "pages": 6,
        "eventRows": len(locations),
        "cutCount": len(rows) * 6,
        "rows": locations,
        "method": "Extracted all printed cuts from the October 1, 2020 USA Swimming report, preserved by its Potomac Valley LSC. Verified each cut against the November 2020 HY-TEK distribution. The report publishes individual events only.",
    }
    for path, data in ((args.output, edition), (Path(f"{args.output}.evidence.json"), evidence)):
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Verified {evidence['eventRows']} event rows and {evidence['cutCount']} cuts")


if __name__ == "__main__":
    main()
