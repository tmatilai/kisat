# Shims to delete

A shim is retired code kept so that a stored link or view state keeps working (`AGENTS.md`, "A
breaking change keeps users working"). A shim goes on any day after its date, and its row goes in
the same commit. Every Tuesday `.github/workflows/shims.yml` opens an issue labelled `shim` for each
row past its date (`dev/shims-due.mjs`, `make shims-due`). The issue's title reads "Delete the
<shim> shim (after <date>)" and its body "Delete <what goes>.", so the cells are written to fit. The
offline suite checks the table's form (`shimProblems`, `test/source.test.mjs`).

| after      | shim                  | what goes                                                                                                                                                      |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-30 | fragment-link         | `legacyRoutePath` and its call in `app.js`, the shapes `/#/w/<id>/c/<compId>`, `/#/c/<compId>/a/…` and `/#/c/<compId>/s/…` in `parseLinkHash`, and their tests |
| 2026-12-15 | `/sarjat` redirect    | the redirect in `worker.js`, its `run_worker_first` line and its Worker test                                                                                   |
| 2026-12-15 | relay-formula key     | the third find in `groupForKey` and its test                                                                                                                   |
| 2026-12-17 | cup club page         | the `/c/<compId>/cup/<orgId>` pattern in `parseRoute`, its test and `probe-cup.js`'s check                                                                     |
| 2026-12-18 | `/api/clubs` endpoint | the route in `worker.js`, `handleClubs` and its Worker test                                                                                                    |
| 2026-12-31 | cover filed at 30     | the `filed` test in `coversStart` and its test                                                                                                                 |
| 2026-12-31 | D.M.YYYY day path     | the redirect in `worker.js`, `legacyDayPath` and its call in `legacyRoutePath`, their tests and the Worker test                                                |
| 2026-12-31 | `/aidat` redirect     | the redirect in `worker.js`, its `run_worker_first` line, its Worker test and `probe-aitataulukko.js`'s check                                                  |
| 2027-01-01 | piirit view-state     | the `?? v?.piirit` in `normalizeCompView`, the bare id in `normalizeScopes` and their test                                                                     |
| 2027-01-19 | start-key offset      | `startKeyOf`, the second find in `groupForKey`, the stored-count move in `renderLaps` and their test                                                           |
