# Seuracupin sarjat

The cup's clubs compete in three series, A, B and C, by the size of their municipality. Nearly every
club stays in the same series from year to year (2026-09). The API has no data about a club's
series, so `seuracup.json` holds the three lists as the series' own site publishes them.

## The file

- **`source` is the address the lists were read from, and `checked` is the date they were read.**
- **`series` is `{A, B, C}`, where each value is a sorted list of club names.** A name is the club's
  `Organization.Name` as Tuloslista spells it, even where the site spells it differently. Names
  match by `clubNameKey`.
- **The lists combine the lists of every year.** A club that has played in two series is listed only
  under the later one, and the season page of every year reads this one file.
- **The season page's `Ei sarjatietoa` line names each club that is in no list.**

## Updating the file

Update the file once a year, when the new year's lists are published:

1. Add each club that is new to the lists to its series.
2. Move each club whose series changed to its new series.
3. Update `source` and `checked`.
4. Add each club that `districts.json` lacks to a piiri's `names` in `districts.json`.
5. Run `make test-offline`.
