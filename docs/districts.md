# Piirit

The API has no data about piiris (`docs/tuloslista-api.md`, "Categories, names and identity"), so
`districts.json` lists the federation's piiris and their member clubs. The medal rule is in
`docs/views.md`, "Medals".

## The file

- **`alueet` lists the alueet (regions)**, each as `{id, name}`. The name is in the nominative, such
  as the demo's "Demolainen". Each piiri belongs to the alue that the alue championships' own pages
  list it under (2026-09).
- **`piirit` is a list of `{id, name, short, alue, clubs, names}`.** The view state stores `id`, and
  `alue` is the id of an entry in `alueet`.
- **`short` is the name that a piiri's own meets use**, such as `DemY:n hallikisat`. `defaultScopes`
  looks for `short` in a meet's name, and also for the first word of `name`, which is the region's
  name in the genitive.
- **`clubs` lists the federation abbreviations** that Tuloslista returns as `NameShort` on every
  row. An abbreviation matches only exactly, case included.
- **`names` lists the same clubs' `Name` values, where they are known.** A name matches by
  `clubNameKey`. A club entered by hand is a second record of the club, and a row of the meet index
  has only the organiser's name (`docs/backend.md`, "A scope's year").
- **`outside` lists the clubs that were checked and are not federation members**, in its own `clubs`
  and `names` lists. The medal table's `Ei piiritietoa` line names every other club that no piiri
  lists.

`make test-offline` proof-reads the file.
