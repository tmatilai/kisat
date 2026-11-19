# Hurdle setups

A hurdle setup is what an official puts on the track before a hurdle start. It consists of the
number of hurdles (aitoja, `count`), their height (korkeus, `height`) and three distances from SUL's
tables:

- alkusileä (`toFirst`): from the start line to the first hurdle.
- väli (`interval`): between two hurdles.
- loppusileä (`toFinish`): from the last hurdle to the finish.

One combination of these values is a setting, and a start can need several settings. A painted mark
(merkintä) on the track can show where a setting's hurdles stand. `hurdles.json` holds the
federations' tables.

## The views

- **The box on a start**: `hurdleBox`, `shuttleBox` and `steepleBox` (`app/hurdles.js`).
- **The day's lines** go on the rows of `Ratalajit`.
- **The day sheet** is `/c/<id>/aidat/<YYYY-MM-DD>`. The tapes are laid from one side of the track
  (observed, 2026-09), so the direction the taping figures face is one choice per meet. `storedFlip`
  stores that choice, and the sheet and each start's figure share it.
- **The table page** is `/mitat#/aidat`. Its chips and kenttä select are kept in the URL fragment,
  and the page writes nothing to storage. The page also has the implement table
  (`docs/implements.md`).

## Aitaviesti

`relays` holds the whole relay sheet. The sekaviesti's two-line entry is two rows, one per sex, and
each row has its own `legs`.

- **The sekaviesti's rows carry `pairs`**, the lane pairs that the note under its entry assigns to a
  full heat. These are not the lane pairs 1 and 2, 3 and 4 that a drawn lane implies.
  `shuttleBandNames` reads `pairs` before the draw.
- **Each hurdle's feet stand on the side its runner comes from.** The tapes are laid from outside
  the track (observed, 2026-09), so the figure's measuring line runs along its bottom edge.
- **A shuttle relay starts and finishes on the individual race's finish line** (2026-09). So the
  taping figure names that end maali, and names the far end by its distance.

## The lookup's rules

The age bands are `categories` in `hurdles.json`. A class that has no setting in the file gets
`setup: null`, never the setting of a neighbouring class.

- **An age with no class of its own runs the setting of the next older class.** Meets set the
  16-year-olds' hurdles to the 17-year-olds' setting (observed, 2026-08). A SUL band in `categories`
  spans those ages and maps to the class of its top age.
- **WMA's women's long-race band 35–49 overlaps its short-race bands 35–39 and 40–49.** The file
  gives the long-race band as two rows with the same setting, since a class maps to exactly one row.

## What the meets do

- **Consecutive starts on one day can share a setting, or move every hurdle with 15 minutes between
  them** (2026-02). The day sheet merges consecutive starts that share a setting into one block.
- **One start can run several classes on different settings, either side by side, each in its own
  lanes, or in turn through one slot, with the hurdles reset between them.** Only the lanes show
  which (2026-08).
- **A meet can run a class's steeplechase at a distance other than the one SUL's sheet pairs it
  with** (2026-09). So `steepleSpec` looks up the barrier height by the class alone.

## The sources

`sources` in `hurdles.json` lists each source file's name and URL. `validFrom` is the date from
which every sheet except `Estejuoksut` is _voimassa_ (in force).

- `Aitajuoksut ulkoradoilla` and `Aitajuoksut sisäradoilla` (SUL): the SUL rows of `setups`. A row's
  `where` names the sheet the row comes from: `outdoor`, `indoor` or `both`.
- `Suomessa käytettävät WMA:n aita-, este- ja välinemitat` (SAUL, a PDF): the masters' settings by W
  or M and age band, for the indoor race, the short race and the long race, and the steeplechase
  barrier heights. They are the WMA rows of `setups`, `indoor` at 60 m and `outdoor` otherwise, and
  the masters' rows of `steeples.heights`.
- `Aitajuoksuviestit` (SUL): the relay rows, which are `relays`.
- `Juoksuratojen maalausohjeet` (SUL): the `Maalausohjeet` sheet gives each mark's colour, symbol,
  size and class list, and the steeplechase barrier's square. They are `marks` and `steeples.mark`.
  The sheet's relay block gives the marks of the hurdle relays, and a mark lists those relays in its
  `relays`.
- `Estejuoksut` (SUL): the barrier height per class group, which are the SUL rows of
  `steeples.heights`. The file leaves out the sheet's barrier counts.

The file relies on these readings of the sources:

- **SUL's indoor and outdoor sheets never give one class two settings at one distance** (2026-08).
  So `setups` has one row per class and distance, and a lookup doesn't need to know whether a meet
  is indoors (`docs/tuloslista-api.md`, "`Stadion` does not say indoor").
- **A mark's `rows` are the marking sheet's class list.** `hurdleMark` keys a mark on its positions,
  and only `hurdleTableProblems` reads `rows`, to check that each class stands at those positions.
- **Where the outdoor and indoor blocks mark the same set of positions, the file keeps one mark**,
  with the outdoor block's size (2026-08).
- **Every race on a track finishes on one line** (2026-09). So each hurdle is measured back from the
  finish line, and one race's paint can serve another distance.
- **Every track paints the international steeplechase square**, which is the same at every distance
  (2026-09). So `steeples.mark` is a single mark, and no kenttä's board is consulted.
- **The file writes the sheet's "viivat molempiin päihin" as `viiva`**, a line in from each side of
  the lane.
- **WMA gives heights in metres.** Its 0,840 m is SUL's 83,8 cm, one 33-inch hurdle height, and the
  file stores SUL's centimetres.
- **A setting's `height` is a list**, since a sheet can give a class a choice of two heights.

## Updating the file, once a year

Read each file that `sources` names, at its URL. Edit `hurdles.json` with one row per line, in the
order `sources`, `categories`, `setups`, `relays`, `steeples` and `marks`. Set `validFrom` to the
sheets' in-force date and `checked` to the day the sources were read. Then run `make test-offline`,
where `hurdleTableProblems` names each failing row. `test/hurdles.test.mjs` resolves (name,
`Gender`, `Age`) triples measured from real meets, so a class that the federations drop fails there
and not at a track.
