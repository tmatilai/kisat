# The competition views

## The day list

- **The `EventId` pre-filter is not the final match.** It matches every round of an event. A start
  is dropped from `Seuratut` only when `matchedEntries` is empty for every class. Otherwise an
  athlete who ran only the heats would keep the semifinal in the list.

## Uusimmat

`Uusimmat` is a mode of the day list on the meet's current day. It lists the starts with followed
lines, the start with the newest change first.

- **The page finds a change by comparing a render with the previous one**, because no result in the
  API has a time. So each device has its own list, and a time is known only for changes this device
  saw happen.
- **A change seen late gets the event's `Last-Modified` as its time.** That is the event document's
  last write, which can be a later attempt by another athlete or a correction. On a device's first
  render of a day, every line gets that time, and none is marked as new.
- **A change is the competitor's own mark, attempts or qualification, never the place**, which moves
  whenever another athlete in the round competes.
- **The multi-event standings in `Ottelut` are not in `Uusimmat`.** The legs are.

## An undrawn round

- **Code that shows an undrawn round's field checks `!roundAllocated`, then tries
  `previousRoundField`.** `Enrollments[]` lists everyone entered in the event, not in one round
  (2026-08), so it is the real field only if the event has no earlier round. `groupLines`,
  `startCounts` and the event view all follow this rule.

## Varmistus

- **`Ei erissä` is the last table of a drawn first round in a meet that takes confirmations.** It
  lists everyone in `Enrollments` who is in no heat. Its tick shows whether the entrant confirmed
  and missed the draw, or never confirmed.
- **An athlete who withdrew from a multi-event is recognised by a non-numeric total on the root
  event** (`combinedWithdrawn`), which marks them `ei jatka` on each leg. A `DNS` on one leg only
  means they missed that leg.

## A start's page

- **When several classes ran in one physical heat, that heat is one table.**

## The name cell

`athleteNameParts` and `nameAside` draw the name cell of every table and ladder (`AGENTS.md`,
"Common traps"). `docs/style.md`, "Components", lists which parts are muted.

## Tables and ladders

- **Pass the round to `qualBadge` whenever the caller has it.** Then both athletes tied at the
  qualifying cut get the badge. Without the round, only the API's own flags are shown.
- **A field event ladder has no top-eight cut line.** The API doesn't say whether a meet gives every
  athlete the same number of attempts or cuts to eight (`docs/tuloslista-api.md`, "Field events").

## The refresh

- **A refresh keeps the first row or heading below the header at the same height on the screen**,
  not the pixel offset. It finds that row again by the heading above it and its index under that
  heading. So a row added above the reader under the same heading moves the page by one row, and a
  table that re-sorts keeps the same places in view, not the same athletes.
- **A refresh keeps each table's horizontal scroll** while the number of tables stays the same.
- **A refresh reads the reader's place on each scroll until it replaces the view**, so a reader who
  scrolls while the data loads stays where they scrolled.
- **A failed refresh leaves the view on screen**, but replaces the loading indicator of a render it
  overtook.
- **A refresh interval shorter than `LIVE_REFRESH_MS` gains little**, because the CDN's copy of a
  document is already up to 29 s old (`docs/tuloslista-api.md`, "Caching").
- **The day list and the medal page fetch a results document again only when `docMaxAge` has
  passed.** A start and a multi-event fetch all of their documents, because the reader is watching
  that page.
- **A round's status and start time don't predict when its document changes.** A field event can run
  hours past its start while its status lags (2026-11). So a followed document that Tuloslista wrote
  in the last few minutes is fetched on every refresh, whatever its rounds' statuses are.
- **A count line or a hurdle line can show a changed draw up to `DOC_MAX_AGE_MS` late**, because a
  document that only those lines read is fetched less often, even while its round runs
  (`docs/tuloslista-api.md`, "Heats and allocations").
- **Only a refresh fetches the schedule every time.** Any other render reuses a schedule fetched in
  the last 20 s, so opening a start from the day list doesn't wait for it.
- **The roster, the meet body and `/properties` come from the browser's cache until their max-age
  passes.** The Watch is fetched on every render, so an edit made on this device shows at once.

## The athlete and club sheets

- **Opening a sheet fetches nothing.** Each action fetches only when tapped.
- **Adding an entry that is already there writes nothing**, because a needless write would give
  anyone else editing the Watch a 409. An add fetches the Watch, merges the entry and `PUT`s it. On
  a 409, `addToWatch` retries once.

## Multi-events

The ottelu standings show on each leg's page and on the multi-event's own page. A day's schedule
lists only the legs (2026-08).

## Results on another site

A meet listed in `elsewhere.json` uses results from another site once its last day has passed, and a
race also during the meet. Where the other site has no results, the views fall back to Tuloslista's.
`docs/elsewhere.md` has the rest.

## The club cup

The Worker builds a cup meet's club table (`docs/backend.md`), and `lib/cup.js` scores it. The API
side is in `docs/tuloslista-api.md`, "Club-cup points (Seuracup)".

## Medals

The championships sheet stores the chosen scopes per meet in the view state's `scopes`.

- **`defaultScopes` guesses the scopes from the meet's name and organiser, and picks fewer when
  unsure.** Nothing in Tuloslista marks a meet as a championship (2026-09). The cases are in
  `test/districts.test.mjs`, most named by their meet's id. To change the rules, change those cases.

## The years

`/seuracup` and `/mestaruudet` show a year of meets from the Worker's season records
(`docs/backend.md`, "A scope's year" and "The cup's year").

- **A scope's year opened with a club in its address scrolls to that club's section, and its back
  link goes to the club's years.** Otherwise the back link goes to `/mestaruudet`, even if a club is
  picked on the page.
- **A notable meet's year links to the meet's medal page.** If the year has several such meets, each
  link is labelled with the meet's classes (`ageRangeLabel`), such as `T/P 8–15`, youngest first. A
  year gets a row if the club entered one of its meets or one of them is not built yet. A notable
  meet with no such year gets no table. A meet's record lists every club with a result (`names`).
- **Every meet of a championship's year is a row linking to its medal table**, so a meet that
  `defaultScopes` gets wrong is still visible.
- **A club's "Kaikki mitalit" table sums the scopes that its chips pick.** A medal of a meet in two
  scopes counts in each scope, because each scope awards its own title.
