# Style

One stylesheet in `index.html` styles both modes. A mode changes which elements are on the page,
never how a shared element looks. The lap counter departs from this doc where `docs/lap-counter.md`,
"Where the look departs from the shared style", says so.

## Components

- **`.row` is the building block of every list.** `.row-main` holds `.row-title` above `.row-sub`.
  Anything at the end of the row, such as a chip, is a sibling of `.row-main`.
- **`.row-sub` separates its parts with `·`.** A missing part drops its separator with it.
- **Each round status has a chip with its own hue, and a heat's heading shows a chip in both of its
  states.**
- **In the name cell, everything except the name and its badges is muted.** The one other exception
  is a best mark that the row's result beat (`.name-aside-beaten`).
- **A tick in a column of its own marks the rows that a property applies to.** The column is on
  every row, so the ticks line up. Outside a menu, the column is a table column.
- **An empty cell of a results table stays empty, because a dash looks like content.** An attempt
  grid marks its own cells, and a `Sija` cell with no place to show gets a dash.
- **A task goes in a `<details>` element with a muted summary line.** Use it for something the
  reader does once, never for something the reader keeps watching.
- **A plain `.notice` reports a result, and `.notice.error` reports a failure to get one.** An empty
  state never uses the error variant.
- **`.search` has a font size of 16 px and never less.** iOS zooms the page when a field with a
  smaller font gets focus.

## A menu is not a dialog

A menu never locks the page.

- **A menu is a list of choices.** Its items are `.row` elements with the tick column, and a menu
  contains no `.btn`. The `▾` marks a button that opens a menu, and nothing else.
- **A dialog is a form, or the single question that an action asks before it does something that
  cannot be undone.** The question has a labelled button to back out, beside the ×.
- **Only a dialog contains prose.** An explanation that no label can hold goes in the help sheet,
  which the `?` in the header opens.
- **An action goes under the row it acts on**, so that each subject has one menu.

## Headings

- **`h2` labels a region of the page, and `h3` names a single item.**
- **A heading's style never changes with the state of its content.** A difference shows in the
  heading's words, or in a chip beside it.
- **`.wind` and `.round-name` qualify a heading inline.** They set `text-transform: none`, so they
  keep their own case inside an `h2`.

## Emphasis

The row that the reader looks for, such as a followed row or a meet running today, gets the
`--watched-bg` tint and an `--accent` bar.

- **The bar is a `box-shadow`, never a `border-left`.** A border shifts the row by its width.
- **In a table, the tint goes on the row and the bar goes on the row's first cell.**
- **In a followed table row, only the name's own line (`.name-main`) is bold.** The club line is
  bold only where it shows a best mark that the result beat, so a fully bold cell would look like a
  personal best.
- **A tinted row gets no chip that repeats the tint's meaning.**

## Width

**The maximum width of a view depends on its content:**

- `main.list`: a row list.
- `main`: results.
- `main.wide`: a table wider than `LADDER_WIDE_THRESHOLD_PX`.

**A table fills the view's maximum width.** A ladder gives its spare width to the name column, up to
`LADDER_NAME_MAX_PX`.

## Finnish

- **A verb that takes a partitive object gets one.** Write `Säädä kelloa`, not `Säädä kello`.
- **Prose and buttons are in sentence case.** Uppercase text comes only from CSS.
- **UI text names a thing for what it is, not by its name in the code.** Write `Eräjaot puuttuvat`,
  not `Unallocated`.
- **`/#/measure` is in English**, because the Finnish words for render, request and median read like
  translations.
