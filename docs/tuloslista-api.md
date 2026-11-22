# The Tuloslista API's traps

Tuloslista publishes no documentation of its API. This doc lists its traps, where a field or a
response means something other than it seems, and the behaviour seen only during a live meet. Each
entry ends with the month it was last seen to hold. `AGENTS.md`, "Measure, do not guess", says where
any other measurement goes.

## Endpoints

- **Nothing is keyed on a person.** No endpoint lists a meet's entrants or looks up an athlete
  (2026-08).

## The listing

- **It serves a live window and ignores every parameter.** The window runs from about a month back
  to a day or two ahead (2026-09). The listing returns the same window whatever `?from`, `?to`,
  `?year`, `?month`, `?date` or `?id` asks for (2026-08).
- **A meet can disappear from `/competition/{id}` and `/properties` while its events' results are
  still available.** Both endpoints then return 404 with an empty body, and the listing drops the
  meet too (2026-10).
- **`MEET_CRAWL_FLOOR` is the lowest id that returns a meet, and the ids above it are sparse.** A
  404 on one id does not mean that the ids after it are unused (2026-09).
- **`Stadion` does not say indoor.** `Type: 2` appeared on one indoor hall, which is too few to
  treat it as an indoor marker (2026-08).

## Schedule and rounds

- **The results resource's copy of a round's `Status` can be stale, and the schedule's copy is
  correct** (2026-08).
- **The `Status` of a class nobody entered never advances.** That class stays at `Unallocated`, or
  at `Allocated` with an empty heat shell, as if the start were still to come (2026-08).
- **A schedule row's `CountEnrolled`, `CountConfirmed` and `CountAllocated` are 0**, even when the
  event has real entrants (2026-08).
- **The steeplechase is filed under `SubCategory` `Steeples` or `Run`**, so only its name identifies
  a steeplechase (2026-09).
- **An adults' SM whose results are on another site has its entries and nothing drawn.** Each event
  has one round with no heats and the start time of the event's first session, whatever the round's
  name and however many rounds were run. A multi-event's root and its `SubEvents[]` legs have no
  heats either (2026-09).
- **An SM meet whose rounds never get past the start lists has its results elsewhere.** Every such
  SM meet of the 2025 and 2026 seasons had its results on another site, and every other SM meet had
  official results (2026-09).

## Heats and allocations

- **A steeplechase's `Position` is the athlete's place on the start line of a group start**, not a
  lane (2026-09).
- **A published draw can change during the meet** (observed at the track, 2026-09).

## Varmistus (confirmation)

- **The confirmation fields of `/properties` are unused.** `ConfirmationDeadlineInMinutes` and
  `ConfirmationOpensWindowInDays` are 0 (2026-08).
- **`Confirmed: false` means nothing on its own.** Most meets confirm nobody and let everybody run
  (2026-08).
- **The confirmation deadline counts back from the event's own start time.** The deadline is the
  `IntValue`, in minutes, of the `Settings[]` entry with `Type: 1` on `/properties` (observed at the
  track, 2026-08).
- **A multi-event athlete confirms once, before the first leg.** The root's `Enrollments[]` holds
  the confirmation, and a leg's own `Confirmed` can differ from it (observed at the track, and
  measured 2026-09).
- **A meet uses confirmation per event and per entry, not for the whole meet.** A meet can take
  confirmations in a few events and draw everybody in the rest. The data does not distinguish a
  required confirmation from a recorded one. A relay team confirms once, where and how its organiser
  decides (2026-08).
- **An unconfirmed entrant may still run, and a confirmed entrant may not be drawn** (2026-08).

## Results and ranks

- **A piiri or alue championship seldom flags the athletes from outside the piiri or alue as guests
  with `NotInCompetition`**, so they take podium places by `ResultRank` (2026-09).
- **`PB` and `SB` are published per entry.** Either can be missing on one of an athlete's entries
  and present on another. They are the values the entry entered with, and stay the same even after a
  result betters them (2026-08).

## Qualification

- **A `q` can change until the round ends.** A later heat can take `QResult: true` away from an
  athlete (2026-08).
- **An equal `ResultRank` is a tie that the API could not break, not every pair of equal marks.**
  The API ranks on thousandths, and the feed rounds them to hundredths (2026-08).
- **A finished round's qualifiers are not always the next round's field.** A qualifier can withdraw,
  and the next athlete down then takes the place without a Q or q flag.

## Relays

- **A flat shuttle relay is filed as a plain relay**, with `SubCategory: "Sprint"`, so only the name
  shows that it is a shuttle relay (2026-08).
- **A shuttle relay's drawn `Position` follows no single convention.** It is either one of the
  pair's two lanes or the pair's number, and no field shows which lane runs which legs (2026-09). At
  the track, the pairs were lanes 1 and 2, 3 and 4, and so on, and legs 2 and 4 ran in the odd lane
  (observed, 2026-08).
- **`TeamId` tells a club's two teams in a race apart, but not which team has which number in its
  `Name`** (2026-08).

## Categories, names and identity

- **For medalists, a licence holds across a year.** A medal row without a licence has one under the
  same name and club in another meet (2026-09).
- **A club keeps its `Organization.Id` across meets**, except a few clubs outside SUL athletics and
  some schools, which exist under two ids (2026-10).
- **A club entered by hand at a meet gets a duplicate `Organization`.** Its `Name` differs from the
  canonical club's `Name` only in case, spacing, punctuation or a trailing "ry", and its `NameShort`
  usually differs too (2026-11).
- **Unrelated clubs can share a `NameShort`**, such as schools and clubs entered by hand (2026-11).

## Field events

- **A short `Attempts[]` does not mean that the athlete missed the top-8 cut.** An athlete who
  reaches the automatic qualifying mark may stop early (2026-08).
- **No field shows whether a meet gives every athlete the same number of attempts or cuts to the top
  eight** (2026-08).

## Combined events (moniottelu)

- **The root round's `Status` is `Unallocated`, however far the multi-event has progressed**
  (2026-09).
- **While a multi-event is in progress, its later legs are not yet drawn** (2026-08).
- **Before the first leg is scored, the root ranks every athlete 1 with a total of `"0"`**
  (2026-08).
- **Before the meet, the root has no round**, and `Enrollments[]` is its only field with data
  (2026-08).

## Club-cup points (Seuracup)

The official cup page, `live.tuloslista.com/seuracup/{id}`, is the only specification of the scoring
(2026-08).

### An osakilpailu

- **The cup meets are small and plain.** They have one round per event, no multi-event, and no
  `Organization` that is null or 0 (2026-08).
- **Tuloslista has no standings resource.** The official cup page fetches every event in the browser
  and recomputes the table (2026-08).

### The finals

- **The flag moves once, on the meet day.** A final's cup entry in `Settings[]` has `Type: 3` before
  its day and `Type: 0` after it (2026-08).

### The season

- **A cup meet can be found by its name.** Every meet of the year named Seuracup or Föreningscup has
  the cup's `Settings[]` entry. The name also distinguishes a 9-year-olds' meet and a final from an
  osakilpailu (2026-09).
- **The two rounds are June and August**, and the finals come after them. A meet's name does not
  always number its round (2026-09).
- **A cup meet's piiri is its organiser's.** The organiser is a member club, several member clubs
  joined with "/", or the piiri itself. A meet's name can add piiris, and a piiri can run several
  lohkot (2026-09).
- **The series' own site shows the season** at `seuracup.tuloslista.com`, over plain HTTP only. Its
  `/finals` page covers only the current year and uses club ids of its own (2026-09).
- **`/finals/` is the qualification for the finals.** The page ranks every club by the sum of its
  two osakilpailu totals, with consecutive numbers even through a tie. Each final takes its
  organiser, then the other clubs by rank: eight for the Superfinaali, and sixteen for a series'
  final, whose series is in its name (2026-09).
- **The series' site sums its own copy of the results, which is older than the API's corrections**
  (2026-09).
