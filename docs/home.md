# The front page

## The sections

The sections are `Seuratut`, `Viimeksi katsotut` and `Kilpailut`, in that order.

- **`Kilpailut` shows the whole listing whether or not a follow-list is active.** A follow-list
  changes neither the rows of `Kilpailut` nor their order, so the meets in `Seuratut` also appear in
  `Kilpailut`.
- **Home has no quick-filter.** The quick-filter stores `Athletes[].Id`, which identifies an entry
  in one meet only (2026-09). To follow a club or an athlete across meets, add them to a
  follow-list.

## The search

- **A search covers only `Kilpailut`.** The search replaces the list of `Kilpailut` with one flat
  list of every matching meet, however old, including the meets that the listing has dropped. The
  sections above it stay as they are.

## Meets that stand alone

A standalone row of `elsewhere.json` has no meet in Tuloslista's listing, so home adds the row as a
meet (`docs/elsewhere.md`, "A championship with no meet in Tuloslista"). The row is also in the
scan's window, so `Seuratut` finds a followed person in it. A row dated on or after the listing's
first day appears in `Kilpailut`. An older row appears only in a search.

## A matched row's athlete lines

- **A line has no times or results.** The digest is a cached roster that is rebuilt only when it is
  stale.
- **The line cap has no expander.** The whole row is one link to the meet, and the lines past the
  cap show only as `+N muuta`.

## Dates and sorting

A meet's days come from four sources in this order: a row of `elsewhere.json`, `/calendar.json`, the
meets that this device opened, and the scan. Each source overrides the sources before it. Today is
the date on the device's own clock.

## Filling the scan in

A render fetches the plain scan, which builds no digest. Then a loop requests the scan with
`build=1`, one round at a time, until no meet is pending or stale. The year pages run the same loop.
The empty notice of `Seuratut` waits until the pending meets are built. What the Worker builds, and
when, is in `docs/backend.md`, "The scan".

- **One loop runs per Watch.** If a render finds the loop already running, the render starts no
  second loop. Until the next render, the page shows neither the running loop's rounds nor its end,
  so its status line stays frozen.
