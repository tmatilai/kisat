# Working in this repo

Kisat is a static single-page app with no framework, and a small Cloudflare Worker in front of it.
`README.md` says what the app does and how to run it. This file is the map and the rules. Each area
has a doc of its own, listed under "Where to read next": read the one the task needs, not all of
them.

The app has two modes, picked by the hostname. Kisat is for following clubs and athletes, and
Juoksut is for the official at the finish line. On a dev host, `?mode=juoksut` picks Juoksut
(`docs/juoksut.md`).

## Finding things

- `worker.js`, `public/demo.js` and the larger files of `public/app/` run past 1,000 lines, so read
  a section, not the file. Their `// --- ` lines are the table of contents, as are those of
  `public/lib/`: `grep -n '^// --- ' worker.js public/demo.js public/app/*.js public/lib/*.js`.
- A doc's headings are its table of contents: `grep -n '^#' docs/views.md`.
- A function's tests: `grep -rn 'functionName' test/`. One test:
  `node --test --test-name-pattern='<name>' test/<area>.test.mjs`.
- The deployed `/api/*` needs the header `x-kisat-client: 1`. Without it, Cloudflare answers with
  its 403 block page (`docs/backend.md`).

## The files

`make help` lists every command.

- `public/`: everything that ships. `make build` bundles it into `dist/`, which is what deploys
  (`docs/architecture.md`).
- `public/index.html`: the markup and **all** the CSS.
- `public/lib/`: the pure logic, with no DOM and no network, one file per area.
- `public/app.js`: the router. It renders a route with the view's module from `public/app/`. Of
  those, `shell.js` (the page's frame) and `data.js` (fetching and storage) load with the page, and
  the others when a view first needs them.
- `public/demo.js`: the demo competitions `demo`, `democup` and `democupfinal`, the test fixture and
  an offline demo. Only a demo meet loads it.
- `public/data/`: tables edited by hand and checked by the offline suite. `docs/<name>.md` describes
  each one.
- `worker.js` and `wrangler.jsonc`: the `/api` layer and the calendar feed in front of the static
  assets, and its routes, KV, rate limits and cron (`docs/backend.md`).
- `test/`: the logic's tests, one file per area, with shared helpers in `fixtures.mjs`.
- `test-worker.mjs` and `test-render.mjs`, at the top level: the checks that run over a local
  `wrangler dev`.
- `dev/`: the browser probes (`dev/AGENTS.md`) and the scripts behind some `make` targets. Nothing
  in it ships.

## Checking a change

Check at the level of the change, cheapest first.

| command             | checks                                                                          | takes                 |
| ------------------- | ------------------------------------------------------------------------------- | --------------------- |
| `make test-offline` | `public/lib/` over `demo.js`, the data files, and the docs' citations           | under a second        |
| `make lint`         | undefined and unused names                                                      | a few seconds         |
| `make check-worker` | that the pinned wrangler builds `dist/` and bundles `worker.js`, with no deploy | a few seconds         |
| `make check-format` | that Prettier would change no file                                              | a few seconds         |
| `make test-worker`  | `worker.js` over a local `wrangler dev`, which serves the bundle                | fifteen seconds       |
| `make test-render`  | that each view of the bundle renders in a headless browser, offline             | a few seconds         |
| `make probes`       | the probes that need only the demo, at a phone width (`dev/AGENTS.md`)          | two minutes           |
| `make test`         | the offline half, then the live API                                             | a few seconds, online |
| `make probe`        | one probe, line by line (`dev/AGENTS.md`)                                       | seconds to a minute   |

CI runs the first seven on every pull request and every push to `main`.

One look at the real render is cheap, but measuring a layout is a probe's job. Before committing,
run `make format`.

## Words

The UI is Finnish, and so are many names in the code and the docs.

- **Tuloslista**: the results service whose public API the app reads (`docs/tuloslista-api.md`).
- **start**: one row of the day's schedule, the rounds that share a start time and an event name.
- **class**, **category**: an age and sex class such as N17 or P13, with M for men, N for women, P
  for boys and T for girls. The API's `Category` field is something else: the discipline group
  `Track`, `Field` or `Relay`.
- **Watch**: a follow-list of clubs and athletes, kept by the Worker and shared by a link.
- **erä**: a heat.
- **viesti**: a relay. A sukkulaviesti is a shuttle relay, and an aitaviesti is a shuttle hurdle
  relay.
- **aidat**, **esteet**: the hurdles and the steeplechase.
- **ottelu**: a multi-event, such as a 7-ottelu.
- **varmistus**: an entrant's confirmation that they are at the meet. The heats are drawn among
  those who confirmed.
- **kenttä**: a named track, with its length and the hurdle marks on its own board.
- **seura**: a club.
- **SUL**, **piiri**, **alue**: the national federation, one of its districts, and one of the
  regions the districts form.
- **SAUL**: the masters' federation. A SAUL SM is a masters' national championship, and SAUL
  publishes the masters' hurdle and implement tables.
- **SM**: a national championship. A piiri's own championship is a piirinmestaruus.
- **Seuracup**: the club cup, a season of scored meets (osakilpailut) and finals (finaalit).
- **mitat**: the page of the hurdle tables and the implement (välineet) tables.

## Rules that hold everywhere

- **Logic goes in a file of `public/lib/`, with a test.** `lib/` touches neither the DOM nor the
  network, so the offline suite can test all of it. `public/app/` renders and handles events, and
  `worker.js` fetches, caches and routes. Code that is hard to test is probably in the wrong file.
- **A package earns its place by the code it saves.** A well-kept package beats own code where the
  thing is hard to get right, such as parsing HTML. A package is pinned, and no module the page
  loads imports one. `public/_headers` lets the page run scripts from its own origin only, so
  nothing loads from a CDN.
- **`demo.js` is the test fixture.** It has the API's shape, so a new case extends it and no test
  mocks the API. It is also the one place where a case may exist only to explore the views. A case
  that a test asserts on is modelled on a measured competition, even where its names are invented.
- **Measure, do not guess.** Tuloslista publishes no documentation, so a claim about its API is
  checked against a live competition before it is written. It is written once, in
  `docs/tuloslista-api.md`, as one sentence with the month it was last seen to hold, such as
  "(2026-08)". It names no competition id and copies no counts, since the API drops old
  competitions. Code, tests and other docs cite it in a phrase.
- **Prove a guard is not vacuous.** After writing a test or a probe check, break the code on purpose
  and watch the check fail. Undo the break from a copy of the file, since `git checkout` also throws
  away the change under test.
- **A breaking change keeps users working**, for a while. A shared link, a stored follow-list or a
  lap count in progress survives a change of URL shape, storage key or record format. The shim is
  the smallest that does it, and its comment says it is temporary. A row in `docs/shims.md` names
  the shim and its date. After that date, the shim, its test and the row go. Derived data, such as a
  cache or a digest, needs no shim: it is rebuilt under a new key or version.

## Writing

These rules cover comments, docs and commit messages. Write plain English, with a verb in every
sentence. Lists, tables and colons are fine. A doc points into the code in a list, as "`function`
(`file`): what it decides", and not in parentheses inside a sentence.

- **A comment states the constraint.** It says what holds, cites the measurement it rests on, and
  says what breaks if the code changes. It gives no argument and no rejected alternative.
- **No runtime data in a comment or doc.** Do not name a kenttä, a class, a club, a meet or a row of
  results. Nothing checks such a name, so it goes stale.
- **Say a thing once, in one place.** A doc paragraph states the rule and where it is tested.
- **Written for a stranger.** The reader has no context and no way to ask. Nothing names a person, a
  machine, a path outside the repo, "the user" or the tool an agent used. An example uses the demo's
  clubs and athletes, or invented names in their style, never a real club or person.
- **No history.** Do not say where a thing came from or what it replaced. `git log` has that. A
  measurement keeps its month, and no more than its month.
- **A commit is one piece of work, the size a reviewer would take or revert whole.** Edits toward
  one goal go together, such as a rename with its code, tests and docs, or one cleanup across many
  files. A part gets its own commit only where it stands alone: unrelated, or worth reverting alone.
  A fix to an earlier commit of the same branch is squashed into that commit, not added after it.
- **A commit message says what the commit does.** The subject is one imperative line, such as "Add
  the cup's year as two tabs". It starts with a capital, ends with no full stop and has no
  `feat:`-style prefix. An area tag such as `[seuracup]` goes first where the scope is not plain. A
  small commit needs only the subject. Where the subject is not the whole story, a body follows a
  blank line, wrapped at 72 columns. It says in a few lines what the change rests on, such as the
  measurement, the test that proves it or the data rebuilt under a new key. It does not say how the
  work went, nor what the diff shows. The body is short sentences that each say one thing, with the
  problem first. A name from the code, a field or a value goes in backticks, such as
  `BeginDateTimeWithTZ` or `+00:00`.

## Where to read next

- `docs/views.md`: each view of a meet and of a year, the code that decides it, and the traps no
  test catches.
- `docs/home.md`: the front page, its sections, sorting and dates, and the scan's fill-in loop.
- `docs/architecture.md`: the routes and adding one, the page's modules, the packages left out, the
  render log, the two modes, view state, back targets, layers and the filter bar.
- `docs/backend.md`: `worker.js`, KV, caches, rate limits, Watch records, the club and meet indexes,
  the cron, `/api/results` and `/calendar.json`.
- `docs/tuloslista-api.md`: anything about what the Tuloslista API does.
- `docs/elsewhere.md`: a meet whose results are on another site, `elsewhere.json`, the `t4r*` and
  `ol*` functions.
- `docs/style.md`: anything visual.
- `docs/juoksut.md`: Juoksut mode, and what the lap counter requires of the rest of the app.
- `docs/lap-counter.md`: the lap counter.
- `docs/hurdles.md`: hurdle setups, `hurdleSpec`, the box on a start, the hurdle table page,
  `hurdles.json`.
- `docs/implements.md`: the implement table page, `implements.json`.
- `docs/venues.md`: a kenttä: the select, its index and board files, reading a board, and adding
  one.
- `docs/districts.md`: medals per piiri, `districts.json`.
- `docs/seuracup.md`: the club cup's series, `seuracup.json`.
- `docs/deployment.md`: the deploy, Workers Builds, a preview and its own data, the WAF rules, and a
  deployment of your own.
- `docs/shims.md`: a shim and its date.
- `dev/AGENTS.md`: a probe, or a look at the page in a browser.

## Two things that catch people out

- **A start is several classes.** Each has its own round, status and qualification rule, and
  sometimes its own physical heat. So `lib/schedule.js` and `lib/start.js` build a start's status,
  counts and tables per class.
- **The name cell is one function for every table.** A change to `athleteNameParts` or `nameAside`
  changes every results table, ladder and phone card at once. For the same reason, anything per row,
  such as a wind or a mark, is looked up per row and not threaded through the table functions.
