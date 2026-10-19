# Heittovälineet

`/mitat#/valineet[/<ages>]` is the federations' table of throwing implements, without a meet. It is
the `Heittovälineet` tab of the `Aita- ja välinemitat` page, and it shares the hurdle tab's
fragment, class chips and tab switch. The links into the page open the hurdle tab. Both hosts serve
it (`docs/juoksut.md`, "What each mode has").

- `renderImplementTable` (`app/tables.js`): the tab.
- `implementWeightRows` (`lib/tables.js`): the weights alone, which the tab shows by default.
- `implementTableSections` (`lib/tables.js`): every dimension, a table per implement, behind the
  `Kaikki mitat` chip.
- `test/implements.test.mjs`, "implementTableSections": both layouts and the file's proof-reading.
- `dev/probe-valineet.js`: the tab in both modes.

## The file

`implements.json` holds the tables. `sources` gives each source's name and URL, `validFrom` is WMA's
in-force date, the later of the two, and `checked` is the day they were read. `categories` has
`hurdles.json`'s shape. `weights` is a row per category, with each implement's weight in grams.
`specs` holds the dimensions of one implement at one weight from one source, in the columns that
`implements` declares, each with its `unit`. A dimension is a range `[min, max]`, a maximum alone
`[null, max]`, one number, or the sheet's own words. A row takes its own source's dimensions, and
else another source's at the same weight (`implementSpec`). Where WMA gives no dimensions, it refers
to WA's rules, and SUL's figures are WA's. `implementTableProblems` (`lib/tables.js`) proof-reads
the file in the offline suite.

- `Heittovälineiden perusmitat` (SUL, an `.xlsx`): the weight and dimensions of the kuula (shot),
  kiekko (discus), moukari (hammer) and keihäs (javelin) per class. It gives the SUL rows, and it is
  _voimassa_ (in force) from 2025-04.
- `Suomessa käytettävät WMA:n aita-, este- ja välinemitat` (SAUL, the PDF that `hurdles.json` also
  reads): the weights of the hammer, shot, discus, javelin and weight throw per masters band, and
  some of their dimensions. It gives the WMA rows, and it is in force from 2026-01.

The `.xlsx` is plain XML, and the PDF reads as `docs/hurdles.md`, "The sources", says.

- **The 14- and 15-year-olds are N and M on the page.** The sheet names them T and P. The hurdle
  sheet names them N and M, and the page follows it. A row's name in the file is a key and nothing
  more.
- **The 8-year-olds throw the 9-year-olds' weights.** The sheet starts at 9, so the file's rows for
  8-year-olds carry the 9-year-olds' weights. A meet seen in 2026-09 threw its 8- and 9-year-olds in
  one start for every implement.

## Updating the file

A changed weight is a `weights` cell, and a new weight also needs a `specs` entry. Set `validFrom`
and `checked`, then run `make test-offline`, where `implementTableProblems` names each failing row.
