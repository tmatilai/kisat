# Checking a change in a browser

A **probe** asserts on the page at a phone width. A **look** is one screenshot and proves no rule,
so a finding worth keeping goes into a probe.

## Running a probe

```sh
make probe PROBE=probe-filter      # one probe, line by line
make probes                        # every probe in OFFLINE
```

`OFFLINE` in `probe.mjs` lists the probes that `make probes` runs, with their queries. Every other
probe's header says what it covers, its query, and the server or data it needs.

- **A probe that reads `/api/*`, or loads a document such as `/mitat`, runs on `make dev`**, with
  `PROBE_HOST=localhost:<DEV_PORT>`. A route such as `c/demo` needs no server, since the runner
  opens `/` and navigates.
- **A `FAIL` in a probe that reads live data is checked against the live page first.** A round drawn
  since the probe was written changes what it reads.

`Q` is the runner's query, with these keys:

- `url`: the app route, with `?` and `#` written as `%3F` and `%23`, such as `c/demo`,
  `c/demo%23/a/i1-a`, or `%3Fmode%3Djuoksut` for Juoksut mode.
- `w` and `h`: the iframe's size, 402×787 by default.
- `wait`: the settle time in milliseconds, 1500 by default.

## Writing a probe

- **Log the values, then assert on them**, so that a failing probe shows what it read.
- **A `(Break on purpose: …)` comment beside a check names the break that makes it fail**
  (`AGENTS.md`, "Prove a guard is not vacuous").
- **A probe that reads a live competition says in its header what shape of competition it needs**,
  so that it can be pointed at another one once the API drops this one.
- **Stub `W.Date.now` for a check that a deadline decides**, as `probe-varmistus.js` does.
  Unstubbed, the check passes in the morning and fails in the afternoon.
- **Read every table of the view**, since each heat is a `.tbl` of its own.
- **At phone width a ladder renders both as a hidden `<table>` and as `.ladder-card`s**, with the
  same name cell, so a query finds each row twice.
- **A module's names are not `window` properties**, so a probe reads them through `appJs`, `libJs`
  and `demoJs`. `libJs` reaches only the `lib/` files the page has loaded. A probe that needs a name
  no file exports adds it to that file's export list.
- **The app runs in an iframe of the phone's size**, so a probe measures inside it, and setting
  `frame.width` fires a real `resize`.
- **Each probe runs in a browser context of its own**, since a cached `app.js` would read a break on
  purpose as a pass.

## Under make dev

`make dev` serves `public/`, which the probes read. No probe reads the bundle that
`make dev ASSETS=dist` serves; `make test-render` renders it.

- **The CSP in `public/_headers` allows no inline script**, so a script that the runner adds to the
  app's document is an external file, as `probe-modules.js` is.
- **`frame-ancestors 'none'` refuses every iframe of the app**, a same-origin one included. The
  driver drops it from each answer of `PROBE_HOST`.
- **A second dev server needs its own `DEV_PORT` and `STATE_DIR`**, since two wranglers over one
  state directory share one SQLite file.
- **The worker and render suites bind fixed ports**, listed above `DEV_PORT` in the `Makefile`. A
  dev server on one of them fails those suites at an unrelated assertion.
- **Stop a server by its port**, never by process name, since `pkill -f wrangler` stops every
  wrangler on the machine. Killing the listener alone leaves wrangler running, so kill its parent:
  `kill $(ps -o ppid= -p $(lsof -ti tcp:<port> -sTCP:LISTEN))`.

## A dev server with a follow-list in it

`probe-home`, and a look at the front page with a follow-list, need a Watch, a meet of the live
listing, and that meet's digest (`docs/backend.md`, "The scan, and its three layers"). This block
seeds the two keys before the server starts, since Miniflare reads its state only at startup, and
then creates a Watch of the demo club. It takes the meet from the listing (`docs/tuloslista-api.md`,
"The listing").

```sh
ID=<id of a meet that ended in the last RECENT_DAYS days>
DAY=<its day, d.m.yyyy>
NOW=$(node -p 'Date.now()')
kv() { pnpm exec wrangler kv key put --binding=ROSTER --local --persist-to .wrangler/scan "$@"; }
kv 'cal:v1' \
  "{\"builtAt\":$NOW,\"comps\":[{\"id\":$ID,\"name\":\"x\",\"days\":[\"$DAY\"],\"daysAt\":$NOW}]}"
kv "digest:$ID" \
  "{\"builtAt\":$NOW,\"digest\":{\"v\":5,\"days\":[\"$DAY\"],\"orgs\":[[1,\"DemU\"]],\"teams\":[],\"athletes\":[[\"70000001\",1,\"Emma Mittainen\",[\"N Keihäs\"]]]}}"
make dev DEV_PORT=8940 STATE_DIR=.wrangler/scan

# In another shell, once the server is up. The answer's id is the Watch's id.
curl -s -X POST localhost:8940/api/watch -H 'x-kisat-client: 1' \
  -d '{"label":"DemU","entries":[{"type":"club","id":"1","name":"Demon Urheilijat"}]}'
make probe PROBE=probe-home Q='watch=<watchId>&wait=2500' PROBE_HOST=localhost:8940
```

- **The digest's `v` must equal `DIGEST_VERSION` (`lib/digest.js`).** A digest of another version
  counts as missing. `SCAN_DIGEST` in `test-worker.mjs` shows the digest's layout.
- **A seeded meet must be in the live listing**, or `probe-home` fails its check that every Seuratut
  meet is in Kilpailut too (2026-10).
- **The seeded `cal:v1` is a hit for `CAL_CACHE_TTL_S` only.** After that the Worker rebuilds the
  calendar from the listing and builds the window's other meets from live data.
- **A device picks the Watch up from `kisatWatches` and `kisatFollow` on a reload**, and
  `probe-home` seeds both from its `watch` parameter. `docs/architecture.md`, "View state", gives
  their shapes.
- **Without seeding, home builds the digests from live data**, so the Watch needs a real club's id
  from `/api/search?q=`. A page reloaded too often meanwhile answers "Liikaa pyyntöjä", which is
  `SCAN_LIMITER` working.

## A look without a probe

Playwright's CLI lays the page out at the viewport it is given (2026-10):

```sh
pnpm exec playwright-core screenshot --viewport-size=402,787 --color-scheme=dark \
  --wait-for-timeout=3000 <url> look.png
```

Without `--wait-for-timeout` it shoots the loading screen, and without `--color-scheme` it is light.
A path other than `/` needs `make dev`. A look at a follow-list takes `--load-storage <file>` with
`kisatWatches` and `kisatFollow` for the dev origin.

- **A tab that a script drives is usually hidden, and a hidden tab renders no frames**, so a
  scripted scroll fires no scroll event. Scroll with the driver's real input events.
