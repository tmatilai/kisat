# Hurdle setups

A hurdle setup is what an official puts on the track before a hurdle start: the number of hurdles
(aitoja, `count`), their height (korkeus, `height`) and three distances from SUL's tables. These are
alkusileä, the start line to the first hurdle (`toFirst`), väli, between two hurdles (`interval`),
and loppusileä, the last hurdle to the finish (`toFinish`). One combination is a setting, and a
start can need several. A painted mark (merkintä) on the track can show where a setting's hurdles
stand.

`hurdles.json` holds the federations' tables, and `lib/hurdles.js` is the lookup over them.

- `hurdleSpec`, `hurdleRelaySpec`, `steepleSpec` (`lib/hurdles.js`): the setting of a start's class
  in a hurdle race, an aitaviesti and a steeple. Tested in `test/hurdles.test.mjs`.
- `hurdleMark` (`lib/hurdles.js`): the painted mark a setting stands on, off the chosen kenttä's
  board where it has one (`docs/venues.md`, "A board").
- `hurdleTableProblems` (`lib/tables.js`): the proof-reading of `hurdles.json`.

## The views

- **The box on a start**: `hurdleBox`, `shuttleBox` and `steepleBox` (`app/hurdles.js`), checked by
  `dev/probe-hurdles.js`.
- **The day's lines**: `hurdleDayLines` (`app/hurdles.js`) on the rows of `Ratalajit`, checked by
  `dev/probe-aidat.js`.
- **The day sheet**: `/c/<id>/aidat/<YYYY-MM-DD>`, drawn by `renderHurdleSheet` (`app/hurdles.js`)
  over `hurdleSheetBlocks` (`lib/hurdles.js`), checked by `dev/probe-aidat.js`. The tapes are laid
  from one side of the track (observed, 2026-09), so which way the taping figures face is one choice
  per meet. `storedFlip` keeps it, and the sheet shares it with each start's figure.
- **The table page**: `/mitat#/aidat`, drawn by `renderHurdleTable` (`app/tables.js`) over
  `hurdleTableSections` (`lib/tables.js`), checked by `dev/probe-aitataulukko.js`. Its chips and
  kenttä select live in the fragment, and the page stores nothing. `docs/implements.md` has the page
  it shares with the implement table.

## Aitaviesti

`relays` is the relay sheet whole. The sekaviesti's two-line entry is two rows, one per sex, each
with its own `legs`.

- `relayTableRow` (`lib/hurdles.js`): a relay row and the mark of each direction. Tested in
  `test/hurdles.test.mjs`, "Aitaviesti: the relay table and the shuttle's tapes".
- `shuttleStartRows`, `shuttleBandNames` (`lib/hurdles.js`): the box's rows and the figure's band
  names.
- `shuttleTapeFigure` (`app/hurdles.js`): the taping figure, a lane per direction.

Rules:

- **The sekaviesti's rows carry `pairs`**, the lane pairs that the note under its entry puts a full
  heat in. They are not the pairs of lanes 1 and 2, 3 and 4 that a drawn lane gives.
  `shuttleBandNames` reads them before the draw.
- **Each hurdle's feet stand on the side its runner comes from.** The tapes are laid from outside
  the track (observed, 2026-09), so the figure's measure line runs along its bottom edge.
- **A shuttle relay starts and finishes on the individual race's finish line** (2026-09). So the
  taping figure names that end maali, and the far end by its distance.

## The lookup's rules

The bands are `categories` in `hurdles.json`. A class the file has no setting for gets
`setup: null`, never a neighbour's.

- **An age with no class of its own runs the next older class's setting.** 16 runs on the
  17-year-olds', 18 on the 19-year-olds', and 20 and 21 on the 22-year-olds'. Meets set the
  16-year-olds' hurdles to the 17-year-olds' (observed, 2026-08). A SUL band in `categories` spans
  those ages and stands for its top age's class.
- **WMA's women's long-race band 35–49 straddles its short-race bands 35–39 and 40–49.** The file
  gives it as two rows with one setting, since a class maps to exactly one row.

## What the meets do

- **Consecutive starts of one day can share a setting, or move every hurdle with 15 minutes between
  them** (2026-02). `hurdleSheetBlocks` folds the first case into one block of the day sheet.
- **One start can run several classes on different settings side by side, each in its own lanes, or
  in turn through one slot with the hurdles reset between them.** Only the lanes tell which
  (2026-08), and `hurdleStartSetups` reads them.
- **A meet can run a class's steeple at a distance other than the one SUL's sheet pairs it with**
  (2026-09). So `steepleSpec` keys the bar on the class alone.

## The sources

`sources` in `hurdles.json` gives each file's name and URL. `validFrom` is the date every sheet but
`Estejuoksut` is _voimassa_ (in force) from, and `Estejuoksut` has been in force since 2020.

- `Aitajuoksut ulkoradoilla` and `Aitajuoksut sisäradoilla` (SUL): a row per sarja (class) and matka
  (distance), with aitoja, alkusileä, väli, loppusileä and korkeus. They are the SUL rows of
  `setups`. A row's `where` names the sheet it is on: `outdoor`, `indoor` or `both`.
- `Suomessa käytettävät WMA:n aita-, este- ja välinemitat` (SAUL, a PDF): the masters by W or M and
  age band, for the indoor race, the short race and the long race, and the steeple bars. They are
  the WMA rows of `setups`, `indoor` at 60 m and `outdoor` otherwise, and the masters' rows of
  `steeples.heights`.
- `Aitajuoksuviestit` (SUL): the relay rows, which are `relays`.
- `Juoksuratojen maalausohjeet` (SUL): each mark's colour, symbol, size and class list, and the
  steeple barrier's square. They are `marks` and `steeples.mark`.
- `Estejuoksut` (SUL): the steeple bar per class group, which gives the SUL rows of
  `steeples.heights`. Its barrier counts are not carried.

The `.xls` files are BIFF and parse with `xlrd`. The PDF's columns interleave in plain reading
order, so it needs an extraction that keeps positions. The marking workbook's other three sheets
copy the first three tables. Its `Maalausohjeet` sheet holds the marks in four blocks:
international, national outdoor, `Sisähalli`, and a relay block whose name reads
`Aikajuoksuviestit`. The first three give the individual races' marks. The relay block gives the
hurdle relays' marks, which a mark lists as its `relays`.

The file rests on these readings:

- **SUL's indoor and outdoor sheets never give one class two settings at one distance** (2026-08).
  So `setups` has one row per class and distance, and a lookup need not know whether a meet is in a
  hall (`docs/tuloslista-api.md`, "`Stadion` does not say indoor").
- **Each row of the marking sheet lists exactly the classes on one set of positions** (2026-08). So
  `hurdleMark` keys a mark on its positions. A mark's `rows` are the sheet's class list, and only
  `hurdleTableProblems` reads them.
- **Where the outdoor and indoor blocks mark one set of positions, the file keeps one mark**, with
  the outdoor block's size (2026-08).
- **Every race on a track finishes on one line** (2026-09). So `hurdlePositions` measures each
  hurdle back from it, and one race's paint can serve another distance.
- **Every track paints the international steeple square**, the same at every distance (2026-09). So
  `steeples.mark` is one mark, and no kenttä's board is asked.
- **The file writes the sheet's "viivat molempiin päihin" as `viiva`**, a line in from each side of
  the lane.
- **WMA writes heights in metres.** Its 0,840 m is SUL's 83,8 cm, one 33-inch bar, and the file
  carries SUL's centimetres.
- **A setting's `height` is a list**, since a sheet can give a class a choice of two bars.

## Updating the file, once a year

Edit `hurdles.json`, one row per line, in the order `sources`, `categories`, `setups`, `relays`,
`steeples` and `marks`. Set `validFrom` to the sheets' in-force date and `checked` to the day the
sources were read, then run `make test-offline`. There `hurdleTableProblems` proof-reads the file
and names each failing row. `test/hurdles.test.mjs` resolves the (name, `Gender`, `Age`) triples
measured off real meets, so a class the federations drop fails there and not at a track.
