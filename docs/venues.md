# Kentät

A kenttä is a named track, with its length and the hurdle marks on its own board. The control is
labelled `Kenttä` and never `Rata`, because `Rata` means a lane in every start list.

In Juoksut mode, the schedule's select or the kenttä link (`docs/architecture.md`, "The route
table") picks the kenttä. The link lets one official's pick reach every lap counter at the meet.
`docs/juoksut.md` gives the storage keys.

## The files

`venues/index.json` is the only file the select reads. It has one row per kenttä, with `id`,
`locality`, `name` and `length`. `venues/<id>.json` is the kenttä's board, with its `checked` date
and its `marks`.

- **A kenttä whose board nobody has read has only its index row.** Without a board file, the
  federations' own marks apply. An empty `marks` would mean that the kenttä has no painted marks.
- **`length` is the lap length that the counter divides by** (`docs/lap-counter.md`, "Distance,
  crossings and the track"). It is 400, 200 or a hall's own length, and it need not be a whole
  number of metres.
- **`locality` and `name` are separate fields**, because the select groups the options by locality,
  and a native select is as wide as its widest option.
- **The `id` is the locality and the name, slugged** (`venueSlug`). `venueProblems` rejects any
  other id.

## A board

- **A kenttä's `marks` are its whole board, and they replace the sheet's marks.** Paint doesn't
  change when SUL next edits the sheet, so a kenttä must not show a mark that nobody painted. A
  setting that the board doesn't mark is unmarked on that kenttä, even where the sheet marks it.
- **A board's mark is keyed on its positions, and it has no class list.** A board's class names can
  be older than the sheet's.
- **`colour` and `symbol` are the app's words, not the board's**, as in `hurdles.json`. A board's
  "pallo" is a `ympyrä`. A board gives no sizes.
- **`checked` is the day the board was read, as an ISO date.**
- **A paint that the board lists once for two settings becomes two `marks`**, one per set of
  positions.
- **A mark whose positions are not measured is left out until they are.**

## Adding a kenttä

Add a kenttä as a row of `venues/index.json`, and add `venues/<id>.json` once its board is read.
Then run `make test-offline`, which proof-reads the row and the file.
