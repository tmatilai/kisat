# Kentät

A kenttä is a named track, with its length and the hurdle marks on its own board. The control says
`Kenttä` and never `Rata`, since `Rata` is a lane in every start list.

In Juoksut mode the schedule's select picks the kenttä, and so does the kenttä link
`/c/<id>/k/<venueId, 400 or 200>` (`docs/architecture.md`, "The route table"). The schedule's title
menu hands out that link as `Jaa kenttälinkki`, so one official's pick reaches every lap counter at
the meet. A pick writes `venue:<compId>`, and it writes the kenttä's length through to
`track:<compId>` (`docs/juoksut.md`). The lap counter reads the length. The hurdle box, the day's
lines and the day sheet read the marks (`docs/hurdles.md`, "The views").

## The files

`venues/index.json` is all the select reads. It has a row per kenttä, with `id`, `locality`, `name`
and `length`. `venues/<id>.json` is the kenttä's board, with its `checked` date and its `marks`.
`test/venues.test.mjs` checks that every board file has an index row.

- **A kenttä whose board nobody has read is its index row alone.** With no file, the federations'
  own marks stand (`venueTable`, `lib/venues.js`). An empty `marks` would say that the board paints
  none.
- **`length` is the lap the counter divides by** (`docs/lap-counter.md`, "Distance, crossings and
  the track"). It is 400, 200 or a hall's own length, and it need not be whole metres.
  `isTrackLength` (`lib/lap-counter.js`) bounds it, and the stored choice too.
- **The locality heads an option group, and the name is the option under it** (`venueGroups`). A
  native select is as wide as its widest option, and `dev/probe-mode.js` checks that the picker
  stays on the toggle's row.
- **The `id` is the locality and the name, slugged** (`venueSlug`). `venueProblems` rejects any
  other id.

## A board

- **A kenttä's `marks` are its whole board, and they replace the sheet's.** Paint does not follow
  SUL's next edit of the sheet, so a kenttä must not show a mark that nobody painted. A setting the
  board does not mark is unmarked on that kenttä, even where the sheet marks it.
- **A board's mark is keyed on its positions, and it carries no class list.** A board's class names
  can be older than the sheet's.
- **`colour` and `symbol` are the app's words, not the board's**, as in `hurdles.json`. A board's
  "pallo" is a `ympyrä`. A board gives no sizes.
- **`checked` is the day the board was read, an ISO date**, like every date these files carry.
- **One paint that the board lists once for two settings is two `marks`**, one per set of positions.
- **A mark whose positions are not measured is left out until they are.**

## Adding a kenttä

A kenttä is added as a row of `venues/index.json`, and it gains `venues/<id>.json` once its board is
read. Then run `make test-offline`, where `venueProblems` (`lib/venues.js`) proof-reads the row and
the file, and each problem names its kenttä.
