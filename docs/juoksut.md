# Juoksut mode

Juoksut mode is the app for the official at the finish line. It puts track and relay first, and it
has the lap counter (`docs/lap-counter.md`). `docs/architecture.md`, "The two modes", says how the
host picks the mode and which routes each mode owns.

## What each mode has

Kisat mode is the audience's. Juoksut mode is for the official who holds the phone at the line, so
whatever says what to put on the track is Juoksut's alone. Whatever shows the race the audience
watched is in both, such as the combined heat view and the combined result (`docs/views.md`).

- **Kisat alone:** follow-lists and the picker's search, and a home listing annotated by the active
  follow-list. Juoksut's home is a plain listing.
- **Juoksut alone:** the lap counter, the meet's track, the hurdle setups (on a start, on
  `Ratalajit`'s rows and in the day sheet), and the schedule's `Ratalajit / Kaikki` toggle
  (`docs/architecture.md`, "The two modes"). Kisat's schedule shows every category, with no category
  toggle.
- **Both:** the hurdle and implement tables (`/mitat`), and the championships sheet with a final's
  `Mitalit`, since an official hands the medals out from a start's page.

**A mode changes framing and reach, never logic.** Everything below the view layer is one
implementation. A difference in the data goes in `public/lib/` for both modes.

## What the counter requires of the rest

The counter's own rules are in `docs/lap-counter.md`. These hold for the code around it.

- **`scheduleRefresh` arms no timer on the `laps` route, and the `visibilitychange` handler
  re-renders every view but the counter.** A refresh would rebuild the tiles under the official's
  finger. `dev/probe-laps.js` checks that no refresh timer is armed and that no tile is rebuilt in
  30 s.
- **The counter takes neither `main.list` nor `main.wide`.** Its density follows the size of the
  field (`docs/lap-counter.md`, "Reading the screen").
- **Nothing on the way to the counter needs `/api`.** The counter reads Tuloslista directly and runs
  from its stored snapshot, so a rate limit cannot lock an official out mid-meet. A start's page
  renders when its `/api` reads fail, and the Juoksut host answers only `GET /api/medals/:compId`
  (`docs/backend.md`, "Abuse protection, layered"). For the same reason the mode has no
  follow-lists, as `viewStateFor` returns no Watch in Juoksut mode (`docs/architecture.md`, "The two
  modes"), and `fetchMeetBody` asks for no meet body (`dev/probe-hurdles.js`).
- **The counter lives on the Juoksut origin alone.** `localStorage` is per origin, so a race counted
  on one host is not on the other. Kisat mode links to the counter nowhere. In Juoksut mode the
  button on a start, `Kierroslaskuri` or `Maaliintulot`, is the only way in besides the URL.
- **`laps:<compId>:<groupKey>` and `track:<compId>` keep their exact format.** A count in progress
  is stored under them, and a renamed key orphans it. A chosen kenttä is `venue:<compId>`, a key of
  its own, and it writes its length through to `track:` (`docs/venues.md`). `docs/lap-counter.md`
  ("Storage") has how long they are kept.
