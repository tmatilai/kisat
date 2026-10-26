# The Worker

`worker.js` sits in front of the static assets and answers `/api`, the document's paths and the
calendar feed. This doc holds its KV keys, the bodies whose shape is a contract, the rules no test
pins, and the measurements behind its caps.

- `API_ROUTES` (`worker.js`): every `/api` route and its methods.
- the `fetch` entry point (`worker.js`): `/calendar.json`, the demo redirects, the per-host assets,
  the shim redirects and the document, in that order, then the Juoksut gate, the header gate and
  `POST /api/cron`.
- `runCron` (`worker.js`) and `triggers` (`wrangler.jsonc`): the cron and its schedule.
- `run_worker_first` (`wrangler.jsonc`): the asset paths that reach the Worker.

Rules:

- **The Worker's day is UTC.** `todayIso` returns it. A meet is over once its last day is before
  that day, and every TTL, freshness rule and graft goes by that. A request's `day` parameter is the
  client's own day.
- **A demo meet's bodies are built on the spot and never written to KV.** `demoApiBody` runs the
  same `lib/` functions over the demo's fixture, so a demo's meet body comes from its own
  `Settings`, never from its id.

## Reading it in production

- **The roster, meet, cup and medals routes send their stats as `x-<route>-*` headers, hit or miss**
  (`jsonResponse`). The results, scan and year routes send headers of their own. A miss adds
  `-build-ms`, and a failed fetch adds `-failed-statuses`, such as `429:5`. A meet's path sends
  `x-meet-meta`.
- **An `/api` route answers `HEAD` with 405**, so read the headers with
  `curl -s -D - -o /dev/null -H 'x-kisat-client: 1' <url>`. `make tail` and the dashboard's Logs
  view show the same numbers in the log lines.
- **A real 429 in `x-roster-failed-statuses` is the reason to change `ROSTER_FETCH_CONCURRENCY`.**
- **`x-meets-crawl` on `GET /api/meets` is the meet crawler's cursor**, `done`, or `-` before the
  cron's first run.

## KV

Every key is in `ROSTER` except the Watches.

| key                                                     | written by                                           | life                                |
| ------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------- |
| `meta:<id>`                                             | `loadMeetRow`                                        | a day                               |
| `cal:v1`                                                | `loadCalendar`                                       | rebuilt after 15 min, kept an hour  |
| `roster:<id>`                                           | `handleRoster`                                       | 5 min, a week once the meet is over |
| `meet:<id>`, `cup:<id>`                                 | `putMeet`                                            | 60 s on a cup, else 300 s           |
| `medals:v9:<id>[tag]`                                   | `putMedals`                                          | as the roster                       |
| `digest:<id>`                                           | `cacheDigest`                                        | 180 days                            |
| `medalseason:v4:<id>[tag]`                              | `putMedals`                                          | 180 days                            |
| `cupseason:v2:<id>`                                     | `putMeet`, `buildCupSeason`                          | 180 days                            |
| `results:v2:<id>:<event>[tag]`, `schedule:v1:<id>[tag]` | `putResults`                                         | 180 days                            |
| `t4r:v7:<id>`                                           | `t4rPagesOf`                                         | 45 days                             |
| `orgs:v1`                                               | `cacheOrgs`, only on a change                        | no TTL, never pruned                |
| `athletes:v1`                                           | `cacheAthletes` only on a change, `backfillAthletes` | no TTL, two seasons (`seasonYears`) |
| `meets:v1`                                              | the cron alone                                       | no TTL, two seasons (`seasonYears`) |
| `watch:<id>` in `WATCHES`                               | the Watch handlers                                   | 180 days after the last write       |

`[tag]` is `elsewhereTag`, which is empty for a meet that `elsewhere.json` does not list
(`docs/elsewhere.md`, "Keeping elsewhere.json").

- **`roster:`, `meet:`, `cup:` and `meta:` carry no version.** A change to the shape of their body
  adds one to the key, or the old bodies are served until their TTL ends.
- **A digest carries its version in the body** (`DIGEST_VERSION`). One of another version reads as
  missing and is built again. The three indexes carry theirs in the body too, and one of another
  version reads as empty.
- **A digest's or a season record's freshness is not its life in KV.** `isStale` decides it, and a
  stale one is still served, marked `stale`.
- **To rebuild the athlete index, raise `ATHLETE_INDEX_VERSION`.** The cron's backfill
  (`backfillAthletes`) then refills it from the stored digests.
- **To change settled season records, raise their key's version.** A settled record is never built
  again, so a change such as a club added to `districts.json` reaches it only under a new key.

## The document, and what a preview says

The Worker serves `index.html` for the document's paths and rewrites its title and description per
host as it streams. Under `/c/` they name the meet, since a link preview's crawler runs no script.

- `siteMeta` (`lib/routes.js`): the tags for a host and a meet.
- `loadMeetRow` (`worker.js`): the meet's row, from the calendar's cache, else from one
  `/properties` fetch.
- `routeModules` (`lib/routes.js`) and `moduleFiles` (`worker.js`): the modules the document
  preloads.

Rules:

- **The tags never carry a status or a result**, since a messaging app caches a preview for days
  (2026-09).
- **A failed preview never costs the document.** A malformed id, a limiter refusal or an upstream
  error serves the site's plain tags. The document waits for the row, so the `/properties` fetch has
  a timeout (`META_FETCH_TIMEOUT_MS`), and a slower answer is a failure.
- **The document's paths are outside the two `/api/*` WAF rules on both hosts**, so `META_LIMITER`
  alone caps a preview's `/properties` fetch.

## The roster

`GET /api/roster/:compId` builds a meet's roster from every event's results, so a miss costs a
subrequest per event (`docs/tuloslista-api.md`, "Nothing is keyed on a person"). The same results
then give the meet's digest, the two picker indexes, the meet body and the medal body.

- `buildRoster` (`lib/roster.js`): the rows, one per entry.
- `handleRoster` (`worker.js`): the cache, the limiter and the writes after a build.
- `aloneRoster` (`worker.js`): the roster of a row of `elsewhere.json` that stands alone.
- `fetchEventResults` (`worker.js`): the fan-out over a meet's events.

Rule:

- **Every fan-out over a meet's events goes through `fetchEventResults`**, so one concurrency cap,
  one failure tally and one log shape cover them all.

## What a competition's own settings say

`GET /api/meet/:compId` answers one of three bodies:

```
{cup: false, confirm}
{cup: true, confirm, phase, clubs, scoring}
{cup: true, final: true, max, confirm, phase, clubs}
```

The last is a final of the series. `confirm` is `{minutes}`, or null where the meet does not confirm
entries.

- `cupBody` (`lib/cup.js`): the meet body.
- `cupBreakdown` (`lib/cup.js`): the body of `GET /api/cup/:compId`, the rows that scored.
- `aggregateMeet` (`worker.js`): one `/properties` read, and the fan-out for a cup alone.
- `putMeet` (`worker.js`): the write of both halves, which `cacheMeet` calls after a roster build.

Rules:

- **This route is the client's only gate on both settings**, the cup and varmistus. Every allocation
  carries `SeuraCUPPoints`, and an entry's `Confirmed` is that person's alone, so neither says
  whether the meet runs the cup or varmistus (`docs/tuloslista-api.md`, "Club-cup points (Seuracup)"
  and "Varmistus (confirmation)"). A cached meet that is neither costs one KV read.
- **`GET /api/cup/:compId` is the same build's other half**, on a route of its own for its size. It
  was about 30 kB on a cup meet and 50 kB on a final (2026-09), and every start view fetches the
  meet body.
- **A `scoring` key is `eventId:allocId`**, not the bare allocation id, since the demo reuses
  allocation ids across a multi-event's legs (`cupScoringKey`).
- **A row of `elsewhere.json` that stands alone has no meet body.** Both routes refuse its id
  with 400.

## The medal table

`GET /api/medals/:compId` answers the meet's medal tables. `docs/views.md`, "Medals", has their
rules. The body:

```
{table: [{id, name, medals: [gold, silver, bronze], total}],
 scopes: [{id, kind, name, short, table}],
 defaults: [{id, cover}],
 closed,
 starts: [{start, medals: [[clubId, medal, key]],
           scoped: [[scopeId, [[clubId, medal, key]]]]}],
 names: [[clubId, name]],
 athletes: [[key, name, licence]],
 unknown: [name]}
```

An entry of `starts` is a class, and `key` is `followedKey`.

- `meetMedalsBody` (`lib/medals.js`): the body.
- `cacheMedals` and `handleMedals` (`worker.js`): the body from a roster build, or from a miss.

Rule:

- **The multi-events' roots stay out of `events`.** The fan-out fetches them for this table alone,
  since the cup scores a club through the legs and would score it twice. No fixture catches the cup
  scoring a root, since no cup meet holds a multi-event (`docs/tuloslista-api.md`, "The cup meets
  are small and plain").

## Results from another site

A meet that `elsewhere.json` lists gets its results from another site once it is over, or a race's
on its days too, as `docs/elsewhere.md` describes. A medal build writes the grafted events and
schedule.

- `graftElsewhere` (`worker.js`): which source a listed meet reads.
- `handleResults` (`worker.js`): `GET /api/results/:compId/:eventId` and `GET /api/results/:compId`.
- `elsewhereTag` (`lib/elsewhere.js`): the tag a listed meet's keys carry.

Rules:

- **A results key holds one event**, since a start view reads a few, and a meet's grafted events
  weighed about a megabyte together, the largest some 100 kB (2026-09).
- **A race's keys written on its days live `ROSTER_CACHE_TTL_S`**, since its classes are still in
  progress, and the keys written once it is over live as long as a digest.
- **The results routes take only a meet that `elsewhere.json` lists.** They check no `COMP_ID_RE`,
  and any other meet gets 404 before anything is spent.
- **`test-worker.mjs` tests a results hit and an unlisted meet's 404, never a build**, since a build
  reaches two outside sites.

## Watches

```
Watch { id, v: 2, label,
        entries: [{type: "athlete"|"club", id, name, enabled}],
        editToken, createdAt, updatedAt }
```

A Watch is kept in `WATCHES` under `watch:<id>`. A change to its shape needs a shim (`AGENTS.md`, "A
breaking change keeps users working").

- the Watch handlers (`worker.js`, section "Watches"): create, read, update and delete.
- `normalizeWatchInput` (`lib/watch.js`): the body a write may store.
- `watchTargets` (`lib/watch.js`): an entry resolved through a meet's roster.

Rules:

- **There are no accounts.** The id is the read link and the `editToken` is the write link. Only the
  create's response carries the token.
- **A token is a bearer capability with no revocation.** Nothing rotates a token, so an edit link
  works as long as the record lives. The remedy is to delete the list and share a new one.
- **Nothing checks a token short of a write.** A `GET` takes no token, so only a `PUT` or a `DELETE`
  checks one, and a wrong one gets 403. A write sends the token in its JSON body, never in the URL.
  A second `DELETE` answers 404, which the app counts as done.
- **An entry's `id` is a `LicenseId` for an athlete and an `Organization.Id` for a club**, since
  both hold across meets (`docs/tuloslista-api.md`, "Categories, names and identity").
  `watchTargets` resolves them through each meet's roster.
- **A `PUT` may name the record it worked from** with `ifUpdatedAt`, the `updatedAt` it loaded, and
  gets 409 where the stored one has changed. Every write of the app sends it.
- **`ifUpdatedAt` catches only a race minutes long.** KV has no compare-and-swap, and its reads are
  eventually consistent (2026-08).

## The scan, and its three layers

`GET /api/scan/:watchId?day=YYYY-MM-DD[&build=1]` answers which meets around `day` have somebody of
a Watch entered.

- `handleScan` (`worker.js`): the response, the window and the builds.
- `loadCalendar` (`worker.js`): the calendar index.
- `buildDigest` and `scanDigest` (`lib/digest.js`): a digest's layout and its matching.

Rules:

- **L1 is the calendar index** (`cal:v1`). It holds the listing and each candidate's real days. A
  cold rebuild fetches up to `CAL_SCHEDULE_FETCH_LIMIT` schedules, nearest `day` first. That costs
  about one roster build's traffic, at about 27 KB a schedule (2026-08).
- **L2 is the presence digest** (`digest:<id>`). Only a roster build and a scan's build write one,
  and no cron warms the digests.
- **L3 is the scan itself.** A `build=1` request builds at most `SCAN_BUILD_LIMIT` digests, one at a
  time. A cold window of a summer listing needs some 26 rounds under `SCAN_LIMITER`, a few minutes
  (2026-08), and `MAX_BUILD_ROUNDS` (`app/shell.js`) outlasts it.
- **A row of `elsewhere.json` that stands alone joins the window from the file**, as the calendar
  has no meet of it. Its digest comes from the build of its roster (`aloneRoster`).
- **The Worker builds only when asked** (`build=1`), in the scan and in both years, so a plain read
  costs nothing upstream.
- **The window comes from `day` alone**, through `CAL_WINDOW_PAST_DAYS` and
  `CAL_WINDOW_FUTURE_DAYS`, and never from the client's `from` or `to`. A client's window would set
  how many digests a scan reads. `CAL_SCHEDULE_FETCH_LIMIT`, not the window's width, bounds a cold
  rebuild.

## A scope's year

`GET /api/medalseason/:scopeId/:year[?build=1]` answers the medals of a scope's meets of a year. It
has the scan's three layers: the meet index takes the calendar's place, and a meet's season record
the digest's.

- `handleMedalSeason` (`worker.js`) and `medalSeasonMeets` (`lib/medals.js`): the response and its
  meets.
- `medalSeasonRecord` (`lib/medals.js`): a meet's record, which `putMedals` writes wherever it
  writes the medal body.
- `warmSeason` (`worker.js`): the cron's builds of this year's records.

Rules:

- **A `build=1` round builds meets until `SEASON_ROUND`'s count or its 12 s are spent**
  (`buildRoundGoesOn`). A cold year was 9 to 15 meets, so one meet a request would outrun
  `SCAN_LIMITER`. One meet built in 3 to 8 s, and three in a row in 8 to 19 s (2026-09).
- **A meet index row has neither result rows nor entries.** So the organiser matches a piiri by name
  alone (`docs/districts.md`), and the cron's warming copies a record's `closed` pair onto the row
  (`meetIndexClosed`).
- **A season record settles a month after its meet's last day** (`recordSettled`), and it never goes
  stale after that.

### The cup's year

`GET /api/cupseason/:year[?club=<orgId>][&watch=<watchId>][&build=1]` has the same layers over every
cup meet of the year (`cupSeasonMeets`), with `cupseason:v2` records in place of `medalseason:v4`. A
meet whose settings score nothing gets a record with no clubs, so it counts as built
(`buildCupSeason`).

## The club index

`orgs:v1` holds every club a build has seen, and nothing prunes it. `/api/search` and the grafts
read it.

- `mergeOrgIndex` (`lib/indexes.js`): the rows.
- `cacheOrgs` (`worker.js`): the write after a roster build or a scan's build.

## The athlete index

`athletes:v1` holds every licensed athlete a build has seen over two seasons, so a person can be
followed with no meet open. Two seasons' rows came to about 540 KB in one KV value (2026-09).

- `mergeAthleteIndex` (`lib/indexes.js`): the rows and the pruning.
- `cacheAthletes` and `backfillAthletes` (`worker.js`): the writes.
- `athleteLicences` (`lib/elsewhere.js`): the licence a graft gives a made person
  (`docs/elsewhere.md`, "The licence a made person gets").

Rule:

- **The athlete index can be searched, not read.** No route serves its rows whole, and
  `SEARCH_LIMITER` bounds walking it with short queries.

## The picker's search

`GET /api/search?q=<query>[&comp=<compId>]` answers the clubs and athletes the create and edit
sheets offer, from the two indexes and the open meet's entrants.

- `searchBody` and `searchRank` (`lib/search.js`): the body, with a match at the start of a word
  before one inside a word.
- `handleSearch` and `scopedSearch` (`worker.js`): the limiter and the open meet's rows.

Rule:

- **A keystroke never builds a roster.** The open meet's entrants come off its stored digest, and a
  meet with no digest adds nobody.

## The meet index

`meets:v1` holds every meet the listing or the crawler has found, so home's search reaches past the
listing's month. `GET /api/meets` serves it (`meetIndexMeets`).

- `crawlMeets` (`worker.js`): the crawl, which runs in the cron.
- `mergeMeetIndex`, `meetCrawlPlan` and `meetCrawlApply` (`lib/indexes.js`): the merge and the
  crawl's steps.

Rule:

- **A run asks `/properties` about up to `MEET_CRAWL_BUDGET` ids, one at a time.** 400 took 23 s on
  a local `wrangler dev` (2026-09). That is well inside the cron's ten minutes and the Workers Paid
  plan's 10,000 subrequests a request (2026-09).

## Abuse protection, layered

The layers below cap the cache misses, and a cache hit spends nothing.

- **The Juoksut host answers 404 to every `/api/*` path but `GET /api/medals/:compId`.** The host
  decides, so `?mode=juoksut` on a dev host keeps all of `/api`.
- **Every `/api/*` request needs `x-kisat-client: 1`**, or the Worker answers 403. The header is a
  filter for scanners and not access control, since `app/data.js` shows it to anyone.
- **The zone's WAF holds the same check as a Custom Rule** with action Block, so a refusal costs no
  Worker invocation. Its expression is in `docs/deployment.md`, "A deployment of your own". Without
  the header, the deployed `/api/*` answers 403 with Cloudflare's HTML block page, which looks like
  a bot challenge and means only the missing header (2026-08).
- **The rate limiting bindings count per `CF-Connecting-IP` and per colo**, not globally
  ([Cloudflare][rl], 2026-08), so they stop a lone scraper and not a distributed one.
  `wrangler.jsonc` has their figures. Each spends only on what it counts:

  | binding            | spends on                                                          |
  | ------------------ | ------------------------------------------------------------------ |
  | `ROSTER_LIMITER`   | a cache miss on the roster, meet, cup, medals or results routes    |
  | `WATCH_LIMITER`    | a Watch create                                                     |
  | `SCAN_LIMITER`     | a scan's or a year's `build=1` request that has something to build |
  | `CALENDAR_LIMITER` | a `/calendar.json` miss in the Cache API                           |
  | `META_LIMITER`     | a meet path's `/properties` fetch                                  |
  | `SEARCH_LIMITER`   | a query of at least `SEARCH_MIN_CHARS` characters                  |

- **A zone WAF Rate Limiting rule covers `/api/*` on both hosts**, before the Worker runs. The
  zone's Free plan allows one such rule, with a 10 s window, and a burst got 30 requests through it
  before a 429 (2026-08).
- **A Watch's `GET` has no binding of its own.** Its id is 48 random bits. At the zone rule's rate,
  a year of guessing from one address finds a given list with odds of about one in three million.
- **A cache-miss build has no single flight.** Concurrent first requests for one uncached meet each
  run their own fan-out.

[rl]: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## The calendar feed

`GET /calendar.json[?day=YYYY-MM-DD]` sits outside `/api/` and answers any origin, off
`loadCalendar`'s cache:

```
{day, comps: [{id, name, location, organizationName, date, days}]}
```

- `handleCalendar` (`worker.js`): the Cache API, the limiter and each field's default.
- `CALENDAR_PATH` and `CALENDAR_CORS` (`worker.js`): the path and its CORS headers.

Rules:

- **Its shape is a public contract**, since any origin may read it and no test of a consumer guards
  it.
- **Neither WAF rule covers it**, since both are scoped to `/api/*`. If the `/api/*` rules are ever
  widened, this path must be excluded by hand, or the feed stops.
