# Contributing

## Reporting a problem

Open an issue and give the address of the page, such as `https://kisat.matilainen.fi/c/demo`.
Describe what the page shows and what you expected instead. Add a screenshot, because a meet's
results keep changing until the meet is over. If a hurdle or implement table is wrong, link the
federation's table that you compared it with.

Report a security vulnerability privately, as described in [SECURITY.md](SECURITY.md).

## Suggesting an idea

Search the issues first, because the idea may have been raised before. Then open an issue, and
describe who the idea is for and what they would do with it.

## Changing the code

Read [AGENTS.md](AGENTS.md) first. It maps the code, sets the rules for a change and lists the
checks to run. For a larger change, open an issue before you start and agree on the approach there.
[Running it](README.md#running-it) in the README describes how to start a local instance.

## Checking a pull request

CI runs the first seven checks in [AGENTS.md](AGENTS.md#checking-a-change) on every pull request.
Run them before you push. `make format` fixes what `make check-format` reports. The first browser
check downloads Playwright's headless shell. Also look at a change to the page in a browser, as
described in [dev/AGENTS.md](dev/AGENTS.md).
