# Results published on another site

Some championships publish their results outside Tuloslista:

- An adults' SM has its entries in Tuloslista and its results on `live.time4results.com`.
- The relay SM has no Tuloslista meet at all.
- A road, terrain or trail SM has its results in the files of a mass race on
  `online.tulospalvelu.fi`.

`public/data/elsewhere.json` lists each of these meets. The Worker's routes and KV keys are in
`docs/backend.md`, "Results from another site", and the views are in `docs/views.md`, "Results on
another site".

The graft makes an entry for each person in the other site's results who has no Tuloslista entry.
This doc calls such an entry and its person "made". A made person's id is `t4r-<club id>-<name key>`
from time4results and `ol-<club id>-<name key>` from a race's files. The name key drops accents but
keeps å, ä and ö. A club that the club index lacks gets the id `ol-<name key>`. Quick-filter links
carry these ids, so changing their format breaks shared links.

## An SM on time4results

The Tuloslista meet has the entries, and none of its rounds is drawn (`docs/tuloslista-api.md`, "An
adults' SM whose results are on another site").

## A championship with no meet in Tuloslista

The `elsewhere.json` row of such a championship stands alone: it has an `id` and no `comp`. Every
person in the championship's results is made.

## A meet in a race's files

A road, terrain or trail meet can run inside a public race. Its entries may be in a Tuloslista meet
that gets no results, or nowhere (2026-09). Each class is one official final, ranked by finish time.

During the race, a finisher appears in the results within a minute or two, and a time can still
change afterwards. A corrected start time can change every finisher's time in a class after the
class has finished. A day's files are rewritten the next morning (2026-10).

## The licence a made person gets

A follow-list follows a person by licence, and neither time4results nor a race's files give a
licence. So a made person takes the licence that the athlete index has under the same name and club,
and often has none.

## Keeping elsewhere.json

Rows are added by hand, and the offline suite proof-reads the file.

- A `comp` row for a race goes in before the meet, once the race's files are online. So does a
  time4results row whose directory comes from last year.
- Any other row goes in once the meet is over. A row that stands alone must not go in early: every
  class of its race shows as run and official, so the classes show as finished and empty.

A scheduled GitHub workflow, `.github/workflows/elsewhere.yml`, runs each day. It opens an issue
labelled `elsewhere` for each championship that is due a row and for each row that is due a fix.
`make elsewhere-due` prints the same list. Where the meet needs no row, close the issue without
adding one.

A championship can change its source and its month from year to year, so check the calendar.

A row in `meets` has one of these shapes. The file's `clubs` is a top-level key next to `meets`.

```text
{comp: <meet id>, t4r: "<year>/<directory>"}
{comp: <meet id>, ol: "<event>", classes: {"<event name>": <class id>}}
{id: "<word>-<year>", was?: <meet id>, name, location, date, start: "<hh:mm:ss±hh:mm>", ol, classes}
{id: "<word>-<year>", sm?: false, name, location, date, last, start, t4r}
```

- **A row with `comp` joins the results to that Tuloslista meet**, whose entries keep their clubs
  and licences. Use a `comp` row whenever the meet exists in Tuloslista.
- **A row with `id` stands alone.** `date` is its first day, and `last` is its last day where the
  meet has several. `start` is the first start time, with the UTC offset of the site's clocks. For a
  race, `start` takes the time and offset of the event file's `Classes[].Races[0].MassStartStr`.
- **A row with `sm: false` is not a championship.** A notable meet's row has it (`docs/notable.md`).
  A row with `comp` has no `sm`.
- **`name` is the championship's name, not the race's.** It is the meet's title, and its words
  narrow the classes that the national scope covers.
- **`location` is the venue's town.** No listing provides it.
- **`was` is the Tuloslista meet that the row stands in for**, once Tuloslista has dropped that meet
  (`docs/tuloslista-api.md`, "The listing"). A link to the dropped meet opens the row's meet.
- **`t4r` is `<year>/<directory>` under `T4R_BASE`.** A championship's directory has kept its name
  from year to year (2026-09).
- **`ol` is the race's event id, and `classes` maps each event name of the meet to the race's class
  id.** Both are available once the race's files are online, days before the race (2026-10). The
  class ids and names change from race to race. A class that sums other classes has no results file,
  and one missing file fails the whole race, so don't map such a class (2026-09).
- **Several rows can name the same `ol`** where several meets run as one race, and each row maps its
  own classes. Where one championship has two Tuloslista meets with the same entries, list only one
  of them.
- **`clubs` maps a page's or a race's own spelling of a club to the club's abbreviation in
  `districts.json`**, for a club that the club index does not find by that spelling.
- **Adding a row needs no cache cleared**, because a listed meet's KV keys include `elsewhereTag`.
