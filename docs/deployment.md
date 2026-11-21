# Deployment

The Worker deploys from `main` to the live hosts, and from any other branch to a preview. The
preview targets of the `Makefile` act on the preview that `PREVIEW` names, which defaults to the
current branch's preview.

## The live site

- **A push to `main` deploys to the live hosts.** Workers Builds runs `make deploy-ci` on the push.
  The target runs only the offline tests before it deploys, so a Tuloslista outage or a flaky port
  in the build sandbox cannot block a fix. CI runs the other checks on the same push.
- **`make deploy-ci` run by hand deploys the checkout to the live hosts, on any branch.** Run
  `make login` first.
- **A push to any other branch deploys a preview at `PREVIEW_HOST`.** The preview uses the
  production KV namespaces and the same rate limiters, so a Watch created on a preview is a real
  Watch. `make deploy-preview` deploys the checkout to the preview without a push.
- **The zone's WAF does not cover `workers.dev`.** On a preview, only the Worker's own header check
  and rate limiters apply.
- **`make tail` does not show a preview's requests** (2026-09). The dashboard's Logs view shows them
  under `$workers.preview`.
- **Workers Builds cannot switch to pnpm 12** from the pnpm 10 in its image, though it switches to
  other versions that `package.json` names (2026-09).

## A preview with its own data

Cloudflare's scheduler never calls a preview's `scheduled()` handler ([Cloudflare][preview-cron],
2026-10). A preview with its own data therefore runs the cron's work through a request.

1. `make preview-own-data` moves the preview to the namespaces `ROSTER_PREVIEW` and
   `WATCHES_PREVIEW`, and sets a new `CRON_TOKEN`. Each run replaces the token, so another checkout
   that kept the old token gets a 403. All previews with their own data share these two namespaces.
2. `make preview-cron RUNS=12` calls `POST /api/cron` with the token, once per cron run.
3. `make preview-shared-data` moves the preview back to the production KV namespaces.

## A deployment of your own

1. **The Workers Paid plan.** On a cache miss, a roster build makes one subrequest per event
   (`docs/backend.md`, "The roster"). For a large meet, that exceeds the Free plan's limit of 50
   subrequests per request (2026-10). The meet crawler also needs the paid plan (`docs/backend.md`,
   "The meet index").
2. **A zone on the same account**, for the custom domains. The first label of the Juoksut host must
   be `juoksut`. A deployment with only the Kisat domain works, but it has no lap counter.
3. **Four KV namespaces**, created once:

   ```sh
   make login
   pnpm exec wrangler kv namespace create ROSTER
   pnpm exec wrangler kv namespace create WATCHES
   pnpm exec wrangler kv namespace create ROSTER_PREVIEW
   pnpm exec wrangler kv namespace create WATCHES_PREVIEW
   ```

   The ids of `ROSTER` and `WATCHES` replace the ids in both `kv_namespaces` and
   `previews.kv_namespaces`. The ids of the other two replace the ids in `previews.kv_namespaces`
   only.

4. **The host names in the files.** Change each host and address that this grep finds, where
   `<zone>` is the zone of the hosts under `routes` in `wrangler.jsonc`:

   ```sh
   git grep -n <zone>
   ```

   The grep misses two places:
   - `wrangler.jsonc`: the Worker's `name` and the KV ids from step 3.
   - `PREVIEW_HOST` (`Makefile`): the Worker's `name` and the account's `workers.dev` subdomain.

   The tests use the live hosts only as examples, so they need no change.

5. **The deploy.** In the Worker's settings under Builds, connect the repository and set the deploy
   command to `make deploy-ci`. Leave Preview builds on, with the command `npx wrangler preview`.
   With `npx wrangler versions upload` as that command, a branch's build fails with "The name in
   your wrangler.jsonc file must match the name of your Worker", even when the name is correct
   (2026-09).
6. **The WAF rules**, in the zone's dashboard under Security. The first is a Rate Limiting rule on
   `/api/*` of both hosts. Its measured rate is in `docs/backend.md`, "Abuse protection". The second
   is a Custom Rule with the action Block and this expression, with your own hosts:

   ```
   (http.host in {"kisat.example.com" "juoksut.example.com"}) and
   starts_with(http.request.uri.path, "/api/") and
   (not any(http.request.headers["x-kisat-client"][*] eq "1"))
   ```

7. **A check of the result.** Each command should print the status shown in its comment.

   ```sh
   KISAT=https://kisat.example.com JUOKSUT=https://juoksut.example.com
   status() { curl -s -o /dev/null -w '%{http_code}\n' "$@"; }
   status "$KISAT/c/demo"                                            # 200
   status "$JUOKSUT/c/demo"                                          # 200
   status -H 'x-kisat-client: 1' "$KISAT/api/roster/demo"            # 200
   status "$KISAT/api/roster/demo"                                   # 403
   status -H 'x-kisat-client: 1' "$JUOKSUT/api/roster/demo"          # 404
   ```

   The front page's search finds older meets after the cron has run about a dozen times
   (`docs/backend.md`, "The meet index").

## Web Analytics

The page loads Cloudflare's Web Analytics beacon on each host in `ANALYTICS_TOKENS`
(`lib/routes.js`).

- **The page adds the beacon, not the Worker.** Under `wrangler dev`, the Worker sees the first
  route's host in both `request.url` and the `Host` header (2026-11). A beacon added by the Worker
  would load on every local server, including the tests' servers.
- **Each host has a Web Analytics site of its own, with the manual setup.** In the account's Web
  Analytics page, add the host as a site, set it to "Enable with JS Snippet installation", and copy
  the `token` from its snippet into `ANALYTICS_TOKENS`.
- **The zone's automatic setup must stay off on these hosts**, because Cloudflare supports one
  beacon per page. On a Free zone, Cloudflare turns the automatic setup on for every host, for
  visitors outside the EU (2026-11). A Configuration Rule with "Disable Real User Monitoring (RUM)"
  for both hosts turns it off.
- **A deployment of your own** replaces the tokens with its own sites' tokens, or removes them.

[preview-cron]: https://developers.cloudflare.com/workers/previews/resources/#cron-triggers
