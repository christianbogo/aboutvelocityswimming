# Times capacity incident — November 19, 2026

Eight people began using the site together at approximately 20:35 PST, primarily viewing leaderboards. Queries initially succeeded, then began timing out about ten minutes later. Supabase logs contain 111 statement timeouts between 20:43 and 21:05 PST (November 20, 04:43–05:05 UTC).

| Read path | Logged timeouts |
| --- | ---: |
| Rankings | 59 |
| My Times | 24 |
| Ranking years | 12 |
| Records | 3 |
| Other statements | 13 |
| Total | 111 |

The incident exposed avoidable amplification in the read path. It does not establish an inherent eight-user limit.

## Evidence and interpretation

The app used a wall-clock minute in its server cache key and client expiry. Views refreshed together, each minute created a new cache key, and identical requests could duplicate database work within one worker. This code evidence supports recurring request bursts as a contributor; it does not attribute every timeout to one cause.

Nano had 512 MB memory, a severe committed-memory warning, and observed swap use. Public RPCs had a three-second statement timeout. Leaderboards hydrated each displayed race separately; My Times repeated peer-cohort ranking and hydration for each event. Concurrent reads multiplied this work against unchanged data.

## Remediation

- Compute: Nano → Micro, confirmed at 1 GB and `ACTIVE_HEALTHY`. The upgrade review quoted $9.68/month for each, a $0 compute-price difference at that time.
- App reads: [stable cache keys and per-worker coalescing](../src/lib/times/server.ts), 60-second revalidation, [relative deadlines, jitter, and backoff](../src/components/collection/times-cache.ts), and [hidden-view suspension and recovery](../src/components/collection/watch-times.ts). Retryable refresh failures retain displayed results; writes still invalidate the cache.
- Database reads: batch leaderboard/recent race hydration, calculate My Times peer bests together, and reuse displayed race JSON. [Migration 20261120065505](../supabase/migrations/20261120065505_batch_times_rankings_and_race_details.sql) preserves other query branches and RPC contracts, uses security invokers, and changes no stored results or indexes.

## Validation and remaining limits

The isolated database passed 36 integration tests: 12 Times, 11 My Times, six moderation, and seven team-record tests. Complete ordered responses match the previous functions across filters and pagination, preserving ties, historical age/gender cohorts, displayed-swim ranks, relay fields, inherited moderation, and public visibility.

App validation passed all 483 swim-resource unit tests, the full `npm test` suite, lint, type checking, production build, and private-artifact checks. Browser checks observed zero reads across ten simulated hidden minutes, one read on returning to the foreground, no duplicate pending read, preserved results and recovery after a 503, and cancellation of a scheduled retry when the page became hidden.

Before/after database tests used 81,800 synthetic swims, 800 athletes, 12 events, three courses, ages 8–18, and two athletes with 1,000 swims each. Each version completed 144 burst requests and 19 serial references with zero errors/timeouts. All 19 ordered response hashes matched, excluding freshness metadata; every case returned data.

| Concurrent requests / pattern | Median before → after | p95 before → after |
| --- | ---: | ---: |
| 8 / identical | 55 → 31 ms | 66 → 65 ms |
| 8 / mixed filters | 37 → 24 ms | 54 → 70 ms |
| 16 / identical | 47 → 32 ms | 67 → 40 ms |
| 16 / mixed filters | 47 → 32 ms | 69 → 65 ms |

Median latency improved, while the eight-request mixed-filter tail varied upward. The authenticated local app also passed 163 reads with zero errors and 19/19 matching RPC hashes. In the initial cold run, 24 identical HTTP requests produced one database read, and all 144 burst requests produced 19 database reads. These used one shared synthetic authenticated session. See [the safe measurement summary](evidence/times-capacity-2026-11-19.json); run `node scripts/collection/times-concurrency-check.mjs --help` for the read-only [harness](../scripts/collection/times-concurrency-check.mjs).

Hosted migration history confirms `20261120065505`, and 10/10 exact pre/post JSON hashes matched across courses, genders, performances, pagination, recent results, and My Times age selections. Single warm SQL samples measured:

| Hosted read | Elapsed before → after | Shared-buffer hits before → after |
| --- | ---: | ---: |
| SCY female 100 freestyle rankings | 60.715 → 28.607 ms | 3,844 → 3,185 |
| My Times, extensive history | 115.866 → 107.571 ms | 18,510 → 31,110 |

My Times improved modestly in elapsed time but touched more shared buffers; this is not evidence of universally reduced database work. Final anonymous hosted RPC checks all returned 200: rankings, 25 rows in 277 ms; recent results, 25 rows in 219 ms; My Times, 22 events in 429 ms. These were serial, network-inclusive requests and verified invoker permissions. Supabase health advisors returned no issues, and existing security/performance findings were unchanged.

Production deployment `dpl_7TfoUo2sr4NgFGYriJE3qzBL9G6u` was promoted. The public app-version endpoint matched build `7f873e5b-dc19-4798-b520-9707f5757b6f`; home/login returned 200 and unauthenticated Times returned the expected 401. The authenticated production browser stopped at login, so the authenticated interaction checks above were local.

Capacity remains finite. Coalescing is per worker; separate workers and unique athlete/filter combinations can still generate parallel database reads. Cohort scans, sorting, and counts grow with the dataset. Short local bursts do not reproduce hosted resources or sustained use. Follow deployment with a representative session longer than ten minutes and review timeouts and database resource metrics before claiming a supported user limit.
