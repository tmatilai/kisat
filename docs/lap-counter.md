# The lap counter

The lap counter exists only in Juoksut mode (`docs/juoksut.md`). An official at the finish line taps
a competitor's tile each time the competitor crosses the line. Each tile shows the call for the
competitor's next crossing: the number of laps left after it, 🔔 when one lap is left, and 🏁 when
none is left.

Rules:

- **The counter is early.** It shows what to do about a runner while the runner is still 30 to 40 m
  from the line, because an official cannot act on a runner who is already level with them
  (2026-08). The official reads it at a glance, with one thumb, in the sun.
- **Nothing moves under the official's finger.** A tile leaves the grid, and the grid reflows, only
  when the official presses or toggles something. The one exception is a standings row being
  dragged. `docs/juoksut.md`, "What the counter requires of the rest", keeps the page's refreshes
  off the counter.

## Being ready 30–40 m out

The clock is optional. Without it, the counter still counts and estimates the pace from the taps.

- **A tile goes due when the competitor is 50 m out at their own pace, and nothing is set per race
  or per class.** The distance is more than the 30 to 40 m above, because the extra metres give the
  official time to tell the crew (2026-08). A tile goes overdue at the same distance past the
  expected crossing, which suggests a missed press.
- **The lap window never crosses a handover.** When a relay's legs are whole laps, only the laps of
  the runner on the track set the pace. Runners of the same age differ widely: in a youth 3x600 m
  indoors, the fastest and the slowest team ran the same 1800 m in 5:46 and 7:13 (2026-02).

## The lap board

On a race with laps, a strip in the clock's row mirrors the lap board at the track. It counts the
crossings the leader has left, and reaches 0 when the leader finishes.

- **Nothing else on the counter shows the distance or the lap count.** The title shows the distance,
  and the board starts at the number of crossings.

## Not losing a press

- **A refused press records nothing.** A press too soon after a crossing is refused as a double
  press. If the press really was a lap, the tile goes overdue, and a repair adds the crossing.
- **A missed crossing is repaired, not tapped.** A repair records one crossing at the time the
  competitor's pace predicts. A tap at the moment the official notices would record one long lap and
  one short one.

### Recording a pack

In a distance race with a big field, the field passes the line as a stream, and the official taps
only the leader and the tail of the pack (2026-08). The pack chip records the overdue rest in one
press, in the gap after the pack.

- **A pack never records a finish, but a single repair may.**

## Saying it without a sound

Nothing beeps. Every cue is a colour, a movement or a vibration. Android vibrates on
`navigator.vibrate`, but iOS Safari ignores it, so on an iPhone only the flash confirms a press
(2026-08).

## Who still needs an action

- **Finishers never leave the grid on their own.** A toggle hides and shows their tiles, and their
  rows stay in the list.

## Distance, crossings and the track

A race's number of crossings is its distance divided by the meet's lap, rounded up. A shuttle relay
has one crossing. Without a stored lap, the counter uses the season's default (`docs/venues.md`).

- **The counter reads the meet's track and never offers it.** A wrong lap count is fixed on the
  competition's page, which needs the network.
- **A race settled on one crossing records only the finish order and the hand times.** A sprint and
  a shuttle relay are such races. They have no call, no lap board, no band, no pack chip and no
  repair.

## The changeover

In a youth 3x600 m indoors, eleven teams ran in one heat, and every changeover happened at the
finish line within about six minutes (2026-02).

- **A handover outranks the number.** 🤝 with a leg number means that the leg's runner goes to the
  exchange zone now. It shows from the team's last lap of a leg, which took about 40 s for young
  runners (2026-02). The bell outranks a handover. A leg that is not a whole number of laps gets no
  handover prompts.
- **The 🤝 is also a check.** A team that hands over while its tile shows a number has run a leg
  short.

## Splitting the field

One official can count and call for four or five competitors (2026-08), so a heat with laps and six
or more competitors can be split between officials. Each phone then shows only its own competitors,
in the tiles, the standings and the shared text.

- **Each phone picks for itself.** Nothing checks that the helpers' picks cover each competitor
  exactly once.

## The next-up band

The grid never reorders, so a band above it shows the order of arrival. A slot of the band never
sorts. It holds its competitor until their crossing is recorded.

## Reading the screen

The whole heat fits on one screen, because there is no time to scroll.

- **The grid's density follows the number of tiles.** A wider screen may add columns, but nothing
  depends on the viewport's height. iOS Safari changes the viewport's height as its URL bar
  collapses, and a relayout during a tap causes a mis-tap (2026-08).
- **A field of 20 fits one phone screen with the band**, with Safari's URL bar showing.

## The screen explains nothing

No line on the counter explains the presses or the symbols. The header's `?` does, and it explains
only what the current screen draws.

## Clock, keys and the screen staying on

Measured on a Tab Active3 tablet (2026-08):

- The programmable side key arrives as a keydown with the `key` `Unidentified`, no `code` and
  `keyCode` 0.
- The pen's button reaches the page only as a `contextmenu` event while the pen's tip touches the
  screen.
- Android swallows the volume-up key of a Bluetooth remote, so a remote must be set to send enter.

### Correcting a clock started late, early, or not at all

Moving the zero shifts every time in the heat by the same amount and changes no order, place or gap,
so the correction is safe during a race. The nudges are whole seconds, because lateness judged
against a clock across the field is accurate to a second at best. Typing a competitor's latest
crossing time, from the stadium clock or the announcer, also rescues a heat whose clock never
started. The new zero is never after a logged crossing and never in the future.

## The standings table

- **The rows sort by place and move only on a press**, because each row is a tap target for the mark
  sheet.

### Correcting the order the boxes were tapped in

When two competitors were tapped in the wrong order, dragging the place of one above the other swaps
their crossing times. Only rows with the same crossing count can be reordered.

## Where the look departs from the shared style

- **A held tile or clock opens a dialog of action buttons.** `docs/style.md`, "A menu is not a
  dialog", reserves a dialog for a form or a single question. In the counter's dialog, nothing
  happens until the official taps a named button.
- **The clock correction's four nudges share one row.** Elsewhere, a dialog's buttons span the card.

## Storage

The stored records are a contract with the phones that hold them, and no test pins their shape. A
change to a record needs a shim (`AGENTS.md`, "A breaking change keeps users working"). The keys
keep their exact format (`docs/juoksut.md`, "What the counter requires of the rest"). Each `laps:`,
`track:`, `venue:` and `flip:` entry is deleted a week after its last write, by its `t`.

`laps:<compId>:<groupKey>` stores one start:

| field          | holds                                                           |
| -------------- | --------------------------------------------------------------- |
| `t`            | the time of the last write, in epoch ms                         |
| `title`        | the start's name                                                |
| `ts`           | the start's time, which selects the season's track when offline |
| `roster`       | the snapshot that lets the counter open offline                 |
| `activeHeat`   | the index of the heat on screen                                 |
| `hideFinished` | whether the finishers' tiles are hidden                         |
| `mine`         | per heat index, the ids this phone counts                       |
| `heats`        | per heat index, the heat's record                               |

`roster`:

| field              | holds                                        |
| ------------------ | -------------------------------------------- |
| `length`           | the race's distance in metres                |
| `relay`, `shuttle` | whether it is a relay, and a shuttle relay   |
| `legs`             | the number of legs, 1 for an individual race |
| `singleCat`        | whether the start has one class              |
| `heats`            | `[{ index, rows }]`, the drawn heats         |

A row of `roster.heats` is `{ id, lane, bib, name, label, org, sb, pb, sbMs, pbMs }`. `id` is the
allocation's id, `label` is the class, and `org` is the club's short name. `sb` and `pb` are the
season's and personal bests as published, and `sbMs` and `pbMs` are the same bests in ms, or null.

A heat's record:

| field      | holds                                                                          |
| ---------- | ------------------------------------------------------------------------------ |
| `startTs`  | the zero in epoch ms, or null before the clock starts                          |
| `startTs0` | the zero as first pressed, or null or missing when the clock was never pressed |
| `events`   | the append-only log. Undo removes its last entry                               |
| `done`     | per competitor id, the mark `DNS`, `DNF` or `DQ`                               |

Each entry of `events` has a `t`, in epoch ms:

- a crossing: `{ id, t }`;
- a repaired crossing: `{ id, t, est: true }`, where `est` marks an estimated time;
- a pack: `{ pack: [{ id, t, est: true }, …], t }`, which one undo removes as a whole;
- a reorder: `{ order, n, t }`, where `order` lists the ids in the corrected order and `n` is the
  crossing they swap, counted from 1.

**Every reader of times goes through `crossingsOf`**, because a pack entry holds several crossings.

`track:<compId>` stores the meet's track as `{ track, t }`, where `track` is the lap in metres.
