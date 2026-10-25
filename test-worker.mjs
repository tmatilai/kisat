// Spawns `wrangler dev` with a throwaway KV and drives worker.js over HTTP.
// CI runs it (AGENTS.md, "Checking a change").
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// A listed meet's keys carry elsewhereTag, so the seeded keys compute it. A
// tag spelled by hand would miss after a bump and send the route to a build.
import elsewhere from './public/data/elsewhere.json' with { type: 'json' };
import { elsewhereTag } from './public/lib/elsewhere.js';
import { DIGEST_VERSION } from './public/lib/digest.js';

const PORT = process.env.TEST_WORKER_PORT || 8933;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADERS = { 'content-type': 'application/json', 'x-kisat-client': '1' };
// package.json pins the version, and `make test-worker` installs it.
const WRANGLER = 'node_modules/.bin/wrangler';

// Each run keeps its KV in a throwaway directory, apart from `make dev`'s.
const stateDir = mkdtempSync(join(tmpdir(), 'kisat-test-worker-'));

// --- Scan fixtures, seeded into local KV before wrangler dev starts ---
// Miniflare reads its state at startup, so a key written while it runs is
// not seen. The seeded calendar and digests let a default scan fetch nothing.
const SCAN_DAY = '2026-08-08';
// The build=1 scans ask about this day. Its window holds testi-7 alone, which
// COMP_ID_RE skips, so they spend SCAN_LIMITER tokens and fetch nothing.
const BUILD_DAY = '2026-04-15';
const SCAN_LICENCE = '70000001';
// It has the current layout. worker.js reads a digest of any other version
// as missing, which 99006's v1 digest tests.
const SCAN_DIGEST = {
  v: DIGEST_VERSION,
  days: ['8.8.2026'],
  orgs: [
    [1, 'DemU'],
    [2, 'MalV'],
  ],
  teams: [[1, 'Demon Urheilijat', ['N 4x100m viesti']]],
  athletes: [
    [SCAN_LICENCE, 1, 'Emma Mittainen', ['N Keihäs', 'N Kuula']],
    ['70000002', 2, 'Nea Merkkinen', ['N Keihäs']],
  ],
};
// isStale reads a digest's own days, not the calendar's, so each seeded
// digest carries its own meet's day.
const SCAN_DIGEST_99005 = { ...SCAN_DIGEST, days: ['20.8.2026'] };
const SCAN_DIGEST_V1 = { ...SCAN_DIGEST, v: 1, days: ['10.8.2026'] };
const SCAN_CALENDAR = {
  builtAt: Date.now(),
  comps: [
    // Only this row carries organizationName. A stored calendar may lack it,
    // and the feed answers the field either way.
    {
      id: 99001,
      name: 'Digestikisat',
      location: 'Testilä',
      organizationName: 'Testilän Kisa',
      date: '2026-08-08',
      days: ['8.8.2026'],
      daysAt: Date.now(),
    },
    // It has no digest, which is the pending case.
    { id: 'testi-2', name: 'Skannaamaton', location: '', date: '2026-08-09', days: ['9.8.2026'], daysAt: Date.now() },
    {
      id: 99003,
      name: 'Ikkunan ulkopuolella',
      location: '',
      date: '2026-07-01',
      days: ['1.7.2026'],
      daysAt: Date.now(),
    },
    // It is five weeks after SCAN_DAY, so only the window's wider future side
    // takes it in (CAL_WINDOW_FUTURE_DAYS, worker.js).
    { id: 99004, name: 'Syyskuun kisat', location: '', date: '2026-09-15', days: ['15.9.2026'], daysAt: Date.now() },
    // Its digest is past its freshness window (STALE_BUILT_AT). The matches
    // still come back, flagged stale.
    {
      id: 99005,
      name: 'Vanhentunut digesti',
      location: 'Testikylä',
      date: '2026-08-20',
      days: ['20.8.2026'],
      daysAt: Date.now(),
    },
    // Its digest has another DIGEST_VERSION, which must read as not scanned yet.
    {
      id: 99006,
      name: 'Vanha digestiversio',
      location: '',
      date: '2026-08-10',
      days: ['10.8.2026'],
      daysAt: Date.now(),
    },
    // It runs on BUILD_DAY, over 60 days from every other row and from 2026-01-01.
    { id: 'testi-7', name: 'Huhtikuun kisat', location: '', date: BUILD_DAY, days: ['15.4.2026'], daysAt: Date.now() },
  ],
};
// This builtAt is past both freshness windows (isStale, worker.js), since
// which one applies depends on the day the suite runs.
const STALE_BUILT_AT = Date.now() - 8 * 24 * 60 * 60 * 1000;
// Only a build writes the club index (mergeOrgIndex, lib/indexes.js). The merge
// stores its rows sorted by name.
const ORG_INDEX = {
  v: 1,
  orgs: [
    ['1', 'Demon Urheilijat', 'DemU'],
    ['2', 'Malliseura', 'MalV'],
  ],
};

const SEASON_YEAR = new Date().toISOString().slice(0, 4);

// The picker searches the athlete index (mergeAthleteIndex, lib/indexes.js). Emma
// Mittainen is also in 99001's digest under another club, and a search with
// that meet open must answer with her entry there.
const ATHLETE_INDEX = {
  v: 1,
  athletes: [
    [SCAN_LICENCE, '2', 'Emma Mittainen', SEASON_YEAR],
    ['70000003', '1', 'Väinö Mittari', SEASON_YEAR],
  ],
};
// Ten days back, a finished record is stale but not settled (recordSettled).
const STALE_DAY = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
// Only the cron writes the meet index (mergeMeetIndex, lib/indexes.js). The medal
// years have a fresh record, a pending meet, a stale record and a meet
// over without a medal. The cup's year has a record, a 9-year-olds' meet,
// democup and a final. A build skips the testi- ids (COMP_ID_RE).
const MEET_INDEX = {
  v: 1,
  meets: [
    ['99001', 'Digestikisat', '2026-08-08', 'Testilä', 'Testilän Kisa'],
    ['16500', 'Talvikisat', '2025-02-01', '', 'Demon Urheilijat'],
    ['99101', 'Helsy:n pm-kilpailut', `${SEASON_YEAR}-06-01`, '', 'Demon Urheilijat'],
    ['testi-s1', 'Helsy:n pm-viestit', `${SEASON_YEAR}-08-01`, '', 'Demon Urheilijat'],
    ['testi-s2', 'Eteläisen alueen aluemestaruuskilpailut', STALE_DAY, '', 'Malliseura'],
    ['testi-s3', 'Helsy:n pm-maastot', `${SEASON_YEAR}-01-01`, '', 'Demon Urheilijat'],
    ['testi-c1', 'Helsy:n Seuracup 9v lajit', `${SEASON_YEAR}-06-10`, '', 'Demon Urheilijat'],
    ['testi-c2', 'Seuracup I - Helsy, UudY', `${SEASON_YEAR}-06-02`, '', 'Demon Urheilijat'],
    ['democup', 'Helsy:n Seuracup II', `${SEASON_YEAR}-06-20`, '', 'Demon Urheilijat'],
    ['testi-c3', 'Seuracup A-sarjan finaali', `${SEASON_YEAR}-08-29`, '', 'Malliseura'],
  ],
  crawl: { next: 18000 },
};
// medalSeasonRecord builds this shape. The second start has no piiri medal.
const MEDAL_SEASON_RECORD = {
  builtAt: Date.now(),
  lastDay: `${SEASON_YEAR}-06-01`,
  starts: [
    {
      start: { EventName: 'P15 Pituus', Age: '15' },
      scoped: [
        ['etelainen', [['1', 1]]],
        [
          'helsy',
          [
            ['1', 1],
            ['2', 2],
          ],
        ],
      ],
    },
    { start: { EventName: 'M 100m', Age: '0' }, scoped: [['etelainen', [['2', 1]]]] },
  ],
  names: [
    ['1', 'Demon Urheilijat'],
    ['2', 'Malliseura'],
  ],
  athletes: [['a1', 'Aino Esimerkki', '111']],
  unknown: ['Harjoituspiirin Urheilijat'],
};

// cupSeasonRecord builds this shape. One row is a relay's.
const CUP_SEASON_RECORD = {
  builtAt: Date.now(),
  lastDay: `${SEASON_YEAR}-06-02`,
  final: false,
  clubs: [
    {
      id: '1',
      name: 'Demon Urheilijat',
      rank: 1,
      points: 1570,
      rows: [
        {
          club: '1',
          licence: '70000111',
          name: 'Aino Esimerkki',
          event: 'T11 60m',
          group: 'g1',
          place: 1,
          field: 6,
          result: '9,12',
          points: 820,
        },
        {
          club: '1',
          licence: null,
          name: 'Demon Urheilijat',
          event: 'T13 4x100m viesti',
          group: 'g2',
          place: 2,
          field: 4,
          result: '55,12',
          points: 750,
        },
      ],
    },
    {
      id: '2',
      name: 'Malliseura',
      rank: 2,
      points: 610,
      rows: [
        {
          club: '2',
          licence: '70000222',
          name: 'Eero Esimerkki',
          event: 'P11 60m',
          group: 'g3',
          place: 3,
          field: 6,
          result: '9,40',
          points: 610,
        },
      ],
    },
  ],
};

function seedKv(key, value, dir = stateDir) {
  const r = spawnSync(
    WRANGLER,
    ['kv', 'key', 'put', '--binding=ROSTER', '--local', '--persist-to', dir, key, JSON.stringify(value)],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`seeding ${key} failed: ${r.stderr || r.stdout}`);
}
seedKv('cal:v1', SCAN_CALENDAR);
seedKv('digest:99001', { builtAt: Date.now(), digest: SCAN_DIGEST });
seedKv('digest:99005', { builtAt: STALE_BUILT_AT, digest: SCAN_DIGEST_99005 });
seedKv('digest:99006', { builtAt: Date.now(), digest: SCAN_DIGEST_V1 });
seedKv('orgs:v1', ORG_INDEX);
seedKv('athletes:v1', ATHLETE_INDEX);
seedKv('meets:v1', MEET_INDEX);
seedKv('medalseason:v4:99101', MEDAL_SEASON_RECORD);
seedKv('cupseason:v2:testi-c2', CUP_SEASON_RECORD);
// The year leaves out a meet over with no medal (medalSeasonMeetEmpty).
seedKv('medalseason:v4:testi-s3', {
  builtAt: Date.now(),
  lastDay: `${SEASON_YEAR}-01-01`,
  starts: [],
  names: [],
  unknown: [],
});
seedKv('medalseason:v4:testi-s2', {
  builtAt: STALE_BUILT_AT,
  lastDay: STALE_DAY,
  starts: [{ start: { EventName: 'N 100m', Age: '0' }, scoped: [['etelainen', [['2', 3]]]] }],
  names: [['2', 'Malliseura']],
  unknown: [],
});
// This /api/meet body is cached for a meet that is neither a cup nor a
// confirmer. A miss would read /properties from Tuloslista.
seedKv('meet:99001', {
  builtAt: Date.now(),
  body: { cup: false, confirm: null },
  stats: { eventsTotal: 0, eventsFailed: 0, failedStatuses: {} },
});
// loadMeetRow writes this row for an id that Tuloslista answers with 404.
seedKv('meta:99009', { row: null });

// A medal build keeps one event of a meet whose results are on another site
// (putResults, worker.js). The route answers 404 for a meet elsewhere.json
// does not list, so the meet is the file's first t4r row.
const LISTED_COMP = String(elsewhere.meets.find((m) => m.t4r).comp);
const LISTED_EVENT_ID = '900001';
const LISTED_EVENT = {
  Id: LISTED_EVENT_ID,
  Name: 'M 100 m',
  Enrollments: [{ Name: 'Väinö Mittari', Organization: { Id: 1, Name: 'Demon Urheilijat' } }],
  Rounds: [
    {
      Id: '1',
      Name: 'Loppukilpailu',
      Status: 'Official',
      RoundTypeCategory: 'Final',
      Heats: [{ Index: 0, Allocations: [{ Id: 'a1', Name: 'Väinö Mittari', ResultRank: 1, Result: '10,55' }] }],
    },
  ],
};
seedKv(`results:v2:${LISTED_COMP}:${LISTED_EVENT_ID}${elsewhereTag(elsewhere, LISTED_COMP)}`, {
  builtAt: Date.now(),
  data: LISTED_EVENT,
});
// The same build also keeps the meet's grafted schedule.
const LISTED_SCHEDULE = {
  '1.1.2026': [
    {
      Id: '1',
      EventId: LISTED_EVENT_ID,
      EventName: 'M 100 m',
      Name: 'Loppukilpailu',
      Category: 'Track',
      Status: 'Official',
      BeginDateTimeWithTZ: '2026-01-01T12:00:00+00:00',
    },
  ],
};
seedKv(`schedule:v1:${LISTED_COMP}${elsewhereTag(elsewhere, LISTED_COMP)}`, {
  builtAt: Date.now(),
  data: LISTED_SCHEDULE,
});

// A build writes this medal record for a championship with no meet on
// Tuloslista. Its id is not a number, so every route finds the row in the
// file (elsewhereRow).
const ALONE_ROW = elsewhere.meets.find((m) => m.id && m.ol);
const ALONE_BODY = {
  table: [{ id: '1', name: 'Demon Urheilijat', medals: [1, 0, 0], total: 1 }],
  scopes: [],
  unknown: [],
  defaults: [],
  starts: [],
  athletes: [],
  names: {},
};
seedKv(`medals:v9:${ALONE_ROW.id}${elsewhereTag(elsewhere, ALONE_ROW.id)}`, {
  builtAt: Date.now(),
  body: ALONE_BODY,
  stats: { eventsTotal: 0, eventsFailed: 0, failedStatuses: {} },
});
// The same build keeps the race's schedule, with each class's own start.
const ALONE_SCHEDULE = {
  '1.1.2026': [{ ...LISTED_SCHEDULE['1.1.2026'][0], Id: 'ol-0', EventId: 'ol-0', EventName: 'N Maraton' }],
};
seedKv(`schedule:v1:${ALONE_ROW.id}${elsewhereTag(elsewhere, ALONE_ROW.id)}`, {
  builtAt: Date.now(),
  data: ALONE_SCHEDULE,
});

function api(path, opts = {}) {
  return fetch(`${BASE}${path}`, { ...opts, headers: { ...HEADERS, ...opts.headers } });
}

async function waitForReady(proc, base, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) throw new Error(`wrangler dev exited early (code ${proc.exitCode})`);
    try {
      await fetch(`${base}/`);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`wrangler dev never became ready on ${base}: ${lastErr}`);
}

const wrangler = spawn(WRANGLER, ['dev', '--port', String(PORT), '--persist-to', stateDir], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let wranglerOutput = '';
wrangler.stdout.on('data', (d) => {
  wranglerOutput += d;
});
wrangler.stderr.on('data', (d) => {
  wranglerOutput += d;
});

// The Juoksut host's and the preview's dev servers start only when the tests
// reach them, and shutdown kills them however they end.
const moreDevs = [];
const moreStates = [];

function shutdown() {
  wrangler.kill('SIGTERM');
  for (const dev of moreDevs) dev.kill('SIGTERM');
  rmSync(stateDir, { recursive: true, force: true });
  for (const dir of moreStates) rmSync(dir, { recursive: true, force: true });
}

async function startMoreDev(args, port) {
  const dev = spawn(WRANGLER, ['dev', '--port', String(port), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  moreDevs.push(dev);
  dev.stdout.on('data', (d) => {
    wranglerOutput += d;
  });
  dev.stderr.on('data', (d) => {
    wranglerOutput += d;
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForReady(dev, base);
  return base;
}

try {
  await waitForReady(wrangler, BASE);
  console.log(`wrangler dev up on ${BASE}`);

  // --- /demo: the vanity path for a demo competition ---
  // It sends no client header, since the path is typed into an address bar.
  {
    const r = await fetch(`${BASE}/demo`, { redirect: 'manual' });
    assert.equal(r.status, 302, 'temporary, so the address on the far end stays app-owned');
    assert.equal(new URL(r.headers.get('location')).pathname, '/c/demo');
    assert.equal(
      new URL(r.headers.get('location')).origin,
      BASE,
      'redirects to the host that was asked, so the juoksut domain lands in its own mode',
    );
    const slash = await fetch(`${BASE}/demo/`, { redirect: 'manual' });
    assert.equal(slash.status, 302, 'a trailing slash is the same address');
    const moded = await fetch(`${BASE}/demo?mode=juoksut`, { redirect: 'manual' });
    const to = new URL(moded.headers.get('location'));
    assert.equal(to.pathname, '/c/demo');
    assert.equal(to.search, '?mode=juoksut', 'the query rides along (siteMode reads it at boot)');
    // Any other method falls through to the assets binding.
    const posted = await fetch(`${BASE}/demo`, { method: 'POST', redirect: 'manual' });
    assert.notEqual(posted.status, 302, 'only a navigation is redirected');

    for (const id of ['democup', 'democupfinal']) {
      const cup = await fetch(`${BASE}/${id}`, { redirect: 'manual' });
      assert.equal(cup.status, 302, id);
      assert.equal(new URL(cup.headers.get('location')).pathname, `/c/${id}`);
      assert.equal(
        (await fetch(`${BASE}/${id}/`, { redirect: 'manual' })).status,
        302,
        'a trailing slash is the same address here too',
      );
    }
  }
  console.log('/demo redirect ok');

  // --- A meet's path: the document, with the link preview naming the meet ---
  // No meet path is a file, so wrangler dev reaches the Worker whatever
  // run_worker_first (wrangler.jsonc) lists. The seeded calendar, the fixture
  // and meta:99009 answer these paths, so none reaches Tuloslista.
  {
    const demo = await fetch(`${BASE}/c/demo`);
    assert.equal(demo.status, 200);
    const demoText = await demo.text();
    assert.match(demoText, /<title>Testikilpailu · Kisat<\/title>/);
    assert.match(demoText, /property="og:title" content="Testikilpailu · Kisat"/);
    assert.match(demoText, /property="og:site_name" content="Kisat"/, 'the site stays the site');
    assert.equal(demo.headers.get('x-meet-meta'), 'demo');
    // A meet's document preloads the chunks app.js imports on demand for it,
    // and a demo's adds demo.js's (routeModules, modules.json). (Break on
    // purpose: skip preloadModules.)
    assert.match(demoText, /<link rel="modulepreload" href="\/assets\/meet-\w+\.js" \/>/);
    assert.match(demoText, /<link rel="modulepreload" href="\/assets\/demo-\w+\.js" \/>/);
    // Every view of the meet gets the same tags, since a messaging app
    // caches a preview for days (docs/backend.md).
    const start = await fetch(`${BASE}/c/demo/g/2026-08-08T12%3A00%3A00%2B03%3A00%7CKuula`);
    assert.equal(start.status, 200);
    assert.match(await start.text(), /<title>Testikilpailu · Kisat<\/title>/);
    assert.equal((await fetch(`${BASE}/c/democup/cup`, { method: 'HEAD' })).status, 200);
    assert.equal(
      (await fetch(`${BASE}/c/demo/k/demola-mallikentta`)).status,
      200,
      'the kenttä link is a meet path too',
    );

    // A listed meet takes the calendar's row with no fetch and caches it.
    // (Break on purpose: skip the calendar read and this gets the plain
    // tags.)
    const listed = await fetch(`${BASE}/c/99001`);
    assert.equal(listed.status, 200);
    const listedText = await listed.text();
    assert.match(listedText, /<title>Digestikisat · Kisat<\/title>/);
    assert.match(listedText, /name="description" content="Testilä · Testilän Kisa · 8.8.2026"/);
    assert.match(listedText, /property="og:description" content="Testilä · Testilän Kisa · 8.8.2026"/);
    assert.equal(listed.headers.get('x-meet-meta'), 'miss');
    assert.doesNotMatch(listedText, /demo\.js/, 'a real meet loads no demo');
    assert.equal((await fetch(`${BASE}/c/99001/d/2026-08-08`)).headers.get('x-meet-meta'), 'hit');

    // A malformed id and a known 404 (meta:99009) get the site's own tags
    // and spend nothing.
    for (const path of ['/c/abc', '/c/99009', '/c/99001/nonsense']) {
      const r = await fetch(`${BASE}${path}`);
      assert.equal(r.status, 200, path);
      assert.match(await r.text(), /<title>Kisat<\/title>/, path);
      assert.equal(r.headers.get('x-meet-meta'), 'none', path);
    }
    assert.match(
      await (await fetch(`${BASE}/c/99001?mode=juoksut`)).text(),
      /<title>Digestikisat · Kisat<\/title>/,
      "the identity is the host's, never the query's",
    );
    assert.doesNotMatch(listedText, /href="\/assets\/hurdles-/, 'a Kisat page never loads the hurdle setups');
    // A meet that stands alone is named off the file with no fetch. (Break on
    // purpose: drop loadMeetRow's elsewhere branch.)
    const aloneMeet = await fetch(`${BASE}/c/${ALONE_ROW.id}`);
    assert.equal(aloneMeet.headers.get('x-meet-meta'), 'elsewhere');
    assert.ok((await aloneMeet.text()).includes(`<title>${ALONE_ROW.name} · Kisat</title>`), 'the row names the page');
  }
  console.log('meet paths ok');

  // --- The identity assets, Kisat's half: one deploy, two custom domains ---
  // The manifest and the two icons differ per host (siteAssetPath, lib/routes.js).
  // This server answers as wrangler.jsonc's first route, the Kisat host. A
  // browser sends no client header for these.
  {
    const manifest = await fetch(`${BASE}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).name, 'Kisat');

    const icon = await fetch(`${BASE}/icon.svg`);
    assert.match(await icon.text(), /viewBox="0 0 64 64"/, "Kisat's own stopwatch");

    // iOS asks the site root for this icon, and only Juoksut's manifest names
    // it. Kisat has none.
    const png = await fetch(`${BASE}/apple-touch-icon.png`);
    assert.equal(png.status, 404, 'Kisat has no touch icon');
  }
  console.log('identity assets (kisat host) ok');

  // --- x-kisat-client gate applies to /api/watch too, not just /api/roster ---
  {
    const r = await fetch(`${BASE}/api/watch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 403, 'missing x-kisat-client must be rejected before routing even looks at the body');
  }
  console.log('client-header gate ok');

  // --- POST /api/watch: validation ---
  {
    const noEntries = await api('/api/watch', { method: 'POST', body: JSON.stringify({ label: 'x' }) });
    assert.equal(noEntries.status, 400, 'entries is the whole body and must be present');

    const badEntries = await api('/api/watch', { method: 'POST', body: JSON.stringify({ entries: 'nope' }) });
    assert.equal(badEntries.status, 400, 'entries must be an array');

    const badEntry = await api('/api/watch', {
      method: 'POST',
      body: JSON.stringify({ entries: [{ type: 'friend', id: '1' }] }),
    });
    assert.equal(badEntry.status, 400, 'an invalid entry type must be rejected');

    const huge = await api('/api/watch', {
      method: 'POST',
      body: JSON.stringify({ entries: [{ type: 'club', id: '1', name: 'x'.repeat(70_000) }] }),
    });
    assert.equal(huge.status, 413, 'a body over WATCH_MAX_BODY_BYTES is refused unread');

    const chunked = await api('/api/watch', {
      method: 'POST',
      body: new Blob([JSON.stringify({ entries: [] })]).stream(),
      duplex: 'half',
    });
    assert.equal(chunked.status, 411, 'a body with no content-length is refused unread');
  }
  console.log('POST /api/watch validation ok');

  // --- A Watch's lifecycle: create, get, update and get again ---
  let id, editToken;
  {
    const create = await api('/api/watch', {
      method: 'POST',
      body: JSON.stringify({
        // An athlete entry's id is a LicenseId, the same in every competition
        // (docs/backend.md).
        label: 'Testiseuranta',
        entries: [{ type: 'athlete', id: '60000001', name: 'Emma Mittainen', enabled: true }],
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.equal(
      created.competitionId,
      undefined,
      'a Watch is not tied to a competition any more — nothing may reintroduce one',
    );
    assert.equal(created.v, 2, 'the stored shape is versioned, so a v1 record is refused rather than misread');
    assert.equal(created.entries.length, 1);
    assert.ok(created.id, 'a created Watch carries its id');
    assert.ok(created.editToken, 'a created Watch carries its editToken — the only response that ever does');
    ({ id, editToken } = created);
  }
  console.log('POST /api/watch create ok');

  {
    const get = await api(`/api/watch/${id}`);
    assert.equal(get.status, 200);
    const watch = await get.json();
    assert.equal(watch.label, 'Testiseuranta');
    assert.equal(watch.editToken, undefined, 'GET must never leak the editToken to a viewer');

    const missing = await api('/api/watch/000000000000');
    assert.equal(missing.status, 404, 'a well-formed but unknown id must 404, not 500');

    const malformed = await api('/api/watch/not-an-id!');
    assert.equal(malformed.status, 404, 'a malformed id must 404 before ever touching KV');
  }
  console.log('GET /api/watch/:id ok');

  {
    const wrongToken = await api(`/api/watch/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ editToken: 'not-it', label: 'x', entries: [] }),
    });
    assert.equal(wrongToken.status, 403, 'a wrong editToken must be rejected, not silently accepted');

    // A wrong token of the right length reaches the byte compare itself.
    const flipped = editToken.slice(0, -1) + (editToken.endsWith('0') ? '1' : '0');
    for (const claimed of [flipped, 12345, [editToken]]) {
      const r = await api(`/api/watch/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ editToken: claimed, label: 'x', entries: [] }),
      });
      assert.equal(r.status, 403, `editToken ${JSON.stringify(claimed)} must be a 403, not a write or a 500`);
    }

    const update = await api(`/api/watch/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        editToken,
        label: 'Päivitetty',
        entries: [
          { type: 'athlete', id: '60000001', name: 'Emma Mittainen', enabled: false },
          { type: 'club', id: '2', name: 'Mallikylän Vire', enabled: true },
        ],
      }),
    });
    assert.equal(update.status, 200);
    const updated = await update.json();
    assert.equal(updated.label, 'Päivitetty');
    assert.equal(updated.entries.length, 2);
    assert.equal(updated.editToken, undefined, "PUT's own response must not leak the editToken either");

    const reget = await api(`/api/watch/${id}`);
    const reloaded = await reget.json();
    assert.equal(reloaded.label, 'Päivitetty', 'the update must actually persist in KV, not just echo back');
    assert.equal(reloaded.entries.find((e) => e.type === 'athlete').enabled, false);

    // ifUpdatedAt is the updatedAt the client loaded (docs/backend.md).
    const stale = await api(`/api/watch/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        editToken,
        label: 'Ohitettu',
        entries: [{ type: 'club', id: '2', name: 'x', enabled: true }],
        ifUpdatedAt: reloaded.updatedAt - 1,
      }),
    });
    assert.equal(stale.status, 409, 'a write against a record that has moved must be refused');
    const afterStale = await (await api(`/api/watch/${id}`)).json();
    assert.equal(afterStale.label, 'Päivitetty', 'and must leave the stored record exactly as it was');
    assert.equal(afterStale.entries.length, 2);

    const fresh = await api(`/api/watch/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        editToken,
        label: 'Yhdistetty',
        entries: afterStale.entries,
        ifUpdatedAt: afterStale.updatedAt,
      }),
    });
    assert.equal(fresh.status, 200, 'the same write against the record it was loaded from goes through');
    assert.ok(
      (await fresh.json()).updatedAt > afterStale.updatedAt,
      'and moves updatedAt on, so the next stale write is caught too',
    );

    // A wrong token is refused before updatedAt is compared, so a caller that
    // cannot write learns nothing from a 409.
    const wrongTokenStale = await api(`/api/watch/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ editToken: 'not-it', label: 'x', entries: [], ifUpdatedAt: 1 }),
    });
    assert.equal(wrongTokenStale.status, 403);
  }
  console.log('PUT /api/watch/:id ok');

  // --- DELETE /api/watch/:id: last on this record, since it ends it ---
  {
    const patched = await api(`/api/watch/${id}`, { method: 'PATCH', body: '{}' });
    assert.equal(patched.status, 405, 'only the three methods the app uses are answered');
    assert.equal(patched.headers.get('allow'), 'GET, PUT, DELETE');

    const noBody = await api(`/api/watch/${id}`, { method: 'DELETE' });
    assert.equal(noBody.status, 400, 'a delete with no body carries no token, so it is not a delete');

    const wrongToken = await api(`/api/watch/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ editToken: 'not-it' }),
    });
    assert.equal(wrongToken.status, 403, 'a read link must not be able to destroy what it can only read');
    const flipped = editToken.slice(0, -1) + (editToken.endsWith('0') ? '1' : '0');
    assert.equal(
      (await api(`/api/watch/${id}`, { method: 'DELETE', body: JSON.stringify({ editToken: flipped }) })).status,
      403,
      'nor a wrong token of the right length',
    );
    assert.equal(
      (await (await api(`/api/watch/${id}`)).json()).label,
      'Yhdistetty',
      'and must leave the record exactly where it was',
    );

    const gone = await api(`/api/watch/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ editToken }),
    });
    assert.equal(gone.status, 204, 'the token that can write it can destroy it');
    assert.equal(await gone.text(), '', 'and there is nothing left to return');

    const afterGet = await api(`/api/watch/${id}`);
    assert.equal(afterGet.status, 404, 'it is gone for everyone with the read link, not just for the deleter');

    const again = await api(`/api/watch/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ editToken }),
    });
    assert.equal(again.status, 404, 'a second delete finds nothing — which is the state it asked for');
  }
  console.log('DELETE /api/watch/:id ok');

  // --- GET /api/scan/:watchId: the front page's cross-meet scan, off the
  // seeded calendar and digests alone ---
  let scanId;
  {
    const create = await api('/api/watch', {
      method: 'POST',
      body: JSON.stringify({
        label: 'Skannausseuranta',
        entries: [{ type: 'athlete', id: SCAN_LICENCE, name: 'Emma Mittainen', enabled: true }],
      }),
    });
    assert.equal(create.status, 201);
    ({ id: scanId } = await create.json());

    const r = await api(`/api/scan/${scanId}?day=${SCAN_DAY}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-scan-calendar'), 'hit', 'the seeded calendar must be used, not re-fetched');
    assert.equal(r.headers.get('x-scan-built'), '0', 'a request that did not ask to build must not build');
    assert.equal(r.headers.get('x-scan-stale'), '1', 'the one seeded past-freshness digest is reported stale');
    const body = await r.json();
    assert.deepEqual(
      [body.from, body.to],
      ['2026-08-01', '2026-10-07'],
      'the window is -7/+60 days around the day the client asked about (CAL_WINDOW_PAST_DAYS/CAL_WINDOW_FUTURE_DAYS, worker.js)',
    );
    assert.deepEqual(
      body.comps.map((c) => String(c.id)),
      ['99001', 'testi-2', '99006', '99005', '99004'],
      'meets running in the window, chronological — the July one (before it) is out, and the ' +
        'September one (~5 weeks ahead) is in',
    );

    assert.deepEqual(
      body.comps[0].matches,
      [
        {
          name: 'Emma Mittainen',
          club: 'DemU',
          events: ['N Keihäs', 'N Kuula'],
          via: 'athlete',
        },
      ],
      'the follow-list resolves through the digest by LicenseId',
    );
    assert.equal(body.comps[0].name, 'Digestikisat');
    assert.equal(body.comps[0].stale, false, 'freshly built (seeded with a current builtAt) — not stale');

    // The front page says different things for null and for an empty list.
    assert.equal(body.comps[1].matches, null, 'a meet with no digest at all reports null, not an empty list');
    assert.equal(body.comps[1].stale, false, 'null and stale are different kinds of "not fresh" — never both');

    assert.deepEqual(
      body.comps[3].matches,
      [
        {
          name: 'Emma Mittainen',
          club: 'DemU',
          events: ['N Keihäs', 'N Kuula'],
          via: 'athlete',
        },
      ],
      'a stale digest still reports its last known matches, not null',
    );
    assert.equal(body.comps[3].stale, true, 'but is flagged so the client can mark it and refresh in the background');

    // A digest of another version is not read, so it rebuilds as pending.
    // (Break on purpose: drop the version check in handleScan and this
    // reports matches.)
    assert.equal(body.comps[2].matches, null, 'a digest of an older version reads as not scanned');
    assert.equal(body.comps[2].stale, false);

    assert.deepEqual(
      body.pending,
      ['testi-2', 99006, 99004],
      'pending carries ids in their original type, unstringified',
    );

    const otherDay = await api(`/api/scan/${scanId}?day=2026-01-01`);
    assert.deepEqual(
      (await otherDay.json()).comps,
      [],
      'a window nothing runs in is empty rather than falling back to everything',
    );

    const badDay = await api(`/api/scan/${scanId}?day=eilen`);
    assert.equal(badDay.status, 200, 'an unparseable day falls back to today rather than erroring');

    // The window derives from the day alone and ignores from/to, or a client
    // would set how many digests a scan reads (docs/backend.md, "The scan, and
    // its three layers"). (Break on purpose: honour from/to and this fails.)
    const widened = await api(`/api/scan/${scanId}?day=${SCAN_DAY}&from=2020-01-01&to=2030-01-01`);
    const widenedBody = await widened.json();
    assert.deepEqual(
      [widenedBody.from, widenedBody.to],
      ['2026-08-01', '2026-10-07'],
      'a client cannot widen the window it is asking about',
    );
    assert.equal(widenedBody.comps.length, 5, 'and so cannot pull in meets outside it');

    // A followed club's relays come first, as a line of the club's own.
    // (Break on purpose: seed the digest without its teams and only Emma
    // is listed.)
    const clubWatch = await api('/api/watch', {
      method: 'POST',
      body: JSON.stringify({
        label: 'Seuraseuranta',
        entries: [{ type: 'club', id: '1', name: 'Demon Urheilijat', enabled: true }],
      }),
    });
    const { id: clubScanId } = await clubWatch.json();
    const clubScan = await api(`/api/scan/${clubScanId}?day=${SCAN_DAY}`);
    assert.deepEqual(
      (await clubScan.json()).comps[0].matches,
      [
        // scanEventLabel (lib/digest.js) drops the digest's trailing "viesti".
        { name: 'Demon Urheilijat', club: 'DemU', events: ['N 4x100m'], via: 'club' },
        { name: 'Emma Mittainen', club: 'DemU', events: ['N Keihäs', 'N Kuula'], via: 'club' },
      ],
      "the club's relays first, then its own individual entrants",
    );

    const unknown = await api('/api/scan/000000000000');
    assert.equal(unknown.status, 404, 'a well-formed but unknown watch id must 404');
    const malformed = await api('/api/scan/not-an-id!');
    assert.equal(malformed.status, 404, 'a malformed watch id must 404 before touching KV');
    const posted = await api(`/api/scan/${scanId}`, { method: 'POST', body: '{}' });
    assert.equal(posted.status, 405);
    const noHeader = await fetch(`${BASE}/api/scan/${scanId}`);
    assert.equal(noHeader.status, 403, 'the x-kisat-client gate covers /api/scan too');
  }
  console.log('GET /api/scan/:watchId ok');

  // --- GET /api/clubs: the club index, a temporary shim for an open app
  // whose app.js still asks for it (docs/shims.md) ---
  {
    const r = await api('/api/clubs');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-clubs'), '2');
    const { clubs } = await r.json();
    assert.deepEqual(
      clubs,
      [
        { id: '1', name: 'Demon Urheilijat', nameShort: 'DemU' },
        { id: '2', name: 'Malliseura', nameShort: 'MalV' },
      ],
      'the picker gets objects, not the stored positional rows',
    );

    const post = await api('/api/clubs', { method: 'POST', body: '{}' });
    assert.equal(post.status, 405, 'the index is read-only over HTTP — it is written by roster builds only');

    const unauthed = await fetch(`${BASE}/api/clubs`);
    assert.equal(unauthed.status, 403, 'the x-kisat-client gate covers this route like every other /api one');
  }
  console.log('GET /api/clubs ok');

  // --- GET /api/search: the create and edit sheets' search. A named meet's
  // entrants come first, off its digest, so a keystroke builds no roster ---
  {
    const r = await api('/api/search?q=mitt');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-search-athletes'), '2');
    assert.equal(r.headers.get('x-search-clubs'), '0');
    assert.deepEqual(
      (await r.json()).athletes,
      [
        { licenseId: SCAN_LICENCE, organizationId: '2', name: 'Emma Mittainen', club: 'Malliseura' },
        { licenseId: '70000003', organizationId: '1', name: 'Väinö Mittari', club: 'Demon Urheilijat' },
      ],
      'the picker gets objects with the club named, not the stored rows',
    );

    const clubs = (await (await api('/api/search?q=demu')).json()).clubs;
    assert.deepEqual(
      clubs,
      [{ id: '1', name: 'Demon Urheilijat', nameShort: 'DemU' }],
      'a club answers to its short name',
    );

    // With a meet open, her entry there wins over the index's row, so a
    // follow-list carries the club the programme shows.
    const here = await api('/api/search?q=mitt&comp=99001');
    assert.deepEqual((await here.json()).athletes[0], {
      licenseId: SCAN_LICENCE,
      organizationId: '1',
      name: 'Emma Mittainen',
      club: 'Demon Urheilijat',
    });

    // A demo meet's search is built on the spot and never written to KV.
    const demo = await (await api('/api/search?q=testil&comp=demo')).json();
    assert.deepEqual(
      demo.clubs.map((c) => c.name),
      ['Testilän Kisa'],
      'a demo club, and it is in no index',
    );
    assert.deepEqual((await (await api('/api/search?q=testil')).json()).clubs, [], 'not offered with no meet named');
    const demoPeople = await (await api('/api/search?q=emma%20mitt&comp=demo')).json();
    assert.notEqual(demoPeople.athletes[0].licenseId, SCAN_LICENCE, "the demo meet's own Emma comes first");
    assert.ok(demoPeople.athletes[0].club, "and carries a demo club's name");

    // A query under SEARCH_MIN_CHARS is a keystroke, so it answers empty.
    const short = await api('/api/search?q=a');
    assert.equal(short.status, 200);
    assert.deepEqual(await short.json(), { clubs: [], athletes: [] });
    assert.deepEqual(await (await api('/api/search')).json(), { clubs: [], athletes: [] });

    assert.equal((await api('/api/search?q=mitt', { method: 'POST', body: '{}' })).status, 405);
    assert.equal(
      (await fetch(`${BASE}/api/search?q=mitt`)).status,
      403,
      'the x-kisat-client gate covers this route too',
    );
  }
  console.log('GET /api/search ok');

  // --- GET /api/meets: the meet index that home's search reads. Only the
  // cron writes it, and test/indexes.test.mjs tests the merge ---
  {
    const r = await api('/api/meets');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-meets'), '10');
    assert.equal(r.headers.get('x-meets-crawl'), '18000');
    assert.deepEqual(
      (await r.json()).meets.find((m) => m.id === '16500'),
      { id: '16500', name: 'Talvikisat', date: '2025-02-01', location: '', organizationName: 'Demon Urheilijat' },
      'objects, not the stored positional rows',
    );
    assert.equal((await api('/api/meets', { method: 'POST', body: '{}' })).status, 405, 'written by the cron only');
    assert.equal((await fetch(`${BASE}/api/meets`)).status, 403, 'the x-kisat-client gate covers this route too');
    // Only a preview with its own data runs the cron on request (previewEnv).
    // (Break on purpose: drop the PREVIEW_DATA test from the /api/cron route.)
    assert.equal((await api('/api/cron', { method: 'POST' })).status, 404, 'no cron on request here');
    assert.equal((await api('/api/meets')).headers.get('x-meets-crawl'), '18000', 'and the index is as it was');
  }
  console.log('GET /api/meets ok');

  // --- GET /api/meet/:compId: a club cup's standings, or the flag that says
  // there are none. democup carries the cup setting and demo does not, so
  // both branches build offline. The Settings decide, never the id ---
  {
    const r = await api('/api/meet/democup');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-meet-cache'), 'miss', 'a demo is never written to KV, so it is always a build');
    const cup = await r.json();
    assert.equal(cup.cup, true);
    assert.deepEqual(
      cup.clubs.map((c) => [c.rank, c.nameShort, c.points]),
      [
        [1, 'DemU', 3820],
        [2, 'TeKi', 2960],
        [3, 'MalV', 2470],
        [4, 'NäVa', 2370],
        [5, 'HarjU', 1760],
      ],
      'the same standings test/cup.test.mjs asserts, over HTTP — so the demo build path reduces the same events',
    );
    assert.ok(
      cup.scoring.length > 0 && cup.scoring.every((k) => k.includes(':')),
      'the rows that scored, keyed eventId:allocId (cupScoringKey)',
    );

    assert.equal(cup.confirm, null, 'and its confirmation setting, which this meet does not carry');
    assert.equal(
      cup.phase,
      'Progress',
      "and the meet's own phase, which only this fan-out can answer — the schedule cannot tell " +
        'a category nobody entered from one still to come (meetPhase, lib/schedule.js)',
    );

    const meet = await (await api('/api/meet/demo')).json();
    assert.deepEqual(
      meet,
      { cup: false, confirm: { minutes: 60 } },
      "not a cup, however many SeuraCUPPoints its rows carry (20224's shape — docs/tuloslista-api.md)",
    );

    // A meet that is neither a cup nor a confirmer costs one KV read. This
    // body is the meet view's only gate on both (docs/backend.md).
    const not = await api('/api/meet/99001');
    assert.equal(not.headers.get('x-meet-cache'), 'hit');
    assert.deepEqual(
      await not.json(),
      { cup: false, confirm: null },
      'no standings at all, not an empty list; and a null switch, not an "off" one',
    );

    assert.equal((await api('/api/meet/nope')).status, 400, 'the same id guard the roster has');
    assert.equal((await api('/api/meet/demo', { method: 'POST' })).status, 405);
    const rosterPost = await api('/api/roster/demo', { method: 'POST' });
    assert.equal(rosterPost.status, 405, 'a roster is built on GET alone');
    assert.equal(rosterPost.headers.get('allow'), 'GET');
    assert.equal((await fetch(`${BASE}/api/meet/demo`)).status, 403, 'the x-kisat-client gate covers this route too');
  }
  console.log('GET /api/meet/:compId ok');

  // --- GET /api/cup/:compId: where each club's cup points came from, off the
  // same build under its own key. Its size gives it a route of its own
  // (docs/backend.md) ---
  {
    const r = await api('/api/cup/democup');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-cup-cache'), 'miss', "and its own cache header, not the meet's");
    const { clubs } = await r.json();

    // A club's rows add up to the total /api/meet gives it, since one build
    // cuts both responses.
    const body = await (await api('/api/meet/democup')).json();
    for (const club of body.clubs) {
      const entries = (clubs[club.id] || []).flatMap((box) => box.entries);
      assert.equal(
        entries.reduce((n, e) => n + e.points, 0),
        club.points,
        `${club.nameShort}'s rows add up to its total`,
      );
    }
    assert.ok(
      clubs['1'].every((box) => box.group && box.event && box.entries.length),
      'every box carries the start it was run in, so the page can link to it',
    );

    // A meet that scores nobody answers an empty breakdown, not a 404.
    assert.deepEqual(await (await api('/api/cup/demo')).json(), { clubs: {} });
    assert.equal((await api('/api/cup/nope')).status, 400);
    assert.equal((await api('/api/cup/demo', { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${BASE}/api/cup/demo`)).status, 403, 'the x-kisat-client gate covers this route too');
  }
  console.log('GET /api/cup/:compId ok');

  // --- GET /api/medals/:compId: the medal table test/medals.test.mjs asserts
  // through meetMedals, over HTTP ---
  {
    const r = await api('/api/medals/demo');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-medals-cache'), 'miss', 'a demo is never written to KV, so it is always a build');
    const { table, scopes, unknown, defaults, starts } = await r.json();
    assert.deepEqual(
      table.map((c) => [c.name, ...c.medals, c.total]),
      [
        ['Testilän Kisa', 6, 3, 3, 12],
        ['Demon Urheilijat', 5, 5, 1, 11],
        ['Mallikylän Vire', 3, 2, 1, 6],
        ['Näyteniemen Vauhti', 2, 3, 3, 8],
        ['Harjoituspiirin Urheilijat', 2, 3, 0, 5],
      ],
    );
    // Each scope gets a table over the demo's alue and piiris (DEMO_DISTRICTS).
    assert.deepEqual(
      scopes.map((p) => [p.short, p.table.map((c) => [c.name, c.medals[0]])]),
      [
        [
          'Demolainen alue',
          [
            ['Testilän Kisa', 6],
            ['Demon Urheilijat', 5],
            ['Näyteniemen Vauhti', 3],
            ['Mallikylän Vire', 3],
          ],
        ],
        [
          'DemY',
          [
            ['Testilän Kisa', 7],
            ['Demon Urheilijat', 7],
          ],
        ],
        [
          'MalY',
          [
            ['Näyteniemen Vauhti', 8],
            ['Mallikylän Vire', 5],
          ],
        ],
      ],
    );
    assert.equal(
      starts.reduce((n, s) => n + s.medals.length, 0),
      42,
      "every medal the meet's table counts, a start each",
    );
    assert.deepEqual(unknown, ['Harjoituspiirin Urheilijat']);
    assert.deepEqual(defaults, [], "the demo's name says nothing");
    // A championship with no meet on Tuloslista answers on its own id.
    // (Break on purpose: guard handleMedals with COMP_ID_RE alone.)
    const alone = await api(`/api/medals/${ALONE_ROW.id}`);
    assert.equal(alone.status, 200);
    assert.equal(alone.headers.get('x-medals-cache'), 'hit', 'the seeded record must be used, not rebuilt');
    assert.deepEqual(await alone.json(), ALONE_BODY);
    assert.equal((await api('/api/medals/nope')).status, 400);
    assert.equal((await api('/api/medals/demo', { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${BASE}/api/medals/demo`)).status, 403, 'the x-kisat-client gate covers this route too');
  }
  console.log('GET /api/medals/:compId ok');

  // --- GET /api/results/:compId/:eventId: one event of a listed meet, off
  // the key a medal build wrote. ---
  {
    const r = await api(`/api/results/${LISTED_COMP}/${LISTED_EVENT_ID}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-results-cache'), 'hit', 'the seeded event must be used, not rebuilt');
    // (Break on purpose: serve the stored record whole and the event arrives
    // wrapped.)
    assert.deepEqual(await r.json(), LISTED_EVENT, 'the event is served as it was kept');
    // A meet the file does not list is refused before any build.
    assert.equal(
      (await api('/api/results/demo/1')).status,
      404,
      'a meet elsewhere.json does not list has no results here',
    );
    assert.equal((await api(`/api/results/${LISTED_COMP}/${LISTED_EVENT_ID}`, { method: 'POST' })).status, 405);
    assert.equal(
      (await fetch(`${BASE}/api/results/${LISTED_COMP}/${LISTED_EVENT_ID}`)).status,
      403,
      'the x-kisat-client gate covers this route too',
    );
  }
  console.log('GET /api/results/:compId/:eventId ok');

  // --- GET /api/results/:compId: the same meet's grafted schedule. ---
  {
    const r = await api(`/api/results/${LISTED_COMP}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-results-cache'), 'hit', 'the seeded schedule must be used, not rebuilt');
    // (Break on purpose: serve the stored record whole and the days arrive
    // wrapped.)
    assert.deepEqual(await r.json(), LISTED_SCHEDULE, 'the schedule is served as it was kept');
    assert.equal(
      (await api('/api/results/demo')).status,
      404,
      'a meet elsewhere.json does not list has no schedule here',
    );
    // (Break on purpose: answer a race's row that stands alone with 404.)
    const alone = await api(`/api/results/${ALONE_ROW.id}`);
    assert.equal(alone.headers.get('x-results-cache'), 'hit', "a race's row serves the schedule its build kept");
    assert.deepEqual(await alone.json(), ALONE_SCHEDULE);
    assert.equal((await api(`/api/results/${LISTED_COMP}`, { method: 'POST' })).status, 405);
    assert.equal(
      (await fetch(`${BASE}/api/results/${LISTED_COMP}`)).status,
      403,
      'the x-kisat-client gate covers this route too',
    );
  }
  console.log('GET /api/results/:compId ok');

  // --- GET /api/cupseason/:year: every cup meet of the year off the seeded
  // index, each with its clubs off its record and the rows asked for. ---
  {
    const path = `/api/cupseason/${SEASON_YEAR}`;
    const r = await api(path);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(
      ['meets', 'pending', 'stale', 'built'].map((h) => r.headers.get(`x-season-${h}`)),
      ['4', '3', '0', '0'],
    );
    const body = await r.json();
    assert.equal(body.year, Number(SEASON_YEAR));
    // (Break on purpose: drop the name filter and the championships come along.)
    assert.deepEqual(
      body.meets.map(({ clubs, stale, rows, ...m }) => m),
      [
        {
          id: 'testi-c2',
          name: 'Seuracup I - Helsy, UudY',
          date: `${SEASON_YEAR}-06-02`,
          kind: 'osa',
          piirit: ['helsy', 'uudy'],
        },
        {
          id: 'testi-c1',
          name: 'Helsy:n Seuracup 9v lajit',
          date: `${SEASON_YEAR}-06-10`,
          kind: 'nines',
          piirit: ['helsy'],
        },
        { id: 'democup', name: 'Helsy:n Seuracup II', date: `${SEASON_YEAR}-06-20`, kind: 'osa', piirit: ['helsy'] },
        {
          id: 'testi-c3',
          name: 'Seuracup A-sarjan finaali',
          date: `${SEASON_YEAR}-08-29`,
          kind: 'final',
          piirit: [],
          organiser: 'Malliseura',
        },
      ],
      "the cup's meets alone, in date order",
    );
    assert.deepEqual(
      body.meets.map((m) => [m.id, m.stale, m.rows]),
      [
        ['testi-c2', false, []],
        ['testi-c1', false, []],
        ['democup', false, []],
        ['testi-c3', false, []],
      ],
      'no rows without a club or a watch',
    );
    assert.deepEqual(
      body.meets[0].clubs,
      CUP_SEASON_RECORD.clubs.map(({ rows, ...c }) => c),
      'the clubs without their rows',
    );
    assert.deepEqual(
      body.meets.slice(1).map((m) => m.clubs),
      [null, null, null],
      'not built',
    );
    assert.deepEqual(body.pending, ['testi-c1', 'democup', 'testi-c3']);

    // (Break on purpose: project every club's rows, or ignore the club.)
    const club = await (await api(`${path}?club=1`)).json();
    assert.deepEqual(club.meets[0].rows, CUP_SEASON_RECORD.clubs[0].rows, "the club's rows alone");
    const create = await api('/api/watch', {
      method: 'POST',
      body: JSON.stringify({
        label: 'Cup',
        entries: [{ type: 'athlete', id: '70000222', name: 'Eero Esimerkki', enabled: true }],
      }),
    });
    const { id: watchId } = await create.json();
    const watched = await (await api(`${path}?club=1&watch=${watchId}`)).json();
    assert.deepEqual(
      watched.meets[0].rows,
      [...CUP_SEASON_RECORD.clubs[0].rows, ...CUP_SEASON_RECORD.clubs[1].rows],
      "the club's and the watch's licence's",
    );
    assert.deepEqual(
      (await (await api(`${path}?watch=000000000000`)).json()).meets[0].rows,
      [],
      'an unknown watch asks for nothing',
    );
    assert.equal((await api(`${path}?watch=nope`)).status, 200, 'nor is a malformed one an error');

    // Only democup builds. COMP_ID_RE skips the testi- ids before any fetch.
    const built = await api(`${path}?build=1`);
    assert.equal(built.status, 200);
    assert.deepEqual(
      ['meets', 'pending', 'stale', 'built'].map((h) => built.headers.get(`x-season-${h}`)),
      ['4', '2', '0', '1'],
    );
    const builtBody = await built.json();
    const demo = builtBody.meets.find((m) => m.id === 'democup');
    assert.ok(
      demo.clubs.length && demo.clubs.every((c) => c.id && c.rank && Number.isFinite(c.points) && !c.rows),
      'a build fills the meet',
    );
    assert.deepEqual(builtBody.pending, ['testi-c1', 'testi-c3']);

    assert.equal((await api(`${path}/helsy`)).status, 404, 'no piiri route');
    assert.equal(
      (await api(`/api/cupseason/${Number(SEASON_YEAR) - 2}`)).status,
      400,
      'a year the index does not keep',
    );
    assert.equal((await api('/api/cupseason/vuosi')).status, 400);
    assert.equal((await api(path, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${BASE}${path}`)).status, 403, 'the x-kisat-client gate covers this route too');
  }
  console.log('GET /api/cupseason/:year ok');

  // --- GET /api/medalseason/:scopeId/:year: the scope's meets off the seeded
  // index, each with its record projected to the scope. ---
  {
    const r = await api(`/api/medalseason/helsy/${SEASON_YEAR}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(
      ['meets', 'pending', 'stale', 'built'].map((h) => r.headers.get(`x-season-${h}`)),
      ['2', '1', '0', '0'],
    );
    const body = await r.json();
    assert.deepEqual([body.scope, body.year], ['helsy', Number(SEASON_YEAR)]);
    // (Break on purpose: project with the alue's id, or drop the year's filter.)
    assert.deepEqual(
      body.meets.map((m) => [m.id, m.date, m.cover, m.stale]),
      [
        ['99101', `${SEASON_YEAR}-06-01`, null, false],
        ['testi-s1', `${SEASON_YEAR}-08-01`, { ages: null, events: ['viestit'] }, false],
      ],
      "the piiri's meets in date order, the alue's not among them, nor the one over without a result",
    );
    assert.deepEqual(
      body.meets[0].starts,
      [
        {
          start: MEDAL_SEASON_RECORD.starts[0].start,
          medals: [
            ['1', 1],
            ['2', 2],
          ],
        },
      ],
      "the piiri's own medals; a start with none of them is not carried",
    );
    assert.deepEqual(
      [body.meets[0].names, body.meets[0].athletes, body.meets[0].unknown],
      [MEDAL_SEASON_RECORD.names, MEDAL_SEASON_RECORD.athletes, MEDAL_SEASON_RECORD.unknown],
    );
    assert.equal(body.meets[1].starts, null, 'no record is not built, not a meet without medals');
    assert.deepEqual(body.pending, ['testi-s1']);

    const alue = await api(`/api/medalseason/etelainen/${STALE_DAY.slice(0, 4)}?build=1`);
    assert.equal(alue.status, 200);
    assert.deepEqual(
      ['meets', 'pending', 'stale', 'built'].map((h) => alue.headers.get(`x-season-${h}`)),
      ['1', '0', '1', '0'],
      'the stale record is queued, and its testi- id is skipped before any fetch',
    );
    const alueBody = await alue.json();
    assert.deepEqual(
      alueBody.meets.map((m) => [m.id, m.stale, m.starts]),
      [['testi-s2', true, [{ start: { EventName: 'N 100m', Age: '0' }, medals: [['2', 3]] }]]],
      'a stale record still answers',
    );

    assert.equal(
      (await api(`/api/medalseason/nope/${SEASON_YEAR}`)).status,
      404,
      'a scope districts.json does not have',
    );
    assert.equal(
      (await api(`/api/medalseason/helsy/${Number(SEASON_YEAR) - 2}`)).status,
      400,
      'a year the index does not keep',
    );
    assert.equal((await api('/api/medalseason/helsy/vuosi')).status, 400);
    assert.equal((await api(`/api/medalseason/helsy/${SEASON_YEAR}`, { method: 'POST' })).status, 405);
    assert.equal(
      (await fetch(`${BASE}/api/medalseason/helsy/${SEASON_YEAR}`)).status,
      403,
      'the x-kisat-client gate covers this route too',
    );
  }
  console.log('GET /api/medalseason/:scopeId/:year ok');

  // --- SCAN_LIMITER, which a scan spends only to build something ---
  // A default scan never 429s, and a burst of build=1 scans does.
  // (Break on purpose: default wantBuild to true and the first loop 429s.)
  {
    // (Break on purpose: scan SCAN_DAY in either loop and this fails.)
    const onlyTesti7 = async (r) => {
      assert.equal(r.headers.get('x-scan-pending'), '1', 'and it still reports what it did not scan');
      const { comps, pending } = await r.json();
      assert.deepEqual(pending, ['testi-7']);
      assert.equal(comps.length, 1, 'testi-7 is the one meet a build could take');
    };
    for (let i = 0; i < 15; i++) {
      const r = await api(`/api/scan/${scanId}?day=${BUILD_DAY}`);
      assert.equal(r.status, 200, `default scan #${i + 1} must not be rate limited — it spends nothing`);
      await onlyTesti7(r);
    }

    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await api(`/api/scan/${scanId}?day=${BUILD_DAY}&build=1`);
      if (r.status === 429) {
        saw429 = true;
        break;
      }
      assert.equal(r.status, 200, `build scan #${i + 1} should succeed or 429, not something else`);
      assert.equal(r.headers.get('x-scan-built'), '0', 'COMP_ID_RE skips testi-7 before any fetch');
      await onlyTesti7(r);
    }
    assert.ok(saw429, 'a burst of build-allowed scans must eventually 429');
  }
  console.log('SCAN_LIMITER / build=0 default ok');

  // --- WATCH_LIMITER, which caps creation per IP (wrangler.jsonc) ---
  // Each wrangler dev counts from zero, and the POSTs above count too.
  {
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await api('/api/watch', { method: 'POST', body: JSON.stringify({ entries: [] }) });
      if (r.status === 429) {
        saw429 = true;
        break;
      }
      assert.equal(r.status, 201, `create #${i + 1} should succeed or 429, not something else`);
    }
    assert.ok(saw429, 'a burst past the WATCH_LIMITER cap must eventually 429');
  }
  console.log('WATCH_LIMITER ok');

  // --- GET /calendar.json: the public feed, which takes no client header
  // since it sits outside /api/ (docs/backend.md). The seeded cal:v1
  // answers it ---
  {
    const bare = (path, opts = {}) => fetch(`${BASE}${path}`, opts);
    // worker.js takes today as a UTC day (todayIso).
    const today = new Date().toISOString().slice(0, 10);

    const r = await bare('/calendar.json');
    assert.equal(r.status, 200, 'no x-kisat-client header needed');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('cache-control') || '', /^public, max-age=\d+$/);
    const body = await r.json();
    // The feed lists every competition, however far from the day asked about.
    assert.equal(body.comps.length, SCAN_CALENDAR.comps.length);
    assert.equal(body.day, today);
    const one = body.comps.find((c) => String(c.id) === '99001');
    assert.deepEqual(one.days, ['8.8.2026'], 'the day span is the point of the feed');
    assert.equal(one.name, 'Digestikisat');
    assert.equal(one.location, 'Testilä');
    assert.equal(one.organizationName, 'Testilän Kisa');
    // A row stored without organizationName answers with it empty.
    const older = body.comps.find((c) => String(c.id) === '99003');
    assert.equal(older.organizationName, '', 'defaulted, not dropped');
    // Nothing about anybody's follow-list may ride along on a public feed.
    const keys = [...new Set(body.comps.flatMap((c) => Object.keys(c)))].sort();
    assert.deepEqual(keys, ['date', 'days', 'id', 'location', 'name', 'organizationName']);
    assert.equal(JSON.stringify(body).includes(SCAN_LICENCE), false, 'no athlete data');

    // A same-origin caller that sends the client header still gets a 200.
    assert.equal((await bare('/calendar.json', { headers: HEADERS })).status, 200);

    // ?day only steers which schedules are fetched, so junk falls back to
    // today.
    assert.equal((await bare('/calendar.json?day=2026-08-20')).status, 200);
    assert.equal((await (await bare('/calendar.json?day=huomenna')).json()).day, today);

    // A caller's preflight, sent for a custom header, gets the CORS headers.
    const pre = await bare('/calendar.json', {
      method: 'OPTIONS',
      headers: { origin: 'https://juoksut.matilainen.fi', 'access-control-request-method': 'GET' },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.match(pre.headers.get('access-control-allow-methods') || '', /GET/);

    // The feed is read-only.
    const post = await bare('/calendar.json', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.match(post.headers.get('allow') || '', /GET/);

    assert.equal((await bare('/api/clubs')).status, 403, 'the /api/ gate still bites');
  }
  console.log('GET /calendar.json ok');

  // --- The identity assets, the Juoksut half ---
  // wrangler dev builds request.url from wrangler.jsonc's first route and not
  // the Host header, so this host needs a second server with --host. It also
  // rewrites a Location header to the asking host, so the /demo origin check
  // passes on either host. Without run_worker_first these get Kisat's files.
  {
    const juoksutState = mkdtempSync(join(tmpdir(), 'kisat-test-worker-juoksut-'));
    moreStates.push(juoksutState);
    // This server has its own KV, and a calendar miss would fetch the live
    // listing.
    seedKv('cal:v1', SCAN_CALENDAR, juoksutState);
    const base = await startMoreDev(
      ['--host', 'juoksut.matilainen.fi', '--persist-to', juoksutState],
      Number(PORT) + 1,
    );

    const manifest = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.equal(
      (await manifest.json()).name,
      'Juoksut',
      'the juoksut domain must install as Juoksut, not as Kisat under its own name',
    );

    // The manifest names its icons by the plain paths, which siteAssetPath
    // swaps.
    const icon = await fetch(`${base}/icon.svg`);
    assert.match(await icon.text(), /viewBox="0 0 180 180"/, "juoksut's lanes, not the stopwatch");

    const png = await fetch(`${base}/apple-touch-icon.png`);
    assert.equal(png.status, 200, 'a 404 here and iOS falls back to a screenshot of the page');
    assert.equal(
      Buffer.from(await png.arrayBuffer())
        .subarray(1, 4)
        .toString(),
      'PNG',
    );

    // A link preview's crawler reads the served bytes, so the document is
    // rewritten per host (siteMeta, lib/routes.js). (Break on purpose: drop "/"
    // from run_worker_first and this host serves Kisat's strings.)
    const jIndex = await (await fetch(`${base}/`)).text();
    // A Juoksut meet preloads the hurdle setups, which its views load there
    // alone (routeModules).
    assert.match(await (await fetch(`${base}/c/99001`)).text(), /href="\/assets\/hurdles-\w+\.js"/);
    const kIndex = await (await fetch(`${BASE}/`)).text();
    // Both hosts serve one bundle, and it picks the mode itself (siteMode). A
    // chunk is named by its content, so a browser keeps it for good.
    const entry = (html) => /<script type="module" src="(\/assets\/app-\w+\.js)"><\/script>/.exec(html)?.[1];
    assert.equal(entry(jIndex), entry(kIndex), 'one app.js, two domains');
    const [jApp, kApp] = await Promise.all([fetch(`${base}${entry(jIndex)}`), fetch(`${BASE}${entry(kIndex)}`)]);
    assert.equal(await jApp.text(), await kApp.text());
    assert.match(kApp.headers.get('cache-control') ?? '', /immutable/);
    assert.match(jIndex, /<title>Juoksut<\/title>/);
    assert.match(jIndex, /property="og:title" content="Juoksut"/);
    assert.match(jIndex, /property="og:site_name" content="Juoksut"/);
    assert.match(jIndex, /name="description" content="Yleisurheilun juoksukiso/);
    assert.match(jIndex, /property="og:description" content="Yleisurheilun juoksukiso/);
    assert.match(kIndex, /<title>Kisat<\/title>/, 'the other host ships what index.html says');
    assert.match(kIndex, /property="og:description"\s+content="Yleisurheilukisojen aikataulut/);
    // /index.html is rewritten the same way.
    assert.match(await (await fetch(`${base}/index.html`)).text(), /<title>Juoksut<\/title>/);
    const strip = (html) =>
      html
        .replace(/<title>[^<]*<\/title>/, '')
        .replace(/<meta\s+(?:name|property)="(?:description|og:title|og:site_name|og:description)"[^>]*>/g, '')
        .replace(/\s*<link rel="modulepreload" href="[^"]+" \/>/g, '');
    assert.equal(
      strip(jIndex),
      strip(kIndex),
      "the title, the preview tags and the route's modules are the whole difference",
    );
    // The table page's path is the document too, named for its link preview
    // on both hosts (TABLE_PAGE_PATH, lib/routes.js).
    const jMitat = await fetch(`${base}/mitat`);
    assert.equal(jMitat.status, 200);
    const jMitatText = await jMitat.text();
    assert.match(jMitatText, /<title>Aita- ja välinemitat · Juoksut<\/title>/);
    assert.match(jMitatText, /property="og:title" content="Aita- ja välinemitat · Juoksut"/);
    assert.match(jMitatText, /name="description" content="Aitajuoksujen ja heittovälineiden/);
    assert.equal(strip(jMitatText), strip(kIndex), 'the same document under another name');
    const kMitat = await fetch(`${BASE}/mitat`);
    assert.equal(kMitat.status, 200);
    assert.match(await kMitat.text(), /<title>Aita- ja välinemitat · Kisat<\/title>/);
    // The championship page is the document on both hosts, named on Kisat's
    // alone (MEDAL_SEASON_PAGE_PATH, lib/routes.js).
    const kSeason = await fetch(`${BASE}/mestaruudet`);
    assert.equal(kSeason.status, 200);
    assert.match(await kSeason.text(), /<title>Mestaruuskilpailut · Kisat<\/title>/);
    const jSeason = await fetch(`${base}/mestaruudet`);
    assert.equal(jSeason.status, 200);
    assert.match(await jSeason.text(), /<title>Juoksut<\/title>/);
    assert.match(await (await fetch(`${BASE}/seuracup`)).text(), /<title>Seuracup · Kisat<\/title>/);
    // A meet's path names the meet under this host's own name too.
    const jMeet = await fetch(`${base}/c/demo`);
    assert.equal(jMeet.status, 200);
    assert.match(await jMeet.text(), /<title>Testikilpailu · Juoksut<\/title>/);
    assert.match(
      await (await fetch(`${base}/c/99001`)).text(),
      /property="og:title" content="Digestikisat · Juoksut"/,
      'served from the seeded calendar here as well',
    );
    // The shared /aidat and /sarjat redirect with their query until their
    // shims go (docs/shims.md). /valineet is not a path.
    const old = await fetch(`${BASE}/aidat?mode=juoksut`, { redirect: 'manual' });
    assert.equal(old.status, 302);
    assert.equal(old.headers.get('location'), `${BASE}/mitat?mode=juoksut`);
    const oldSeason = await fetch(`${BASE}/sarjat?mode=kisat`, { redirect: 'manual' });
    assert.equal(oldSeason.status, 302);
    assert.equal(oldSeason.headers.get('location'), `${BASE}/mestaruudet?mode=kisat`);
    // A day's D.M.YYYY path redirects to its YYYY-MM-DD one until its shim goes.
    for (const [path, to] of [
      ['/c/99001/d/8.8.2026?mode=kisat', '/c/99001/d/2026-08-08?mode=kisat'],
      ['/c/demo/aidat/8.8.2026', '/c/demo/aidat/2026-08-08'],
    ]) {
      const oldDay = await fetch(`${BASE}${path}`, { redirect: 'manual' });
      assert.equal(oldDay.status, 302, path);
      assert.equal(oldDay.headers.get('location'), `${BASE}${to}`);
    }
    assert.equal((await fetch(`${BASE}/valineet`)).status, 404);

    // --- and one /api route on this host, the rest closed ---
    // These carry the client header, so each 404 is the host's gate.
    for (const path of [
      '/api/clubs',
      '/api/search?q=mitt',
      '/api/meets',
      '/api/roster/demo',
      '/api/meet/demo',
      '/api/scan/abc',
      '/api/watch',
      `/api/results/${LISTED_COMP}`,
      `/api/results/${LISTED_COMP}/${LISTED_EVENT_ID}`,
    ]) {
      const r = await fetch(`${base}${path}`, { headers: HEADERS });
      assert.equal(r.status, 404, `${path} must not exist on the juoksut host`);
    }
    // The medal tables stay open, since this mode's piiri sheet and Mitalit
    // view read them. (Break on purpose: close them and this is a 404.)
    assert.equal(
      (await fetch(`${base}/api/medals/demo`, { headers: HEADERS })).status,
      200,
      'the medal scopes are served on the juoksut host',
    );
    assert.equal(
      (await fetch(`${base}/api/medals/demo`, { method: 'POST', headers: HEADERS })).status,
      404,
      'and only for a GET',
    );
    assert.equal(
      (await fetch(`${base}/api/medals/demo`)).status,
      403,
      'and only for a caller sending the client header',
    );
    // The Kisat host answers the same roster request, so the 404 above is
    // the gate's and not the route's.
    assert.equal(
      (await fetch(`${BASE}/api/roster/demo`, { headers: HEADERS })).status,
      200,
      'the same request is served on the host the API belongs to',
    );

    // The calendar feed is outside /api/ and stays open, since this host's
    // front page reads it (fetchCalendarDays, app/home.js).
    const feed = await fetch(`${base}/calendar.json`);
    assert.equal(feed.status, 200, 'the public feed is not /api and does not close with it');
    assert.ok(
      (await feed.json()).comps.some((c) => c.id === 99001),
      'served from local KV',
    );
  }
  console.log('identity assets + closed /api (juoksut host) ok');

  // --- POST /api/cron on a preview with its own data ---
  // wrangler dev binds the top level alone, so this server's config takes
  // the previews block's bindings, as a preview does (previewEnv). A GET with
  // the right token passes the gate to the 405, so no call here runs the
  // cron, which reads the live API. (Break on purpose: drop the token test
  // from the /api/cron route.)
  {
    const dir = mkdtempSync(join(tmpdir(), 'kisat-test-worker-preview-'));
    moreStates.push(dir);
    const text = readFileSync('wrangler.jsonc', 'utf8');
    const { build, previews, ...top } = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
    const config = {
      ...top,
      main: resolve(top.main),
      assets: { ...top.assets, directory: resolve(top.assets.directory) },
      kv_namespaces: previews.kv_namespaces,
      ratelimits: previews.ratelimits,
    };
    writeFileSync(join(dir, 'wrangler.json'), JSON.stringify(config));
    const token = 'a'.repeat(64);
    const base = await startMoreDev(
      [
        '--config',
        join(dir, 'wrangler.json'),
        '--persist-to',
        join(dir, 'state'),
        '--var',
        'PREVIEW_DATA:own',
        '--var',
        `CRON_TOKEN:${token}`,
      ],
      Number(PORT) + 2,
    );
    const cron = (method, authorization) =>
      fetch(`${base}/api/cron`, { method, headers: { ...HEADERS, ...(authorization && { authorization }) } });
    assert.equal((await cron('POST')).status, 403, 'the client header alone is not enough');
    assert.equal((await cron('POST', `Bearer ${'b'.repeat(64)}`)).status, 403, 'a wrong token is refused');
    assert.equal((await cron('POST', `Bearer ${token}x`)).status, 403, 'a longer token is refused');
    assert.equal((await cron('POST', token)).status, 403, 'the token is a bearer');
    assert.equal((await cron('GET', `Bearer ${token}`)).status, 405, 'the right token passes the gate');
  }
  console.log('POST /api/cron (preview with its own data) ok');

  console.log('\nall worker tests ok');
} catch (err) {
  console.error('\nworker test failed:', err);
  console.error('\n--- wrangler dev output ---\n' + wranglerOutput);
  shutdown();
  process.exit(1);
}

shutdown();
