# Style

One stylesheet in `index.html` draws both modes. A mode changes what is on the page, never how a
shared thing looks. The lap counter departs from this doc where `docs/lap-counter.md`, "Where the
look departs from the shared style", says. A rule that a probe checks names the probe, and the rest
hold by review.

## Components

- **`.row` is the unit a list is built of.** `.row-main` holds `.row-title` over `.row-sub`.
  Anything trailing, such as a chip, is a sibling of `.row-main`.
- **`.row-sub` joins its parts with `·`, and a missing part drops out with its separator.**
- **Each round status has a chip of its own hue, and a heat's heading chips both of its states**, so
  the reader never has to work out what a missing chip means.
- **Everything in the name cell but the name and its badges is muted.** The one other exception is a
  best the row's result passed (`.name-aside-beaten`).
- **A tick in a column of its own marks the rows a thing applies to.** The column is on every row,
  so the ticks line up. The reader scans the column, so a word on each row cannot replace it.
  Outside a menu it is a table column.
- **An empty cell of a results table stays empty, since a dash reads as content.** An attempt grid
  marks its own cells, and a `Sija` with no place to give takes a dash.
- **A task folds into a `<details>` with a muted summary line.** It is for something done once,
  never for something watched.
- **A plain `.notice` is an answer, and `.notice.error` is a failure to get one.** An empty state
  never takes the error variant.
- **`.search` is 16 px and never smaller.** iOS zooms the page when a smaller field takes focus.

## A menu is not a dialog

Both are layers (`docs/architecture.md`, "Layers"). `dev/probe.js` checks the Watch chip's menu, the
athlete sheet's `▾` and one question. Its check "the page under an anchored menu does scroll" pins
that a menu never locks the page.

- **A menu is a list of choices.** Its items are `.row`s with the tick column, and it holds no
  `.btn`. The `▾` marks a button that opens a menu, and nothing else.
- **A dialog is a form, or the one question an action asks before it does what cannot be undone.**
  The question has a named way out beside the ×.
- **Only a dialog carries prose.** A menu tells two items apart by their names. What no label can
  say goes in the help sheet behind the header's `?`.
- **An action goes under the row it acts on**, not as a button under the list, so one subject stays
  in one menu.

## Headings

- **`h2` labels a region of the page, and `h3` names a thing.**
- **A heading's style never changes with the state of its content.** A heading says a difference in
  words, or in a chip beside it.
- **`.wind` and `.round-name` qualify a heading inline.** Their `text-transform: none` keeps their
  case inside an `h2`.

## Emphasis

The row a reader looks for, such as a followed row or a meet running today, takes the `--watched-bg`
tint and an `--accent` bar. `tr.watched` and `.row.watched` draw them.

- **The bar is a `box-shadow`, never a `border-left`.** A border changes the box and shifts the row
  by its width.
- **In a table the tint goes on the row and the bar on its first cell.**
- **In a followed table row only the name's own line (`.name-main`) is bold.** The club line's one
  bold state marks a best the result passed, so a bold cell would read as a personal best
  (`dev/probe-pending.js`).
- **No chip goes beside the tint**, as it would say what the tint already says.

## Width

**A view's cap follows what it holds.** Each selector states its cap:

- `main.list`: a row list;
- `main`: results;
- `main.wide`: a table wider than `LADDER_WIDE_THRESHOLD_PX` (`app/event.js`).

**A table fills its cap.** A ladder gives its spare width to the name column, up to
`LADDER_NAME_MAX_PX` (`app/event.js`), and `dev/probe-ladder.js` checks it.

## Finnish

- **A verb that takes the partitive gets it**, as `Säädä kelloa` and not `Säädä kello`.
- **Prose and buttons are in sentence case.** Uppercase comes only from CSS.
- **A thing is named for what it is, not for what the code calls it**, as `Eräjaot puuttuvat` and
  not `Unallocated`.
- **`/#/measure` is in English**, as the Finnish for render, request and median reads as a
  translation.
