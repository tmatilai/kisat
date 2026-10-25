# The competition views

This doc covers the views of one meet and the two pages of a year. For each view it names the
functions that decide what it shows, and where they are tested. It then states the traps and rules
that no test catches.

A file of `public/lib/` decides what a view shows, and `public/app/` draws it. Other docs own these
topics:

- the routes, the view state and which mode has a view: `docs/architecture.md`;
- the look: `docs/style.md`;
- every API fact behind these views: `docs/tuloslista-api.md`.

## The day list

The day list is a meet's schedule for one day. `renderComp` (`app/meet.js`) draws it.

- `groupRounds`, `groupStatuses`, `startCounts` (`lib/schedule.js`): the starts, their status chips
  and their `Erät ja osallistujat` lines. Tested in `test/schedule.test.mjs`.
- `lib/day.js`: which day shows, and how the list is narrowed. Tested in `test/day.test.mjs`.
- `lib/filter.js`: the class and discipline filter. Tested in `test/routes.test.mjs`, "class and
  discipline filter", and by `dev/probe-filter.js`.
- `matchedEntries` (`lib/watch.js`) and `allocPosition` (`lib/results.js`): the line under a start
  for each followed entry. Tested in `test/watch.test.mjs`.

Traps:

- **The `EventId` pre-filter is not the match.** The pre-filter covers every round of an event. A
  start leaves `Seuratut` only when `matchedEntries` is empty for every class. Otherwise an athlete
  who ran only the heats keeps the semifinal in the list.
- **The count lines are read live and never cached.** A published draw can change during the meet
  (`docs/tuloslista-api.md`, "Heats and allocations").

## An undrawn round

`Enrollments[]` lists the whole event, not one round (`docs/tuloslista-api.md`). So an undrawn
round's own list still holds athletes who went out in an earlier round.

- `previousRoundField`, `previousRound`, `fieldMayChange` (`lib/schedule.js`): the field an undrawn
  round borrows from the round before it. Tested in `test/schedule.test.mjs`.
- `undrawnNotice` (`lib/start.js`): the notice the event view shows. Tested in
  `test/start.test.mjs`, "what an undrawn round waits on".

Rule:

- **Code that shows an undrawn round's field first checks `!roundAllocated`, then tries
  `previousRoundField`.** `groupLines`, `startCounts` and the event view all do this. The raw
  `Enrollments` is the true field only when the event has no earlier round.

## Varmistus

Varmistus is an entrant's confirmation that they are at the meet. `lib/confirmation.js` decides what
the views show about it:

- `confirmNote`: the `Varmistaneita n/m` line;
- `confirmRows`, `watchConfirmations`: the day's own list of followed entries.

They are tested in `test/watch.test.mjs` and drawn by `dev/probe-varmistus.js`. What the API
publishes is in `docs/tuloslista-api.md`, "Varmistus (confirmation)". The tick column is in
`docs/style.md`, "Components".

Traps:

- **`Ei erissä` ends the drawn first round of a meet that takes confirmations** (`app/event.js`). It
  lists everyone who is in `Enrollments` but in no heat. Its tick separates an entrant who confirmed
  but missed the draw from one who never confirmed.
- **An entry out of the ottelu is marked by the root's non-numeric total** (`combinedWithdrawn`).
  That total marks the entry `ei jatka` on a leg's list. A `DNS` on one leg means only that the
  athlete missed that leg.

## A start's page

`renderGroup` (`app/event.js`) draws a start and picks the labels of its views: `Kaikki` or `Erät`,
`Kokonaistulokset` or `Sarjat`, and the medals view (`medalsLabel`).

- `startPageModel` (`lib/start.js`): which views the start offers.
- `startPageView` (`lib/start.js`): what the chosen view draws.
- `roundTables` (`lib/start.js`): one class's tables. These three are tested in
  `test/start.test.mjs`.
- `defaultResultView`: the view a start opens on. Tested in `test/schedule.test.mjs`.
- `displayRank`: the place each view prints. Tested in `test/results.test.mjs`.

Where several classes ran in one physical heat, that heat is one table (`heatsAreShared`,
`sharedHeatTable`). Tested in `test/results.test.mjs`, "shared heats", and by `dev/probe-shared.js`.
`dev/probe-heats.js` draws the other views.

## The name cell

`athleteNameParts` and `nameAside` (`app/event.js`) draw the name cell of every table and ladder.
The parts come from `earlierMarks`, `bestsParts`, `beatsMark` and `resultWind` (`lib/results.js`).
They are tested in `test/results.test.mjs`, "name-cell asides", and drawn by `dev/probe-pending.js`.
Which parts are muted is in `docs/style.md`, "Components".

## Tables and ladders

The section "The result tables" of `app/event.js` draws the results tables and the field ladders.
The rows come from `sortResults`, `attemptColumns`, `verticalJumpHeights` and `heatPlaces`
(`lib/results.js`), tested in `test/results.test.mjs`. The widths are in `docs/style.md`, "Width",
and `dev/probe-ladder.js` measures them.

Traps:

- **Pass the round to `qualBadge` wherever the caller has it.** Then both athletes tied at the cut
  get the badge. Without the round, only the API's own flags show.
- **A field ladder draws no top-eight cut line.** The API cannot tell a meet that gives everyone the
  same number of attempts from one that cuts to eight (`docs/tuloslista-api.md`, "Field events").

## The refresh

The event view refreshes every `GROUP_REFRESH_MS` (`app.js`). The refresh keeps the reader's place
down the page (`wantedScroll`, `app/shell.js`) and across each ladder (`renderGroup`).
`dev/probe-refresh.js` checks both. A refresh that fails keeps the view on screen, but replaces the
loader of a render it overtook (`renderRoute`, `app.js`).

## The athlete and club sheets

Tapping a name opens the athlete sheet, and tapping a club opens the club sheet. The section "A
name, and its sheet" of `app/follow.js` holds both, with `athleteNameLink` and `clubNameLink`.
`athleteCard` (`lib/results.js`) builds the athlete sheet. A sheet's filter action goes through
`openFocusFilter` (`app/follow.js`). `dev/probe-club.js` and `dev/probe-pending.js` draw them.

Rules:

- **Neither sheet fetches anything to open.** Each action fetches only when it is tapped.
- **An add that changes nothing writes nothing** (`watchEntriesWith`, `test/watch.test.mjs`). A
  needless write would give anyone else editing the list a 409. An add fetches the list, merges and
  `PUT`s it. On a 409, `addToWatch` adds again, once. The Worker's side is in `docs/backend.md`,
  "Watches".

## Multi-events

`lib/combined.js` builds the `Ottelut` section, the standings and a leg's points. It is tested in
`test/combined.test.mjs`. `combinedEventStatus` (`lib/schedule.js`) gives a multi-event's status.
`app/event.js` draws the standings on each leg's page and on the ottelu's own page
(`renderCombined`), and `dev/probe-ottelu.js` draws both. A day's schedule holds only the legs
(`docs/tuloslista-api.md`, "Combined events (moniottelu)").

## Results on another site

A meet listed in `elsewhere.json` reads its grafted results once its last day has passed, and a
race's on its days too (`graftApplies`, `lib/elsewhere.js`). The section "A meet's documents" of
`app/data.js` reads them, and falls back to Tuloslista's documents where the graft is empty. The
rules for the file and the Worker's side are in `docs/elsewhere.md`, and `test/elsewhere.test.mjs`
tests them.

## The club cup

The Worker sums a cup meet's club table (`docs/backend.md`). `lib/cup.js` scores it:

- `cupStandings`, `cupFinalRoundScores`, `cupBreakdown`: the standings, a final's points and a
  club's breakdown. Tested in `test/cup.test.mjs` over the demo meets `democup` and `democupfinal`.
- `renderCup` (`app/cup.js`): draws the standings page.
- `pointsEl` (`app/event.js`): draws a row's points.

`dev/probe-cup.js` and `dev/probe-cupfinal.js` draw the cup. The API side is in
`docs/tuloslista-api.md`, "Club-cup points (Seuracup)".

## Medals

`renderMedals` (`app/medals.js`) draws a meet's medals per club, and the medalists of a follow-list.
It reads the Worker's body (`docs/backend.md`, "The medal table"). `medalFor`, `medalTables` and
`scopeResults` (`lib/medals.js`) decide who has a medal, and a start's `Mitalit` view uses the same
functions. They are tested in `test/medals.test.mjs`.

A championship gives its medals among the clubs of its scope: a piiri, an alue or the whole country
(`docs/districts.md`). In `lib/districts.js`:

- `medalScope`: which scope a row ranks under;
- `nameCover` and `coversStart`: which starts a scope's championship covers;
- `closedPair`: a second piiri, found from the meet's entries.

The championships sheet stores the chosen scopes per meet, in the view state's `scopes`
(`normalizeScopes`, `lib/routes.js`).

Rule:

- **`defaultScopes` reads the meet's name and organiser, and gives fewer scopes when in doubt.**
  Nothing in Tuloslista marks a meet as a championship (`docs/tuloslista-api.md`). The cases are in
  `test/districts.test.mjs`, most under their meet's id. To change the rules, change those cases.

## The years

Two pages show a year of meets from the Worker's records (`docs/backend.md`, "A scope's year" and
"The cup's year"):

- `/seuracup`: `renderCupSeason` (`app/cup.js`), from the section "The cup's year" of `lib/cup.js`.
  Tested in `test/cup.test.mjs`.
- `/mestaruudet`: `renderMedalSeason` (`app/medals.js`), from the section "A championship's year" of
  `lib/medals.js`. Tested in `test/medals.test.mjs`.

Home's fill-in loop adds a year's missing meets (`docs/home.md`, "Filling the scan in").

Rule:

- **Every meet of a championship's year is a row that links to its medal table.** So a meet that
  `defaultScopes` reads wrongly is still seen.
