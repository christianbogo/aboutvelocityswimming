# Admin: Accounts, seasons, and Workshare tickets

The **Admin** link opens `/tools/admin`. The **Accounts** tab retains registration
accounts, athletes, archive filters, and column controls. Click an account row to edit
it; account details, athletes, and seasonal requirements autosave. **Done** waits
for pending saves before closing. The **Tickets** tab lists completed work across
accounts with account, category, date-range, description, and pagination controls.

Verified `christiancutter02@gmail.com` and verified addresses on the exact
`velocity-swimming.com` domain can access Admin and their own Account page.
Existing explicit staff grants remain valid. The scoped `is_workshare_staff`
authority protects the Workshare API and tables; it does not grant owner access
to Data. Released Times, Rankings, Records, and Standards tools accept verified
accounts. Eligibility creates no grants or invitations. Ordinary sign-in opens
Account at `/tools`; authorized return paths and account-linking returns are preserved.

## Athletes and fixed practice groups

The **Athletes** tab manages the registration roster and athlete group assignments.
Practice groups are fixed in this order: Seniors, Juniors, Age Groupers, Prep,
Other. Other has a divider above it. Groups have no assigned coach and cannot be
created, renamed, removed, or reordered. All athletes, Unassigned, and Archived
are navigation filters; Unassigned appears when it contains athletes.

`workshare_groups.sort_order` is the shared, ascending display order, independent
of names. Both `GET /api/workshare/athletes` and `?groupsOnly=1` return groups in
that order (with ID as a deterministic tiebreaker). The Athletes sidebar, move
menus, and Accounts group controls consume it directly; new consumers should use
the same order. Database guards reject unsupported group edits from older clients.

`POST /api/workshare/athletes` accepts `action: "move"`, a `destinationId`, and
an `athletes` array of `{id, updatedAt}` pairs. The staff-only transaction verifies
every account version before moving any athlete; stale moves do not partially save.
The fixed-group migration preserves athletes and consolidates retired groups into Other.

## Seasons and required hours

One season picker applies to Accounts and Tickets and is retained in the URL. The default is
the season containing today in America/Los_Angeles, then the most recently started
season, then the earliest future season. Season switching is disabled during editing.

**Create first season** asks for a name and inclusive start/end dates and adopts
existing account requirements, preserving unset (`null`) and zero. **New season**
requires an explicit source season and copies its requirements. No tickets are
copied, so completed totals start at zero. Season dates cannot overlap, and saved
season definitions are immutable. Past seasons remain available for correction.

The account table displays completed / required hours for General, Starlight, and
Apple Capital, using `completed/-` for an unset requirement. Totals are calculated
from tickets on the server; they are never editable account fields. Separate
versions protect account details, seasonal requirements, and individual tickets.

## Creating and correcting tickets

Use **Add ticket** on an account row, in its editor, or on the Tickets tab. Select
an account, work date, description, category, and hours, then click **Add ticket**.
The work date must fall within the selected season. Today is prefilled only when
it falls inside that season; otherwise the date starts blank. Hours must be
positive, at most 10,000, and have at most two decimal places. Descriptions allow
1–500 characters. Each ticket credits exactly one category.

After creation, the form stays open with saved details and an **Add to more
accounts** list. Search by account name, email, or athlete name. Each **Add**
immediately saves an independent copy, shows **Added**, and offers **Undo**.
Successful copies stay visible if another account's save fails. Target rows retain
their positions while credits are added. **Use again** prefills a new creation
session; **New ticket** clears the saved details and credited-account indicators.

Open an existing ticket to autosave corrections or delete it. A correction or
deletion affects only that account's ticket and recalculates the appropriate
season/category total. Conflicts retain the draft for review rather than overwriting
another coach's changes. Archiving accounts or athletes preserves tickets.
Creation keys survive deletion, so delayed requests cannot recreate an undone ticket.
There is no detailed revision-history interface.

The Account page includes **Workshare Tracking** below Athlete Tracking. It shows
completed / required totals for the registration accounts whose contact emails
match the user's current verified sign-in email. A season picker provides past
totals; before first-season setup, existing requirements appear with zero
completed hours. Archived linked accounts remain visible. This read-only summary
includes associated contact emails, athletes, and tickets, with no editing
controls. Selecting an athlete to track does not establish a Workshare association.

Google Sheet history, scheduled jobs, and old volunteer records are not imported.
Account holders can read their ticket history; editing remains staff-only. Retired
Workshare URLs continue to redirect to Admin.

## Data model and staff editing API

| Table                                                                  | Purpose                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `workshare_accounts`, `workshare_account_emails`, `workshare_athletes` | Registration identity, contacts, roster, and independent account version       |
| `workshare_seasons`                                                    | Named, non-overlapping date ranges                                             |
| `workshare_account_requirements`                                       | Nullable General/Starlight/Apple Capital quotas and version per account/season |
| `workshare_tickets`                                                    | Independent dated credits with category, amount, and version                   |
| `workshare_ticket_create_keys`                                         | Idempotency fingerprints retained after ticket deletion                        |

All new tables use staff-only row-level security. API writes require an
authenticated staff session, same origin, and valid bounded JSON. Responses are
private and uncached.

- `GET /api/account/workshare` returns only the verified caller's associated
  accounts and totals. Optional `seasonId=UUID` selects a historical season.
  The `read_my_workshare_summary` RPC verifies ownership inside the database,
  without granting direct access to the roster or ticket tables.

- `GET /api/workshare/accounts` preserves the legacy account export shape.
- Adding `?seasonId=UUID` returns `{account, requirements, completed}` summaries.
- Account `POST`/`PUT` accept explicit core fields: name, emails, athletes, archive
  status, plus ID/version on updates. Derived totals and seasonal quotas never enter
  this payload. Legacy full records remain accepted for identity edits when their
  obsolete quota/season fields are unchanged.
- `PUT /api/workshare/accounts/{id}/requirements` accepts explicit `seasonId`, the
  exact requirements `updatedAt` (`null` for a missing row), and the three quotas.
- `GET`/`POST /api/workshare/seasons` list or create seasons. Creation includes a
  stable UUID, name, dates, and `copyFromSeasonId` (`null` only for the first season).
- `GET /api/workshare/tickets` requires `seasonId`; optional filters are `accountId`,
  `category`, `from`, `to`, `q`, and `page`. Pages contain 50 tickets, sorted newest first.
- Ticket `POST` includes a stable UUID, account/season, `completedOn`, description,
  category (`general`, `starlight`, `apple_capital`), and hours. Retry with the same
  UUID and original payload. Changed reuse returns `409`; a deleted key returns `410`.
- `PUT /api/workshare/tickets/{id}` accepts the exact `updatedAt` and editable fields.
  Account and season cannot change. `DELETE` includes `updatedAt` and is repeatable.

RPCs mirror these operations: `list_workshare_seasons`, `create_workshare_season`,
`list_workshare_account_summaries`, `save_workshare_requirements`,
`list_workshare_tickets`, `create_workshare_ticket`, `update_workshare_ticket`, and
`delete_workshare_ticket`. Existing account RPCs remain available. Once a season
adopts the legacy quotas, actual changes to obsolete scalar quota/current-season
fields are rejected, including direct table writes. Use scoped requirements instead.

## Workbook preparation and CLI editing

Prepare a registration export without changing the workbook or database:

```sh
python3 scripts/workshare/prepare-accounts.py "/path/to/registration.xlsx" \
  --output /path/to/private/workshare/staged-accounts.json
```

Use `--sheet "Worksheet name"` to select a worksheet; otherwise the first sheet
is read. The preparer groups rows by primary account email, includes account and
athlete contact emails, and preserves the exported training-group labels. It
leaves season, required hours, and Times links unset. Account and athlete archive
flags start as `false`.

The private JSON contains `accounts`, source filename/hash/worksheet/range, source
row mappings, and review lists for duplicate names, shared contacts, missing or
deleted training groups, and account-only rows. Review those lists before import;
the preparer does not infer identity matches or historical Workshare credits.

The Node 24 CLI supports initial population and later AI-assisted edits. Use an
explicit season for requirement exports and writes:

```sh
node scripts/workshare/accounts.mjs list \
  --output /path/to/private/workshare/current-accounts.json --config local-status.json
node scripts/workshare/accounts.mjs import \
  --file /path/to/private/workshare/staged-accounts.json \
  --output /path/to/private/workshare/import-receipt.json --config local-status.json
node scripts/workshare/accounts.mjs apply \
  --file /path/to/private/workshare/edited-accounts.json \
  --output /path/to/private/workshare/edit-receipt.json --config local-status.json
node scripts/workshare/accounts.mjs list --season SEASON_UUID \
  --output /path/to/private/workshare/season-accounts.json --config local-status.json
node scripts/workshare/accounts.mjs apply-requirements --season SEASON_UUID \
  --file /path/to/private/workshare/season-accounts.json \
  --output /path/to/private/workshare/requirements-receipt.json --config local-status.json
```

`--config` accepts JSON from `supabase status --output json`, using `API_URL` and
`SERVICE_ROLE_KEY`. Without it, the CLI uses `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Keep configuration, data files, and receipts private.

Without a season, `list` exports legacy account records with their IDs and versions.
With `--season`, it exports account summaries with separately versioned requirements
and computed totals. `apply-requirements` reads those nested requirements (or a plain
requirements array), validates every record's explicit season, and writes only quotas.

`import` accepts a nonempty account array or a preparer document containing `accounts`; all records
must be new and omit IDs and versions. The database imports 1–1,000 accounts in
one transaction and requires the account table to be empty. A failed record rolls
back the entire import, and a second import cannot duplicate populated accounts.

For `apply`, edit a fresh `list` export and preserve each account's `id`, exact
`updatedAt`, and existing athlete IDs. The CLI validates all input records before
writing, then saves accounts sequentially with version checks. Each account save
is atomic; the full file is not one transaction. It writes a receipt after every
successful account and stops on the first error. Review that receipt and reload
current versions before retrying a partial run. The receipt records returned IDs
and versions for successful saves. Write commands require a new receipt path and
verify it before changing data; output paths must differ from input and connection
configuration paths.

## Verification

With a seeded local Supabase stack, run `npm run verify`. The default database
suite includes accounts, seasonal tickets, account summaries, and domain-staff
access tests. These SQL fixtures roll back their transactions.

With the local app running, `npm run test:smoke:browser` checks current sign-in,
account settings, athlete preferences, and staff roster autosave/access. It
creates isolated synthetic users and accounts, cleans them afterward, and rejects
hosted backend URLs. `VELOCITY_BROWSER_URL` selects another local app port;
`VELOCITY_SUPABASE_WORKDIR` and `VELOCITY_SUPABASE_DB_CONTAINER` select a disposable
stack. See [repository verification](../verification.md) for the full CI workflow
and the distinction between maintained smoke checks and older targeted scripts.

## Account editor and workshare preferences

The Accounts table has a Columns menu for Athletes, General, Starlight, and Apple
Capital. Choices are remembered in this browser. Edit opens a persistent form on
the right and temporarily collapses navigation. The editor fills the screen height
and scrolls independently. Drag its divider, use Left/Right arrows, or press Enter
to reset the split. The left table becomes a clickable account picker with only
search; hidden archive and training-group filters do not limit that picker. Selecting
another account flushes both account and required-hours edits first. Invalid drafts
stay open. Done closes the editor and restores the full table and sidebar preference.
On narrow screens the picker and editor stack vertically. Add account stays beside
the Accounts and Tickets tabs. An account’s tickets appear first in its editor,
without category or date filters; those filters remain on the all-accounts Tickets tab.

Require Workshare defaults to Yes for existing and new accounts. No makes the
account exempt across seasons, with zero effective required hours on the table and
account page. Stored seasonal quotas and ticket history remain intact, so switching
back to Yes restores the saved requirements. Note to Account supports up to 2,000
characters and appears as plain text beside that account's Workshare totals.
Both values are account-version protected. Only staff can edit them; the existing
verified-email association controls which account holders can read the note.

Account writes accept `requireWorkshare` (boolean) and `workshareNote` (text).
Older clients may omit them without resetting either field. Apply migration
`20261119202705_workshare_account_preferences.sql` before releasing the UI.

## Archiving and athlete navigation

The account editor places Archive/Unarchive account beside Done. Each athlete
has Archive/Unarchive beside their name, followed by the settings button.
Archived athletes appear in the fixed Archived filter, have no training-group
assignment, and cannot be selected for group moves. Unarchiving leaves them
unassigned. A database trigger enforces this for older clients as well.

The Athletes table's Columns control remembers Account/Group visibility in the
browser. Athlete names remain visible for navigation; clicking a name or row
opens its registration account in the Accounts tab. The link icon matches the
Accounts table's Linked to Times indicator.
