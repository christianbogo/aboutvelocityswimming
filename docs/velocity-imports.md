# Velocity Imports

Use the local Puppeteer session to navigate to the source and save the download or structured result capture directly to disk. Keep the capture and its manifest in the ignored `backups/` directory. The local uploader parses files, computes or verifies their hashes, and writes pending rows to Supabase. Its terminal output contains counts, a short list of exception reasons, and the review link.

## Stage a capture

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `VELOCITY_COLLECTOR_TOKEN` in `.env.collection.local`. A Knowledge-scoped token stages catalog meets. A Times-scoped token stages operational meets and results. Split mixed inputs into two manifests when using a token with only one scope. Use the exact Supabase project reference in the manifest, or `local:aboutvelocityswimming` for the local database.

```sh
npm run collection:import -- backups/my-import/capture.json --dry-run
npm run collection:import -- backups/my-import/capture.json
```

`--dry-run` parses the files and reports the planned requests with zero database calls. Add `--local-report backups/my-import/normalized.json` to retain normalized candidates and parser exceptions for inspection. Use a new report filename for each run. If an upload is interrupted, rerun the same manifest to reuse the same capture and skip rows already received.

For browser captures, save a manifest such as the following. Artifact paths are relative to the manifest.

```json
{
  "version": 1,
  "project": "local:aboutvelocityswimming",
  "captures": [
    {
      "format": "structured",
      "file": "rows.json",
      "sourceUrl": "https://example.org/meet/42",
      "capturedAt": "2026-11-11T20:00:00Z",
      "coverage": "partial",
      "sourceScope": "Meet results for one visiting club"
    }
  ]
}
```

`rows.json` contains a `rows` array. Each item has `kind`, `id`, and the existing canonical record `data` object.

```json
{
  "rows": [
    {
      "kind": "meet",
      "id": "example-meet-42",
      "locator": "meet/42",
      "data": {
        "name": "Example Invitational",
        "startsOn": "2026-11-10",
        "endsOn": "2026-11-10"
      }
    }
  ]
}
```

Supported kinds are `catalog_meet`, `meet`, `swim`, and `relay`. Include a source row ID or line label as `locator` when available. A known issue can be recorded as a `blocker`. For a Times row, add linked `prerequisites` in the same `{kind,id,data}` format for new `team`, `athlete`, or `venue` records. Use an existing meet ID or include a separately selectable `meet` row. Keep raw membership identifiers, dates of birth, and signed download URLs in the local capture. Use stable source IDs or digests and public-facing source URLs in normalized records.

For a saved Inland Empire event array, use `"format": "ies-catalog"` and a `cutoff` in ISO date format. The existing catalog parser converts eligible listings to pending catalog meets. Catalog coverage describes the supplied listings. Result and participation coverage have their own fields.

## Stage paired HY3/CL2 results

Use the existing [race source manifest and reviewed mappings](./collection-races.md) for the meet selection. The additive command reuses the checksum, exact B1 match, companion pairing, dated team mapping, stable member digest, split and relay checks. It uses explicit canonical meet and athlete mappings as references for the database to verify. Archive coverage remains partial. Individual lead-offs and reviewed catalog date corrections use the existing review workflow.

```sh
npm run collection:import -- backups/my-import/sources.json --mappings backups/my-import/mappings.json --dry-run
npm run collection:import -- backups/my-import/sources.json --mappings backups/my-import/mappings.json
```

## Review and pilot

Open **Velocity Imports → Import**. Start with **Issues to resolve** above the pending tables. Open a swimmer match, choose the profile, and save. The corrected swims return to the pending list for separate approval. If a swim needs a linked meet that is ready for approval, open **Review linked meet** and approve the meet there. Issues that need a corrected capture show the original source and captured fields.

The page checkbox covers the visible page. **Select all matching** freezes the matching rows when clicked. The approval preview lists blockers and linked records such as newly introduced swimmers and teams. Open [Batch review and history](/tools/review/batches) for corrections and legacy imports. Use **Viewer** to browse imported Swims and Meets.

For a pilot, process the same saved meet archive against equivalent test databases. Record the browser acquisition time once. Compare preparation, request bytes, time until rows appear in the queue, time to load the review page, and time from approval to Times visibility. Count model tokens from the session that performs the same acquisition and review task. Verify the selected results in Times, best times, team records, and Archive, and check that the unselected results remain private. Keep the existing workflow available while running the pilot.

### Local pilot results

On one saved HY3/CL2 archive, median local preparation across three runs was 1,037 ms on the legacy path and 125 ms on the new path. The legacy preparer read a 68.5 MB baseline. The new preparer read the capture and mappings, producing 80 candidates in a 339 KB request and four parser exceptions.

Rollback-only runs of the same 80 candidates against an isolated database gave these median results. The legacy comparison stages and approves prerequisites before results. Review time is the database query time. The new review payload contains the first page of each table.

| Database step | Legacy | Pending rows |
| --- | ---: | ---: |
| Stage | 14 ms | 89 ms |
| Load review data | 2 ms / 41 KB | 17 ms / 19 KB |
| Prepare approval preview | — | 56 ms |
| Publish | 99 ms | 169 ms |

The browser smoke test used synthetic rows and verified frozen selection, linked-record approval, and retry after a lost response. A production pilot still needs browser acquisition and end-to-end model token measurements before the production workflow changes.

For rollout, apply the import queue migration before deploying the new review page. Legacy proposals and receipts remain available in Batch review and history. If the app is rolled back, retain the private queue tables so staged rows and approval receipts are available after redeployment.

## GoMotion held observations

Use the retained audit and original GoMotion exports to load the private archive. The loader verifies the receipts, source rows, and workbook checksums. Use the same audit to resume or verify a replay after loading.

```sh
node scripts/collection/load-held-observations.mjs backups/imports/gomotion-resume-preparation/final-backfill-audit-complete.json --dry-run
node --env-file-if-exists=.env.collection.local scripts/collection/load-held-observations.mjs backups/imports/gomotion-resume-preparation/final-backfill-audit-complete.json --project YOUR_SUPABASE_PROJECT_REF
```

Open **Velocity Imports → Held Observations**, select an observation or swimmer group, and choose a profile under **Link swimmer**. **Link swimmer and approve eligible swims** checks the full source swimmer ID across meets and publishes every result that passes. The receipt shows approvals, previously recorded results, and observations that still need review. Keep the page open until the receipt shows the whole group has been checked. If the request is interrupted, resume with the same profile.

Use **Review meet export** to confirm a workbook at the event or round level. Keep the original GoMotion affiliation and confirm historical Barracuda eligibility when it applies. The audit records who made the decision and uses the source already on file.

Use **Review one result** to compare the source, proposed result, and any published result. Approve individually staged times in **Import**. A newly confirmed age or relay lineup is a correction to the existing result and goes through **Batch review and history**.

When staff have verified that the GoMotion export is an official source, use **Accept all GoMotion observations** on **Held Observations**. It takes a snapshot of the archive across all filters and saves progress after each batch. Reopen the page and use **Resume archive acceptance** after an interruption.

The receipt distinguishes newly published Times results, observations already represented by a published result, and **Accepted source only**. Every observation is accepted with its original workbook, row, round, and outcome intact. When the export omitted the official flag, the approval can supply that trust. A canonical result still needs a resolved swimmer or relay, meet, date, event, and race occurrence. A nonfinish, a conflict, or incomplete race information stays in the accepted archive and can be reviewed later. The bulk action does not rewrite existing results.
