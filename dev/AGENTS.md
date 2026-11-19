# Checking a change in a browser

A **probe** is a script that asserts on the page at a phone width. A **look** is a single
screenshot. A look checks no rule, so put any finding worth keeping into a probe.

## Running a probe

```sh
make probe PROBE=probe-filter      # one probe, line by line
make probes                        # every probe, offline
```

`probe.mjs` maps each probe to its query: in `OFFLINE` for a probe that needs only the demo, and in
`WORKER` for a probe that needs the Worker.

- **A probe in `WORKER` runs on a `wrangler dev` that the driver starts**, with its own KV. With
  `PROBE_HOST=localhost:<DEV_PORT>`, `make probe` uses a running `make dev` instead.
- **`make probes` runs offline.** The driver intercepts each request to another origin, and writes
  the KV entries from `workerKv()` before the Worker starts. If a meet in the calendar had no
  digest, the Worker would build one from the live API.
- **A probe run against `make dev` reads live data.** Check a `FAIL` there against the live page
  first.

`Q` sets the query that the runner reads:

- `url`: the app route, with `?` and `#` written as `%3F` and `%23`, such as `c/demo`,
  `c/demo%23/a/i1-a`, or `%3Fmode%3Djuoksut` for Juoksut mode.
- `w` and `h`: the size of the iframe, 402×787 by default.
- `wait`: the milliseconds to wait after the first view has settled, 0 by default.

## Writing a probe

- **Wait with `settle()`, not with a fixed time.** `settle()` returns once no fetch is in flight and
  the latest render has finished. `back()` and `reload()` wait in the same way. A fixed wait is only
  for a timer that the app runs, such as a debounce: `settle(ms)` waits `ms` milliseconds for that
  timer before it starts checking.
- **A check that something does not happen needs a control check.** Stub a long interval to a short
  one, and check that the opposite case, such as a visible tab, does happen within the same wait.
- **Log the values, then assert on them**, so that a failing probe shows what it read.
- **A `(Break on purpose: …)` comment beside a check names the break that makes the check fail**
  (`AGENTS.md`, "Check that each new test or probe check can fail").
- **Stub `W.Date.now` when a deadline decides the result of a check.** Without the stub, the check
  passes in the morning and fails in the afternoon.
- **Read every table of the view.** Each heat is a separate `.tbl`.
- **At phone width a ladder renders both as a hidden `<table>` and as `.ladder-card` elements.**
  Both use the same name cell, so a query finds each row twice.
- **A module's names are not `window` properties.** A probe reads them through `appJs`, `libJs` and
  `demoJs`. `libJs` reaches only the `lib/` files that the page has loaded. If a probe needs a name
  that no file exports, add the name to that file's export list.
- **The app runs in an iframe of the phone's size.** A probe measures inside the iframe, and setting
  `frame.width` fires a real `resize` event.
- **Each probe runs in its own browser context.** A cached `app.js` would make a break on purpose
  look like a pass.

## Under make dev

The probes read `public/`, not the bundle that `make dev ASSETS=dist` serves. `make test-render`
renders the bundle.

- **The CSP in `public/_headers` allows no inline script.** A script that the runner adds to the
  app's document must be an external file.
- **`frame-ancestors 'none'` blocks every iframe of the app**, including a same-origin one. The
  driver removes the directive from each response of a `wrangler dev`.
- **A second dev server needs its own `DEV_PORT` and `STATE_DIR`.** Two wranglers with the same
  state directory share one SQLite file.
- **The worker suite, the render suite and `make probes` bind fixed ports.** The `Makefile` lists
  them above `DEV_PORT`. A dev server on one of these ports makes those runs fail at an unrelated
  assertion.
- **Stop a server by its port, never by process name.** `pkill -f wrangler` stops every wrangler on
  the machine. Killing only the listening process leaves wrangler running, so kill its parent:
  `kill $(ps -o ppid= -p $(lsof -ti tcp:<port> -sTCP:LISTEN))`.

## A look without a probe

Playwright's CLI lays out the page at the viewport size it is given (2026-10):

```sh
pnpm exec playwright-core screenshot --viewport-size=402,787 --color-scheme=dark \
  --wait-for-timeout=3000 <url> look.png
```

Without `--wait-for-timeout`, the screenshot shows the loading screen. Without `--color-scheme`, the
page is light. A path other than `/` needs `make dev`. To look at a follow-list, pass
`--load-storage <file>` with `kisatWatches` and `kisatFollow` set for the dev origin.

- **A tab that a script drives is usually hidden, and a hidden tab renders no frames.** A scripted
  scroll therefore fires no scroll event. Scroll with the driver's real input events.
