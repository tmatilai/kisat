# The Tuloslista API, as measured

Tuloslista publishes no documentation of its API, so each entry here is a measurement that the code
depends on, with the month it was last seen to hold. `AGENTS.md`, "Measure, do not guess", says how
one is written. The other sites that carry a meet's results are in `docs/elsewhere.md`.

## Measuring a claim

- Read an endpoint with `curl -s <base>/competition/<id>`. The API needs no key and no header.
- `make test COMP=<id>` runs `test/live.mjs`, which checks that a meet's live data still has the
  shape `public/lib/` assumes.
- Re-probe `MEET_CRAWL_FLOOR` and the first ids of 2026 in January 2027, since the floor may move at
  the turn of the year.

## Endpoints

- `API` (`lib/schedule.js`): the base, which the page fetches directly.
- `buildRoster` (`lib/roster.js`): a meet's entrants.
- `SM_WORD_RE` (`lib/districts.js`): a championship, read from the name.

The base is `https://cached-public-api.tuloslista.com/live/v1`. Its CORS is open, and Tuloslista
publishes no rate limit (2026-09). The code reads four endpoints (2026-09):

- `GET /competition`: the listing, rows of `Id`, `Name`, `Date`, `Location`, `OrganizationName`,
  `Stadion` and `LiveStatus`.
- `GET /competition/{id}`: the schedule, an object keyed by day in the form `"8.8.2026"`.
- `GET /competition/{id}/properties`: `Competition`, with `Name`, `BeginDate` and the organiser's
  name, and `Settings[]`.
- `GET /results/{compId}/{eventId}`: one event, with `Name`, `EventType`, `Enrollments[]` and
  `Rounds[]`.

Traps:

- **Nothing is keyed on a person.** No endpoint lists a meet's entrants or looks an athlete up
  (2026-08).
- **No response gives a venue or a meet's last day.** Only the listing's `Location`, `Stadion` and
  `Date` come near (2026-08).
- **Nothing marks a championship.** Neither the listing nor `/properties` has such a field, so a
  meet's `Name` is the only sign (2026-09).

## The listing

- `crawlMeets` (`worker.js`), `MEET_CRAWL_FLOOR` (`lib/indexes.js`): the meet index
  (`docs/backend.md`, "The meet index").
- `meetWhen`, `meetPlace` (`lib/home.js`), `isoDay` (`lib/dates.js`): a meet's days and place.

Traps:

- **It serves a live window and ignores every parameter.** The window runs about a month back and a
  day or two ahead (2026-09), whatever `?from`, `?to`, `?year`, `?month`, `?date` or `?id` asks
  (2026-08).
- **A meet answers by id outside the window.** It answers days before the listing names it, and long
  after, with its schedule, `/properties` and every event's results (2026-09).
- **`MEET_CRAWL_FLOOR` is the lowest id that answers.** Ids above it are sparse, so one 404 means
  nothing (2026-09).
- **`Date` is one day, and not reliably a meet's first day.** It can fall after the schedule's first
  day, and the schedule's day keys are the meet's real days (2026-08).
- **`Date`'s time is noon in Finland under one of two offsets.** It reads `T09:00:00+00:00` or
  `T12:00:00+03:00`, so the day is the date as written (2026-09).
- **`Location` defaults to the placeholder `Kilpailupaikka`.** Such a row still has a usable
  `OrganizationName` (2026-08).
- **`Stadion` does not say indoor.** It is `{Name, TrackCount, Type}` on listing rows only,
  `TrackCount` reads 0, and `Type: 2` appeared on one hall, too few to read as indoor (2026-08).

## Schedule and rounds

- `eventStore`, `roundDetail` (`lib/schedule.js`): an event's document, and a round in it.
- `reconcileStatuses`, `groupStatuses`, `startFinished`, `meetPhase` (`lib/schedule.js`): the status
  of a start and a meet.
- `tsKey` (`lib/dates.js`), `roundGroupKey` (`lib/schedule.js`): the schedule's order, a start's
  key.
- `steepleDistance` (`lib/hurdles.js`): a steeplechase.

Traps:

- **A schedule row is one round.** Its `Id` is the round, its `EventId` is shared by every round of
  the event, `/results/{compId}/{eventId}` returns them all in `Rounds[]`, and a round's name does
  not say which round it is (2026-08).
- **A day costs one document per `EventId` on it** (2026-09).
- **`Enrollments[]` is event-wide.** It lists everyone who entered the event, including athletes
  knocked out in an earlier round (2026-08).
- **An event runs at most three rounds, and seldom three** (2026-08).
- **The results resource's copy of a round's `Status` goes stale, and the schedule's is true.** They
  disagree only as `Progress` against `Official`, so the further along wins (2026-08).
- **The classes of one start do not share a `Status`, and a class nobody entered never advances.**
  It rests at `Unallocated`, or at `Allocated` over a heat shell, like a start still to come
  (2026-08).
- **One class at `Official` says a start has been run** (2026-09).
- **A schedule row's `CountEnrolled`, `CountConfirmed` and `CountAllocated` read 0**, even with real
  entrants (2026-08).
- **`BeginDateTimeWithTZ` can write one meet's instants under two offsets.** The schedule is ordered
  by the instant, and a start's key keeps the raw string, since one start's rows agree (2026-08).
- **`SubCategory` is the discipline family, and it is reliable.** `Hurdles` marks every hurdle race
  and hurdle relay, and the steeplechase is `Steeples` or `Run`, so its name gates it (2026-09).
- **An event's results resource can be missing.** It answers 404 with an XML `BlobNotFound` body on
  a class nobody entered, so a 404 marks its own class alone as missing (2026-08).
- **An adults' SM whose results are on another site has its entries and nothing drawn.** Each event
  has one round with `Index: 0`, no heats and the clock of the event's first session, whatever the
  round's name says and however many rounds were run. A relay has no `Enrollments`, a multi-event's
  root and its `SubEvents[]` legs have no heats either, and a qualifying round has an empty `QRank`
  and `QResult` (2026-09).
- **An SM meet whose rounds never get past the start lists has its results elsewhere.** Every such
  SM meet of the 2025 and 2026 seasons had them on another site, and every other SM meet had
  official results (2026-09).

## Heats and allocations

- `heatsInOrder`, `roundAllocated`, `laneDrawn` (`lib/results.js`): heat order, the draw, a lane.
- `lanesAreOneDraw`, `heatsAreShared` (`lib/results.js`): a shared heat. Tested in
  `test/results.test.mjs`, "shared heats".
- `hurdleStartSetups` (`lib/hurdles.js`): a start's hurdle setups.

`Position` is the lane on the track and the draw order in the field (2026-08).

Traps:

- **`Heats[]` is not in heat order.** Heats are sorted by `Index` (2026-08).
- **An undrawn round can carry an empty heat shell**, beside an empty `Heats[]`, no `Heats` key and
  no round in `Rounds[]`, so a round is drawn when some heat holds an allocation (2026-08).
- **The classes in a heat can change from heat to heat.** A lane means something only inside its
  heat (2026-08).
- **A shared heat is not what it looks like.** Nothing says whether two classes' heat 1 at one time
  is one race, and only the lanes tell, since one draw uses each lane once (2026-08).
- **A field event is never one draw.** Its `Position` restarts at 1 in each class (2026-08).
- **A track event is one draw about half the time.** Whole meets fall on one side, and a meet that
  draws no lanes has `Position` 0 on every row (2026-08).
- **A steeplechase's `Position` is a place on a group start's line, not a lane** (2026-09).
- **A published draw can change during the meet** (observed at the track, 2026-09).

## Varmistus (confirmation)

- `confirmSetting`, `confirmNote`, `confirmStartAt` (`lib/confirmation.js`): the switch, the count
  and the deadline.
- `confirmRows`, `watchConfirmations` (`lib/confirmation.js`): the day's list, one row per entry.
- `categorySections` (`app/event.js`): the "Ei erissä" list.
- `confirmDeadline` (`app/follow.js`): the portal's link.

Traps:

- **`Enrollments[].Confirmed` is the only record of it.** No allocation carries it, and
  `Allocation.Id` equals `Enrollment.Id` (2026-08).
- **The meet's switch is a `Settings[]` entry on `/properties`.** It has `Type: 1`, a `StringValue`
  of `"on"` or `"off"` and the deadline in minutes as `IntValue`, and it is the only signal before
  anybody has confirmed (2026-08).
- **`/properties`' own confirmation fields are dead.** `ConfirmationDeadlineInMinutes` and
  `ConfirmationOpensWindowInDays` read 0 (2026-08).
- **The entry's presence is read, and its value is not.** A meet at `"off"` can still confirm, and a
  meet with no entry is judged on its data (2026-08).
- **`Confirmed: false` means nothing on its own.** Most meets confirm nobody and run everybody
  (2026-08).
- **The minutes count back from the event's own start** (observed at the track, 2026-08).
- **A multi-event confirms once, before its first leg.** Its root's `Enrollments[]` holds the
  answer, and a leg's own `Confirmed` can disagree (observed at the track, and measured 2026-09).
- **Confirmation is used per event and per entry, not per meet.** A meet can confirm in a few events
  and draw everybody in the rest, a relay team confirms once, and the data cannot tell a required
  confirmation from a recorded one. It does not vary with the discipline, so nothing gates on
  `EventType` (2026-08).
- **Unconfirmed is not "not running", and confirmed is not "drawn".** A strict meet draws exactly
  the confirmed, and a referee can still draw an unconfirmed entrant (2026-08).
- **The portal ignores the meet in its own URL.** A fresh load of
  `www.tuloslista.com/varmistus/#!/{id}` still asks for a competition, and a relay team confirms
  wherever its organiser says, so the link is a guess for a relay (2026-08, the relay's side
  observed at the track).

## Results and ranks

- `displayRank`, `heatPlaces`, `isFinalRound` (`lib/results.js`), `medalFor` (`lib/medals.js`):
  ranks, places and medals.
- `medalScope` (`lib/districts.js`): a piiri's or an alue's own medals.
- `bestsParts`, `beatsMark` (`lib/results.js`): an entry's bests.

Traps:

- **`ResultRank` is round-wide, and `HeatRank` is the place in the heat.** This holds in a field
  qualifying round too, `HeatRank` is set wherever `ResultRank` is, and in a single-heat round the
  two are equal (2026-08).
- **A rank is per class.** In a heat of two classes, neither rank is the place in the race
  (2026-08).
- **A shared place is a shared `ResultRank`**, in a final too (2026-09).
- **`RoundTypeCategory` is `Final` on a single-round event, with rare exceptions.** An only round
  can be filed `Qualify` (2026-09).
- **`NotInCompetition` marks a guest, who is listed and timed and has no rank** (2026-08).
- **A piiri's or an alue's championship seldom flags its guests from outside the piiri or alue**, so
  they take podium places by `ResultRank` (2026-09).
- **`PB` and `SB` are published per entry.** Either can be missing on one entry of an athlete and
  present on another, and a `PB` with no `SB` is common (2026-08).
- **An entry's `PB` and `SB` are the ones it entered with**, through every round, even after a
  result passes them (2026-08).

## Qualification

`QRank` and `QResult` are strings on a round, which give the rule, and booleans on an allocation,
the athlete's own Q or q, which never has both (2026-08). A field event's `QRank` is the automatic
mark and its `QResult` the field size with the fill-ins, and a track event's `QRank` is the
automatic qualifiers per heat and its `QResult` the fill-ins on time (2026-08).

- `qualificationNote`, `qualBadge`, `qualPending`, `tiedQualBadge` (`lib/results.js`): the rule and
  the badges. Tested in `test/results.test.mjs`, "qualBadge tied qualifiers".
- `previousRoundField`, `fieldMayChange` (`lib/schedule.js`): a field borrowed from the round
  before.

Traps:

- **An empty `QRank` is half the rule unused, not "no cut".** Only both empty means no cut
  (2026-08).
- **A `q` is a standing count until the round ends.** A later heat can take `QResult: true` off an
  athlete, while a `Q` is decided by its own heat (2026-08).
- **A tie can leave the badge on one of the two.** The API gives tied athletes equal ranks and the
  `q` to only one (2026-08).
- **An equal `ResultRank` is a tie the API could not break, not every equal mark.** The API ranks on
  thousandths that the feed rounds to hundredths (2026-08).
- **A finished round's qualifiers are not the next round's field.** A qualifier can withdraw and the
  next one down take the place with neither flag.

## Wind

- `heatWind`, `windLegalEvent`, `parseWind`, `resultWind` (`lib/results.js`): which races show a
  wind, and a row's reading. Tested in `test/results.test.mjs`, "resultWind".

A reading is `+d,d` or `-d,d`, signed except on a calm `0,0`, with an ASCII hyphen (2026-08).

Traps:

- **Every track heat carries a `Wind`, even in a race the rules do not measure it for.** The
  distance gate is the app's (2026-08).
- **A heat without a reading has `'NM'` or `null`** (2026-08).
- **Each track allocation carries its heat's `Wind`**, so a row out of its heat reads its own
  (2026-08).
- **A field heat never carries a `Wind`.** A horizontal jump's wind is per attempt, on the
  allocation (2026-08).

## Relays

- `relayLegCount` (`lib/results.js`), `raceDistance` (`lib/lap-counter.js`): legs and distance.
- `isShuttleRelay` (`lib/lap-counter.js`): a shuttle relay.
- `shuttleLanePair`, `shuttlePairDraw`, `hurdleRelaySpec` (`lib/hurdles.js`): shuttle lanes and the
  mixed relay (`docs/hurdles.md`, "Aitaviesti").
- `relayLineup`, `relayInfo` (`lib/results.js`), `relayTeams` (`lib/roster.js`): a team.
- `allocMatches` (`lib/watch.js`): a team's club.

Traps:

- **`EventType.Length` is one leg.** A 4x400 m reports 400, so a relay passes any test on length
  unless `Category` is read too (2026-08).
- **A race can be filed under the wrong `EventType`.** Its `TeamSize` and code are then wrong, while
  the event's `Name` in the results is right, so an `NxM` in it wins (2026-08).
- **A hurdle relay is a shuttle relay.** It has `SubCategory: "Hurdles"`, the team crosses the line
  once however far it runs, and each team takes a pair of lanes (2026-08).
- **A flat shuttle relay is filed as a plain relay.** It has `SubCategory: "Sprint"` and one lane a
  team, so only the name says shuttle (2026-08).
- **A shuttle relay's drawn `Position` follows no convention.** It names either lane of a pair or
  the pair's number, and no field says which lane runs which legs (2026-09). At the track the pairs
  stood (1,2), (3,4) and on, with legs 2 and 4 on the odd lane (observed, 2026-08).
- **The sekaviesti's class token is `M/N` or `N/M`, and the round is filed under one gender.** It
  can be either, and a junior series glues its age onto the token (2026-09).
- **`AthleteOrders` can be longer than the race has legs.** The extras carry no flag, so a team's
  runners are its first legs by `Index` (2026-08).
- **`Enrollments[]` never carries `AthleteOrders`**, even after the draw (2026-08).
- **A relay enrollment's `Name` is the team's.** It is the club's name, numbered per race where the
  club enters twice, and `TeamId` tells two teams apart but not which is which (2026-08).
- **A relay entry belongs to the club that entered it.** An athlete's own `Organization` need not be
  the team's, so a club is matched on the entry's `Organization.Id` (2026-08).
- **An individual allocation also carries a one-entry `Athletes` array.** The event, not the row,
  decides whether a row is a team (2026-08).

## Categories, names and identity

- `compareCategories`, `rowClassAge`, `filedStart`, `parseEventName` (`lib/schedule.js`),
  `hurdleKey` (`lib/hurdles.js`): a row's class.
- `buildDigest` (`lib/digest.js`), `allocKey`, `bibNumbersUsed` (`lib/results.js`): an entry.
- `isFollowableOrgId` (`lib/indexes.js`): the placeholder club.
- `medalSeasonTable` (`lib/medals.js`), `cupSeasonTable` (`lib/cup.js`), `cupSeasonTargets`
  (`worker.js`): the years keyed on `Organization.Id`.

A schedule row carries `Gender` and a numeric `Age`, with `"0"` for the adult classes, and the
results resource has only `Group` (2026-08).

Traps:

- **A relay's `Category` is `Relay`, never `Track`.** A filter on `Track` drops every relay
  (2026-08).
- **Class labels do not sort as text.** No youth class runs past 22 and no masters' class starts
  before 35, so an age of 30 splits them (2026-08).
- **`Age` can be the group's and not the class's.** It varies even within one meet, and `GroupName`
  can disagree with the class too, so a class in the event name wins (2026-08).
- **A relay of several classes names none, and is filed as the adult men.** A name that opens on its
  formula names no class (2026-09).
- **One meet can spell a mixed series two ways**, with and without a space between `Mixed` and the
  age (2026-08).
- **A meet can name an event one way in its schedule and another in the event's document**, such as
  a boys' class written with M in one and P in the other (2026-09).
- **`Athletes[].Id` identifies an entry, not a person.** A person entered individually and in a
  relay gets two ids in one meet, on rows that agree on name and club, and `LicenseId` identifies
  the person (2026-09).
- **An entry's `TeamId`, or else its sole `Athletes[].Id`, is the same in every round of one event**
  (2026-08).
- **Whether an entry has a bib depends on the meet and the event.** Some meets number nobody in most
  events, and sprint relays have `Number: null` (2026-08).
- **A licence holds across a year for medalists.** A medal row without one has a licence under the
  same name and club in another meet (2026-09).
- **An `Organization` is `{Id, Name, NameShort}` and nothing more.** Nothing names a piiri or a
  region (2026-09).
- **`Organization.Id: 0` is no club, and it carries a real club's name.** Only the id marks it, and
  its rows have no `LicenseId` (2026-08).
- **A club keeps its `Organization.Id` across meets.** Each club name has one id and each id one
  name, except that a few clubs outside SUL athletics, and some schools, exist under two ids, so a
  year keyed on the id shows them twice (2026-10).
- **A club entered by hand is a second `Organization`**, with a `NameShort` of its own and the same
  `Name` (2026-09).

## Field events

`Category: "Field"` has the `SubCategory` `Throw`, `VerticalJump` or `HorizontalJump`. An attempt is
`{Line1: "<mark>" | "x" | "-", Line2: null}` in a throw, `{Line1: "<mark>", Line2: "<wind>"}` in a
horizontal jump and `{Line1: "<height in cm>", Line2: "xxo"}` in a vertical jump (2026-08).

- `markFormat`, `attemptColumns`, `verticalJumpRow` (`lib/results.js`): the attempts.
- `fieldMark`, `resultOrderKey` (`lib/results.js`): a mark's unit and order.
- `startListTable` (`app/event.js`): a drawn start.

Traps:

- **A drawn start has no attempts until the first one is taken.** Drawn and started are separate
  questions (2026-08).
- **`Attempts.length` differs within a heat.** The columns come from the widest row of every heat in
  the round (2026-08).
- **A short `Attempts[]` is not the top-8 cut.** An athlete with the automatic mark may stop early,
  and the last three rounds run in reverse order of standing (2026-08).
- **A meet can give every athlete the same number of attempts instead of cutting to the top eight**,
  and nothing tells the two apart (2026-08).
- **A `Result` is a bare number in the discipline's unit, and `PB` and `SB` can be in the other.** A
  throw or a horizontal jump is metres with a decimal point, a vertical jump whole centimetres, and
  a time has a decimal comma (2026-08).
- **The decimal point is the unit.** Nothing names one, and a mark with a point is metres and one
  without is centimetres (2026-08).

## Combined events (moniottelu)

- `combinedEventStarts`, `multiEventLeg` (`lib/combined.js`): the legs. Tested in
  `test/combined.test.mjs`, "combined events".
- `combinedEventRoots` (`lib/roster.js`), `combinedEventStatus` (`lib/schedule.js`): the root and
  the status.
- `combinedTotals`, `combinedLegColumns`, `combinedWithdrawn` (`lib/combined.js`): the standings.
- `renderCombined`, `pointsRail` (`app/event.js`): the view.

Traps:

- **A multi-event is on no day's schedule, and only its legs are.** A leg is an ordinary row named
  as the multi-event, two spaces, then the discipline, so it is found by its name alone (2026-08).
- **A leg's results resource names its root.** It has `IsCombinedEvent: true`, `RootName` and
  `RootId`, and nothing in the schedule says a row is a leg (2026-08).
- **The `RootId` is a results resource of its own.** It has `RootId: 0`, and its one round carries
  each athlete's total, the sum of the legs' `CEPoints`, as `Result`, placed by `ResultRank`
  (2026-08).
- **`SubEvents[]` holds whole leg results.** A leg runs in as many heats as it needs, and the root's
  one heat is a container with `Index: 0`, `Position: 0` on every row and a `HeatRank` that copies
  `ResultRank` (2026-08).
- **`SubEvents[].Index` is the order the legs are run in, and nothing else gives it** (2026-08).
- **Root and legs join on `Athletes[0].Id`**, the per-meet id (2026-08).
- **The root's round `Status` reads `Unallocated` however finished the meet is.** Its
  `RoundTypeCategory` is `Final` (2026-09).
- **While a multi-event runs, its later legs are still undrawn** (2026-08).
- **Before the first leg is scored, the root ranks everybody 1 on a total of `"0"`**, an entry list
  and not a standing (2026-08).
- **Before the meet, the root has no round to read.** `Enrollments[]` is the only field (2026-08).
- **A withdrawal's total is `"DNF"` or `"DNS"`, with `ResultRank: null`.** The two are used
  interchangeably, and a leg's DNF costs that leg's points alone (2026-09).
- **A guest can out-score the winner, and is ranked nowhere.** A guest's rows have no rank, the
  legs' included (2026-08).
- **`CEPoints` is on every allocation of every event.** It is `0` outside a multi-event, so
  `IsCombinedEvent` decides whether it shows (2026-08).
- **A multi-event can span two days** (2026-08).

## Club-cup points (Seuracup)

The cup is a national series of piiri meets scored by club. Its official reader,
`live.tuloslista.com/seuracup/{id}`, is the only specification, and each scoring rule below was
checked row for row against it (2026-08). `docs/seuracup.md` holds the clubs' series.

### An osakilpailu

- `isCupMeet`, `cupMode`, `cupStandings`, `cupRowBeats` (`lib/cup.js`): the marker and the
  standings. Tested in `test/cup.test.mjs`, "isCupMeet/cupStandings".

Traps:

- **The marker is a `Settings[]` entry on `/properties` with `Type: 3` and a non-zero `IntValue`.**
  The reader gates on it too, and the flag decides, since every allocation of every meet carries
  `SeuraCUPPoints` (2026-08).
- **Only a `RoundTypeCategory: "Final"` round scores, even as the only round** (2026-08).
- **One scorer per club per event, the club's single best `SeuraCUPPoints`.** Level on points, the
  series' site names the better result, then the better place, across the walks' two races too
  (2026-09).
- **`NotInCompetition` scores nothing, and its rows carry real points** (2026-08).
- **The walk is one event for both genders.** Walks of `SubCategory: "Walk"` whose `Group` agrees
  after the gender letter score as one, and a club scores its best walker of both (2026-08).
- **A start and a cup event do not line up.** The genders' walks may share a start or not, and one
  start can hold two ages' walks, so the standings name the rows that counted (2026-08).
- **A relay scores as the team's own row**, and a mixed relay is one event upstream (2026-08).
- **The cup meets are small and plain.** They have one round an event, no multi-event, and no
  `Organization` that is null or 0 (2026-08).
- **There is no standings resource.** The reader fetches every event in the browser and sums the
  table again every 30 s (2026-08).

### The finals

- `cupFinalMax`, `cupFinalLadder`, `cupFinalStandings` (`lib/cup.js`): a final. Tested in
  `test/cup.test.mjs`, "cupMode/cupFinalStandings".
- `NOT_A_CUP_TTL_S` (`worker.js`): how long a meet that scores nothing is cached.

Traps:

- **A final's marker is `Type: 0`.** Its `IntValue` is the winner's points, and a final fails the
  `Type: 3` gate (2026-08).
- **The flag moves, once on a meet day.** A final carries `Type: 3` before its day and `Type: 0`
  after, while age moves no osakilpailu's flag (2026-08).
- **A final scores by place, off a ladder whose top is `IntValue`.** The second takes `IntValue - 2`
  and each place after one less, tied rows share their places' points, a row with no place scores
  nothing and skips nobody, two rows a club score per round, and level clubs are split by their best
  sukkulaviesti place (2026-08).

### The season

- `cupSeasonMeets`, `cupMeetRound`, `cupSeasonTable`, `cupFinalSeries` (`lib/cup.js`): the year's
  meets, table and finals.
- `make cup-diff` (`dev/cup-diff.mjs`): compares a year with the series' site.

Traps:

- **A cup meet's name finds it.** Every meet of the year named Seuracup or Föreningscup carries the
  flag, and the name tells a 9-year-olds' meet and a final from an osakilpailu (2026-09).
- **The two rounds are June and August**, with the finals after, and a name need not number its
  round (2026-09).
- **A cup meet's piiri is its organiser's.** The organiser is a member club, several joined with
  "/", or the piiri itself, a name can add piiris, and a piiri may run several lohkot (2026-09).
- **A club's season is the sum of its osakilpailu totals.** The meet index, not the listing, reaches
  the year's meets (2026-09).
- **The series' own site shows the season** at `seuracup.tuloslista.com`, over plain HTTP only, and
  `/finals` covers the current year alone, with club ids of its own (2026-09).
- **`/finals/` is the qualification.** It ranks every club by the sum of its two osakilpailu totals,
  numbered on through a tie, and each final holds its organiser and the rest by rank, eight for the
  Superfinaali and sixteen for a series' final, whose series is in its name (2026-09).
- **The series' site sums a copy of its own, older than the API's corrections.** `cupStandings` on a
  fresh fan-out equals the official reader (2026-09).
