# The front page

`renderHome` (`app/home.js`) draws the front page: `Seuratut`, `Viimeksi katsotut` and `Kilpailut`,
in that order. On load it fetches the listing, `/calendar.json` and, with a follow-list, the scan.
Each section below names the code that decides its part and the checks that pin it, and then states
the rules that no test pins.

- `lib/home.js`: a meet's days against today, the sort and the rows of `Seuratut`. Tested in
  `test/home.test.mjs`.
- `lib/digest.js`: the lines under a matched row. Tested in `test/digest.test.mjs`,
  "buildDigest/scanDigest".
- `dev/probe-home.js` and `dev/probe-calendar.js`: the page with and without a follow-list, over the
  meets that `dev/probe.mjs` seeds.

## The sections

- `scanSection` (`app/home.js`), `scanHits` and `scanSince` (`lib/home.js`): `Seuratut`, its heading
  and its empty notice. Tested in `test/home.test.mjs`, "meetSortValue/scanHits".
- `homeRow` (`app/home.js`): a row, and the tint on a meet running today.
- `recentEl` in `renderHome`: how `Viimeksi katsotut` folds in each mode.
- `bar` in `renderHome`: the filter bar, which has no mode toggle and fetches no Watch record on
  render.
- `dev/probe-home.js`: the order of the sections, the tint, the fold and the missing toggle.

Rules:

- **`Kilpailut` is the whole listing whether or not a follow-list is on.** A follow-list changes
  neither its rows nor their order, so the meets in `Seuratut` show in it too. `dev/probe-home.js`
  checks it.
- **Home has no quick-filter.** The quick-filter stores one meet's `Athletes[].Id`, which means
  nothing in another meet (`docs/tuloslista-api.md`, "`Athletes[].Id` identifies an entry"). Across
  meets, a club or an athlete is followed on a follow-list.

## The search

- `paint` in `renderHome`: what a search matches, and the list it draws.
- `loadArchived` in `renderHome` and `archivedListingRows` (`lib/indexes.js`): the meets that the
  listing has dropped, fetched on the first keystroke. Tested in `test/indexes.test.mjs`, "meet
  index".
- `meetPlace` (`lib/home.js`): the venue and club that a row prints and a search matches. Tested in
  `test/home.test.mjs`, "meetPlace".
- `searchJumpPath` (`lib/routes.js`): the meet that Enter on an id opens. Tested in
  `test/routes.test.mjs`, "parseRoute".
- `dev/probe-calendar.js`: a hidden older meet found by a search, and the placeholder venue.

Rule:

- **A search covers `Kilpailut` alone.** It turns the list into one flat list of every meet it
  matches, however old, and the sections above it stay.

## A matched row's athlete lines

- `scanDigest` (`lib/digest.js`): the lines a row gets, their order, and the line a relay goes on.
- `scanEventLabel` (`lib/digest.js`): the name of an event on a line.
- `buildDigest` (`lib/digest.js`): the events in order of first start.
- `combinedEventRoots` (`lib/roster.js`): a multi-event as one event. Tested in
  `test/combined.test.mjs`, "combinedEventRoots".
- `scanAthleteLine` and `SCAN_ROW_LINES` (`app/home.js`): the line's three cells, and the lines a
  row shows before `+N muuta`.
- `.scan-athlete` (`public/index.html`): the columns, and the layout on a phone.

Rules:

- **A line has no times or results.** The digest is a cached roster, rebuilt only once it is stale.
- **The line cap has no expander.** The row is one link to the meet, and the lines past the cap show
  only as `+N muuta`.

## Dates and sorting

- `meetWhen`, `meetSortValue` and `meetIsRecent` (`lib/home.js`): where a meet sits against today,
  its place in the sort, and whether it hides behind `Näytä vanhemmat kilpailut`. Tested in
  `test/home.test.mjs`, "meetWhen" and "meetSortValue/scanHits".
- `knownDays` and `knownRanges` in `renderHome`: a meet's days. They come from `/calendar.json`,
  then the meets this device opened, then the scan, and each source overrides the one before it.
- `fetchCalendarDays` (`app/home.js`) and `rememberComp` (`app/data.js`): the first two sources.
- `localIsoDay` (`lib/dates.js`): today, on the device's own clock. Tested in `test/home.test.mjs`,
  "localIsoDay".
- `dev/probe-calendar.js`: the sort, the tint and the older meets.

## Filling the scan in

- `fetchScan` (`app/home.js`): the plain scan that a render asks for, which builds no digest.
- `renderFillStatus` and `autoRefreshing` (`app/shell.js`): the loop that asks with `build=1` a
  round at a time until nothing is pending or stale, its waits and its retry button. The year pages
  run it too.
- `scanSection` (`app/home.js`): the `Vanhentunut` chip on a stale meet, and the empty notice that
  waits for the pending meets.
- `docs/backend.md`, "The scan, and its three layers": what the Worker builds, and when.
- `dev/probe-home.js`: the loop over a stubbed scan.

Rule:

- **One loop runs per Watch.** A render that finds the loop running starts none. It shows neither
  that loop's rounds nor its end until the next render, so its status line stays frozen.
