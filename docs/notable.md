# Notable meets

`public/data/notable.json` lists the meets that a club's years show beside the championships. An
entry is a meet that is held every year, and its `comps` lists the meets of each year:

```
{ "id": "demo", "name": "Demon nuorten kisat", "short": "DNK", "comps": [90001, 91001] }
```

- **A meet is listed by its Tuloslista id**, because its name, organiser and town can change from
  year to year.
- **A meet whose results are on another site is listed by the `id` of its row in `elsewhere.json`.**
  That row stands alone and has `sm: false` (`docs/elsewhere.md`).
- **A Tuloslista meet must be added within two seasons (`seasonYears`)**, before the meet index
  drops it. The meet index keeps a listed meet permanently.
- **One year's edition can be several meets.** Their medals are summed in the year's row.
- **A notable meet's medals are its own places 1 to 3, counted over every club.**
- **An entry's `id` must differ from every scope's id and from `seura`.**
- **An entry's `short` is the meet's abbreviation**, which labels its chip on a club's years.

## Keeping notable.json

Each year's meets are added by hand. Every Wednesday, `.github/workflows/notable.yml` opens an issue
labelled `notable` for each of these gaps in the file. `make notable-due` lists the same gaps.

- **A meet whose name contains an entry's `name`**, dated in or after the year of the entry's latest
  listed meet. If the meet is not part of the event, close its issue.
- **A year with no such meet one month after the date of the previous year's meet.** That year's
  meet may have run under another name or on another site.
