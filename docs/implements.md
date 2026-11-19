# Heittovälineet

`/mitat#/valineet[/<ages>]` shows the federations' table of throwing implements, independent of any
meet. It is the `Heittovälineet` tab of the `Aita- ja välinemitat` page.

## The file

`implements.json` holds the tables:

- `sources` lists each source's name and URL.
- `validFrom` is WMA's in-force date, which is the later of the two.
- `checked` is the day the sources were read.
- `categories` has the same shape as in `hurdles.json`.
- `weights` has one row per category, with each implement's weight in grams.
- `specs` holds the dimensions of one implement at one weight from one source, in the columns that
  `implements` declares, each with its `unit`. A dimension is a range `[min, max]`, a maximum alone
  `[null, max]`, one number, or the sheet's own words.

A row takes the dimensions from its own source, or else from another source at the same weight.
Where WMA gives no dimensions, it refers to WA's rules, and SUL's figures are WA's.

- `Heittovälineiden perusmitat` (SUL, an `.xlsx` file): the weight and dimensions of the kuula
  (shot), kiekko (discus), moukari (hammer) and keihäs (javelin) per class. It gives the SUL rows,
  and it is _voimassa_ (in force) from 2025-04.
- `Suomessa käytettävät WMA:n aita-, este- ja välinemitat` (SAUL, the PDF that `hurdles.json` also
  uses): the weights of the hammer, shot, discus, javelin and weight throw per masters band, and
  some of their dimensions. It gives the WMA rows, and it is in force from 2026-01.

- **The 14- and 15-year-olds are N and M on the page.** The sheet names them T and P, but the hurdle
  sheet names them N and M, and the page follows the hurdle sheet. A row's name in the file is only
  a key.
- **The 8-year-olds throw the 9-year-olds' weights.** The sheet starts at 9, so the file's rows for
  8-year-olds carry the 9-year-olds' weights. A meet in 2026-09 threw its 8- and 9-year-olds in one
  start for every implement.

## Updating the file

A changed weight is a change to a `weights` cell, and a new weight also needs a `specs` entry. Set
`validFrom` and `checked`, then run `make test-offline`, which names each failing row.
