# Velocity Swimming

The website and tools share one Next.js app and Supabase project `hgsghjqefynhbavmkehv`. Use the latest Node 24 LTS (24.15.0 or newer), `npm ci`, and `npm run dev`. Ordinary development uses the configured backend; synthetic local development uses `supabase start`, `npm run seed:local`, and `npm run dev:local`. Never seed a hosted database.

- `/tools/data` is the owner's swimming data editor: Results, Swimmers, Meets, Standards, and Import File. Manual saves and meet files write directly after validation.
- `/tools/my-times`, `/tools/rankings`, `/tools/records`, and `/tools/standards` display eligible canonical data. Flagged and other excluded results remain stored.
- `/tools/admin` is the separate staff Accounts & Roster and Workshare tool.

Data management requires the verified owner account in both the API and database. Workshare staff permissions do not grant swimming-data management. Historical review URLs redirect to Data; collector tokens, approval queues, and prepared imports are retired.

See [Data management](docs/data-management.md) for supported files, identity matching, corrections, provenance, retirement, and verification. Applied SQL migrations remain in `supabase/migrations`; `supabase/seed.sql` installs only a local synthetic-fixture helper.

Run `npm run verify` for lint, types, unit/database tests, the production build, and private-artifact checks. With local synthetic data and a local app at port 3001, `npm run test:data:browser` checks direct entry, file imports, access controls, and moderation. CI rehearses retirement against a populated pre-retirement database before advancing it to the current schema.

See [verification](docs/verification.md) for the complete database and browser
coverage, and [architecture](docs/architecture.md) for feature ownership and
compatibility boundaries. The Supabase CLI is pinned to 3.4.0 in the lockfile and CI.

For a disposable local stack on different ports, set `VELOCITY_SUPABASE_WORKDIR`, `VELOCITY_SUPABASE_DB_CONTAINER`, and `VELOCITY_DATA_TEST_CONTAINER` before seeding and running database checks. The two container variables must name that stack's local database. Seeding writes its development environment file inside the selected workdir; `npm run dev:local` reads the same file. These helpers reject hosted backend URLs.

Private source originals and essential receipts are archived outside the checkout. Browser verification artifacts use temporary directories; do not create new backup trees in this repository. The active development server's cache must not be removed while it is running.

## Website update notices

Production builds now include mobile-friendly Update now/Later notices and a refresh confirmation. Use `npm run build` so all Next.js workers share one release ID. See [behavior, safeguards, and release checks](docs/WEBSITE-UPDATES.md).

## Store checkout and fulfillment

Set these server environment variables before running the store:

- `PRINTFUL_API_KEY`: store-scoped Printful token with product read and order read/write access.
- `STRIPE_SECRET_KEY`: Stripe secret key for the intended test or live environment.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the webhook endpoint in that environment.
- `SITE_URL`: canonical public origin, for example `https://your-domain.com`. Set this in production so checkout redirects do not depend on request headers. Local development falls back to the request origin.

Configure Stripe to deliver `checkout.session.completed` and
`checkout.session.async_payment_succeeded` to `/api/webhook`.

Checkout reads the selected product and variant from Printful on the server;
only synced, non-ignored variants with a valid USD retail price are purchasable.
The current shipping policy remains USD 5 to the US, Canada, or Great Britain.

Paid **live** sessions create orders with `confirm=1`, submitting them for
Printful fulfillment and charging the configured Printful billing method.
Stripe test sessions never create Printful orders. The success page verifies
payment status but does not claim shipping or fulfillment completion.

Fulfillment hashes the Checkout Session ID into a stable Printful `external_id`.
Printful enforces uniqueness within the store, so repeated events, concurrent
workers, and timeouts recover the same order. Existing drafts with that reference
are confirmed; submitted orders are reused. Failed, canceled, or on-hold orders
return a webhook error and require investigation in Printful. Missing shipping
information and provider outages also return errors so Stripe can retry.

Before rollout, reconcile any previously paid sessions and existing Printful
orders manually. Orders created by the old implementation have no stable external
reference; replaying those historical events can create another order.

Run the isolated commerce regression suite with `npm run test:commerce`.
It mocks provider responses and never creates real payments or orders.

Provider references: [Printful Orders API](https://developers.printful.com/docs/#tag/Orders-API)
and [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment).

## Admin

The standalone Admin page at `/tools/admin` contains Accounts & Roster, backed by staff-only
Supabase tables and an authenticated account editing API. See the
[Workshare model and API](docs/workshare/README.md).
