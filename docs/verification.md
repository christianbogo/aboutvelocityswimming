# Repository verification

Use Node 24 and the repository's pinned Supabase CLI 3.4.0 (`npm ci`). The CLI
targets the local stack by default; these checks never pass `--remote`. Existing
`config.toml` projects remain supported. CI and npm scripts use the same CLI
version. `SUPABASE_TELEMETRY_DISABLED=1` disables CLI telemetry when needed.

`npm run verify` runs secret checks, lint, types, unit tests, database integration
tests, and the production build. Database coverage includes swimming data,
attendance, account preferences, and the Workshare accounts, seasonal tickets,
account summary, and domain-staff permission suites. Run against seeded local
Supabase. The Workshare suites honor `VELOCITY_SUPABASE_DB_CONTAINER` through the
shared helper; their older `WORKSHARE_TEST_DB_CONTAINER` override remains supported.

`npm run test:browser` runs Data imports/editing, Records, and the released-feature
smoke check against a local app at port 3001. The smoke check exercises password
sign-in/out, account settings, persistent athlete preferences, My Times to Rankings
navigation, and staff roster autosave and access. It creates isolated local users
and accounts and removes them in `finally`; it does not open the Team page.
Use `npm run test:smoke:browser` to run just that check, optionally setting
`VELOCITY_BROWSER_URL` to another loopback frontend. Backend configuration comes
from the shared local Supabase helper and respects `VELOCITY_SUPABASE_WORKDIR`.

CI separately runs `npm run test:updates:browser` against two production builds
before starting the development server. The existing update harness verifies
deferred updates, confirmation, offline recovery, in-flight form protection,
rollback, and preservation of browser state. It blocks external requests and
uses synthetic sign-in responses. Build both releases with the seeded local
environment loaded; the second uses `VELOCITY_TEST_BUILD=true`. Never overwrite a
build directory while a server using it is running.

The obsolete profile browser script and its `test:profile:browser` alias have been
retired because they depended on the removed sample-family UI. Current account
behavior is covered by the smoke suite and account unit/database tests. The
persisted profile/avatar database policies still have integration coverage even
though the website no longer exposes profile editing.

Longer feature-specific browser scripts remain available for targeted changes.
Some predate the current UI and need selector/fixture updates before they can be
promoted into CI (notably old Workshare scripts using retired training groups,
settings controls, or the former staff landing page). They are not a substitute
for the smoke suite. Hardware/provider checks such as real OAuth and physical
passkeys remain separate from synthetic CI.

CI fails explicitly if its local app does not become ready, instead of starting
browser checks after a silent readiness timeout. Browser failures save screenshots
under the temporary artifact directory printed by each harness.
