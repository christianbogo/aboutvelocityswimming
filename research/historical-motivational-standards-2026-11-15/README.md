# USA Swimming historical age-group motivational standards

This collection covers the national age-group B through AAAA tables. Single-age, percentile, championship-based and Top 16 recognition tables are separate series. Earlier editions only contain the events in the original charts; do not insert relay or sprint cuts from a newer edition.

| Edition title | Primary table | Validity evidence |
| --- | --- | --- |
| 2001–2004 | [USA Swimming chart preserved by Dayton Raiders](https://www.gomotionapp.com/czosdrsc/UserFiles/Image/Time%20Standards/National%20Time%20Standards/2001_National.pdf), October 10, 2000; see also the [2003 USA Swimming Rulebook, PDF pages 101–103](https://www.usaswimming.org/docs/default-source/governance/governance-lsc-website/rules_policies/rulebooks/2003-rulebook.pdf#page=101) | September 2000 through August 2004 is inferred from the edition's season years. |
| 2005–2008 | [USA Swimming chart preserved by Potomac Valley Swimming](https://files.pvswim.org/time_stds/2008MotivationalTimes-Top16.pdf), September 13, 2004 | September 2004 through August 2008 is inferred from the edition's season years. [Ozark Swimming's meeting minutes](https://www.gomotionapp.com/czoslsc/UserFiles/Image/QuickUpload/hodsep04_040672.pdf) confirm the 2004 convention distribution. |
| 2009–2012 | [2012 USA Swimming Rulebook, PDF pages 85–87](https://www.usaswimming.org/docs/default-source/governance/governance-lsc-website/rules_policies/rulebooks/2012-rulebook.pdf#page=85), chart dated October 22, 2008 | The September 2008 start is inferred from the season. The next edition began September 1, 2012. |
| 2013–2016 | [2016 USA Swimming Rulebook, PDF pages 91–93](https://www.usaswimming.org/docs/default-source/governance/governance-lsc-website/rules_policies/rulebooks/2016-rulebook.pdf#page=91) | [Florida Swimming](https://www.floridaswimming.org/page/news/279661/new-2013-16-age-group-motivational-times-available) confirms September 1, 2012 through August 31, 2016. |
| 2017–2020 | [2020 USA Swimming Rulebook, PDF pages 91–93](https://www.usaswimming.org/docs/default-source/governance/governance-lsc-website/rules_policies/rulebooks/2020-rulebook.pdf#page=91) | [Ohio Swimming's 2016 criteria](https://www.gomotionapp.com/team/ohlsczone/page/midstates-allstar) use the new edition for swims from September 1, 2016. [Bayside YMCA](https://www.gomotionapp.com/mabays/__doc__/BYNS%20Motivational%20Patch%20Program.pdf) states September 2016 through August 2020. |
| 2021–2024 | [USA Swimming report preserved by Potomac Valley Swimming](https://files.pvswim.org/time_stds/2024MotivationalTimes.pdf), October 1, 2020 | [USA Swimming](https://www.usaswimming.org/times/) gives September 1, 2020 through August 31, 2024. |

The six editions above each contain 214 published event/age/course rows, or 2,568 cuts across both genders and all six tiers. The 2009–2012 version in the rulebooks matches the September 2008 standalone printing. For 2017–2020, the official rulebooks and the standalone report agree; the HY-TEK download differs on seven cuts. The 2021–2024 PDF matches all 2,568 values in the corresponding HY-TEK download. See `evidence/` for checksums, source locations and comparison notes.

The annual 1996–1999 national motivational tables survive in scanned rulebooks. Each has all three courses, with three pages per course, and B through AAAA cuts. OCR returned conflicting digits, so the scans still need a verified transcription before import. A separate letter-grade chart for 2000 was not verified; the 2000 rulebook's Top 16 reportable times are a different series. The source-only manifest in `evidence/pre-2001-sources.json` records the scans and their page ranges.

| Source only | Physical PDF pages |
| --- | --- |
| [1996 USA Swimming Rulebook](https://www.usaswimming.org/docs/default-source/governance/governance-lsc-website/rules_policies/rulebooks/1996-rulebook.pdf#page=92) | 92–100 |
| [1997 USA Swimming Rulebook](https://www.usaswimming.org/docs/default-source/governance/governance-lsc-website/rules_policies/rulebooks/1997-rulebook.pdf#page=86) | 86–94 |
| [1998 USA Swimming Rulebook](https://www.usaswimming.org/docs/default-source/governance/governance-lsc-website/rules_policies/rulebooks/1998-rulebook.pdf#page=88) | 88–96 |
| [1999 USA Swimming Rulebook](https://www.usaswimming.org/docs/default-source/governance/governance-lsc-website/rules_policies/rulebooks/1999-rulebook.pdf#page=90) | 90–98 |

## Reproduce the records

Run the parsers from the repository root, using the exact PDF versions identified in the evidence. The 2001–2004, 2005–2008 and 2021–2024 source copies are retained in this directory. Output files include the full matrix and an adjacent `.evidence.json`.

```sh
# Poppler's pdftotext must be on PATH for these two parsers.
python3 scripts/collection/extract-old-motivational.py 2001-2004 2001-2004-dayton.pdf 2001-2004.json
python3 scripts/collection/extract-old-motivational.py 2005-2008 2005-2008-pvs.pdf 2005-2008.json
python3 scripts/collection/extract-old-motivational.py 2009-2012 2012-rulebook.pdf 2009-2012.json
python3 scripts/collection/extract-motivational-2021-2024.py 2021-2024-pvs.pdf USA-S-2021-2024-TimeStds.zip 2021-2024.json

# These PDFs require pdfplumber.
python3 scripts/collection/extract-rulebook-motivational.py 2013-2016 2016-rulebook.pdf 2013-2016.json
python3 scripts/collection/extract-rulebook-motivational.py 2017-2020 2020-rulebook.pdf 2017-2020.json
```

Adjust the paths to the source files as needed. The HY-TEK file is available from the [HY-TEK downloads page](https://hytek.active.com/downloads.html#swim).

To add an edition to Velocity, follow [the standards workflow](../../docs/time-standards.md) and stage one complete edition per batch. Staff approval makes it selectable as an expired edition in Velocity Times.
