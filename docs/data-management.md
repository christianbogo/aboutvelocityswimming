# Swimming data management

Data (`/tools/data`) replaces the historical import-review system. Only the verified owner account can list private records or save changes; the database checks the account independently of the browser and API. Workshare staff privileges remain separate. Flagging, restoration, and private moderation evidence use the same owner check in the API and database.

## Manual editing

Results includes individual swims, relays, and flag/restoration history. Swimmers, Meets, and Standards each have direct editors. Saves validate the whole record and compare an opaque version with the current database contents. A stale edit returns HTTP 409 and writes nothing. Cancel and reopen the record to load current facts.

Changed record and moderation drafts ask for confirmation before Cancel, section
changes, or normal internal links. Saves and imports lock section navigation;
reload/close uses the browser's native unsaved-work prompt. Clicking the active
section preserves the editor. Browser Back/Forward and unrelated programmatic
navigation are not intercepted, so save or explicitly discard before using them.

Results retain their source identity when edited. A correction rebuilds both the previous and new event groups, refreshes team records, and invalidates the Times cache. Profile edits do not infer roster membership or backfill old results. Meet dates cannot exclude already recorded races.

A relay total belongs to the team. Its first swimmer is not automatically an individual result. A separate lead-off requires a linked first swimmer, verified flat-start timing, and source evidence. Use the relay editor's linked-first-leg correction option to commit related corrections together. Every dependent result has its own stale-edit check. Historical parentless lead-offs retain immutable source attestations; edits cannot contradict that verified identity, occurrence, or timing.

## Meet files

Import File accepts `.hy3`, `.cl2`, `.sd3`, and ZIP archives containing those formats. Choose up to 20 files totaling 20 MB; archives are bounded to 250 entries and 100 MB expanded. A browser worker parses the files. No Python process is used by the application.

Supply paired HY3 and CL2 exports together when available. HY3 checksums and paired facts are checked; explicit SDIF split increments and relay leg boundaries establish split distances. Missing intermediate marks remain missing. The parser never derives an individual lead-off from an ordinary relay split. The SDIF implementation follows the [vendor's format reference](https://support.activenetwork.com/hytekswimming/article?id=kA1d00000009L1o).

The browser sends up to 50 rows from one event at a time, limiting the ranking work in each transaction. The API and database independently validate normalized rows (maximum 100 rows and 1.5 MB per request). Valid rows save immediately; failures roll back all prerequisites created for that row. Results show saved, duplicate, skipped, and error outcomes with filenames, positions, and reasons. Choose All rows to inspect duplicates too. An interrupted upload can be repeated safely.

Matching uses stable source swimmer identities or an unambiguous verified name, birthday, and category combination. Name alone never merges profiles. Creating a new profile requires a unique source ID and complete identity details; its roster status starts inactive. Edit a swimmer to link a source ID when a file reports an unresolved identity.

Meet headers match an existing name and start date, or create a new meet. Multiple matches require selecting a meet explicitly. A selected meet must contain each actual race date. IE-VS results are in scope. IE-CUDA history requires the explicit historical-program choice and keeps its original affiliation. Other clubs are skipped.

Exact recorded performances are no-ops. Conflicting times, outcomes, categories, known ages, splits, or lineups require manual correction. Files cannot overwrite a result or choose between multiple occurrences. Disqualifications, no-shows, scratches, and unfinished swims retain their outcomes and do not become ranking times.

## Provenance and retirement

`/api/times/manage` and `/api/times/import` call the owner-authorized transactional database writer. Private audit rows record the actor, changed fields, filename, checksum, source position, and paired-source reference. Raw uploads, rejected candidates, and approval state are not stored.

The additive migration introduces direct management and compact identity links. After deploying Data, the retirement migration transfers evidence linked to actual retained records and creates bound source attestations for verified historical lead-offs. It removes staging, selections, approvals, held observations, collectors, and collection queues with explicit dependency drops. Source identity mappings, occurrence identities, moderation, published evidence, and all canonical records remain.

Retirement compares counts and content checksums for canonical records, public projections, bests, moderation, and source/occurrence identities in its transaction. It also compares old/new lead-off eligibility before dropping the old validator. A mismatch aborts the migration. Applied historical migration files remain intact.

## Verification and private artifacts

Current result-management and Times-dispatcher SQL definitions are collected in `20261120074116_explicit_result_functions.sql`. Full and event-scoped record refreshes share `private.team_record_winners`; their queue and locking behavior remain separate. Future changes should supply explicit function definitions in a new migration instead of replacing strings inside existing function source. Applied migration history stays intact.

`npm run test:data:database` exercises authorization, manual saves, stale conflicts, ranking changes, standards, partial imports, duplicates, identity conflicts, ambiguous meets, historical affiliation, and atomic relay/lead-off corrections. It uses synthetic local data and rolls back. `npm run test:swim-resources` covers the parser, API boundary, and shared result rules. `npm run test:data:browser` requires seeded local data and a local app.

CI first starts a disposable database with migrations through the additive writer, runs `npm run test:data:retirement` against published legacy fixtures, then advances to the final schema. `supabase/seed.sql` supplies `test_write_records` only for local synthetic fixtures; that helper is never a hosted migration.

The private archive is `/Users/christianbogo/Documents/Velocity Archive/2026-11-19-repo-pruning`. Its checksum manifest maps former repository paths to deduplicated originals and essential receipts. Copies are verified before repository copies are deleted. Git history is retained. New browser screenshots and logs belong in temporary directories through `scripts/verification-artifacts.mjs`, not `backups/`.
