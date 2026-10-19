# Contributing

## Reporting a problem

Open an issue, and give the address of the page, such as `https://kisat.matilainen.fi/c/demo`. Say
what the page shows and what you expected instead. Add a screenshot, since a meet's results keep
changing until it is over. If a hurdle or implement table is wrong, link the federation's table you
compared it with.

Report a security hole privately, as [SECURITY.md](SECURITY.md) says.

## Suggesting an idea

Search the issues first, since the idea may have been raised before. Then open an issue, and say who
the idea is for and what they would do with it.

## Changing the code

Read [AGENTS.md](AGENTS.md) first. It maps the code, sets the rules a change follows and lists the
checks to run. For a larger change, open an issue before you start, and agree on the approach there.
The README's [Running it](README.md#running-it) says how to start a local instance.

## Checking a pull request

CI runs the first seven checks of [AGENTS.md](AGENTS.md#checking-a-change) on every pull request.
Run them before you push. `make format` fixes what `make check-format` reports. The first browser
check downloads Playwright's headless shell. A change to the page is also looked at in a browser, as
[dev/AGENTS.md](dev/AGENTS.md) says.
