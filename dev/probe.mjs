// Runs probes in Playwright's Chromium for `make probe` and `make probes`.
// Exits 1 on a FAIL, THREW or ERROR line, or on a run that ends before the
// runner's DONE.
//   node dev/probe.mjs [host:port] <probe> [query]   one probe, line by line
//   node dev/probe.mjs '' all                         every probe, offline
// The driver serves the page itself (listen below), from disk or from a host
// such as make dev's. A probe of WORKER with no host runs on a wrangler dev of
// the driver's own. CHROMIUM= names a browser to use in place of Playwright's
// own.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { DIGEST_VERSION } from '../public/lib/digest.js';

// The probes that need only the demo, with their queries.
const OFFLINE = {
  'probe-heats': '',
  'probe-filter': 'url=c/demo',
  'probe-ottelu': '',
  'probe-cup': '',
  'probe-cupfinal': 'url=c/democupfinal',
  'probe-shared': '',
  'probe-pending': 'url=c/demo%23/a/i1-a',
  'probe-varmistus': '',
  'probe-refresh': 'w=700&h=300',
  'probe-layers': 'url=c/demo',
  'probe-ladder': '',
  'probe-measure': 'url=c/demo',
  'probe-laps': 'url=%3Fmode%3Djuoksut',
  'probe-hurdles': 'url=%3Fmode%3Djuoksut',
  'probe-aidat': 'url=%3Fmode%3Djuoksut',
  'probe-mode': 'url=%3Fmode%3Djuoksut',
};
// The probes that need the Worker, with their queries. They run on a wrangler
// dev over public/ whose KV starts as workerKv() writes it.
const WORKER = {
  probe: 'url=c/demo',
  'probe-club': 'url=c/demo',
  'probe-clubs': 'url=%23/',
  'probe-home': '',
  'probe-calendar': '',
  'probe-valineet': 'url=mitat%23%2Fvalineet',
  'probe-aitataulukko': 'url=mitat%3Fmode%3Djuoksut',
};
const PARALLEL = Number(process.env.PROBE_PARALLEL) || 4;
const TIMEOUT_MS = (Number(process.env.PROBE_TIMEOUT_S) || 600) * 1000;
// The Makefile lists this port beside the suites' own.
const WORKER_PORT = Number(process.env.PROBE_WORKER_PORT) || 8936;
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WRANGLER = path.join(REPO, 'node_modules/.bin/wrangler');
const BAD = /: FAIL$|^THREW |^ERROR /;

const [host, which, query = ''] = process.argv.slice(2);

// --- The offline Worker's data ---

// Meets dated from today. The scan finds the demo club in the first two, the
// third has nobody in it, and the fourth is past RECENT_DAYS (lib/home.js), so
// it stands behind "Näytä vanhemmat kilpailut" with no days from the feed. Its
// venue is Tuloslista's placeholder (docs/tuloslista-api.md, "The listing").
const MEETS = [
  {
    id: 99001,
    name: 'Kotikentän kisat',
    on: 0,
    days: [0],
    athletes: [['70000001', 1, 'Emma Mittainen', ['N Keihäs']]],
  },
  {
    id: 99002,
    name: 'Viikonlopun kisat',
    on: -3,
    days: [-3, -2],
    athletes: [['70000003', 1, 'Väinö Mittari', ['M 100m']]],
  },
  { id: 99003, name: 'Huomisen kisat', on: 1, days: [1], athletes: [] },
  { id: 99004, name: 'Vanhat kisat', on: -12, location: 'Kilpailupaikka' },
];
const dayFrom = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};
const isoDay = (offset) => dayFrom(offset).toLocaleDateString('sv-SE');
const fiDay = (offset) => dayFrom(offset).toLocaleDateString('fi-FI');
// Tuloslista's listing, which the browser fetches itself. Every other request
// that leaves the page's origin gets an empty list.
const LISTING = MEETS.map((m) => ({
  Id: m.id,
  Name: m.name,
  Date: `${isoDay(m.on)}T09:00:00+00:00`,
  Location: m.location ?? 'Mallila',
  OrganizationName: 'Demon Urheilijat',
}));
// elsewhere.json, with one meet that stands alone from yesterday, which home
// lists beside the listing (docs/home.md, "Meets that stand alone"). The real
// file's rows would come and go with the date.
const ELSEWHERE = {
  meets: [
    {
      id: `maastot-${isoDay(-1).slice(0, 4)}`,
      name: 'Testimaastot',
      location: 'Mallila',
      date: isoDay(-1),
      start: '11:00:00+03:00',
      ol: 'demo',
      classes: { 'N Maastojuoksu': 0 },
    },
  ],
};

// Writes the calendar, the digests and the two search indexes, so that the
// Worker answers the scan, the feed and a search with no fetch of its own. A
// meet in the calendar with no digest would be built from the live API.
function workerKv() {
  const now = Date.now();
  const year = String(new Date().getFullYear());
  const scanned = MEETS.filter((m) => m.days);
  const entries = {
    'cal:v1': {
      builtAt: now,
      comps: scanned.map((m) => ({
        id: m.id,
        name: m.name,
        location: 'Mallila',
        organizationName: 'Demon Urheilijat',
        date: isoDay(m.on),
        days: m.days.map(fiDay),
        daysAt: now,
      })),
    },
    'orgs:v1': {
      v: 1,
      orgs: [
        ['1', 'Demon Urheilijat', 'DemU'],
        ['2', 'Malliseura', 'MalV'],
      ],
    },
    'athletes:v1': {
      v: 1,
      athletes: [
        ['70000001', '1', 'Emma Mittainen', year],
        ['70000003', '1', 'Väinö Mittari', year],
      ],
    },
  };
  for (const m of scanned)
    entries[`digest:${m.id}`] = {
      builtAt: now,
      digest: { v: DIGEST_VERSION, days: m.days.map(fiDay), orgs: [[1, 'DemU']], teams: [], athletes: m.athletes },
    };
  return Object.entries(entries).map(([key, value]) => ({ key, value: JSON.stringify(value) }));
}

// Starts a wrangler dev over public/ with workerKv() in a state of its own,
// and returns its host and a stop().
async function startWorker() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'kisat-probes-'));
  const stop = () => fs.rmSync(state, { recursive: true, force: true });
  const bulk = path.join(state, 'kv.json');
  fs.writeFileSync(bulk, JSON.stringify(workerKv()));
  const put = spawnSync(WRANGLER, ['kv', 'bulk', 'put', bulk, '--binding=ROSTER', '--local', '--persist-to', state], {
    cwd: REPO,
    encoding: 'utf8',
  });
  if (put.status !== 0) {
    stop();
    throw new Error(`seeding KV failed: ${put.stderr || put.stdout}`);
  }
  const dev = spawn(WRANGLER, ['dev', '--port', String(WORKER_PORT), '--persist-to', state, '--assets', 'public'], {
    cwd: REPO,
    stdio: 'ignore',
  });
  const workerHost = `127.0.0.1:${WORKER_PORT}`;
  const done = () => {
    dev.kill('SIGTERM');
    stop();
  };
  for (const deadline = Date.now() + 60_000; ;) {
    if (dev.exitCode != null || Date.now() > deadline) {
      done();
      throw new Error(`wrangler dev never answered on ${workerHost}`);
    }
    try {
      await fetch(`http://${workerHost}/robots.txt`);
      return { host: workerHost, stop: done };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

// --- Serving the page ---

// The same types make serve's server gives.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function fileAt(root, pathname) {
  const file = path.join(root, decodeURIComponent(pathname));
  if (!file.startsWith(root)) return null;
  const index = path.join(file, 'index.html');
  if (fs.existsSync(index)) return index;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

// Serves dev/ from disk, since make dev serves public/ alone. With a host, the
// rest goes to it, a redirect included, and each answer loses the deployed
// _headers' frame-ancestors, which refuses every iframe of the app. Without
// one, public/ comes from disk as make serve gives it. Returns the server and
// its origin.
async function listen(upstream) {
  let origin = '';
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    const root = pathname.startsWith('/dev/') ? REPO : upstream ? null : path.join(REPO, 'public');
    if (root) {
      const file = fileAt(root, pathname);
      if (!file) return res.writeHead(404).end('Not Found');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const answer = await fetch(`http://${upstream}${req.url}`, {
          method: req.method,
          headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== 'host')),
          body: chunks.length ? Buffer.concat(chunks) : undefined,
          redirect: 'manual',
        });
        const headers = Object.fromEntries(answer.headers);
        // fetch has decoded the body already.
        delete headers['content-encoding'];
        delete headers['content-length'];
        if (headers['content-security-policy'])
          headers['content-security-policy'] = headers['content-security-policy'].replace(
            /frame-ancestors[^;]*;?\s*/,
            '',
          );
        if (headers.location) headers.location = headers.location.replace(`http://${upstream}`, origin);
        res.writeHead(answer.status, headers).end(Buffer.from(await answer.arrayBuffer()));
      } catch (err) {
        res.writeHead(502).end(String(err));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // localhost is a dev host (isDevHost, lib/routes.js).
  origin = `http://localhost:${server.address().port}`;
  return { server, origin };
}

// Runs one probe in a context of its own and returns its lines. onLine sees
// each line as it comes. An offline run answers every request that leaves
// origin itself, LISTING for the listing and an empty list for the rest, and
// serves ELSEWHERE for elsewhere.json.
async function runProbe(browser, origin, probe, q, { offline = false, onLine = () => {} } = {}) {
  // The iframe has the phone's size (probe-runner.js), so the window only
  // needs to hold it.
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  if (offline) {
    await context.route(
      (url) => url.origin !== origin,
      (r) => r.fulfill({ json: /\/competition$/.test(new URL(r.request().url()).pathname) ? LISTING : [] }),
    );
    await context.route(`${origin}/data/elsewhere.json`, (r) => r.fulfill({ json: ELSEWHERE }));
  }
  const lines = [];
  const done = new Promise((resolve) =>
    context.exposeFunction('probeLine', (line) => {
      lines.push(line);
      onLine(line);
      if (line === 'DONE') resolve();
    }),
  );
  const url = `${origin}/dev/probe.html?probe=${probe}${q ? `&${q}` : ''}`;
  try {
    const page = await context.newPage();
    await page.goto(url);
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS))]);
  } finally {
    await context.close();
  }
  if (lines.at(-1) !== 'DONE')
    lines.push(`ERROR ${url} stopped before DONE: the server is down, or the probe outran PROBE_TIMEOUT_S.`);
  return lines;
}

// --- The run ---

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const servers = [];
let worker = null;
let failed = 0;
try {
  if (which !== 'all') {
    // A Worker probe with no host gets the offline Worker.
    const own = !host && which in WORKER;
    if (own) worker = await startWorker();
    const { server, origin } = await listen(own ? worker.host : host);
    servers.push(server);
    const lines = await runProbe(browser, origin, which, query || OFFLINE[which] || WORKER[which] || '', {
      offline: own,
      onLine: console.log,
    });
    failed = lines.filter((l) => BAD.test(l)).length;
    if (lines.at(-1) !== 'DONE') console.error(lines.at(-1));
    else if (failed) console.error(`${failed} failed`);
  } else {
    // The Worker starts while the demo's probes run.
    const disk = await listen('');
    servers.push(disk.server);
    const workerOrigin = startWorker().then(async (w) => {
      worker = w;
      const served = await listen(w.host);
      servers.push(served.server);
      return served.origin;
    });
    workerOrigin.catch(() => {});
    const queue = [
      ...Object.entries(OFFLINE).map(([probe, q]) => [probe, q, async () => disk.origin]),
      ...Object.entries(WORKER).map(([probe, q]) => [probe, q, () => workerOrigin]),
    ];
    const next = async () => {
      for (let item; (item = queue.shift());) {
        const [probe, q, originOf] = item;
        const started = Date.now();
        let lines;
        try {
          lines = await runProbe(browser, await originOf(), probe, q, { offline: true });
        } catch (err) {
          lines = [`ERROR ${err.message}`];
        }
        const bad = lines.filter((l) => BAD.test(l));
        if (bad.length) failed++;
        console.log(
          `${bad.length ? 'FAIL' : 'ok  '} ${probe.padEnd(18)} ${Math.round((Date.now() - started) / 1000)} s`,
        );
        for (const l of bad) console.log(`       ${l}`);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, next));
    console.log(failed ? `\n${failed} failed` : '\nall probes pass');
  }
} finally {
  await browser.close();
  for (const server of servers) server.close();
  worker?.stop();
}
process.exit(failed ? 1 : 0);
