// Runs probes in Playwright's Chromium for `make probe` and `make probes`.
// Exits 1 on a FAIL, THREW or ERROR line, or on a run that ends before the
// runner's DONE.
//   node dev/probe.mjs [host:port] <probe> [query]   one probe, line by line
//   node dev/probe.mjs '' all                         every probe in OFFLINE
// The driver serves the page itself (serve below), from disk or from a host
// such as make dev's. CHROMIUM= names a browser to use in place of
// Playwright's own.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// The probes that need neither make dev nor live data, with their queries.
// Each other probe's header says what it covers, its query, and the server or
// data it needs.
const OFFLINE = {
  'probe-heats': '',
  'probe-filter': 'url=c/demo',
  'probe-ottelu': '',
  'probe-cup': '',
  'probe-cupfinal': 'url=c/democupfinal',
  'probe-shared': '',
  'probe-pending': 'url=c/demo%23/a/i1-a&wait=1500',
  'probe-varmistus': '',
  'probe-refresh': 'w=700&h=300',
  'probe-layers': 'url=c/demo&wait=1500',
  'probe-ladder': '',
  'probe-measure': 'url=c/demo',
  'probe-laps': 'url=%3Fmode%3Djuoksut',
  'probe-hurdles': 'url=%3Fmode%3Djuoksut',
  'probe-aidat': 'url=%3Fmode%3Djuoksut',
};
// Four at a time keeps each probe's settle waits long enough on a laptop.
const PARALLEL = Number(process.env.PROBE_PARALLEL) || 4;
const TIMEOUT_MS = (Number(process.env.PROBE_TIMEOUT_S) || 600) * 1000;
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BAD = /: FAIL$|^THREW |^ERROR /;

const [host, which, query = ''] = process.argv.slice(2);
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
// one, public/ comes from disk as make serve gives it.
function serve(req, res) {
  const { pathname } = new URL(req.url, 'http://x');
  const root = pathname.startsWith('/dev/') ? REPO : host ? null : path.join(REPO, 'public');
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
      const upstream = await fetch(`http://${host}${req.url}`, {
        method: req.method,
        headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== 'host')),
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: 'manual',
      });
      const headers = Object.fromEntries(upstream.headers);
      // fetch has decoded the body already.
      delete headers['content-encoding'];
      delete headers['content-length'];
      if (headers['content-security-policy'])
        headers['content-security-policy'] = headers['content-security-policy'].replace(
          /frame-ancestors[^;]*;?\s*/,
          '',
        );
      if (headers.location) headers.location = headers.location.replace(`http://${host}`, origin);
      res.writeHead(upstream.status, headers).end(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      res.writeHead(502).end(String(err));
    }
  });
}
const server = http.createServer(serve);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
// localhost is a dev host (isDevHost, lib/routes.js).
const origin = `http://localhost:${server.address().port}`;

// Runs one probe in a context of its own and returns its lines. onLine sees
// each line as it comes.
async function runProbe(browser, probe, q, onLine = () => {}) {
  // The iframe has the phone's size (probe-runner.js), so the window only
  // needs to hold it.
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failed = 0;
try {
  if (which !== 'all') {
    const lines = await runProbe(browser, which, query || OFFLINE[which] || '', console.log);
    failed = lines.filter((l) => BAD.test(l)).length;
    if (lines.at(-1) !== 'DONE') console.error(lines.at(-1));
    else if (failed) console.error(`${failed} failed`);
  } else {
    const queue = Object.entries(OFFLINE);
    const worker = async () => {
      for (let next; (next = queue.shift());) {
        const [probe, q] = next;
        const started = Date.now();
        const lines = await runProbe(browser, probe, q);
        const bad = lines.filter((l) => BAD.test(l));
        if (bad.length) failed++;
        console.log(
          `${bad.length ? 'FAIL' : 'ok  '} ${probe.padEnd(16)} ${Math.round((Date.now() - started) / 1000)} s`,
        );
        for (const l of bad) console.log(`       ${l}`);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    console.log(failed ? `\n${failed} failed` : '\nall probes pass');
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
