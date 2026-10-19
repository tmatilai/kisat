# Piirit

A piirinmestaruus meet gives its medals among the piiri's own clubs, and a meet that two piiris run
together gives two sets. The API says nothing about piiris (`docs/tuloslista-api.md`, "Categories,
names and identity"), so `districts.json` holds the federation's piiris and their member clubs.
`docs/views.md`, "Medals", has the rule and the control, and `docs/backend.md`, "The medal table",
has the tables.

## The file

- **`alueet` is the alueet (regions)**, each `{id, name}` with the name in the nominative, such as
  the demo's "Demolainen". Their piiris are as the alue championships' own pages list them
  (2026-09).
- **`piirit` is a list of `{id, name, short, alue, clubs, names}`.** `id` is what the view state
  stores, and `alue` is the id of one of `alueet`.
- **`short` is the name a piiri's own meets carry**, such as `DemY:n hallikisat`. `defaultScopes`
  (`lib/districts.js`) looks for it in a meet's name, and for the first word of `name`, which is the
  region's genitive.
- **`clubs` are the federation abbreviations** that Tuloslista carries as `NameShort` on every row.
  They match exactly, case included.
- **`names` are the same clubs' `Name`s, where known.** They match by `clubNameKey`. A club entered
  by hand is a second record (`docs/tuloslista-api.md`, "Categories, names and identity"), and a
  meet index row names its organiser by name alone (`docs/backend.md`, "A scope's year").
- **`outside` lists the clubs checked and found to be no federation member**, by `clubs` and by
  `names`. Any other club that no piiri lists is named on the medal table's `Ei piiritietoa` line.

`make test-offline` proof-reads the file with `districtProblems` (`lib/districts.js`).

`DEMO_DISTRICTS` in `demo.js` is the fixture. Some demo clubs are in no piiri, so the
`Ei piiritietoa` line has something to show.
