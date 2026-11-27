# Code ownership

Velocity Swimming is one Next.js App Router application backed by Supabase. The
website, account area, swimming tools, and staff Workshare tools share authentication
and UI primitives. Routes compose feature code; server APIs and database functions
enforce access independently of navigation visibility.

| Responsibility                                                                        | Current owner                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Routes, layouts, metadata, and API entrypoints                                        | `src/app/`                                                                |
| Session provider and React auth context                                               | `src/features/auth/`                                                      |
| Supabase identity adapter and tool capabilities                                       | `src/lib/auth.ts`, `src/lib/tools-access.ts`                              |
| Browser/server Supabase clients and generated DB types                                | `src/lib/supabase/`                                                       |
| Swimming query contracts, domain types, ranking helpers, validation, and cache policy | `src/features/swimming/domain/`                                           |
| Times, Rankings, Records, Standards UI and browser loaders                            | `src/components/collection/`                                              |
| Cached swimming reads                                                                 | `src/lib/times/`                                                          |
| Owner data editor and import UI                                                       | `src/components/data/`                                                    |
| Result parsing, worker, validation, and server writes                                 | `src/lib/results/`                                                        |
| Staff accounts, roster, seasons, and tickets                                          | `src/features/workshare/`; `AccountsAdmin` composes its tabs              |
| Current account settings, athlete following, and Workshare summary UI                 | `src/components/shared/Account*.tsx`                                      |
| Reusable controls and tool navigation shell                                           | `src/components/shared/`                                                  |
| Marketing components and content                                                      | `src/components/`, `src/data/`                                            |
| Calendar and store provider integrations                                              | `src/lib/calendar*.ts`, `src/lib/store-catalog.ts`, `src/lib/commerce.ts` |
| SQL schema, authorization, projection updates, and historical migrations              | `supabase/`                                                               |
| Source photos and public image derivatives                                            | `assets/photos/`, `public/assets/photos/optimized/`                       |

The `collection` name remains on the swimming UI directory and route group for
now. New shared domain code belongs in `features/swimming/domain`, not alongside
components. Server modules may consume those domain contracts; they should not
depend on UI components or browser caches. A few old component/domain paths
re-export the new modules so unfinished Team work can continue without a broad
rename. Those adapters contain no separate implementation.

`features/swim-resources` still owns attendance, legacy public swimming pages,
and some shared swimming schema/normalization modules. It is not all dead code.
Migrate those owners individually when changing the corresponding feature rather
than replacing the entire directory at once. Likewise, the login view currently
lives under Workshare while its session state is owned by `features/auth`.

Use PascalCase for React components, descriptive kebab-case for domain modules
and hooks, and framework-required names for route files. Keep data contracts and
validation independent of React. Group additions by their current feature rather
than reviving retired collection or sample-family workflows.

Tests currently combine Vitest in `tests/swim-resources`, Node database suites in
`tests/`, and targeted browser scripts in `scripts/`. The historical test directory
name does not define product ownership. [Verification](verification.md) records
which checks run by default and which require targeted setup.

Applied SQL migrations and compatibility redirects preserve upgrade history and
existing bookmarks. Do not delete or renumber them as a naming cleanup. The former Firebase
configuration and rules are preserved verbatim in `docs/legacy/firebase/`, outside
the root deployment discovery path. The current runtime and CI use Supabase. This
archive makes no claim about the status of an external Firebase service.
