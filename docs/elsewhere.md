# Results published on another site

An adults' SM has only its entries in Tuloslista and its results on `live.time4results.com`. The
relay SM has no Tuloslista meet at all. A road, terrain or trail SM has its results in a mass race's
files on `online.tulospalvelu.fi`. `public/data/elsewhere.json` lists each one, and the Worker reads
its results once it is over, or a race's on its days too. The routes and keys are in
`docs/backend.md`, "Results from another site", and the views' side is in `docs/views.md`, "Results
on another site".

- `graftElsewhere` (`worker.js`): the source a listed Tuloslista meet reads.
- `aggregateAlone` (`worker.js`): a championship with no Tuloslista meet.

## An SM on time4results

The Tuloslista meet has the entries and nothing drawn (`docs/tuloslista-api.md`, "An adults' SM
whose results are on another site"), and the graft fills its rounds from the site's pages.

- `t4rSitePages`, `t4rIndex`, `t4rResultPage`, `t4rQualRule` (`lib/t4r.js`): the pages, parsed with
  parse5.
- `t4rWanted` (`lib/elsewhere.js`): which pages are read.
- `t4rGraft`, `t4rRoundPages`, `t4rEventGraft` (`lib/elsewhere.js`): an event's rounds, one a page.
- `DEMO_SM_EVENTS`, `DEMO_SM_PAGES`, `DEMO_SM_SITE` (`demo.js`): the fixture. Tested in
  `test/elsewhere.test.mjs`, "t4rGraft: an SM meet's results from another site on its entries".

### The pages

- **A meet's directory has one index page per day.** The front page is the last day, and an earlier
  day is a subdirectory named by its weekday in two letters, such as `pe/`, which the front page
  links as `./pe/` (2026-09).
- **An index row gives the time, the event and the round, and links the pages.** The result page is
  `showEvent('<n>-<round>-r.html')` and the start list `-sl.html`. The time is the start's and the
  site's only clock. The round is `Alkuerät`, `Karsinta`, `Välierät` or `Loppukilpailu`, or empty
  for an event with no qualifying round and for a multi-event. A result page's `<h2>` is the index
  row's round (2026-09).
- **Event names differ from Tuloslista's** in spacing, in `aj` and `ej` for aidat and esteet, in a
  relay that has no `viesti`, and in `M` and `N` for a youth class's `P` and `T` (2026-09).
- **The pages are labelled `ISO-8859-1`, which a browser reads as windows-1252.** They send an
  `ETag`, and a request with `If-None-Match` answers 304 (2026-09).
- **Each heat and each field group is a table of its own, whose header row starts with `Sija`.**
  Places are numbered within it, and no list combines the heats. The row over the table names the
  heat and gives `Tuuli:` and the wind, the word alone where no reading was taken, or nothing for a
  field group. Split times are a table of their own after the heat, under a header that starts with
  `Matka` or `Distance` (2026-09).
- **A result row's second cell is the name, a `<br>` and the club.** No other kind of row has a
  `<br>` there. The third cell is the result, with a comma for the decimal and a jump's wind after a
  `<br>`. A row with no result has an empty place and a word such as `DNF`. A relay team's row has
  the team where a person's name is, and the next row has an empty first cell and the team's runners
  separated by commas (2026-09).
- **The cells between the result and the attempts have empty headers.** They hold, in an order that
  differs between pages, the record mark, a reaction time, `Q` or `q` alone for a row that went
  through, and a multi-event leg's points as the one cell of digits alone (2026-09).
- **A header with text after the result opens an attempt column.** A throw or a horizontal jump has
  one per attempt, and a jump's cell has the wind on a second line. A vertical jump's columns are
  its bars, with the pattern in the cell and `-` for a passed bar, and a bar nobody reached has an
  empty column. More than six bars wrap onto further lines of the same cells, and a cell's line
  answers the header's line (2026-09).
- **A multi-event has one standings page per day under one event name, and the last day's page is
  final.** Each leg has its own page. The standings give a club by its abbreviation, where every
  other page writes the full name (2026-09).
- **An earlier round's start list gives its rule for going through, and the result page does not.**
  The rule follows `Jatkoonpääsy:` in the row over each heat. A field round writes
  `Karsintaraja 12,50 (Q) tai 10 parasta (q)`, with a vertical jump's bar in centimetres and no
  comma. A track round writes `2 parasta (Q) + 2 ajalla (q)` (2026-09).

### Matching a row to an entry

- `t4rHeats` (`lib/elsewhere.js`): a row's entry, and its rank over all the heats of a round.
- `t4rMadeEntry` (`lib/elsewhere.js`): the entry made for a row nobody entered.
- `T4R_NOT_SM_RE` (`lib/elsewhere.js`): the starts that get no results.

Traps:

- **Tuloslista has a person's present name, and the page the name on the day.** So a row that finds
  no name takes the one unmatched entry of its club and first name (2026-09).
- **Some names differ between the sites by an accent alone.** So `personNameKey` drops accents, and
  keeps å, ä and ö as letters of their own (2026-09).
- **A page can write a club as no entry's `Organization.Name` does.** So a row's club falls back to
  the club its person or one of its runners is entered under (2026-09).
- **A wheelchair race (`kelaus`) runs in the meet but is no championship event in the federation's
  SM rules.** So it gets no results and no medals (2026-09).

## A championship with no meet in Tuloslista

Such a championship's row stands alone under an `id`, and every person in its meet is made.

- `t4rAloneMeet`, `t4rAloneDays` (`lib/elsewhere.js`): a meet off time4results, an event per index
  row's event and a round per page.
- `elsewhereClubOf`, `elsewhereClubIndex` (`lib/elsewhere.js`): a made row's club.

Traps:

- **The relay SM has no Tuloslista meet, since its teams are entered elsewhere.** Its site is the
  whole championship, and the index rows are its only schedule (2026-09).
- **Every event of the relay SM is a relay whose name carries the leg count.** A team's name is its
  club's name with a number after it, and the club is on the cell's second line (2026-09).
- **A long relay writes each leg's split after the runner.** The split's own comma cuts its fraction
  into an item of its own, so a cell of four runners reads as eight items (2026-09).
- **A made row's club comes from the club index.** A name that `clubs` spells is found by its
  abbreviation, and any other by its name. A club the index lacks gets an `ol-` id made of its name.

## A meet in a race's files

A road, terrain or trail meet can run inside a public race. Its entries may be in a Tuloslista meet
that gets no results, or nowhere (2026-09). A class is one official final, ranked by finish time.

- `olFiles` (`worker.js`): the reads.
- `olRace` (`lib/elsewhere.js`): a class's finishers, and the entry made for one.
- `olGraft` (`lib/elsewhere.js`): the finishers on a meet's own entries, matched by name.
- `graftPhase` (`lib/elsewhere.js`): a race's meet is read on its days, with each class in progress,
  and official once the meet is over.
- `olAloneMeet`, `olSchedule` (`lib/elsewhere.js`): a meet with no Tuloslista meet.
- `DEMO_ROAD_ROW`, `DEMO_ROAD_FILES`, `DEMO_ROAD_COMP` (`demo.js`): the fixture. Tested in
  `test/elsewhere.test.mjs`, "olAloneMeet: a road championship off a mass race's files".

Traps:

- **The results are static files under `/tulokset-new/online/` on `online.tulospalvelu.fi`.** They
  are `online_<event>_event.json`, `online_<event>_competitors.json`, and the results, either whole
  in `online_<event>_results.json` or as one `online_<event>_results_<classId>_1.json` per class.
  The page for people is `/tulokset-new/fi/<event>/`, and a class has no address of its own
  (2026-09).
- **A result row's `Results` is a list of `[point, time]`.** Point 0 is the finish, and the time is
  in tenths of a second. A row that did not finish has a null time. The rows carry no place and come
  in no order, and no two finishers of a class have shared a time (2026-09).
- **The files give no licence and give a club as free text.** `LicenseNumber` is 0 (2026-09).
- **A finisher reaches `results.json` within a minute or two, and a time can still move after the
  race.** A corrected start time moved every finisher's time in four classes 45 minutes after their
  last finisher, and a day's files are rewritten the next morning (2026-10).

## The licence a made person gets

Neither time4results nor a race's files give a licence, and a follow-list follows a person by
licence. So a person the graft makes takes the licence that the athlete index has under its name and
club, and none where two licences share them. A meet with no Tuloslista meet has its own rows as its
roster.

- `athleteLicences` (`lib/elsewhere.js`): the lookup by name and club. Tested in
  `test/indexes.test.mjs`, "athleteLicences".
- `aloneEntries` (`lib/elsewhere.js`): the roster of a meet with no Tuloslista meet.
- `watchTargets` (`lib/watch.js`): a followed person, matched by licence.

Trap:

- **A made person often has no licence.** The athlete index knows most runners of the relay SM and
  about a third of a marathon's finishers (2026-09).

## Keeping elsewhere.json

A row is added by hand, and `elsewhereProblems` proof-reads the file in the offline suite. A `comp`
row of a race goes in before the meet, once the race's files answer, and so does a time4results row
with last year's directory. Any other row goes in once the meet is over. A scheduled GitHub
workflow, `.github/workflows/elsewhere.yml`, opens an issue each day for a championship due a row
and for a row due a fix, and `make elsewhere-due` prints the same list. Close an issue with no row
where the meet needs none.

- `elsewhereUpcoming`, `elsewhereIsRace`, `t4rFromLastYear` (`lib/elsewhere.js`): a championship run
  in a race, or one whose name had a `t4r` row last year, due its row from two weeks before it runs.
- `elsewhereCandidates`, `elsewhereIsDue` (`lib/elsewhere.js`): an SM meet whose rounds stop at the
  start lists (`docs/tuloslista-api.md`, "An SM meet whose rounds never get past the start lists").
- `ELSEWHERE_YEARLY`, `elsewhereYearlyDue` (`lib/elsewhere.js`): a championship that may have no
  Tuloslista meet, due from its entry's fixed day while the year has neither its row nor a meet of
  its name.
- `elsewhereRecheck`, `olMissingClasses` (`lib/elsewhere.js`): a `comp` row whose meet Tuloslista
  dropped, or whose `classes` name no event of the meet.

Where an SM's results are elsewhere, a track and field SM's have been on time4results and a road,
terrain or trail SM's in a race's files (2026-09), but a championship can change its source and its
month from year to year, so check the calendar. A row has one of these shapes, and the file's
`clubs` sits beside `meets`:

```text
{comp: <meet id>, t4r: "<year>/<directory>"}
{comp: <meet id>, ol: "<event>", classes: {"<event name>": <class id>}}
{id: "<word>-<year>", was?: <meet id>, name, location, date, start: "<hh:mm:ss±hh:mm>", ol, classes}
{id: "<word>-<year>", name, location, date, last, start, t4r}
```

Rules:

- **A row with `comp` joins the results to that Tuloslista meet**, whose entries keep their clubs
  and licences. Use it whenever there is one.
- **A row with `id` stands alone.** `date` is its first day, and `last` its last where it has
  several. `start` is the first start with the offset of the site's clocks, and for a race it takes
  the time and offset of the event file's `Classes[].Races[0].MassStartStr`.
- **A race's class starts at its own time.** `olSchedule` reads each class's `MassStartStr` from the
  race's event file, and falls back to the row's `start` where the file has none, as the page does
  while the Worker cannot answer. A cross-country meet's classes started apart (2026-10).
- **`name` is the championship's name, not the race's.** It is the meet's title, and `defaultScopes`
  reads its words to narrow the classes that the national scope covers.
- **`location` is the venue's town.** The front page prints it, since no listing gives it.
- **`was` is the Tuloslista meet that a row stands in for**, once Tuloslista has dropped it
  (`docs/tuloslista-api.md`, "The listing"). A link to that meet opens the row (`standInFor`).
- **A row that stands alone is added after its race, never before.** `olSchedule` marks every class
  of an `ol` row run and official, so a row added early shows the classes finished and empty.
- **`t4r` is `<year>/<directory>` under `T4R_BASE`.** A championship's directory has kept its name
  from year to year (2026-09).
- **`ol` is the race's event id, and `classes` maps each event name of the meet to the race's class
  id.** Both are known once the race's files answer, days before the race (2026-10). The class ids
  and names change from race to race, so the graft matches nothing on a class name. A class that
  sums others has no results file, and one missing file fails the whole race, so map no such class
  (2026-09).
- **Several rows can name one `ol`** where several meets run as one race, and each maps its own
  classes. Where one championship has two Tuloslista meets with the same entries, list one of them.
- **`clubs` maps a page's or a race's own spelling of a club to its abbreviation in
  `districts.json`**, for a club that the club index does not find by that name.
- **Adding a row needs no cache cleared**, since a listed meet's keys carry `elsewhereTag`.
- **Neither site forbids the reads.** `live.time4results.com` has no `robots.txt`, no terms and no
  robots tag, and `online.tulospalvelu.fi/robots.txt` disallows only `/tulokset/*` (2026-09).
