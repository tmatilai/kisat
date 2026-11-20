# Juoksut mode

Juoksut mode is the app for the official at the finish line, with the lap counter
(`docs/lap-counter.md`). `docs/architecture.md`, "The two modes", describes how the host selects the
mode.

## What each mode has

Anything that tells the official what to set up on the track belongs to Juoksut mode alone, such as
the lap counter, the meet's track, the hurdle setups and the `Ratalajit / Kaikki` toggle on the
schedule. Anything that shows the race the audience watched is in both modes. Follow-lists exist
only in Kisat mode. Both modes have the hurdle and implement tables (`/mitat`), and the
championships sheet with a final's `Mitalit`, because an official hands out the medals from a
start's page.

**A mode changes framing and reach, never logic.** Everything below the view layer has one
implementation for both modes.

## What the counter requires of the rest

- **`scheduleRefresh` arms no timer on the `laps` route, and the `visibilitychange` handler
  re-renders every view except the counter.** A refresh would rebuild the tiles under the official's
  finger.
- **The counter uses neither `main.list` nor `main.wide`.** Its density depends on the size of the
  field (`docs/lap-counter.md`, "Reading the screen").
- **Nothing on the way to the counter needs `/api`.** The counter fetches from Tuloslista directly
  and runs from its stored snapshot, so a rate limit cannot lock an official out during a meet. A
  start's page renders when its `/api` requests fail, and the Juoksut host serves only
  `GET /api/medals/:compId` (`docs/backend.md`, "Abuse protection"). For the same reason, Juoksut
  mode has no follow-lists and fetches no meet body.
- **The counter lives on the Juoksut origin only.** `localStorage` is per origin, so a race counted
  on one host is not stored on the other. Kisat mode has no link to the counter. In Juoksut mode,
  the start's button is the only way into the counter other than its URL.
- **`laps:<compId>:<groupKey>` and `track:<compId>` keep their exact format.** A count in progress
  is stored under these keys, and renaming a key orphans the count. So a chosen kenttä has its own
  key, `venue:<compId>` (`docs/venues.md`).
