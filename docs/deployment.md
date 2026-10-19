# Deployment

The Worker deploys from `main` to the live hosts and from any other branch to a preview. A fork
follows "A deployment of your own".

- `wrangler.jsonc`: the Worker's `name`, its custom domains under `routes`, its bindings and the
  `previews` block.
- `deploy-ci` (`Makefile`): the deploy, which builds `dist/` first.
- `PREVIEW_HOST` (`Makefile`): the host of the branch's preview.

## The live site

- **A push to `main` deploys to the live hosts.** Workers Builds runs `make deploy-ci` on it. The
  target waits on the offline tests alone, so a Tuloslista outage or a flaky port in the build
  sandbox cannot block a fix. CI runs the other checks on the same push.
- **`make deploy-ci` by hand deploys the checkout to the live hosts, whatever the branch.** Run
  `make login` first.
- **A push to any other branch deploys a preview at `PREVIEW_HOST`.** The preview binds production's
  KV and the same rate limiters, so a Watch made there is a real one.
- **The zone's WAF does not cover `workers.dev`.** On a preview, only the Worker's own header check
  and limiters hold.
- **`make tail` shows no preview's requests** (2026-09). The dashboard's Logs view shows them under
  `$workers.preview`.
- **The Workers Builds image runs pnpm 10.** It switches to the pnpm that `package.json` names, but
  it cannot switch to a pnpm 12 (2026-09).

## A preview with its own data

The scheduler calls no preview's `scheduled()` ([Cloudflare][preview-cron], 2026-10), so a preview
with its own data runs the cron's work on request.

- `make preview-own-data`: sets the preview's `PREVIEW_DATA` to `own` and a new `CRON_TOKEN`, which
  it keeps in `.wrangler/cron-token/`. Each run rotates the token, so a token kept by another
  checkout then gets a 403.
- `previewEnv` (`lib/routes.js`): swaps in `ROSTER_PREVIEW` and `WATCHES_PREVIEW`, which every such
  preview shares.
- `make preview-cron RUNS=12`: calls `POST /api/cron` with the token, one cron run a call.
- `make preview-shared-data`: moves the preview back to production's KV.

## A deployment of your own

1. **The Workers Paid plan.** A roster build on a cache miss costs a subrequest per event
   (`docs/backend.md`, "The roster"). On a large meet that passes the Free plan's 50 subrequests a
   request (2026-10). The meet crawler counts on the paid plan too (`docs/backend.md`, "The meet
   index").
2. **A zone on the same account**, for the custom domains. The Juoksut host's first label must be
   `juoksut`. A deploy with only the Kisat domain works, without the lap counter.
3. **Four KV namespaces**, created once:

   ```sh
   make login
   pnpm exec wrangler kv namespace create ROSTER
   pnpm exec wrangler kv namespace create WATCHES
   pnpm exec wrangler kv namespace create ROSTER_PREVIEW
   pnpm exec wrangler kv namespace create WATCHES_PREVIEW
   ```

   The ids of `ROSTER` and `WATCHES` replace those in both `kv_namespaces` and
   `previews.kv_namespaces`. The other two replace those in `previews.kv_namespaces` only.

4. **The names in the files.** Change each host and address that this grep finds, where `<zone>` is
   the zone of the hosts under `routes` in `wrangler.jsonc`:

   ```sh
   git grep -n <zone>
   ```

   The grep misses two places:
   - `wrangler.jsonc`: the Worker's `name` and the KV ids of step 3.
   - `PREVIEW_HOST` (`Makefile`): the Worker's `name` and the account's `workers.dev` subdomain.

   The tests name the live hosts only as examples and need no change.

5. **The deploy.** In the Worker's settings under Builds, connect the repository with
   `make deploy-ci` as the deploy command. Leave Preview builds on, with their command
   `npx wrangler preview`. With `npx wrangler versions upload` there, a branch's build fails with
   "The name in your wrangler.jsonc file must match the name of your Worker", even with the right
   name (2026-09).
6. **The WAF rules**, in the zone's dashboard under Security. One is a Rate Limiting rule on
   `/api/*` of both hosts, and `docs/backend.md`, "Abuse protection, layered", has its measured
   rate. The other is a Custom Rule with action Block and this expression, with the fork's hosts:

   ```
   (http.host in {"kisat.example.com" "juoksut.example.com"}) and
   starts_with(http.request.uri.path, "/api/") and
   (not any(http.request.headers["x-kisat-client"][*] eq "1"))
   ```

7. **A check of the result.** Each command should print the status after it.

   ```sh
   KISAT=https://kisat.example.com JUOKSUT=https://juoksut.example.com
   status() { curl -s -o /dev/null -w '%{http_code}\n' "$@"; }
   status "$KISAT/c/demo"                                            # 200
   status "$JUOKSUT/c/demo"                                          # 200
   status -H 'x-kisat-client: 1' "$KISAT/api/roster/demo"            # 200
   status "$KISAT/api/roster/demo"                                   # 403
   status -H 'x-kisat-client: 1' "$JUOKSUT/api/roster/demo"          # 404
   ```

   The front page's search finds older meets once the cron has run about a dozen times
   (`docs/backend.md`, "The meet index").

[preview-cron]: https://developers.cloudflare.com/workers/previews/resources/#cron-triggers
