"""Run with: python3 tests/workshare/test_prepare_accounts.py"""

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("prepare_accounts", ROOT / "scripts/workshare/prepare-accounts.py")
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)
HEADERS = [
    "Memb. Email", "Memb. First Name", "Memb. Last Name", "Roster", "Acct. First Name",
    "Acct. Last Name", "Email", "Email Opt 1", "Email Opt 1 Valid", "Email Opt 2",
    "Email Opt 2 Valid", "Email Opt 3", "Email Opt 3 Valid", "Email Valid",
]


def row(primary="b@example.com", account_first="Same", account_last="Person",
        athlete_first="Swimmer", athlete_last="One", group="", optional="", member=""):
    return [member, athlete_first, athlete_last, group, account_first, account_last,
            primary, optional, "No", "", "No", "", "No", "Yes"]


def workbook(path, records, headers=None, sheet_target="worksheets/sheet1.xml"):
    """A minimal source fixture with stale dimensions and mixed XLSX string types."""
    namespace = PREPARE.MAIN_NS
    tag = lambda name: f"{{{namespace}}}{name}"
    strings = []
    sheet = ET.Element(tag("worksheet"))
    ET.SubElement(sheet, tag("dimension"), {"ref": "A1"})
    data = ET.SubElement(sheet, tag("sheetData"))
    for row_index, values in enumerate([HEADERS if headers is None else headers] + records, 1):
        source_row = ET.SubElement(data, tag("row"), {"r": str(row_index)})
        for column_index, value in enumerate(values, 1):
            reference = f"{PREPARE.column_label(column_index)}{row_index}"
            if row_index % 2:
                cell = ET.SubElement(source_row, tag("c"), {"r": reference, "t": "s"})
                strings.append(value)
                ET.SubElement(cell, tag("v")).text = str(len(strings) - 1)
            else:
                cell = ET.SubElement(source_row, tag("c"), {"r": reference, "t": "inlineStr"})
                inline = ET.SubElement(cell, tag("is"))
                ET.SubElement(inline, tag("t")).text = value
    shared = ET.Element(tag("sst"))
    for value in strings:
        item = ET.SubElement(shared, tag("si"))
        ET.SubElement(item, tag("t")).text = value
    book = ET.Element(tag("workbook"))
    sheets = ET.SubElement(book, tag("sheets"))
    ET.SubElement(sheets, tag("sheet"), {"name": "Sheet0", "sheetId": "1",
                                        f"{{{PREPARE.REL_NS}}}id": "rId1"})
    relationships = ET.Element(f"{{{PREPARE.PACKAGE_REL_NS}}}Relationships")
    ET.SubElement(relationships, f"{{{PREPARE.PACKAGE_REL_NS}}}Relationship", {
        "Id": "rId1", "Target": sheet_target,
        "Type": f"{PREPARE.REL_NS}/worksheet",
    })
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("xl/workbook.xml", ET.tostring(book))
        archive.writestr("xl/_rels/workbook.xml.rels", ET.tostring(relationships))
        archive.writestr("xl/sharedStrings.xml", ET.tostring(shared))
        archive.writestr("xl/worksheets/sheet1.xml", ET.tostring(sheet))


class AccountPreparationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.source = Path(self.directory.name) / "source.xlsx"

    def test_groups_only_primary_email_and_preserves_source_members(self):
        workbook(self.source, [
            row(optional="shared@example.com"),
            row(primary=" A@Example.com ", group="(Deleted Group)", optional="shared@example.com"),
            row(primary=" B@Example.com ", athlete_last="Two", group="Not Assigned", member=" Athlete@Example.com "),
            row(primary="c@example.com", account_first="Only", account_last="Account", athlete_first="", athlete_last=""),
        ])
        original = self.source.read_bytes()
        prepared = PREPARE.prepare_accounts(self.source)
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(prepared["source"], {
            "filename": "source.xlsx", "sha256": hashlib.sha256(original).hexdigest(),
            "sheet": "Sheet0", "range": "A1:N5", "rowCount": 4,
        })
        accounts = prepared["accounts"]
        self.assertEqual(len(accounts), 3)
        self.assertEqual([account["emails"][0] for account in accounts],
                         ["a@example.com", "b@example.com", "c@example.com"])
        self.assertEqual(accounts[1]["emails"], ["b@example.com", "shared@example.com", "athlete@example.com"])
        self.assertEqual([item["fullName"] for item in accounts[1]["athletes"]], ["Swimmer One", "Swimmer Two"])
        self.assertEqual(accounts[0]["athletes"][0]["trainingGroup"], "(Deleted Group)")
        self.assertEqual(accounts[1]["athletes"][0]["trainingGroup"], "")
        self.assertEqual(accounts[1]["athletes"][1]["trainingGroup"], "Not Assigned")
        self.assertEqual(accounts[2]["athletes"], [])
        for account in accounts:
            self.assertFalse(account["isArchived"])
            self.assertNotIn("id", account)
            self.assertNotIn("sourcePrimaryEmail", account)
            for field in ("currentSeason", "generalHoursRequired", "starlightHoursRequired", "appleCapitalHoursRequired"):
                self.assertIsNone(account[field])
            for athlete in account["athletes"]:
                self.assertFalse(athlete["isArchived"])
                self.assertIsNone(athlete["timesAthleteId"])
        review = prepared["review"]
        self.assertEqual((review["accountCount"], review["athleteCount"], review["uniqueEmailCount"]), (3, 3, 5))
        self.assertEqual(review["accountOnlyRows"], [5])
        self.assertEqual(review["missingTrainingGroupRows"], [2])
        self.assertEqual(review["deletedTrainingGroupRows"], [3])
        self.assertEqual(review["unassignedTrainingGroupRows"], [4])
        self.assertEqual(review["duplicateAccountNameRows"], [[2, 3, 4]])
        self.assertEqual(review["duplicateAthleteNameRows"], [[2, 3]])
        self.assertEqual(review["sharedContactEmailRows"], [[2, 3]])
        self.assertEqual(review["sourceRowMappings"][1], {
            "accountIndex": 1, "rows": [2, 4],
            "athletes": [{"athleteIndex": 0, "row": 2}, {"athleteIndex": 1, "row": 4}],
        })
        self.assertNotIn("example.com", json.dumps(review))
        self.assertNotIn("Same Person", json.dumps(review))

    def test_rejects_conflicting_names_for_one_primary_email(self):
        workbook(self.source, [row(), row(account_first="Different")])
        with self.assertRaisesRegex(PREPARE.PreparationError, "Conflicting account names.*2, 3") as caught:
            PREPARE.prepare_accounts(self.source)
        self.assertNotIn("example.com", str(caught.exception))
        self.assertNotIn("Different", str(caught.exception))

    def test_reports_duplicate_source_rows_without_merging_athletes(self):
        workbook(self.source, [row(), row()])
        prepared = PREPARE.prepare_accounts(self.source)
        self.assertEqual(len(prepared["accounts"][0]["athletes"]), 2)
        self.assertEqual(prepared["review"]["duplicateSourceRows"], [[2, 3]])

    def test_rejects_missing_or_invalid_emails_and_partial_member_names(self):
        for source_row, message in [
            (row(primary=""), "primary account email"),
            (row(primary="invalid"), "primary account email"),
            (row(optional="invalid"), "Email Opt 1"),
            (row(athlete_last=""), "incomplete athlete name"),
            (row(account_first="", account_last=""), "account full name"),
        ]:
            with self.subTest(message=message):
                workbook(self.source, [source_row])
                with self.assertRaisesRegex(PREPARE.PreparationError, message):
                    PREPARE.prepare_accounts(self.source)

    def test_rejects_oversized_fields_and_account_lists(self):
        for records in ([row(account_first="a" * 201)], [row(group="a" * 101)], [row()] * 101):
            workbook(self.source, records)
            with self.assertRaises(PREPARE.PreparationError):
                PREPARE.prepare_accounts(self.source)

    def test_requires_unique_source_headers_and_a_real_sheet(self):
        workbook(self.source, [], headers=["Email", "Email"])
        with self.assertRaisesRegex(PREPARE.PreparationError, "duplicate column headers"):
            PREPARE.prepare_accounts(self.source)
        workbook(self.source, [], headers=["Email"])
        with self.assertRaisesRegex(PREPARE.PreparationError, "missing required headers"):
            PREPARE.prepare_accounts(self.source)
        workbook(self.source, [row()])
        with self.assertRaisesRegex(PREPARE.PreparationError, "worksheet is unavailable"):
            PREPARE.prepare_accounts(self.source, "Unknown")

    def test_accepts_an_absolute_internal_sheet_relationship(self):
        workbook(self.source, [row()], sheet_target="/xl/worksheets/sheet1.xml")
        self.assertEqual(PREPARE.prepare_accounts(self.source)["review"]["accountCount"], 1)

    def test_writes_only_private_json_and_is_reproducible(self):
        workbook(self.source, [row()])
        prepared = PREPARE.prepare_accounts(self.source)
        self.assertEqual(prepared, PREPARE.prepare_accounts(self.source))
        output = Path(self.directory.name) / "private" / "accounts.json"
        PREPARE.write_private_json(output, prepared)
        self.assertEqual(json.loads(output.read_text()), prepared)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(output.parent.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
