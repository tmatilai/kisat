// Renders the bundle's views in a headless browser over a local `wrangler
// dev`, which builds dist/ first. A route fails on an uncaught error, a failed
// request to the Worker, or a view that ends in its error notice.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = process.env.TEST_RENDER_PORT || 8935;
const BASE = `http://127.0.0.1:${PORT}`;
const WRANGLER = 'node_modules/.bin/wrangler';

// Each route names the module its view loads (VIEW_MODULES, lib/routes.js),
// and a module that no route loads fails the run. A start's key holds today's
// date, so `links` follows the page's own links, and each keeps the query.
// `blocked` renders with storage blocked, where reading `localStorage` throws,
// as it does in Chrome with site data blocked. `gone` renders a meet whose
// schedule and /properties answer 404, as Tuloslista answers for a meet that
// has vanished (docs/tuloslista-api.md, "The listing"). Its meet body answers
// nothing, so the Worker fetches nothing.
const GROUP = 'a[href^="/c/demo/g/"]';
const ROUTES = [
  { module: 'home', path: '/' },
  { module: 'meet', path: '/c/demo' },
  { module: 'meet', path: '/c/demo', blocked: true },
  { module: 'meet', path: '/c/1', gone: true },
  { module: 'event', path: '/c/demo', links: [GROUP] },
  { module: 'event', path: '/c/demo', links: ['a[href^="/c/demo/o/"]'] },
  { module: 'medals', path: '/c/demo/mitalit' },
  { module: 'cup', path: '/c/democup/cup' },
  { module: 'follow', path: '/c/demo#/a/i1-a' },
  { module: 'tables', path: '/mitat' },
  { module: 'tables', path: '/mitat#/valineet' },
  { module: 'measure', path: '/#/measure' },
  { module: 'hurdles', path: '/c/demo?mode=juoksut' },
  { module: 'laps', path: '/c/demo?mode=juoksut', links: [GROUP, 'a[href$="/laps"]'] },
];

const stateDir = mkdtempSync(join(tmpdir(), 'kisat-test-render-'));
const wrangler = spawn(WRANGLER, ['dev', '--port', String(PORT), '--persist-to', stateDir], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let wranglerOutput = '';
wrangler.stdout.on('data', (d) => (wranglerOutput += d));
wrangler.stderr.on('data', (d) => (wranglerOutput += d));

async function waitForReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (wrangler.exitCode != null) throw new Error(`wrangler dev exited early (code ${wrangler.exitCode})`);
    try {
      await fetch(`${BASE}/robots.txt`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`wrangler dev never became ready on ${BASE}`);
}

// Returns what went wrong while `page` loaded `path` and rendered its view.
async function render(page, path) {
  const problems = [];
  const local = (url) => url.startsWith(BASE);
  const onError = (err) => problems.push(`uncaught: ${err.message}`);
  const onConsole = (msg) => {
    if (msg.type() === 'error' && local(msg.location().url || BASE)) problems.push(`console: ${msg.text()}`);
  };
  const onResponse = (res) => {
    if (local(res.url()) && res.status() >= 400) problems.push(`${res.status()} ${res.url()}`);
  };
  // A navigation aborts the requests the page before it still had open, such
  // as its idle prefetch. A view whose own module fails ends in its error
  // notice, or never fills #updated.
  const onFailed = (req) => {
    const error = req.failure()?.errorText;
    if (local(req.url()) && error !== 'net::ERR_ABORTED') problems.push(`failed: ${req.url()} ${error}`);
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  try {
    await page.goto(`${BASE}${path}`);
    await page.locator('#updated:not(:empty)').waitFor({ state: 'attached', timeout: 15_000 });
    const notice = await page.locator('#app .notice.error').allTextContents();
    if (notice.length) problems.push(`error notice: ${notice.join(' ')}`);
  } catch (err) {
    problems.push(err.message.split('\n')[0]);
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
    page.off('response', onResponse);
    page.off('requestfailed', onFailed);
  }
  return problems;
}

let failed = 0;
let browser;
try {
  await waitForReady();
  const { modules } = JSON.parse(readFileSync('dist/modules.json', 'utf8'));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const context = await browser.newContext({ viewport: { width: 402, height: 787 } });
  // Tuloslista and the calendar feed, which the Worker builds from it, answer
  // an empty list, so the run stays offline.
  await context.route(
    (url) => url.origin !== BASE,
    (r) => r.fulfill({ json: [] }),
  );
  await context.route('**/calendar.json*', (r) => r.fulfill({ json: { comps: [] } }));
  for (const route of ROUTES) {
    const page = await context.newPage();
    if (route.blocked)
      await page.addInitScript(() => {
        for (const name of ['localStorage', 'sessionStorage'])
          Object.defineProperty(globalThis, name, {
            get() {
              throw new Error('Access is denied for this document.');
            },
          });
      });
    if (route.gone) {
      await page.route(/\/competition\/\d+(\/properties)?$/, (r) => r.fulfill({ status: 404, body: '' }));
      await page.route('**/api/meet/*', (r) => r.fulfill({ status: 204 }));
    }
    let path = route.path;
    for (const link of route.links ?? []) {
      await page.goto(`${BASE}${path}`);
      const href = await page.locator(link).first().getAttribute('href', { timeout: 15_000 });
      path = `${href}${new URL(path, BASE).search}`;
    }
    const problems = await render(page, path);
    await page.close();
    const label = `${path}${route.blocked ? ' (storage blocked)' : ''}${route.gone ? ' (gone)' : ''}`;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${route.module.padEnd(8)} ${label}`);
    for (const p of problems) console.log(`       ${p}`);
    if (problems.length) failed++;
  }
  const unvisited = Object.keys(modules).filter((name) => name !== 'demo' && !ROUTES.some((r) => r.module === name));
  if (unvisited.length) {
    console.log(`FAIL no route loads ${unvisited.join(', ')}`);
    failed++;
  }
} catch (err) {
  console.error(err);
  console.error(`\n--- wrangler dev output ---\n${wranglerOutput}`);
  failed++;
} finally {
  await browser?.close();
  wrangler.kill('SIGTERM');
  rmSync(stateDir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : '\nall routes render');
process.exit(failed ? 1 : 0);
