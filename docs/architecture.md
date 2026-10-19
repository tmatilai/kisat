# How the app is put together

This doc holds the URL shapes, the modules, the packages left out, the local state, and the rules
that span views.

## The route table

`parseRoute` (`lib/routes.js`) is the route table. Shared links depend on these shapes.

The views:

- `/`: home (`docs/home.md`).
- `/c/<compId>[/d/<YYYY-MM-DD>]`: a meet's day list.
- `/c/<compId>/g/<groupKey>`: one start.
- `/c/<compId>/g/<groupKey>/laps`: the lap counter (`docs/lap-counter.md`).
- `/c/<compId>/o/<label>`: a multi-event's standings, keyed on its label.
- `/c/<compId>/cup[/s/<orgId>]`: the club cup's table, with the picked club.
- `/c/<compId>/mitalit[/<ages>][/s/<orgId>]`: the medal table, with the age chips and the picked
  club.
- `/c/<compId>/k/<venueId, 400 or 200>`: the kenttä link (`docs/venues.md`).
- `/c/<compId>/aidat/<YYYY-MM-DD>`: one day's hurdle setups on paper (`docs/hurdles.md`, "The day
  sheet").
- `/mitat[#/<aidat or valineet>[/<ages>][/k/<venueId, ulkoradat or sisaradat>][/viestit or esteet]]`:
  the hurdle and implement tables.
- `/mestaruudet[#/[<scopeId>/]<year>[/<ages>][/s/<orgId>]]`: a scope's medals over a year
  (`docs/views.md`, "The years"). Without a scope, it lists the scopes.
- `/seuracup[#/[<osakilpailut, finaalit or piiriId>/]<year>[/s/<orgId>]]`: the club cup's year.
  Without a tab, it opens the default tab.

The activation links, and one page, in a fragment:

- `/c/<compId>#/w/<watchId>[/e/<editToken>]` or `/#/w/<watchId>[/e/<editToken>]`: a Watch's read
  link, or with the token its edit link.
- `/#/k/<id>[:<token>][,…]`: the pairing link, which carries this device's whole registry of
  Watches.
- `/c/<compId>#/a/<athleteId>` and `/c/<compId>#/s/<orgId>`: the quick-filter on a person or a club.
- `/#/measure`: what the renders on this device cost ("What a render cost").

The code:

- `parseRoute`, `parseLinkHash` (`lib/routes.js`): the paths and the fragments. Tested in
  `test/routes.test.mjs`, "parseRoute".
- `activateWatchLink`, `activatePairLink`, `activateFocusLink` (`app/follow.js`): the landings of
  the links in a fragment.
- `navigate`, `replaceAddress` (`app/shell.js`): the two ways a view changes the address.

Rules:

- **A view is a path, and a link that carries a Watch id, an edit token or a followed person is a
  fragment.** A browser sends no fragment to a server, and a path lets a link preview name the meet
  (`docs/backend.md`, "The document, and what a preview says").
- **A retired URL shape keeps working until its date in `docs/shims.md`.** When its shim goes, its
  test becomes one that the shape falls through to home.
- **A view changes the address only through `navigate`, or through `replaceAddress` for a choice the
  view already shows.** `navigate` renders, since `pushState` fires no event. Both keep the query
  string, since `?mode=` picks a dev host's mode.
- **An activation link is not a view.** Its handler turns the link into local state and replaces its
  own history entry with the view the link names, so back never lands on the link again.

### Adding a route

1. Add a pattern to `parseRoute` and its cases to `test/routes.test.mjs`, "parseRoute".
2. Name the view's module in `VIEW_MODULES` (`lib/routes.js`) and its render in `RENDERS`
   (`app.js`). A new module also needs a loader in `LOADERS` (`app.js`) and a row in `ROUTES`
   (`test-render.mjs`).
3. Put a view of one mode in `KISAT_ONLY_VIEWS` or `JUOKSUT_ONLY_VIEWS` (`lib/routes.js`).
4. Give the view a constant back target ("Back targets and scroll") and a `setScrollKey`. A row-list
   view joins the `list` toggle in `renderRoute` (`app.js`, `docs/style.md`, "Width"). A view that
   refreshes gets its interval in `scheduleRefresh` (`app.js`).
5. Give a new path outside `/c/` an entry in `DOC_PATHS` (`worker.js`), a line in `run_worker_first`
   (`wrangler.jsonc`) and a case in `siteMeta` (`lib/routes.js`) for its title. Nothing checks these
   three.

## The page's modules

`app.js` is the router. It imports a view's module of `public/app/` the first time the view renders.

- `build.mjs`: the bundle in `dist/`, with `app.js` and its modules as chunks. `make dev` serves
  `public/` unbundled (`dev/AGENTS.md`, "Under make dev").
- `VIEW_MODULES`, `JUOKSUT_MODULES`, `MAIN_MODULES` (`lib/routes.js`): the module each view loads,
  the modules Juoksut mode adds, and the modules that load once the first view is on screen.
- `routeModules` (`lib/routes.js`): the chunks the Worker preloads with a route's document.
- `loadFresh` (`app.js`): the reload into a newer deploy when a module fails to load.
- `onLeave`, `setRouter` (`app/shell.js`): what a module drops on a route change, and how a view
  reaches the router without importing `app.js`.
- `test/source.test.mjs`, "module preloads", "no import cycles" and "no package in the page": the
  checks on what the modules import.

## Packages weighed and left out

Each package below was weighed against the code it would replace in 2026-09, and left out
(`AGENTS.md`, "A package earns its place").

- **A router for the Worker**, such as Hono. The document, the hosts, the modes and the header gate
  stay the Worker's own code either way, and Hono answers a wrong method with 404, not 405 with
  `allow`.
- **A date library.** `lib/dates.js` converts the schedule's own day keys, which no library knows,
  and `Intl` formats the rest.
- **Fuzzy search**, such as Fuse. `searchRank` in `lib/search.js` ranks a match at a word's start
  before one inside a word, and fuzzy matching would list the wrong names.
- **Schema validation**, such as Valibot, Zod or ajv. A Watch's body is the one input the Worker
  validates, and most checks of `public/data/` compare rows with each other, which no schema
  expresses.
- **A DOM morph**, such as idiomorph or morphdom. A morph keeps the old nodes, but a view holds the
  nodes it built, and its handlers close over its render's data.
- **Menu placement**, such as Floating UI. `menuAnchorPos` in `lib/routes.js` does it in a few
  lines.
- **Dragging a row**, such as SortableJS. The lap counter keeps a dragged row inside its run of
  equal counts, which such a library does not know, in about 80 lines.
- **`URLPattern` for the page's routes.** It reached Safari only in version 26, and each route would
  still need its own pattern and mapping.
- **@playwright/test for the probes.** Its runner and assertions run in Node, but a probe runs
  inside the page, so `playwright-core` drives them.

## What a render cost

`/#/measure` lists what the renders on this device cost.

- `lib/render-log.js`: the log, its cap, its summary and its TSV. Tested in `test/routes.test.mjs`,
  "renderStats".
- `fetchJson` (`app/data.js`): counts each request toward the render current when it started.
- `renderMeasure` (`app/measure.js`): the page. `dev/probe-measure.js` checks it.

Rule:

- **The render log ships and collects on every render but the measure page's own, with no dev-host
  gate.** A reading is taken on a phone at a meet, on a network that no probe sees.

## The two modes

One Worker serves both hosts, and the host picks the mode.

- `siteMode`, `isDevHost` (`lib/routes.js`): the mode from the host, and from `?mode=` on a dev host
  only. Tested in `test/routes.test.mjs`, "siteMode".
- `routeMode` (`lib/routes.js`): the views of one mode. On the other mode's host such a route leaves
  for its own host, and on a dev host it falls to home.
- `SITE_ASSETS`, `siteMeta` (`lib/routes.js`): the files and the document's identity per host
  (`docs/backend.md`, "The document, and what a preview says").
- `docs/juoksut.md`, "What the counter requires of the rest": why nothing on the way to the counter
  needs `/api`, and why Juoksut mode asks for no meet body.

Rule:

- **A dev host serves both modes from one origin's storage.** So Juoksut's category toggle is a
  field of its own, `cats`, beside the Watch's `mode`. And `viewStateFor` (`app/data.js`) drops
  `watchId` and `focus` in Juoksut mode, since on a dev host the Kisat views store them in the same
  rows.

## View state

**The schedule view's state is local and kept per meet, never in the URL.** So a link to a day or a
start cannot lose it, and a start reads the same stored state. `app/data.js` keeps it in
`localStorage`, under these keys:

- `kisatWatches`: every Watch this device knows, `[{watchId, label}]`, one list for every meet, most
  recent first (`WATCH_REGISTRY_MAX`).
- `kisatFollow`: the active Watch's id, or null.
- `kisatWatchEdit:<id>`: a Watch's edit token, where this device holds one.
- `kisatCompView`: each meet's view state, most recent first (`COMP_VIEW_MAX`), and one row,
  `#home`, for home, `/mestaruudet` and `/seuracup`.
- `kisatRecentComps`: the meets this device opened (`docs/home.md`).
- `kisatRenderLog`: the render log ("What a render cost").

Juoksut mode's own keys are in `docs/juoksut.md` and `docs/lap-counter.md`, "Storage".

- `normalizeCompView` (`lib/routes.js`): each field of a meet's row. Tested in
  `test/routes.test.mjs`, "compViewState/compViewUpdate".
- `viewStateFor`, `activeFollow` (`app/data.js`): the state a view reads.
- `resolveFilter` (`app/follow.js`), `followTargets` (`app/data.js`): the quick-filter, or else the
  active Watch, as the people and clubs a view marks.

Rules:

- **A storage key or a stored shape is a contract with stored data.** Changing one needs a shim
  (`AGENTS.md`, "A breaking change keeps users working"). The render log is derived data, so a new
  shape takes a new key and no shim.
- **One Watch is active on every view, home included.** `viewStateFor` takes `watchId` from
  `activeFollow()`, so a meet's row holds a `watchId` that is written and never read.
- **Only an explicit action writes or removes state**, such as a pick in a menu, an activation link
  or a create. A failed fetch of a Watch, a roster or the scan shows a notice and the plain list,
  and leaves local state alone, since a 404 looks the same as a passing failure.

## Back targets and scroll

- `setBack` (`app/shell.js`): the header's `‹`, a link or an action that closes a layer.
- `openFocusFilter`, `closeFocusFilter` (`app/follow.js`): where a tapped name's quick-filter opens,
  and every way out of it.
- `scrollKey`, `saveScroll` (`app/shell.js`): each rendered view's position, saved before any swap
  of views.
- `dev/probe.js`, `dev/probe-layers.js`: the back targets and the scroll round trips.

Rules:

- **A view's back target is a constant.** The schedule's is home, and a start's is its day. The view
  it returns to reads its own state, so the target never depends on the path taken. With the
  quick-filter on, the `‹` closes the filter instead and stays on the view.
- **Scroll positions are keyed per rendered view, not per URL.** Two URLs can show one list, and the
  quick-filter's shorter list keeps a position of its own.

## Layers

A layer is a sheet or the quick-filter, stacked over a view at that view's own URL. The layers share
one stack and one way out, `closeTopLayer()`, so the ×, the backdrop, Escape, the `‹` and the
browser's back all do the same thing. One history entry, the sentinel, stands for the whole stack.

- `openLayer`, `closeTopLayer`, `clearLayers` (`app/shell.js`): the stack and the sentinel.
- `layerPopAction`, `layerCloseAction` (`lib/routes.js`): what a back press and a close do to
  history. Tested in `test/routes.test.mjs`, "layers".
- `dev/probe-layers.js`: the browser's back over the layers, and the `popstate` fact the sentinel
  rests on.
- `dev/probe-refresh.js`: the refresh under an open sheet, and in a hidden tab, which runs no timer.

Rules:

- **Close a layer only through `closeTopLayer()`.** A sheet whose node is removed any other way
  stays on the stack, and the refresh stops for good. The stack, not the DOM, says which layer is on
  top.
- **A route change closes every sheet, and a render closes none.** So a sheet with unsaved edits
  outlives a refresh, and the refresh skips its tick while a sheet is open. The quick-filter does
  not hold the refresh off.

## The filter bar

`filterBar` (`app/follow.js`) carries the Watch chip and the `Seuratut / Koko päivä` toggle in Kisat
mode, and the category toggle and the kenttä select in Juoksut mode. The chip's `▾` opens one menu
that both picks a list and acts on the picked one, so the chip has no share button beside it. While
the quick-filter is on, its own chip and `Jaa linkki` take the Watch chip's place.

- `watchMenu` (`app/follow.js`): the chip's menu. `dev/probe.js` checks its rows in order.
- `addToWatchMenu` (`app/follow.js`): the athlete sheet's "Lisää seurantaan".
- `openCreateWatchSheet`, `openCopyWatchSheet`, `openEditWatchSheet`, `openDeleteWatchSheet`,
  `watchPickerSheet` (`app/follow.js`): the sheets that change a list, and the picker they share.
- `watchConflictMerge` (`lib/watch.js`): the merge after a save that lost a race. Tested in
  `test/watch.test.mjs`, "watchConflictMerge".

Rule:

- **No row named "Jaa" offers the pairing link.** It carries every edit token this device holds, so
  it is offered only as "Siirrä toiseen laitteeseen", for the reader's own devices.
