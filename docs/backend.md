# The Worker

`worker.js` runs in front of the static assets. It serves `/api`, the HTML document and the calendar
feed.

- **The Worker's day is the UTC date** (`todayIso`). A meet is over once its last day is before that
  date. Every TTL, freshness check and graft uses it. The `day` parameter of a request is the
  client's local date.
- **A demo meet's responses are built per request and never stored in KV.**

## Debugging in production

- **The roster, meet, cup and medals routes report their stats in `x-<route>-*` headers**, on a
  cache hit or miss. A cache miss adds `-build-ms`, and a failed upstream fetch adds
  `-failed-statuses`, such as `429:5`.
- **`/api` routes return 405 to `HEAD`**, so read the headers with
  `curl -s -D - -o /dev/null -H 'x-kisat-client: 1' <url>`. `make tail` and the Cloudflare
  dashboard's Logs view show the same numbers in the log lines.
- **Change `ROSTER_FETCH_CONCURRENCY` only for a real 429** in `x-roster-failed-statuses`.
- **`x-meets-crawl` on `GET /api/meets` shows the meet crawler's progress**: the next id it will
  request, `done`, or `-` before the cron's first run.

## KV

All keys are in the `ROSTER` namespace, except the Watches.

| key                                                     | written by                                           | expires                                      |
| ------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| `meta:<id>`                                             | `loadMeetRow`                                        | after a day                                  |
| `cal:v1`                                                | `loadCalendar`                                       | rebuilt after 15 min, expires after an hour  |
| `roster:<id>`                                           | `handleRoster`                                       | 5 min, a week once the meet is over          |
| `meet:<id>`, `cup:<id>`                                 | `putMeet`                                            | 60 s for a cup meet, else 300 s              |
| `medals:v9:<id>[tag]`                                   | `putMedals`                                          | as `roster:`                                 |
| `digest:<id>`                                           | `cacheDigest`                                        | 180 days                                     |
| `medalseason:v4:<id>[tag]`                              | `putMedals`, `warmSeason`                            | 180 days, never once settled                 |
| `medalists:v1`                                          | `indexMedalists`, only on a change                   | never                                        |
| `cupseason:v2:<id>`                                     | `putMeet`, `buildCupSeason`                          | 180 days                                     |
| `results:v2:<id>:<event>[tag]`, `schedule:v1:<id>[tag]` | `putResults`                                         | 180 days, `ROSTER_CACHE_TTL_S` during a race |
| `t4r:v8:<id>`                                           | `t4rPagesOf`                                         | 45 days                                      |
| `orgs:v1`                                               | `cacheOrgs`, only on a change                        | never, and never pruned                      |
| `athletes:v1`                                           | `cacheAthletes` only on a change, `backfillAthletes` | never, pruned to two seasons (`seasonYears`) |
| `meets:v1`                                              | the cron only                                        | never, pruned as in "The meet index"         |
| `watch:<id>` in `WATCHES`                               | the Watch handlers                                   | 180 days after the last write                |

`[tag]` is `elsewhereTag`, which is empty for a meet not listed in `elsewhere.json`
(`docs/elsewhere.md`, "Keeping elsewhere.json").

- **`roster:`, `meet:`, `cup:` and `meta:` have no version in the key.** If the shape of their value
  changes, add a version to the key. Otherwise old values are served until they expire.
- **A digest and the three indexes store their version in the value** (`DIGEST_VERSION` and the
  `*_INDEX_VERSION` constants). A digest with another version is treated as missing and rebuilt. An
  index with another version is treated as empty.
- **Whether a digest or a season record is stale is separate from its KV expiry.** A stale value is
  still served, marked `stale`.
- **To rebuild the athlete index, raise `ATHLETE_INDEX_VERSION`.** The cron then refills it from the
  stored digests.
- **To change settled season records, raise their key's version.** A settled record is never
  rebuilt, so a change such as a club added to `districts.json` only reaches it under a new key. A
  new key also loses the meets that Tuloslista no longer returns ("A scope's year").

## Link previews

The Worker rewrites the document's title and description for the host. Under `/c/` they name the
meet, because link preview crawlers don't run scripts.

- **The tags never include a status or a result**, because messaging apps cache a preview for days
  (2026-09).
- **A failed preview never breaks the document.** A malformed id, a rate limit or an upstream error
  falls back to the site's default tags. The document waits for the meet's row, so the `/properties`
  fetch has a timeout (`META_FETCH_TIMEOUT_MS`).
- **The document's paths are outside the two `/api/*` WAF rules**, so `META_LIMITER` is the only
  limit on the preview's `/properties` fetches.

## The roster

`GET /api/roster/:compId` builds a meet's roster from the results of every event, so a cache miss
costs one upstream request per event (`docs/tuloslista-api.md`, "Nothing is keyed on a person").

- **Every fetch over a meet's events goes through `fetchEventResults`**, so they share one
  concurrency limit, one failure count and one log format.

## Meet settings

`GET /api/meet/:compId` returns one of three bodies:

```
{cup: false, confirm}
{cup: true, confirm, phase, clubs, scoring}
{cup: true, final: true, max, confirm, phase, clubs}
```

The last is a cup final. `confirm` is `{minutes}`, or null if the meet doesn't take confirmations.

- **This route is the client's only way to know whether a meet runs the cup or varmistus.** Every
  allocation has `SeuraCUPPoints`, and an entry's `Confirmed` is per person, so neither tells
  (2026-08).
- **`GET /api/cup/:compId` returns the rows that scored, from the same build**, on its own route
  because of its size. Every start view fetches the meet body.
- **A `scoring` entry is `eventId:allocId`**, because the demo reuses allocation ids across a
  multi-event's legs.

## The medal table

`GET /api/medals/:compId` returns the meet's medal tables (`docs/views.md`, "Medals"):

```
{table: [{id, name, medals: [gold, silver, bronze], total}],
 scopes: [{id, kind, name, short, table}],
 defaults: [{id, cover}],
 closed,
 starts: [{start, medals: [[clubId, medal, key, runners?]],
           scoped: [[scopeId, [[clubId, medal, key, runners?]]]]}],
 names: [[clubId, name]],
 athletes: [[key, name, licence]],
 unknown: [name]}
```

Each entry of `starts` is one class. `key` is `followedKey`. A relay's medal also has `runners`: its
runners' keys in `athletes`, in leg order.

- **The root events of multi-events are left out of `events`.** The Worker fetches them only for the
  medal table. The cup scores a club through the legs, so including the roots would score it twice.
  No fixture tests this, because no cup meet has a multi-event (`docs/tuloslista-api.md`, "The cup
  meets are small and plain").

## Results from another site

A meet listed in `elsewhere.json` gets its results from another site (`docs/elsewhere.md`). A medal
build writes the grafted events and schedule.

- **Each results key stores one event**, because a start view reads only a few events.
- **The results routes accept only meets listed in `elsewhere.json`.** They skip `COMP_ID_RE` and
  return 404 for any other meet before fetching anything.
- **No test covers a build**, because a build fetches from two outside sites.

## Watches

```
Watch { id, v: 2, label,
        entries: [{type: "athlete"|"club", id, name, enabled}],
        editToken, createdAt, updatedAt }
```

A Watch is stored in `WATCHES` under `watch:<id>`. A change to its shape needs a shim (`AGENTS.md`,
"A breaking change keeps users working").

- **There are no accounts.** The id is the read link, and `editToken` is the edit link. Only the
  response to the create contains the token.
- **A token can't be revoked or rotated**, so an edit link works as long as the Watch exists. To cut
  off an edit link, delete the Watch and share a new one.
- **Only writes check the token.** A `GET` takes no token. A `PUT` or `DELETE` with a wrong token
  gets 403. The token goes in the JSON body, never in the URL. A second `DELETE` gets 404, which the
  app treats as success.
- **An entry's `id` is a `LicenseId` for an athlete and an `Organization.Id` for a club**, because
  both stay the same across meets (2026-09).
- **A `PUT` can send `ifUpdatedAt`**, the `updatedAt` it loaded, and gets 409 if the stored Watch
  has changed since.
- **`ifUpdatedAt` only catches conflicts minutes apart.** KV has no compare-and-swap, and its reads
  are eventually consistent (2026-08).

## The scan

`GET /api/scan/:watchId?day=YYYY-MM-DD[&build=1]` returns which meets around `day` have a followed
athlete or club entered. It works in three layers.

- **Layer 1 is the calendar index** (`cal:v1`), the meet listing with each meet's actual days. A
  cold rebuild fetches up to `CAL_SCHEDULE_FETCH_LIMIT` schedules, nearest to `day` first.
- **Layer 2 is a digest per meet** (`digest:<id>`), the people entered. Only a roster build and a
  scan's build write one. No cron job prebuilds them.
- **Layer 3 is the scan itself.** A `build=1` request builds up to `SCAN_BUILD_LIMIT` digests, one
  at a time. The client's `MAX_BUILD_ROUNDS` (`app/shell.js`) allows for the rounds a cold window
  needs.
- **The Worker builds only on `build=1`**, in the scan and in both year routes, so a plain read
  makes no upstream requests.
- **The window is computed from `day` alone**, with `CAL_WINDOW_PAST_DAYS` and
  `CAL_WINDOW_FUTURE_DAYS`. A client-supplied range would let a client decide how many digests a
  scan reads.

## A scope's year

`GET /api/medalseason/:scopeId/:year[?build=1]` returns the medals of a scope's meets in a year. It
has the same three layers as the scan, with the meet index in place of the calendar and a season
record per meet in place of the digest. The years run from `SEASON_FIRST_YEAR` to the current one.

- **A `build=1` request builds meets until it reaches `SEASON_ROUND`'s count or time budget**,
  because one meet per request would hit `SCAN_LIMITER` on a cold year.
- **A meet index row has no results or entries.** So the organiser is matched to a piiri by name
  only (`docs/districts.md`), and the cron copies a record's `closed` pair onto the row.
- **A season record is settled a month after its meet's last day.** A settled record is never stale.
- **A settled record is kept forever**, because it may be the only copy of the meet's medals:
  Tuloslista can stop returning a meet (`docs/tuloslista-api.md`, "The listing"). The cron rewrites
  a settled record that still has a TTL without one. Change the key's version, a past meet's
  `elsewhereTag` or `MEET_INDEX_VERSION` only if losing those meets is acceptable.
- **The cron rebuilds a record without the `relayRunners` field under the same key**, settled or
  not. If the rebuild fails, the cron keeps the old record and sets `relayRunners: false`, so that
  it doesn't try again.

### A club's years

`GET /api/medalclub/:orgId` returns a club's medals in its scopes' championships and at the notable
meets (`docs/notable.md`), for every year:

```
{club: {id, name},
 scopes: [{id, kind, name, short}],
 years: [{year, scopes: [{id, meets, pending}]}]}
```

`kind` is `maa`, `alue` or `piiri` for a championship, and `notable` for a notable meet, which has
`short: null`. A championship's `meets` have the same shape as in a scope's year. A notable meet's
`meets` have the meet's own medals instead, and its classes in `ages`. Both include only the club's
medals.

- **The club's piiri is found from its `NameShort` in `orgs:v1`.** A season record has only the
  club's `Name`, so a club missing from the index gets 404.
- **The route only reads records and never builds them.** A meet with no record is listed in
  `pending`, and the scope's year or the cron builds it.
- **A notable meet's record without the meet's own medals is treated as missing**, and the cron
  rebuilds it.

### An athlete's years

`GET /api/medalathlete/:id` returns an athlete's medals in the championships and at the notable
meets, for every year:

```
{id,
 scopes: [{id, kind, name, short}],
 years: [{year, scopes: [{id, meets}]}]}
```

The shapes are those of a club's years, with only the athlete's medals, and only the scopes and
meets that hold one of them. Each meet also has `own`, the athlete's own keys in `athletes`, since
`athletes` also holds the athlete's relay teammates.

`id` is the medalist id. It is the athlete's licence, or `<clubId>-<name key>` for a medalist
without one, such as `147-ainoesimerkki`. The name key is that of `docs/elsewhere.md`. Shared links
carry the medalist id, so changing its format breaks them.

`medalists:v1` maps each medalist id to the meets whose season records list that medalist, by the
meet's own places or a scope's. The route reads only those records, so it also finds a medal won for
an earlier club.

- **The cron fills the medalist index.** Each season record's key carries the record's `builtAt` in
  its KV metadata. The cron lists the keys and reads only the records whose `builtAt` the index has
  not seen, up to `MEDALIST_INDEX_READS` a run. It reads a record stored without the metadata once.
  A record that a request builds reaches the athlete's page at the next cron run.
- **The athlete index can later find a licence for a medalist who had none.** A record keeps the
  licence it was built with. So each cron run looks up each medalist id without a licence in the
  athlete index, by club and name, and stores the licence it finds in the medalist index's `names`.
  The route then returns one page for both medalist ids, with the medals of both.
- **The route spends `SEARCH_LIMITER`**, so walking through the licences costs as much as walking
  through the search ("The athlete index").

### The cup's year

`GET /api/cupseason/:year[?club=<orgId>][&watch=<watchId>][&build=1]` works the same way over every
cup meet of the year, with `cupseason:v2` records instead of `medalseason:v4`. A meet whose settings
score nothing gets a record with no clubs, so it counts as built.

## The club index

Search and `/api/medalclub` merge a club's duplicate records in `orgs:v1` (`duplicateClubs`,
`docs/tuloslista-api.md`, "Categories, names and identity"). Watches and a meet's medal table don't.

## The athlete index

`athletes:v1` stores every licensed athlete that a build has seen in the last two seasons, so the
app can follow a person with no meet open.

- **The athlete index can be searched but not downloaded.** No route returns all of it, and
  `SEARCH_LIMITER` limits listing it through short queries.

## The picker's search

`GET /api/search?q=<query>[&comp=<compId>]` searches both indexes and the open meet's entrants.

- **A search never builds a roster.** The open meet's entrants come from its stored digest. A meet
  with no digest adds no one.

## The meet index

`meets:v1` stores every meet found by the listing or the crawler, so the front page's search reaches
past the listing's month. `GET /api/meets` returns it.

- **The index keeps two seasons (`seasonYears`), plus the championships and notable meets back to
  `SEASON_FIRST_YEAR`.** A year's medal page lists its meets from the index only, so a meet removed
  from the index disappears from its year.
- **A cron run sends `/properties` requests for up to `MEET_CRAWL_BUDGET` ids, one at a time.** The
  budget stays within the cron's ten minutes and the Workers Paid plan's 10,000 subrequests per
  request.

## Abuse protection

These limits apply to cache misses. A cache hit costs nothing upstream.

- **The Juoksut host returns 404 for every `/api/*` path except `GET /api/medals/:compId`.** The
  check uses the host, so `?mode=juoksut` on a dev host keeps all of `/api`.
- **Every `/api/*` request needs the header `x-kisat-client: 1`**, or the Worker returns 403. The
  header filters out scanners. It is not access control, because `app/data.js` shows it to anyone.
- **The zone's WAF has the same check as a Custom Rule** with the Block action, so a blocked request
  never invokes the Worker. Its expression is in `docs/deployment.md`, "A deployment of your own".
  Without the header, the deployed `/api/*` returns 403 with Cloudflare's HTML block page. It looks
  like a bot challenge, but only means the header is missing (2026-08).
- **The rate limiting bindings count per `CF-Connecting-IP` and per Cloudflare location**, not
  globally ([Cloudflare][rl], 2026-08), so they stop a single scraper but not a distributed one.
  `wrangler.jsonc` has their limits. Each binding counts only these requests:

  | binding            | counts                                                              |
  | ------------------ | ------------------------------------------------------------------- |
  | `ROSTER_LIMITER`   | a cache miss on the roster, meet, cup, medals or results routes     |
  | `WATCH_LIMITER`    | creating a Watch                                                    |
  | `SCAN_LIMITER`     | a `build=1` request of the scan or a year route that has work to do |
  | `CALENDAR_LIMITER` | a `/calendar.json` miss in the Cache API                            |
  | `META_LIMITER`     | a meet document's `/properties` fetch                               |
  | `SEARCH_LIMITER`   | a search query of at least `SEARCH_MIN_CHARS` characters            |

- **A zone WAF Rate Limiting rule covers `/api/*` on both hosts**, before the Worker runs. The Free
  plan allows one such rule, with a 10 s window.
- **Reading a Watch has no rate limit of its own.** Its id has 48 random bits. At the WAF rule's
  rate, a year of guessing from one address has about a one in three million chance of finding a
  given Watch.
- **Concurrent cache misses are not deduplicated.** Simultaneous first requests for an uncached meet
  each fetch everything themselves.

[rl]: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## The calendar feed

`GET /calendar.json[?day=YYYY-MM-DD]` is outside `/api/`, allows any origin, and is served from the
calendar index's cache:

```
{day, comps: [{id, name, location, organizationName, date, days}]}
```

- **Its shape is a public contract.** Any site may read it, and no test covers its consumers.
- **Neither WAF rule covers it**, since both apply to `/api/*` only. If the `/api/*` rules are ever
  widened, exclude this path, or the feed stops working.
