# How the app is put together

## The route table

Shared links depend on the URL shapes below. `parseRoute` (`lib/routes.js`) maps each URL to a view.

- `/`: home (`docs/home.md`).
- `/c/<compId>[/d/<YYYY-MM-DD>]`: a meet's day list.
- `/c/<compId>/g/<groupKey>[#/urheilija/<licence>]`: one start. The fragment highlights one athlete
  as followed, and the page opens at the athlete's class.
- `/c/<compId>/g/<groupKey>/laps`: the lap counter (`docs/lap-counter.md`).
- `/c/<compId>/o/<label>[#/urheilija/<licence>]`: a multi-event's standings, identified by the
  multi-event's label. The fragment highlights one athlete as followed, and the page opens at the
  athlete's row.
- `/c/<compId>/cup[/s/<orgId>]`: the club cup's table. The optional `/s/<orgId>` selects a club.
- `/c/<compId>/mitalit[/<ages>][/s/<orgId>]`: the medal table. The optional parts select the age
  chips and a club.
- `/c/<compId>/l/<eventName>[#/urheilija/<licence>]`: the start that decided a class's medals, found
  by the class's event name. The view replaces its own history entry with the start's `/g/` or `/o/`
  URL, which keeps the fragment. An athlete's medal years link to it, because a season record keeps
  no round's time.
- `/c/<compId>/k/<venueId, 400 or 200>`: the kenttä link (`docs/venues.md`).
- `/c/<compId>/aidat/<YYYY-MM-DD>`: a printable sheet of one day's hurdle setups (`docs/hurdles.md`,
  "The day sheet").
- `/mitat[#/<aidat or valineet>[/<ages>][/k/<venueId, ulkoradat or sisaradat>][/viestit or esteet]]`:
  the hurdle and implement tables.
- `/mestaruudet[#/[<scopeId>/]<year>[/<ages>][/s/<orgId>]]`: the medals of one scope over a year
  (`docs/views.md`, "The years"). Without a scope, the page lists the scopes.
- `/mestaruudet#/seura/<orgId>[/<ages>]`: a club's medals per year in the championships of the
  club's scopes.
- `/mestaruudet#/urheilija/<licence>[/<year>]`: an athlete's championship medals of one year, by
  level. The page has a tab per year with medals, and opens the latest when no year is given.
- `/seuracup[#/[<osakilpailut, finaalit or piiriId>/]<year>[/s/<orgId>]]`: the club cup's season for
  one year. Without a tab in the URL, the page opens the default tab.

The activation links, and one page, use the URL fragment:

- `/c/<compId>#/w/<watchId>[/e/<editToken>]` or `/#/w/<watchId>[/e/<editToken>]`: a Watch's read
  link, or, with the edit token, the Watch's edit link.
- `/#/k/<id>[:<token>][,…]`: the pairing link. It carries every Watch in this device's registry.
- `/c/<compId>#/a/<athleteId>` and `/c/<compId>#/s/<orgId>`: the quick-filter on one athlete or one
  club.
- `/#/measure`: the render cost page ("What a render cost").

Rules:

- **A view is a path, and a link that carries a Watch id, an edit token or a followed person is a
  fragment.** A browser doesn't send the fragment to the server. A path lets a link preview name the
  meet (`docs/backend.md`, "Link previews").
- **A retired URL shape keeps working until its date in `docs/shims.md`.** When the shim is removed,
  the shape's test changes to assert that the URL falls through to home.
- **A view changes the address only through `navigate`, or through `replaceAddress` for a choice the
  view already shows.** `navigate` also renders the view, because `pushState` fires no event. Both
  functions keep the query string, because `?mode=` selects the mode on a dev host.
- **An activation link is not a view.** Its handler stores what the link carries in local state.
  Then the handler replaces the link's history entry with the view that the link names, so the back
  button never returns to the link.

### Adding a route

1. Add a pattern to `parseRoute` and its cases to `test/routes.test.mjs`, "parseRoute".
2. Add the view's module to `VIEW_MODULES` (`lib/routes.js`) and its render function to `RENDERS`
   (`app.js`). A new module also needs a loader in `LOADERS` (`app.js`) and a row in `ROUTES`
   (`test-render.mjs`).
3. If the view belongs to one mode only, add it to `KISAT_ONLY_VIEWS` or `JUOKSUT_ONLY_VIEWS`
   (`lib/routes.js`).
4. Give the view a constant back target ("Back targets and scroll") and a `setScrollKey`. If the
   view shows a list of rows, add it to the `list` class toggle in `renderRoute` (`app.js`), which
   sets the narrower width (`docs/style.md`, "Width"). If the view refreshes, add its interval to
   `scheduleRefresh` (`app.js`).
5. A new path outside `/c/` needs an entry in `DOC_PATHS` (`worker.js`), a line in
   `run_worker_first` (`wrangler.jsonc`) and a case in `siteMeta` (`lib/routes.js`) for its title.
   No test checks these three.

## Packages weighed and left out

Each package below was compared with the code it would replace, in 2026-09, and left out
(`AGENTS.md`, "A package earns its place").

- **A router for the Worker**, such as Hono. The Worker would still need its own code for the
  document, the hosts, the modes and the header check.
- **A date library.** The schedule's own day keys need conversion code that no library supports, and
  `Intl` formats the other dates.
- **Fuzzy search**, such as Fuse. The search ranks a match at the start of a word above a match
  inside a word. Fuzzy matching would list the wrong names.
- **Schema validation**, such as Valibot, Zod or ajv. A Watch's body is the only input that the
  Worker validates. Most checks of `public/data/` compare rows with each other, which a schema can't
  express.
- **A DOM morph**, such as idiomorph or morphdom. A morph keeps the old nodes, but a view keeps
  references to the nodes it built, and its event handlers close over the data of its render.
- **Menu placement**, such as Floating UI. The app places a menu in a few lines.
- **Dragging a row**, such as SortableJS. The lap counter keeps a dragged row inside its run of
  equal lap counts, which such a library doesn't support.
- **`URLPattern` for the page's routes.** Safari supports it only from version 26.
- **@playwright/test for the probes.** Its runner and assertions run in Node, but a probe runs
  inside the page, so the probes use `playwright-core`.

## What a render cost

The page `/#/measure` lists the cost of the renders on this device.

- **The render log ships in production and records every render except the measure page's own.** It
  isn't limited to dev hosts, because a reading is taken on a phone at a meet, on a network that no
  probe can reproduce.

## The two modes

One Worker serves both hosts, and the host selects the mode. On a dev host only, `?mode=` selects
the mode. A route that belongs to one mode redirects to its own host from the other mode's host. On
a dev host, such a route falls through to home.

- **A dev host serves both modes from one origin, so both modes share its storage.** For this
  reason, Juoksut mode stores its category toggle in a field of its own, `cats`, next to the Watch's
  `mode`. In Juoksut mode, `viewStateFor` (`app/data.js`) also drops `watchId` and `focus`, because
  on a dev host the Kisat views store them in the same rows.

## View state

**The schedule view's state is stored on the device per meet, never in the URL.** So a link to a day
or a start can't lose the state, and a start reads the same stored state. The state is in
`localStorage`, under these keys:

- `kisatWatches`: every Watch registered on this device, as `[{watchId, label}]`. It is one list for
  all meets, most recent first, capped at `WATCH_REGISTRY_MAX`.
- `kisatFollow`: the active Watch's id, or null.
- `kisatWatchEdit:<id>`: a Watch's edit token, if this device has one.
- `kisatCompView`: the view state of each meet, most recent first, capped at `COMP_VIEW_MAX`. One
  row, `#home`, holds the state of home, `/mestaruudet` and `/seuracup`.
- `kisatRecentComps`: the meets that this device opened (`docs/home.md`).
- `kisatRenderLog`: the render log ("What a render cost").

Juoksut mode's own keys are in `docs/juoksut.md` and `docs/lap-counter.md`, "Storage".

A view marks the people and clubs of the quick-filter if it is on, and otherwise those of the active
Watch.

Rules:

- **A storage key, or the shape of a stored value, is a contract with data already stored on
  devices.** Changing either needs a shim (`AGENTS.md`, "A breaking change keeps users working").
  The render log is derived data, so a new shape gets a new key and no shim.
- **One Watch is active on every view, home included.** `viewStateFor` takes `watchId` from
  `activeFollow()`, so the `watchId` in a meet's row is written but never read.
- **Only an explicit action writes or removes state**, such as a choice in a menu, an activation
  link or creating a Watch. When the fetch of a Watch, a roster or the scan fails, the view shows a
  notice and the unfiltered list, and leaves local state unchanged. A 404 looks the same as a
  temporary failure.

## Back targets and scroll

- **A view's back target is a constant.** The schedule's back target is home, and a start's back
  target is its day. The view that `‹` returns to reads its own stored state, so the back target
  never depends on how the reader got to the view. When the quick-filter is on, `‹` closes the
  filter instead and stays on the view.
- **Scroll positions are keyed per rendered view, not per URL.** Two URLs can show the same list,
  and the quick-filter's shorter list keeps a scroll position of its own.

## Layers

A layer is a sheet or the quick-filter. A layer opens over a view and keeps that view's URL. All
layers are on one stack, and `closeTopLayer()` is the only way to close one. So the ×, the backdrop,
Escape, the `‹` and the browser's back button all do the same thing. One history entry, the
sentinel, represents the whole stack.

- **Close a layer only through `closeTopLayer()`.** If a sheet's node is removed any other way, the
  sheet stays on the stack and the refresh stops for good. The stack, not the DOM, records which
  layer is on top.
- **A route change closes every sheet, and a render closes none.** So a sheet with unsaved edits
  survives a refresh, and the refresh skips its tick while a sheet is open. The quick-filter doesn't
  stop the refresh. A hidden tab runs no timer.

## The filter bar

The Watch chip's `▾` opens one menu that both selects a list and acts on the selected list, so the
chip has no share button next to it. While the quick-filter is on, the quick-filter's own chip and
`Jaa linkki` replace the Watch chip.

- **No row named "Jaa" offers the pairing link.** The pairing link carries every edit token that
  this device holds, so it is offered only as "Siirrä toiseen laitteeseen", for moving the Watches
  to the reader's own devices.
