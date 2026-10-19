# The lap counter

The lap counter is Juoksut mode's alone (`docs/juoksut.md`). An official at the finish line taps a
competitor's tile at each crossing. A tile shows the call for that competitor's coming crossing: the
number of laps left after it, which the official shouts, 🔔 where one is left, and 🏁 where none is.

- `lib/lap-counter.js`: the logic, tested by `test/lap-counter.test.mjs`.
- `app/laps.js`: the view.
- The section "The lap counter (Juoksut mode)" of `index.html`: the look, with each call's colour,
  the pulses, the flashes and what reduced motion keeps.
- `dev/probe-laps.js`: the view in a browser, on the demo's races.

Rules:

- **The counter is early.** It says what to do about a runner while they are still 30 to 40 m out,
  since an official cannot act on a runner already level with them (2026-08). It reads at a glance,
  with one thumb, in the sun.
- **Nothing moves under the official's finger.** A tile leaves the grid, and the grid reflows, only
  on the official's own press or toggle. A dragged standings row is the one thing that moves, under
  the finger that drags it. `docs/juoksut.md`, "What the counter requires of the rest", keeps the
  page's refreshes off the counter.

## Being ready 30–40 m out

The clock is optional. Without it, the counter still counts, paces and prompts from the taps alone.
The clock adds the hand times, a pace from the first segment and the expected first crossing.

- `lapTimeMs` (`lib/lap-counter.js`): a competitor's lap time, from their own last laps, the first
  segment, the seed time or the heat's pace, in that order.
- `heatLapMs` (`lib/lap-counter.js`): the heat's pace.
- `lapPrompts` (`lib/lap-counter.js`): each competitor's expected crossing, call and state, such as
  due or overdue.

Rules:

- **A tile goes due when the competitor is 50 m out at their own pace, and nothing is set per race
  or per class.** The distance is `LEAD_METRES`, more than the 30 to 40 m above, since the extra
  metres leave the time to say it to the crew (2026-08). It goes overdue once it is as far past the
  expected crossing, which reads as a missed press.
- **The lap window never crosses a handover.** Where a relay's legs are whole laps, only the laps of
  the runner now on the track set the pace, and the team's history stands in until that runner has
  run one. Runners of one age differ widely: in a youth 3x600 m in a hall, the fastest and the
  slowest team ran the same 1800 m in 5:46 and 7:13 (2026-02).

## The lap board

On a race with laps, a strip in the clock's row mirrors the lap board at the track. Its big number
is the leader's crossings left to the finish, so it opens on the race's crossings and reaches 0 as
the leader finishes. Beside it are the number the board turns to on the leader's next pass, the
leader's bib and the time to that pass.

- `boardLeader` (`lib/lap-counter.js`): whose crossings the board counts, the competitor furthest
  along, finished or not, who is not out of the race.
- `applyBoard` (`app/laps.js`): the strip's numbers, and the swap of their sizes inside
  `BOARD_SWAP_METRES`.

Rule:

- **Nothing else on the counter shows the distance or the lap count.** The title has the distance,
  and the board opens on the crossings.

## Not losing a press

- `tapGuardMs` (`lib/lap-counter.js`): how soon after a crossing a press is refused as a double
  press.
- `repairTime` (`lib/lap-counter.js`): the time a repaired crossing gets.
- `deriveLaps` (`lib/lap-counter.js`): the counts and times, read from the log in time order, so a
  repair entered late sorts into place.

Rules:

- **A refused press records nothing.** If it truly was a lap, the tile goes overdue, and a repair
  puts the crossing in.
- **A missed crossing is repaired, not tapped.** Hold the tile, or tap its row in the list, and
  choose `＋ Kirjaa ohitettu ylitys`. It records one crossing where the competitor's pace puts it,
  since a tap at the moment of noticing would record one long lap and one short one.

### Recording a pack

A big distance field passes the line as a stream, and the official taps only its leader and its tail
(2026-08). The pack chip, `⏱ n kirjaamatta` under the clock, records the rest in one press, in the
gap after the pack. Its sheet names them, all ticked, and unticking leaves out someone who has left
the track.

- `missingIn` (`app/laps.js`): whom the chip counts, the overdue competitors less anyone one
  crossing from home.
- `packCrossings` (`lib/lap-counter.js`): the times a pack records, bracketed by the presses made
  within the last lap.

Rule:

- **A pack never records a finish, but a single repair may.**

## Saying it without a sound

Nothing beeps. Every cue is a colour, a movement or a buzz. Android vibrates on `navigator.vibrate`,
and iOS Safari ignores it, so on an iPhone the flash alone confirms a press (2026-08).

## Who still needs an action

- `openMark` (`app/laps.js`): the sheet that a held tile or a tapped row opens. It repairs a
  crossing, marks a DNS, DNF or DQ, or takes a mark back.
- `standingsFor` (`app/laps.js`): the standings, where a marked competitor trails the field and
  takes no place.

Rule:

- **Finishers never leave the grid on their own.** The `🏁 n maalissa · piilota` toggle takes their
  tiles off and puts them back, and their rows stay in the list.

## Distance, crossings and the track

- `crossingsFor` (`lib/lap-counter.js`): a race's crossings, the distance over the meet's lap
  rounded up, and 1 for a shuttle relay.
- `raceDistance` (`lib/lap-counter.js`): a race's distance, which for a relay comes from the name's
  `NxM`.
- `isShuttleRelay` (`lib/lap-counter.js`): a shuttle relay, known by its type or its name.
- `storedTrack` (`app/hurdles.js`): the meet's lap, as stored, or else the season's guess from
  `defaultTrack`. The select that stores it is in `docs/venues.md`.

Rules:

- **The counter reads the meet's track and never offers it.** A wrong lap count is fixed on the
  competition's page, which needs the network.
- **A race settled on one crossing records only the finish order and the hand times.** A sprint and
  a shuttle relay are such races. They have no call, no lap board, no band, no pack chip and no
  repair, and the start's button reads `🏁 Maaliintulot` where a distance race's reads
  `🔔 Kierroslaskuri`.

## The changeover

A youth 3x600 m in a hall put eleven teams in one heat, with every changeover at the finish line
inside about six minutes (2026-02).

- `nextCall` (`lib/lap-counter.js`): the call, where the bell outranks a handover.
- `legCrossings` (`lib/lap-counter.js`): the crossings per leg, or 0 where a leg is not whole laps,
  which turns the handover prompts off.

Rules:

- **A handover outranks the number.** 🤝 with a leg number means that leg's runner goes to the zone
  now. It shows from the team's last lap of a leg, which was about 40 s for young runners (2026-02).
- **The 🤝 is also a check.** A team that hands over while its tile shows a number has run a leg
  short.

## Splitting the field

One official can count and call four or five competitors (2026-08), so a heat of six or more with
laps can be split. The threshold is `SPLIT_MIN_FIELD`. `👥 Omat` opens a list of the heat, and each
phone then shows only the competitors it picked, in the tiles, the standings and the shared text.

- `myRows` (`lib/lap-counter.js`): whom a phone counts. No pick, or a pick that matches nobody,
  means the whole heat.
- `pickSheet` (`app/laps.js`): the pick, which applies nothing until `Valmis`.

Rule:

- **Each phone picks for itself.** Nothing checks that the helpers' picks cover the field once.

## The next-up band

The grid never reorders, so the band above it carries the order of arrival. It shows on a race with
laps and a heat of `BAND_MIN_FIELD` or more.

- `bandQueue`, `bandSlots` (`lib/lap-counter.js`): who is in the band and which slot each holds. A
  slot never sorts, holds its competitor until their crossing is recorded, and stays dead for
  `BAND_HOLD_MS` once it empties.
- `applyBand` (`app/laps.js`): the slots, written on each tick.

## Reading the screen

The heat fits one screen, as there is no time to scroll.

- `tileDensity` (`lib/lap-counter.js`): the tier, two, three or four columns on a phone, from the
  number of tiles.
- `tileAnchor`, `sortTiles` (`lib/lap-counter.js`): a tile's big number and the tiles' order. The
  number is the bib on a race with laps and the lane on a race of one crossing.

Rules:

- **The grid's density follows the number of tiles.** A wider screen may add columns, but nothing
  follows the viewport's height. iOS Safari changes the viewport's height as its URL bar collapses,
  and a relayout mid-tap is a mis-tap (2026-08).
- **A field of 20 fits one phone screen with the band.** It fitted at 402x697 CSS px, an iPhone 16
  Pro in Safari with its URL bar showing (2026-08).

## The screen explains nothing

What the presses do and what the symbols mean is behind the header's `?`, and no line on the counter
explains them.

- `lapsHelp` (`lib/lap-counter.js`): the help, which explains only what the screen in front of it
  draws.

## Clock, keys and the screen staying on

A tap on the clock starts it. A hold opens its sheet, which corrects the clock or clears the heat.

- `startsClock` (`lib/lap-counter.js`): the keys that start the clock, which are space, enter and
  the tablet's side key.
- `holdWakeLock` (`app/laps.js`): the screen staying on while the counter is open.

Measured on a Tab Active3 tablet (2026-08):

- Its programmable side key arrives as a keydown with the `key` `Unidentified`, no `code` and
  `keyCode` 0.
- Its pen's button reaches the page only as a `contextmenu` while the tip touches the glass.
- Android swallows a Bluetooth remote's volume-up key, so a remote must be set to send enter.

### Correcting a clock started late, early, or not at all

Moving the zero moves every time in the heat by the same amount and changes no order, place or gap,
so the correction is safe mid-race.

1. Hold the clock and choose `Säädä kelloa`. It is there once the clock has started or a crossing is
   logged, and it applies nothing until `Valmis`.
2. Nudge by how late the press was, in whole seconds, since a lateness judged against a clock across
   the field is no better than a second. Or pick a competitor and type the time that their latest
   crossing actually had, off the stadium clock or the announcer, in the form `2.05,3`. The second
   way also rescues a heat whose clock never started.

- `correctedStart`, `anchorStart` (`lib/lap-counter.js`): the new zero, which lands neither after a
  logged crossing nor in the future.
- `startNote` (`lib/lap-counter.js`): the note that the zero was set or moved afterwards.

## The standings table

- `standingsFor` (`app/laps.js`): the places.
- `lapsBehind` (`lib/lap-counter.js`): the `−1 kier.` beside a lapped competitor's name.
- `exportText` (`app/laps.js`): the shared text, with every heat that has taps or marks.

Rule:

- **The rows sort by place and move only on a press**, as each row is a tap target for the mark
  sheet.

### Correcting the order the boxes were tapped in

Where two competitors were tapped in the wrong order, drag the place of the one tapped second above
the other, or focus the place and press an arrow key. The two swap their crossing times.

- `reorderSpans` (`lib/lap-counter.js`): the rows that have a handle, which are runs of rows on the
  same crossing count.
- `reorderCrossing` (`lib/lap-counter.js`): the crossing's times handed round as a set, or the drag
  refused whole.

## Where the look departs from the shared style

- `actionSheet` (`app/laps.js`): the dialog that a held tile, a tapped row or the held clock opens.

Rules:

- **A held tile or clock opens a dialog of action buttons.** `docs/style.md`, "A menu is not a
  dialog", keeps a dialog for a form or one question. Here nothing happens until a named button is
  tapped.
- **The clock correction's four nudges share one row**, where a dialog's buttons otherwise span the
  card.

## Storage

The stored records are a contract with the phones that hold them, and no test pins their shape. A
change to one needs a shim (`AGENTS.md`, "A breaking change keeps users working"), and the keys keep
their exact format (`docs/juoksut.md`, "What the counter requires of the rest").

- `renderLaps` (`app/laps.js`): the start's record, read on the way in and written on each change.
- `saveTrack` (`app/hurdles.js`): the meet's track.
- `refreshesSnapshot` (`lib/lap-counter.js`): whether a fetched roster replaces the stored one.
- `crossingsOf` (`lib/lap-counter.js`): the crossings of one log entry. Every reader of times goes
  through it, since a pack holds several.
- `pruneLapsStore` (`app/data.js`): the sweep of the `laps:`, `track:`, `venue:` and `flip:` entries
  a week after each one's last write, by its `t`.

`laps:<compId>:<groupKey>` is one start:

| field          | holds                                                           |
| -------------- | --------------------------------------------------------------- |
| `t`            | the time of the last write, in epoch ms                         |
| `title`        | the start's name                                                |
| `ts`           | the start's time, from which the season picks the track offline |
| `roster`       | the snapshot that lets the counter open offline                 |
| `activeHeat`   | the index of the heat on screen                                 |
| `hideFinished` | whether the finishers' tiles are hidden                         |
| `mine`         | per heat index, the ids this phone counts                       |
| `heats`        | per heat index, the heat's record                               |

`roster`:

| field              | holds                                      |
| ------------------ | ------------------------------------------ |
| `length`           | the race's distance in metres              |
| `relay`, `shuttle` | whether it is a relay, and a shuttle relay |
| `legs`             | the legs, 1 for an individual race         |
| `singleCat`        | whether the start has one class            |
| `heats`            | `[{ index, rows }]`, the drawn heats       |

A row of `roster.heats` is `{ id, lane, bib, name, label, org, sb, pb, sbMs, pbMs }`. `id` is the
allocation's id, `label` the class, `org` the club's short name, `sb` and `pb` the bests as
published, and `sbMs` and `pbMs` the same in ms, or null.

A heat's record:

| field      | holds                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| `startTs`  | the zero in epoch ms, or null before the clock starts                           |
| `startTs0` | the zero as first pressed, or null or missing where the clock was never pressed |
| `events`   | the append-only log, whose last entry undo pops                                 |
| `done`     | per competitor id, the mark `DNS`, `DNF` or `DQ`                                |

`Nollaa erä` replaces the heat's record, so it clears the marks with the taps and keeps the pick.
Each entry of `events` carries `t`, in epoch ms:

- a crossing: `{ id, t }`;
- a repaired crossing: `{ id, t, est: true }`, where `est` marks an estimated time;
- a pack: `{ pack: [{ id, t, est: true }, …], t }`, which one undo takes back whole;
- a reorder: `{ order, n, t }`, where `order` is the ids in the corrected order and `n` the crossing
  they swap, counted from 1.

`track:<compId>` is the meet's track, `{ track, t }`, with `track` the lap in metres.
