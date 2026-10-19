PORT ?= 8932
# Two wranglers with the same --persist-to share one SQLite state, so a second
# make dev needs its own DEV_PORT and STATE_DIR. A dev server keeps off 8933 to
# 8935: make test-worker binds TEST_WORKER_PORT, 8933, and the two ports after
# it, and make test-render binds TEST_RENDER_PORT, 8935.
DEV_PORT ?= 8787
COMP ?=
# package.json pins the tools and the packages. A target that needs them
# installs them first, when they are missing or when package.json,
# pnpm-lock.yaml or pnpm-workspace.yaml has changed since the last install.
BIN := node_modules/.bin
INSTALLED := node_modules/.modules.yaml
WRANGLER ?= $(BIN)/wrangler
ESLINT ?= $(BIN)/eslint
PRETTIER ?= $(BIN)/prettier
STATE_DIR ?= .wrangler/state
# CHROMIUM= names a Chromium for the browser runs, and Playwright's own is
# then not installed.
BROWSER := $(if $(CHROMIUM),,$(BIN)/playwright-core install chromium-headless-shell)

.DEFAULT_GOAL := help

$(INSTALLED): package.json pnpm-lock.yaml pnpm-workspace.yaml
	pnpm install --frozen-lockfile
	@touch $@

## help: list the available targets
help:
	@awk -F': ' '/^## /{ printf "  make %-21s %s\n", substr($$1, 4), $$2 }' $(MAKEFILE_LIST)

## serve: serve public/ (and dev/ under /dev/) at http://localhost:8932/ (override with PORT=)
serve:
	python3 dev/serve.py $(PORT)

## dev: serve through wrangler (DEV_PORT=, STATE_DIR= for a second one, ASSETS=dist for the bundle)
# The probes read the source's modules, so public/ is the default.
ASSETS ?= public
dev: $(INSTALLED)
	$(WRANGLER) dev --port $(DEV_PORT) --persist-to $(STATE_DIR) --assets $(ASSETS)

## build: bundle the page's modules into dist/, which wrangler serves and deploys
build: $(INSTALLED)
	node build.mjs

## test: run the offline tests, then the live API's (COMP=12345 for another competition)
test: test-offline
	node test/live.mjs $(COMP)

## test-offline: run the tests of public/lib/ in test/, with no network (what CI runs)
test-offline: $(INSTALLED)
	node --test $(wildcard test/*.test.mjs)

## test-render: render each view of the bundle in a headless browser, over a local wrangler dev (what CI runs)
test-render: $(INSTALLED)
	$(BROWSER)
	node test-render.mjs

## test-worker: test worker.js over a local wrangler dev, which serves the bundle (what CI runs)
test-worker: $(INSTALLED)
	node test-worker.mjs

## lint: check the JavaScript for undefined and unused names (eslint.config.mjs)
lint: $(INSTALLED)
	$(ESLINT) .

## format: rewrite the files in Prettier's format (prettier.config.mjs)
format: $(INSTALLED)
	$(PRETTIER) --write --log-level warn .

## check-format: list the files Prettier would change, and fail if there are any
check-format: $(INSTALLED)
	$(PRETTIER) --check --log-level warn .

## probe: run a dev/ probe in Playwright's Chromium (PROBE=probe-heats, Q= its query, PROBE_HOST= for make dev)
PROBE ?= probe
PROBE_HOST ?=
Q ?=
probe: $(INSTALLED)
	$(BROWSER)
	@node dev/probe.mjs '$(PROBE_HOST)' '$(PROBE)' '$(Q)'

## probes: run every probe that needs only the demo, four at a time (what CI runs)
probes: $(INSTALLED)
	$(BROWSER)
	node dev/probe.mjs '' all

## check-worker: check that the pinned wrangler builds dist/ and bundles worker.js, with no deploy
check-worker: $(INSTALLED)
	$(WRANGLER) deploy --dry-run

## deploy-ci: run the offline tests, then deploy (what Workers Builds runs on a push to main)
# It waits on the offline tests alone (docs/deployment.md, "The live site").
deploy-ci: test-offline $(INSTALLED)
	$(WRANGLER) deploy

## login: authenticate wrangler with Cloudflare (first time only)
login: $(INSTALLED)
	$(WRANGLER) login

## tail: stream live request logs from the deployed worker
tail: $(INSTALLED)
	$(WRANGLER) tail

# A push deploys main to the custom domains, and any other branch to a
# preview named after it (docs/deployment.md, "The live site"). PREVIEW_HOST
# is the preview's host, and it is empty on main.
BRANCH_ALIAS := $(shell git branch --show-current | tr -d '\n' | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-')
PREVIEW_HOST := $(if $(filter-out main,$(BRANCH_ALIAS)),$(BRANCH_ALIAS)-kisat.teemu-matilainen.workers.dev)

## open: open the live site in a browser
open:
	open https://kisat.matilainen.fi/

## open-juoksut: open the live site's Juoksut domain in a browser
open-juoksut:
	open https://juoksut.matilainen.fi/

## open-preview: open the branch's preview, or the live site on main
open-preview:
	open $(if $(PREVIEW_HOST),https://$(PREVIEW_HOST)/,https://kisat.matilainen.fi/)

# A preview host is a dev host, so ?mode= picks the mode (siteMode, lib/routes.js).
## open-juoksut-preview: open the branch's preview in Juoksut mode, or the Juoksut domain on main
open-juoksut-preview:
	open $(if $(PREVIEW_HOST),'https://$(PREVIEW_HOST)/?mode=juoksut',https://juoksut.matilainen.fi/)

# The branch's preview reads production's KV until PREVIEW_DATA says "own"
# (previewEnv, lib/routes.js). The secrets are the preview's, so no commit and
# no merge carries them. CRON_TOKEN_FILE keeps the token that POST /api/cron
# requires in this checkout alone
# (docs/deployment.md, "A preview with its own data").
CRON_TOKEN_FILE := .wrangler/cron-token/$(BRANCH_ALIAS)

## preview-own-data: move the branch's preview to the preview namespaces
preview-own-data: $(INSTALLED)
	@test -n "$(PREVIEW_HOST)" || { echo 'main has no preview'; exit 1; }
	@mkdir -p $(dir $(CRON_TOKEN_FILE))
	@(umask 077 && openssl rand -hex 32 | tr -d '\n' > $(CRON_TOKEN_FILE))
	$(WRANGLER) preview secret put CRON_TOKEN --name $(BRANCH_ALIAS) < $(CRON_TOKEN_FILE)
	printf own | $(WRANGLER) preview secret put PREVIEW_DATA --name $(BRANCH_ALIAS)

## preview-shared-data: move the branch's preview back to production's KV
preview-shared-data: $(INSTALLED)
	@test -n "$(PREVIEW_HOST)" || { echo 'main has no preview'; exit 1; }
	$(WRANGLER) preview secret delete PREVIEW_DATA --name $(BRANCH_ALIAS)
	$(WRANGLER) preview secret delete CRON_TOKEN --name $(BRANCH_ALIAS)
	rm -f $(CRON_TOKEN_FILE)

## preview-cron: run the cron's work on a preview with its own data (RUNS= for several rounds)
preview-cron:
	@test -n "$(PREVIEW_HOST)" || { echo 'main has no preview'; exit 1; }
	@test -s $(CRON_TOKEN_FILE) || { echo 'no cron token here, run make preview-own-data'; exit 1; }
	for i in $$(seq $(or $(RUNS),1)); do curl -fsS -X POST -H 'x-kisat-client: 1' -H "authorization: Bearer $$(cat $(CRON_TOKEN_FILE))" https://$(PREVIEW_HOST)/api/cron || exit 1; done

## cup-diff: compare a cup year's totals with the series' site, on the branch's deploy (YEAR=, ALL=1 for every club's rows)
cup-diff:
	node dev/cup-diff.mjs $(or $(YEAR),$(shell date +%Y)) $(or $(PREVIEW_HOST),kisat.matilainen.fi) $(if $(ALL),all)

## elsewhere-due: list the championships due a row in elsewhere.json, off the branch's deploy
elsewhere-due:
	node dev/elsewhere-due.mjs $(or $(PREVIEW_HOST),kisat.matilainen.fi)

## hotspots: list the code's size per area and its N most complex functions (N=)
hotspots: $(INSTALLED)
	node dev/hotspots.mjs $(N)

## shims-due: list the shims past their date in docs/shims.md
shims-due:
	node dev/shims-due.mjs

.PHONY: help serve dev build test test-offline test-render test-worker lint format check-format probe probes cup-diff elsewhere-due hotspots shims-due check-worker deploy-ci login tail open open-juoksut open-preview open-juoksut-preview preview-own-data preview-shared-data preview-cron
