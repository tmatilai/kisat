# Working in this repo

Kisat is a static single-page app with no framework, plus a small Cloudflare Worker in front of it.
`README.md` explains what the app does and how to run it. This file maps the code and sets the rules
for changing it. Each area has its own doc, listed under "Where to read next". Read the one your
task needs, not all of them.

The app has two modes, chosen by the hostname. Kisat is for following clubs and athletes. Juoksut is
for the official at the finish line. On a dev host, `?mode=juoksut` selects Juoksut
(`docs/juoksut.md`).

## Finding things

- `worker.js`, `public/demo.js` and the larger files in `public/app/` are over 1,000 lines long, so
  read one section, not the whole file. Lines that start with `// --- ` mark the sections, in these
  files and in `public/lib/`:
  `grep -n '^// --- ' worker.js public/demo.js public/app/*.js public/lib/*.js`.
- A doc's headings are its table of contents: `grep -n '^#' docs/views.md`.
- To find a function's tests: `grep -rn 'functionName' test/`. To run one test:
  `node --test --test-name-pattern='<name>' test/<area>.test.mjs`.
- The deployed `/api/*` requires the header `x-kisat-client: 1`. Without it, Cloudflare returns its
  403 block page (`docs/backend.md`).

## The files

`make help` lists every command.

- `public/`: everything that ships. `make build` bundles it into `dist/`, which is what gets
  deployed.
- `public/index.html`: the markup and **all** the CSS.
- `public/lib/`: pure logic, with no DOM and no network access, one file per area.
- `public/app.js`: the router. It renders each route with a view module from `public/app/`.
  `shell.js` (the page frame) and `data.js` (fetching and storage) load with the page. The other
  modules load when a view first needs them.
- `public/demo.js`: the demo competitions `demo`, `democup` and `democupfinal`. They are the test
  fixture and an offline demo. Only a demo meet loads this file.
- `public/data/`: tables edited by hand and checked by the offline suite. Each has its own
  `docs/<name>.md`.
- `worker.js` and `wrangler.jsonc`: the `/api` layer and the calendar feed in front of the static
  assets, with their routes, KV, rate limits and cron (`docs/backend.md`).
- `test/`: the tests of the logic, one file per area. Shared helpers are in `fixtures.mjs`.
- `test-worker.mjs` and `test-render.mjs`, at the top level: checks that run against a local
  `wrangler dev`.
- `dev/`: the browser probes (`dev/AGENTS.md`) and the scripts behind some `make` targets. Nothing
  in it ships.

## Checking a change

Run the checks that match the change, cheapest first.

| command             | checks                                                                     | takes                 |
| ------------------- | -------------------------------------------------------------------------- | --------------------- |
| `make test-offline` | `public/lib/` against `demo.js`, the data files, and the docs' citations   | under a second        |
| `make lint`         | undefined and unused names                                                 | a few seconds         |
| `make check-worker` | that the pinned wrangler builds `dist/` and bundles `worker.js`, no deploy | a few seconds         |
| `make check-format` | that Prettier would change no file                                         | a few seconds         |
| `make test-worker`  | `worker.js` against a local `wrangler dev` that serves the bundle          | fifteen seconds       |
| `make test-render`  | that each view of the bundle renders in a headless browser, offline        | a few seconds         |
| `make probes`       | every probe at phone width, offline (`dev/AGENTS.md`)                      | under a minute        |
| `make test`         | the offline checks, then the live API                                      | a few seconds, online |
| `make probe`        | one probe, line by line (`dev/AGENTS.md`)                                  | seconds to a minute   |

CI runs the first seven on every pull request and every push to `main`.

A quick look at the rendered page is fine, but measuring a layout needs a probe. Before committing,
run `make format` and go through "Before you commit" under "Writing".

## Words

The UI is in Finnish, and so are many names in the code and the docs.

- **Tuloslista**: the results service whose public API the app reads (`docs/tuloslista-api.md`).
- **start**: one row of the day's schedule, made of the rounds that share a start time and an event
  name.
- **class**, **category**: an age and sex class such as N17 or P13. M is men, N women, P boys and T
  girls. The API's `Category` field is something else: the discipline group `Track`, `Field` or
  `Relay`.
- **Watch**: a follow-list of clubs and athletes, stored by the Worker and shared by a link.
- **erä**: a heat.
- **viesti**: a relay. A sukkulaviesti is a shuttle relay, and an aitaviesti is a shuttle hurdle
  relay.
- **aidat**, **esteet**: hurdles and steeplechase.
- **ottelu**: a multi-event, such as a 7-ottelu.
- **varmistus**: an entrant's confirmation that they are at the meet. Heats are drawn among those
  who confirmed.
- **kenttä**: a named track, with its length and the hurdle marks on its own board.
- **seura**: a club.
- **SUL**, **piiri**, **alue**: the national federation, one of its districts, and one of the
  regions the districts form.
- **SAUL**: the masters' federation. A SAUL SM is a masters' national championship. SAUL publishes
  the masters' hurdle and implement tables.
- **SM**: a national championship. A piiri's own championship is a piirinmestaruus.
- **Seuracup**: the club cup, a season of scored meets (osakilpailut) and finals (finaalit).
- **mitat**: the page with the hurdle tables and the implement (välineet) tables.

## Rules for code

- **Logic goes in `public/lib/`, with a test.** Code in `lib/` uses neither the DOM nor the network,
  so the offline suite can test all of it. `public/app/` renders and handles events. `worker.js`
  fetches, caches and routes. If code is hard to test, it is probably in the wrong file.
- **Add a package only where it saves a lot of code**, for a problem that is hard to get right, such
  as parsing HTML. Choose a well-maintained package and pin its version. No module that the page
  loads may import a package, because the CSP in `public/_headers` blocks scripts from other
  origins. The Web Analytics beacon is the one exception.
- **`demo.js` is the test fixture.** It has the same shape as the API, so a new test case extends
  it, and no test mocks the API. `demo.js` is also the only place where a case may exist just to try
  out a view. A case that a test asserts on is modelled on a real, measured competition, even when
  its names are invented.
- **Measure, do not guess.** Tuloslista publishes no API documentation, so check each claim about
  its API against a live competition before relying on it. Record the measurement in `demo.js` and a
  test that asserts on it. Where code depends on a measurement that no test can pin, give it a
  one-line comment that ends with the month, such as "(2026-08)". Don't name a competition id or
  copy counts, because the API drops old competitions.
- **Check that each new test or probe check can fail.** After writing it, break the code on purpose
  and confirm that the check fails. Restore the code from a copy of the file, because `git checkout`
  would also discard the change under test.
- **A breaking change keeps users working** for a while. A shared link, a stored follow-list or a
  lap count in progress must survive a change to a URL shape, a storage key or a record format. Add
  the smallest shim that does this, with a comment saying it is temporary, and a row in
  `docs/shims.md` with the shim's removal date. After that date, delete the shim, its test and the
  row. Derived data, such as a cache or a digest, needs no shim: rebuild it under a new key or
  version.

## Common traps

- **A start contains several classes.** Each class has its own round, status and qualification rule,
  and sometimes its own heat. That is why `lib/schedule.js` and `lib/start.js` compute a start's
  status, counts and tables per class.
- **Every table uses the same name cell.** Changing `athleteNameParts` or `nameAside` changes every
  results table, ladder and phone card at once. For the same reason, look up per-row data such as a
  wind or a mark for each row. Don't pass it through the table functions.

## Writing

These rules apply to comments, docs, commit messages and pull request descriptions. Much of the
existing documentation is older and too terse. Don't copy its style.

### Words and sentences

- **Write plain technical English** that a developer new to the repo understands on first reading.
  Every sentence has a subject and a verb and says one thing. A longer plain sentence beats a short
  cryptic one.
- **Use the standard engineering term, or the code's own name for the thing**: duplicate, canonical,
  returns, merges, maps X to Y. Don't coin a term such as "head" or "link name": a new term needs a
  definition, and the definition grows into a section.
- **The subject is what acts**: a function, a route, the cron, the Worker or a person. An id, a key,
  a record or a field doesn't act. Code stores, maps, looks up or returns it.
- **The verb is what the code does**, such as stores, reads, maps or rebuilds. Don't give code a
  human verb such as "answers", "says" or "knows", or a metaphor verb such as "joins", "reaches",
  "lands" or "lives".
- **A bold opening is a plain sentence.** If a rule doesn't fit in one, keep the bold part short and
  explain the rule in the next sentence.
- **Name the thing.** Write "the sample rate", not "the rate". Refer to a function, field or setting
  by its name in backticks.
- **Describe the code as it is.** Don't say what it replaced, how it came about or which
  alternatives were weighed: `git log` and the commit message have that. A measurement keeps its
  month and nothing more.
- **Write for a reader with no context.** Don't mention a person, a machine, a path outside the
  repo, "the user" or the tool you used. In examples, use the demo's clubs and athletes, or invented
  names in their style, never a real club or person.
- **No runtime data.** Don't name a kenttä, a class, a club, a meet or a row of results. Nothing
  checks such a name, so it goes stale.

### What to write

- **A doc holds only what the code and the tests can't tell a reader:**
  - traps in the Tuloslista API, and behaviour seen only during a live meet or at the track, dated;
  - contracts that outlive a deploy: KV keys, response bodies, stored formats, URL shapes and the
    data files' formats;
  - constraints and traps: what must hold, and what breaks if it doesn't;
  - procedures that a person follows, such as deploying or updating a data file.
- **A doc or a comment never describes what the code or a test already shows.** That includes case
  handling, precedence, tiebreaks and fallbacks, and lists of functions, files or tests. Name a
  function only where a rule is about it. A comment says why, or the constraint that holds.
- **A measurement that can be taken again in minutes stays out of the docs**, such as the shape of
  an outside API's response, an outside page's layout, a timing or a size. Measure it again when it
  matters.
- **A feature's docs go into the sections that already hold its contracts**, such as the route table
  or a response body, usually a line in each. A new section needs a contract or a trap that no
  section covers yet.
- **State each fact once.** A code comment cites the doc's section, such as
  `(docs/backend.md, "A scope's year")`, instead of restating the rule. Code copied from elsewhere
  doesn't copy its comment.
- **Say what a change does not cover** when the docs' own text implies that it does.
- **New text goes in its own paragraph** or at the end of one.
- **A change keeps the text around it right.** Search the docs and comments for each claim the
  change drops or changes, and each name it renames. Rewrite the lines it touches that break these
  rules, and delete the lines that only repeat the code or `git log`.

### Examples

| Don't write                                                   | Write                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Rows whose names agree by `clubNameKey` are one club.         | Two club records with the same `clubNameKey` are the same club.             |
| `/api/medalclub` answers any of its ids with the head's page. | Given a duplicate record's id, `/api/medalclub` returns the canonical club. |
| A meet reaches no year.                                       | The year's medal page doesn't list the meet.                                |
| An id without a licence joins a licence.                      | The cron maps the id to the licence.                                        |
| The views of a meet: …                                        | Each view of a meet is listed below.                                        |
| Answer a club's hand-made records as one club                 | Merge duplicate club records in search                                      |

### Commits

- **A commit is one piece of work**, the size a reviewer would review or revert as a whole. A rename
  goes in one commit with its code, tests and docs. A part gets its own commit only if it stands
  alone. A fix to an earlier commit on the same branch is squashed into that commit.
- **The subject names the change in words a reviewer understands without knowing the repo**, such as
  "Merge duplicate club records in search". It is one imperative line that starts with a capital and
  ends with no full stop. It has no `feat:`-style prefix. An area tag such as `[seuracup]` goes
  first where the scope isn't obvious.
- **A small commit needs only the subject.** Otherwise a body follows a blank line, wrapped at 72
  columns. It states the problem first, then what the change does and what it relies on, such as a
  measurement or data rebuilt under a new key: two or three short sentences per problem. It doesn't
  describe how the work went, what the diff shows, or which tests ran. Names from the code and
  values go in backticks, such as `BeginDateTimeWithTZ` or `+00:00`.

### Before you commit

Read the added comments and doc lines together, as a developer new to the repo would.

- Replace each word that only makes sense inside the repo.
- Cut each line that repeats another line, the code or a test.
- Rewrite each sentence that needs a second reading.

## Where to read next

- `docs/views.md`: the rules and traps of the meet and year views.
- `docs/home.md`: the front page, its sections, sorting and dates, and the scan's fill-in loop.
- `docs/architecture.md`: the routes and how to add one, the packages left out, the render log, the
  two modes, view state, back targets, layers and the filter bar.
- `docs/backend.md`: `worker.js`, KV, caches, rate limits, Watch records, the club and meet indexes,
  the cron, `/api/results` and `/calendar.json`.
- `docs/tuloslista-api.md`: the Tuloslista API's traps and its behaviour during a meet.
- `docs/elsewhere.md`: meets whose results are on another site, and `elsewhere.json`.
- `docs/style.md`: anything visual.
- `docs/juoksut.md`: Juoksut mode, and what the lap counter requires of the rest of the app.
- `docs/lap-counter.md`: the lap counter.
- `docs/hurdles.md`: hurdle setups, their sources, and `hurdles.json`.
- `docs/implements.md`: the implement table page, `implements.json`.
- `docs/venues.md`: a kenttä: the select, its index and board files, reading a board, and adding
  one.
- `docs/districts.md`: medals per piiri, `districts.json`.
- `docs/seuracup.md`: the club cup's series, `seuracup.json`.
- `docs/notable.md`: the notable meets in a club's years, `notable.json`.
- `docs/deployment.md`: deploying, Workers Builds, a preview and its own data, the WAF rules, and
  running your own deployment.
- `docs/shims.md`: the shims and their removal dates.
- `dev/AGENTS.md`: probes, and looking at the page in a browser.
