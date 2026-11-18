#!/usr/bin/env python3
"""Prepare private Accounts & Roster JSON from a registration XLSX export.

This only reads a workbook and writes a local JSON file. It never accesses a
database, links Times athletes, or carries forward historical Workshare data.
"""

import argparse
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": MAIN_NS}
REQUIRED_HEADERS = (
    "Memb. First Name", "Memb. Last Name", "Roster", "Acct. First Name",
    "Acct. Last Name", "Email",
)
CONTACT_HEADERS = ("Email", "Email Opt 1", "Email Opt 2", "Email Opt 3", "Memb. Email")
EMAIL_PATTERN = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


class PreparationError(ValueError):
    """Invalid or ambiguous source data that must be corrected before import."""


def xml_file(archive, name):
    data = archive.read(name)
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise PreparationError("Workbook XML cannot contain entity declarations.")
    return ET.fromstring(data)


def column_number(reference):
    match = re.fullmatch(r"([A-Z]+)[1-9][0-9]*", reference or "")
    if not match:
        raise PreparationError("Workbook contains an invalid cell reference.")
    number = 0
    for character in match.group(1):
        number = number * 26 + ord(character) - ord("A") + 1
    return number


def column_label(number):
    label = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        label = chr(ord("A") + remainder) + label
    return label


def rich_text(element):
    if element is None:
        return ""
    return "".join(node.text or "" for node in element.findall("m:t", NS)
                   + element.findall("m:r/m:t", NS))


def read_sheet(path, requested_sheet=None):
    """Read actual XML cells, ignoring the export's potentially stale dimension."""
    with zipfile.ZipFile(path) as archive:
        workbook = xml_file(archive, "xl/workbook.xml")
        relationships = xml_file(archive, "xl/_rels/workbook.xml.rels")
        targets = {
            element.attrib["Id"]: element.attrib.get("Target", "")
            for element in relationships.findall(f"{{{PACKAGE_REL_NS}}}Relationship")
            if element.attrib.get("TargetMode") != "External"
        }
        sheets = workbook.findall("m:sheets/m:sheet", NS)
        sheet = next((item for item in sheets
                      if requested_sheet is None or item.attrib.get("name") == requested_sheet), None)
        if sheet is None:
            raise PreparationError("The requested worksheet is unavailable.")
        target = targets.get(sheet.attrib.get(f"{{{REL_NS}}}id"))
        if not target:
            raise PreparationError("The worksheet has no internal workbook relationship.")
        sheet_path = posixpath.normpath(target.lstrip("/") if target.startswith("/")
                                       else posixpath.join("xl", target))
        if not sheet_path.startswith("xl/") or ".." in sheet_path.split("/"):
            raise PreparationError("The worksheet relationship is invalid.")
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = xml_file(archive, "xl/sharedStrings.xml")
            shared = [rich_text(item) for item in strings.findall("m:si", NS)]
        contents = xml_file(archive, sheet_path)
        rows = []
        maximum_column = 0
        for source_row in contents.findall("m:sheetData/m:row", NS):
            try:
                row_number = int(source_row.attrib["r"])
            except (KeyError, ValueError) as error:
                raise PreparationError("Workbook contains an invalid row reference.") from error
            values = {}
            for cell in source_row.findall("m:c", NS):
                index = column_number(cell.attrib.get("r"))
                if index in values:
                    raise PreparationError(f"Source row {row_number} has duplicate cells.")
                value_node = cell.find("m:v", NS)
                value = value_node.text or "" if value_node is not None else ""
                kind = cell.attrib.get("t")
                if kind == "s":
                    try:
                        shared_index = int(value)
                        if shared_index < 0:
                            raise ValueError
                        value = shared[shared_index]
                    except (IndexError, ValueError) as error:
                        raise PreparationError(f"Source row {row_number} has an invalid shared string.") from error
                elif kind == "inlineStr":
                    value = rich_text(cell.find("m:is", NS))
                elif kind == "e":
                    raise PreparationError(f"Source row {row_number} contains a spreadsheet error.")
                values[index] = value.strip()
                maximum_column = max(maximum_column, index)
            if any(values.values()):
                rows.append((row_number, values))
        if not rows:
            raise PreparationError("The worksheet is empty.")
        return sheet.attrib["name"], rows, maximum_column


def bounded_name(value, label, row_number, limit=200, required=True):
    if (required and not value) or len(value) > limit:
        raise PreparationError(f"Source row {row_number} has an invalid {label}.")
    return value


def prepare_accounts(path, requested_sheet=None):
    path = Path(path)
    sheet_name, source_rows, maximum_column = read_sheet(path, requested_sheet)
    header_row, header_cells = source_rows[0]
    header_values = list(header_cells.values())
    if len(header_values) != len(set(header_values)):
        raise PreparationError("The worksheet contains duplicate column headers.")
    positions = {name: index for index, name in header_cells.items()}
    missing = [name for name in REQUIRED_HEADERS if name not in positions]
    if missing:
        raise PreparationError("The worksheet is missing required headers: " + ", ".join(missing) + ".")

    grouped = {}
    email_groups = defaultdict(set)
    email_rows = defaultdict(set)
    account_name_rows = defaultdict(list)
    account_name_groups = defaultdict(set)
    athlete_name_rows = defaultdict(list)
    duplicate_source_rows = defaultdict(list)
    account_only_rows, missing_group_rows, unassigned_rows, deleted_group_rows = [], [], [], []

    for row_number, cells in source_rows[1:]:
        value = lambda name: cells.get(positions.get(name), "")
        primary_email = value("Email").lower()
        if not primary_email or len(primary_email) > 254 or not EMAIL_PATTERN.fullmatch(primary_email):
            raise PreparationError(f"Source row {row_number} has an invalid primary account email.")
        full_name = bounded_name(" ".join(filter(None, (
            value("Acct. First Name"), value("Acct. Last Name")))), "account full name", row_number)
        if primary_email not in grouped:
            grouped[primary_email] = {"name": full_name, "emails": [], "athletes": [], "rows": [], "athleteRows": []}
        group = grouped[primary_email]
        if group["name"] != full_name:
            refs = ", ".join(map(str, group["rows"] + [row_number]))
            raise PreparationError(f"Conflicting account names share one primary email in source rows {refs}.")
        group["rows"].append(row_number)
        account_name_rows[full_name.casefold()].append(row_number)
        account_name_groups[full_name.casefold()].add(primary_email)
        duplicate_source_rows[tuple(sorted(cells.items()))].append(row_number)
        for column in CONTACT_HEADERS:
            email = value(column).lower()
            if not email:
                continue
            if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
                raise PreparationError(f"Source row {row_number} has an invalid email in {column}.")
            if email not in group["emails"]:
                group["emails"].append(email)
            email_groups[email].add(primary_email)
            email_rows[email].add(row_number)
        first_name, last_name = value("Memb. First Name"), value("Memb. Last Name")
        if bool(first_name) != bool(last_name):
            raise PreparationError(f"Source row {row_number} has an incomplete athlete name.")
        if not first_name:
            account_only_rows.append(row_number)
            continue
        athlete_name = bounded_name(f"{first_name} {last_name}", "athlete full name", row_number)
        training_group = bounded_name(value("Roster"), "training group", row_number, 100, False)
        group["athletes"].append({
            "fullName": athlete_name, "trainingGroup": training_group,
            "timesAthleteId": None, "isArchived": False,
        })
        group["athleteRows"].append(row_number)
        athlete_name_rows[athlete_name.casefold()].append(row_number)
        if not training_group:
            missing_group_rows.append(row_number)
        if training_group.casefold() in ("not assigned", "no assignment"):
            unassigned_rows.append(row_number)
        if training_group.casefold() == "(deleted group)":
            deleted_group_rows.append(row_number)

    accounts, provenance = [], []
    for primary_email in sorted(grouped):
        group = grouped[primary_email]
        if len(group["emails"]) > 100 or len(group["athletes"]) > 100:
            refs = ", ".join(map(str, group["rows"]))
            raise PreparationError(f"An account exceeds 100 emails or athletes in source rows {refs}.")
        provenance.append({"accountIndex": len(accounts), "rows": group["rows"],
                           "athletes": [{"athleteIndex": index, "row": row}
                                        for index, row in enumerate(group["athleteRows"])]})
        accounts.append({
            "fullName": group["name"], "emails": group["emails"], "athletes": group["athletes"],
            "currentSeason": None, "generalHoursRequired": None, "starlightHoursRequired": None,
            "appleCapitalHoursRequired": None, "isArchived": False,
        })
    source_range = f"A{header_row}:{column_label(maximum_column)}{max(row for row, _ in source_rows)}"
    return {
        "source": {"filename": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                   "sheet": sheet_name, "range": source_range, "rowCount": len(source_rows) - 1},
        "accounts": accounts,
        "review": {
            "accountCount": len(accounts), "athleteCount": sum(len(account["athletes"]) for account in accounts),
            "uniqueEmailCount": len(email_groups), "accountOnlyRows": account_only_rows,
            "missingTrainingGroupRows": missing_group_rows, "unassignedTrainingGroupRows": unassigned_rows,
            "deletedTrainingGroupRows": deleted_group_rows,
            "duplicateAccountNameRows": [rows for name, rows in account_name_rows.items()
                                         if len(account_name_groups[name]) > 1],
            "duplicateAthleteNameRows": [rows for rows in athlete_name_rows.values() if len(rows) > 1],
            "sharedContactEmailRows": [sorted(email_rows[email]) for email, groups in email_groups.items()
                                       if len(groups) > 1],
            "duplicateSourceRows": [rows for rows in duplicate_source_rows.values() if len(rows) > 1],
            "sourceRowMappings": provenance,
        },
    }


def write_private_json(output, prepared):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                         prefix=f".{output.name}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            os.chmod(temporary, 0o600)
            json.dump(prepared, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--sheet", help="Worksheet name; defaults to the first worksheet.")
    parser.add_argument("--output", type=Path, required=True, help="Private local JSON output path.")
    args = parser.parse_args(argv)
    if args.workbook.resolve() == args.output.resolve():
        parser.error("The output must not overwrite the source workbook.")
    try:
        prepared = prepare_accounts(args.workbook, args.sheet)
        write_private_json(args.output, prepared)
    except (PreparationError, OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        print(f"Account preparation failed: {error}", file=sys.stderr)
        return 2
    print(json.dumps({"sourceRows": prepared["source"]["rowCount"],
                      "accounts": prepared["review"]["accountCount"],
                      "athletes": prepared["review"]["athleteCount"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
