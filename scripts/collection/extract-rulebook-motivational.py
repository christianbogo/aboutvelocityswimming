"""Extract the traditional age-group tables in the 2016/2020 USA Swimming rulebooks.

Usage: python extract-rulebook-motivational.py 2013-2016 rulebook.pdf output.json
Requires pdfplumber. Keep the source PDF alongside the output for auditing.
"""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import pdfplumber


AGES = {'10 & Under': '10&U', '11-12': '11-12', '13-14': '13-14',
        '15-16': '15-16', '17-18': '17-18'}
COURSES = {
    'Long Course Meters': 'LCM',
    'Short Course Yards': 'SCY',
    'Short Course Meters': 'SCM',
}
STROKES = {'Free': 'FR', 'Back': 'BK', 'Breast': 'BR', 'Fly': 'FL', 'IM': 'IM'}
TIERS = ['B', 'BB', 'A', 'AA', 'AAA', 'AAAA']
AGE_HEADING = re.compile(r'(10 & Under|11-12|13-14|15-16|17-18) Girls \1 Boys')
EVENT = re.compile(r'\b(\d+) ([MY]) (Free|Back|Breast|Fly|IM)\b')
TIME = re.compile(r'(?:(\d+):)?(\d{1,2})\.(\d{2})')
SEASON_START = {
    '2013-2016': ('2012-09-01', '2016-08-31'),
    '2017-2020': ('2016-09-01', '2020-08-31'),
}
SOURCES = {
    '2013-2016': (
        '2016-rulebook.pdf',
        'Florida Swimming confirms the 2013–2016 standards apply from September 1, 2012 through August 31, 2016.',
        'https://www.floridaswimming.org/page/news/279661/new-2013-16-age-group-motivational-times-available',
    ),
    '2017-2020': (
        '2020-rulebook.pdf',
        'The four-season interval follows the dated 2013–2016 and 2021–2024 quads. The table is stamped September 30, 2016.',
        'https://www.usaswimming.org/times/',
    ),
}
SOURCE_HASHES = {
    '2013-2016': 'f3d3969976fdfb6a0f5b0a74c8aefcc55996893df0b6629eca0c64511a07163e',
    '2017-2020': 'fd0640b01955968cb79e65c55ce8a61be13c46e17c87b0c3f9c8976dbf5ccf90',
}
RULEBOOK_URL = (
    'https://www.usaswimming.org/docs/default-source/governance/'
    'governance-lsc-website/rules_policies/rulebooks/'
)


def cuts_by_tier(text, status):
    tokens = text.replace('*', ' ').split()
    if len(tokens) != 6 or any(not TIME.fullmatch(token) for token in tokens):
        raise ValueError(f'Expected six times at {status}; got {tokens}')
    cuts = []
    for tier, token in zip(TIERS, tokens, strict=True):
        minutes, seconds, hundredths = TIME.fullmatch(token).groups()
        time_ms = 60_000 * int(minutes or 0) + 1000 * int(seconds) + 10 * int(hundredths)
        cuts.append(dict(tierName=tier, timeMs=time_ms, timeDisplay=token))
    if any(left['timeMs'] <= right['timeMs'] for left, right in zip(cuts, cuts[1:])):
        raise ValueError(f'Cut times do not get faster at {status}: {tokens}')
    return dict(cutsByTier=cuts[::-1])


def parse(season, source, first_page):
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    if source_hash != SOURCE_HASHES[season]:
        raise ValueError(f'Unexpected PDF checksum for {season}. Verify this source before importing.')
    years = season.replace('-', '–')
    source_file, date_note, date_url = SOURCES[season]
    effective, expiration = SEASON_START[season]
    record = dict(
        id=f"usas_motivational_{season.replace('-', '_')}",
        name=f'{years} USA Swimming Age Group Motivational Standards',
        category='motivational',
        standardType='age-group',
        governingBody='USA_Swimming',
        seasonYears=years,
        effectiveDate=effective,
        expirationDate=expiration,
        sourceUrl=RULEBOOK_URL + source_file,
        cuts={},
    )
    rows = []
    seen_courses = set()
    course_counts = Counter()
    age_counts = Counter()
    pages = range(first_page, first_page + 3)
    with pdfplumber.open(source) as pdf:
        for number in pages:
            page = pdf.pages[number - 1]
            lines = page.extract_text().splitlines()
            if not any(line.startswith(f'{season} National Age Group Motivational Times') for line in lines):
                raise ValueError(f'Unexpected source table on PDF page {number}')
            headings = {COURSES[line] for line in lines if line in COURSES}
            if len(headings) != 1 or headings & seen_courses:
                raise ValueError(f'Unexpected course headings on PDF page {number}: {headings}')
            course, = headings
            seen_courses.add(course)
            age = None
            for line in lines:
                heading = AGE_HEADING.fullmatch(line)
                if heading:
                    age = AGES[heading[1]]
                    continue
                event = EVENT.search(line)
                if not event:
                    if TIME.search(line):
                        raise ValueError(f'Unparsed time on PDF page {number}: {line}')
                    continue
                if not age or event[2] != ('Y' if course == 'SCY' else 'M'):
                    raise ValueError(f'Unexpected event on PDF page {number}: {line}')
                key = f'{event[1]}_{STROKES[event[3]]}_{course}'
                status = f'PDF page {number}, {age}, {key}'
                for gender, values in (
                    ('F', line[:event.start()]),
                    ('M', ' '.join(line[event.end():].replace('*', ' ').split()[::-1])),
                ):
                    events = record['cuts'].setdefault(course, {}).setdefault(gender, {}).setdefault(age, {})
                    if key in events:
                        raise ValueError(f'Duplicate event at {status}')
                    events[key] = cuts_by_tier(values, f'{status}, {gender}')
                rows.append(dict(page=number, ageGroup=age, eventCode=key))
                course_counts[course] += 1
                age_counts[course, age] += 1

    expected_counts = {('LCM', age): count for age, count in zip(AGES.values(), [11, 17, 14, 14, 14])}
    for course in ('SCY', 'SCM'):
        expected_counts.update({(course, age): count for age, count in zip(AGES.values(), [12, 18, 14, 14, 14])})
    if age_counts != expected_counts:
        raise ValueError(f'Unexpected table coverage: {age_counts}')
    evidence = dict(
        sourceUrl=record['sourceUrl'],
        sourceSha256=source_hash,
        pages=list(pages),
        eventRows=len(rows),
        cutCount=len(rows) * 12,
        eventRowsByCourse=dict(course_counts),
        rows=rows,
        method=(
            'Traditional age groups in Appendix 2-B. Every source event row checked, '
            'with six female columns B through AAAA and six male columns AAAA through B. '
            'Asterisks indicate changes from the previous quad and are omitted from the displayed times.'
        ),
        validityNote=date_note,
        validitySourceUrl=date_url,
    )
    return record, evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('season', choices=SOURCES)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--first-page', type=int, default=91,
                        help='The first of the three traditional age-group table pages (1-based).')
    args = parser.parse_args()
    record, evidence = parse(args.season, args.source, args.first_page)
    args.output.write_text(json.dumps(record, indent=2) + '\n')
    Path(f'{args.output}.evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(f"Extracted {evidence['eventRows']} event rows / {evidence['cutCount']} cuts")


if __name__ == '__main__':
    main()
