# Notable meets

`public/data/notable.json` lists the meets that a club's years show beside the championships
(`docs/views.md`, "The years"). An entry is a meet held every year, and `comps` lists each year's
meets:

```
{ "id": "demo", "name": "Demon nuorten kisat", "comps": [90001, 91001] }
```

- `notableYear` (`lib/medals.js`): an entry's meets of a year.
- `isNotableMeet` (`lib/medals.js`): the meets that the meet index keeps for good and the cron
  warms.

Rules:

- **A meet is listed by its Tuloslista id.** Its name, organiser and town can change from year to
  year.
- **A meet whose results are on another site is listed by the `id` of its row of `elsewhere.json`.**
  The row stands alone and has `sm: false` (`docs/elsewhere.md`).
- **A Tuloslista meet goes in within two seasons (`seasonYears`)**, before the meet index drops it.
- **A year's edition can be several meets.** Their medals add up in the year's row.
- **A meet counts its own places 1 to 3, over every club.**
- **An entry's `id` is neither a scope's id nor `seura`.** Tested in `test/medals.test.mjs`,
  "notable.json".

## Keeping notable.json

Each year's meets go in by hand. Every Wednesday `.github/workflows/notable.yml` opens an issue
labelled `notable` for what the file lacks (`dev/notable-due.mjs`, `make notable-due`):

- **A meet whose name holds an entry's `name`**, from the year of the entry's latest meet on. A meet
  that is no part of the edition gets its issue closed.
- **A year with no such meet a month past the day of last year's meet.** That meet may have run
  under another name or on another site.

`notableDue` (`lib/medals.js`) finds them. Tested in `test/medals.test.mjs`.
