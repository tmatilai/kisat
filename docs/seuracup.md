# Seuracupin sarjat

The cup's clubs play in three series, A, B and C, by the size of their municipality. Nearly every
club keeps its series from year to year (2026-09).

The API says nothing about a club's series, so `seuracup.json` holds the three lists as the series'
own site publishes them. The cup's season page shows a club's series in its `Sarja` column.

## The file

- **`source` is where the lists were read, and `checked` is the day.**
- **`series` is `{A, B, C}`, a sorted list of club names each.** A name is the club's
  `Organization.Name` as Tuloslista spells it, even where the site spells it another way.
  `cupSeries` (`lib/cup.js`) compares names by `clubNameKey` (`docs/districts.md`).
- **The lists are the union of every year's.** A club in two series is listed under its later one,
  and every year's page reads the one file.
- **A club in no list is named on the season page's `Ei sarjatietoa` line.**

`test/medals.test.mjs` proof-reads the file in the offline suite.

## Updating the file

The file is refreshed once a year, when the new year's lists appear. The clubs new to them are added
to their series, a club whose series changed moves to its new one, and `source` and `checked` are
updated. A club that `districts.json` lacks is added to a piiri's `names` there too. Then run
`make test-offline`.
