# Checking a change in a browser

A **probe** asserts on the page at a phone width. A **look** is one screenshot and proves no rule,
so a finding worth keeping goes into a probe.

## Running a probe

```sh
make probe PROBE=probe-filter      # one probe, line by line
make probes                        # every probe, offline
```

`OFFLINE` in `probe.mjs` lists the probes that need only the demo, and `WORKER` the ones that need
the Worker, each with its query. Every probe's header says what it covers and its query.

- **A probe of `WORKER` runs on a `wrangler dev` that the driver starts**, over `public/` with KV of
  its own. `make probe` does the same for one, unless `PROBE_HOST=localhost:<DEV_PORT>` points it at
  a `make dev`.
- **`make probes` runs offline.** The driver answers each request that leaves the page's origin, the
  Tuloslista listing with `LISTING` and the rest with an empty list. Before the Worker starts it
  writes `workerKv()`: the calendar, a digest per meet in it, and the club and athlete indexes. A
  meet in the calendar with no digest would make the Worker build one from the live API.
- **A probe run on a `make dev` reads live data**, so a `FAIL` there is checked against the live
  page first.

`Q` is the runner's query, with these keys:

- `url`: the app route, with `?` and `#` written as `%3F` and `%23`, such as `c/demo`,
  `c/demo%23/a/i1-a`, or `%3Fmode%3Djuoksut` for Juoksut mode.
- `w` and `h`: the iframe's size, 402×787 by default.
- `wait`: milliseconds to wait once the first view has settled, 0 by default.

## Writing a probe

- **Wait with `settle()`, not with a fixed time.** It returns once no fetch is in flight and the
  latest render is done, which is when a navigation, a tap or a save has shown its result. `back()`
  and `reload()` wait the same way. A fixed wait is for a timer the app runs, such as a debounce,
  which `settle(ms)` waits out first.
- **A check that nothing happens needs its control.** Stub a long interval short, as
  `probe-refresh.js` does, and check that the visible case does happen within the wait.
- **Log the values, then assert on them**, so that a failing probe shows what it read.
- **A `(Break on purpose: …)` comment beside a check names the break that makes it fail**
  (`AGENTS.md`, "Prove a guard is not vacuous").
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
  driver drops it from each answer of a `wrangler dev`.
- **A second dev server needs its own `DEV_PORT` and `STATE_DIR`**, since two wranglers over one
  state directory share one SQLite file.
- **The worker and render suites and `make probes` bind fixed ports**, listed above `DEV_PORT` in
  the `Makefile`. A dev server on one of them fails those runs at an unrelated assertion.
- **Stop a server by its port**, never by process name, since `pkill -f wrangler` stops every
  wrangler on the machine. Killing the listener alone leaves wrangler running, so kill its parent:
  `kill $(ps -o ppid= -p $(lsof -ti tcp:<port> -sTCP:LISTEN))`.

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
