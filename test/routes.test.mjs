// Tests the routes, the two modes and the view state (docs/architecture.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { isoToFiDay } from '../public/lib/dates.js';
import { ALONE_ID_RE } from '../public/lib/elsewhere.js';
import { activeFilter, filterCategories, filterRows, meetFilterChoices } from '../public/lib/filter.js';
import { propertiesMeetRow } from '../public/lib/indexes.js';
import {
  RENDER_LOG_MAX,
  logRender,
  msText,
  normalizeRenderLog,
  renderLogTsv,
  renderStats,
} from '../public/lib/render-log.js';
import {
  CUP_SEASON_PAGE_PATH,
  CUP_TAB_FINALS,
  CUP_TAB_ROUNDS,
  DEMO_IDS,
  RELOAD_GAP_MS,
  MEDAL_SEASON_PAGE_PATH,
  TABLE_PAGE_PATH,
  TABLE_TAB_VIEWS,
  anchorMoved,
  compViewMode,
  compViewSetMode,
  compViewState,
  compViewUpdate,
  cupPath,
  dayPath,
  focusLink,
  hurdleSheetPath,
  isDemoId,
  isDevHost,
  keyringLinkHash,
  keyringPairs,
  layerCloseAction,
  layerPopAction,
  legacyDayPath,
  legacyRoutePath,
  medalsPath,
  menuAnchorPos,
  parseLinkHash,
  parseRoute,
  parseSeasonHash,
  parseTablePageHash,
  pastedLink,
  previewEnv,
  reloadDue,
  routeMode,
  searchJumpPath,
  seasonHash,
  siteAssetPath,
  siteMeta,
  siteMode,
  tablePageHash,
  watchLink,
} from '../public/lib/routes.js';
import { RUN_CATEGORIES, groupRounds, rowClassAge } from '../public/lib/schedule.js';
import { DEMO_CUP_ID, DEMO_ID, demoMeet, demoSchedule } from '../public/demo.js';

// --- What a render cost: its log and page (docs/architecture.md) ---
test('renderStats', () => {
  // The log is newest first and capped.
  let log = [];
  for (let i = 0; i < RENDER_LOG_MAX + 10; i += 1) log = logRender(log, { view: 'comp', ms: i, fetches: 0 });
  assert.equal(log.length, RENDER_LOG_MAX);
  assert.equal(log[0].ms, RENDER_LOG_MAX + 9, 'newest first');

  // A refresh gets a row of its own, since its documents may be fetched
  // already. (Break on purpose: drop `refresh` from renderStats' key, and
  // these collapse into one row of 3 renders.)
  const mixed = [
    { view: 'comp', refresh: false, ms: 900, fetches: 12 },
    { view: 'comp', refresh: true, ms: 120, fetches: 1 },
    { view: 'comp', refresh: true, ms: 100, fetches: 1 },
    { view: 'group', refresh: false, ms: 300, fetches: 3 },
  ].reduce(logRender, []);
  const stats = renderStats(mixed);
  assert.deepEqual(
    stats.map((v) => `${v.view} ${v.renders}`),
    ['comp 1', 'group 1', 'comp (refresh) 2'],
    'worst first, a refresh apart',
  );
  assert.deepEqual(stats[0], { view: 'comp', renders: 1, ms: 900, msWorst: 900, fetches: 12, fetchesWorst: 12 });

  // A row reports the median, so one cold open does not carry it.
  // (Break on purpose: average instead, and this reads 3433 ms.)
  const cold = [
    { ms: 10000, fetches: 1 },
    { ms: 200, fetches: 1 },
    { ms: 100, fetches: 1 },
  ]
    .map((r) => ({ ...r, view: 'home', refresh: false }))
    .reduce(logRender, []);
  assert.equal(renderStats(cold)[0].ms, 200);

  assert.deepEqual(renderStats([]), []);

  // A stored log can hold rows of an older shape. (Break on purpose: return
  // the array as it came, and the page renders "NaN ms".)
  assert.deepEqual(
    normalizeRenderLog([
      { view: 'comp', ms: 12, fetches: 1 },
      { view: 'comp', fetches: 1 },
      { ms: 12, fetches: 1 },
      { view: 'comp', ms: 12 },
      null,
    ]),
    [{ view: 'comp', refresh: false, at: 0, ms: 12, fetches: 1, fetchMs: 0 }],
  );
  assert.deepEqual(normalizeRenderLog(null), []);
  assert.equal(
    normalizeRenderLog(Array(RENDER_LOG_MAX + 5).fill({ view: 'a', ms: 1, fetches: 0 })).length,
    RENDER_LOG_MAX,
  );

  // Copy puts tab-separated rows on the clipboard, which paste into a sheet
  // as columns.
  const tsv = renderLogTsv([{ at: 0, view: 'comp', refresh: true, ms: 12.6, fetches: 3, fetchMs: 4.2 }]);
  assert.deepEqual(tsv.split('\n'), [
    'time\tview\trefresh\tms\trequests\tslowest_ms',
    '1970-01-01T00:00:00.000Z\tcomp\t1\t13\t3\t4',
  ]);
  assert.equal(renderLogTsv([]).split('\n').length, 1, 'a header even with nothing under it');
  assert.equal(msText(0), '0 ms');
  assert.equal(msText(999), '999 ms');
  assert.equal(msText(1000), '1,0 s', 'a decimal comma, and seconds once ms say nothing');
  assert.equal(msText(12345), '12,3 s');
});

// --- parseRoute: the route table (docs/architecture.md) ---
test('parseRoute', () => {
  assert.deepEqual(parseRoute(''), { view: 'home' });
  assert.deepEqual(parseRoute('/', '#/'), { view: 'home' });
  assert.deepEqual(parseRoute('/c/20224'), { view: 'comp', compId: '20224' });
  assert.deepEqual(parseRoute('/c/20224/d/2026-08-08'), { view: 'comp', compId: '20224', date: '8.8.2026' });
  assert.deepEqual(parseRoute('/c/demo/g/2026-08-08T12:00:00+03:00|Kuula'), {
    view: 'group',
    compId: 'demo',
    key: '2026-08-08T12:00:00+03:00|Kuula',
  });
  assert.deepEqual(
    parseRoute('/c/demo/g/2026-08-08T12%3A00%3A00%2B03%3A00%7CKuula').key,
    '2026-08-08T12:00:00+03:00|Kuula',
    'an encoded group key decodes to the same route',
  );
  // routeOf parses a link the app hands out as the browser holds it.
  const routeOf = (link) => {
    const u = new URL(link, 'https://kisat.test');
    return parseRoute(u.pathname, u.hash);
  };
  // The quick-filter's link names the person in the fragment.
  assert.deepEqual(parseRoute('/c/demo', '#/a/g1-a'), { view: 'athleteLink', compId: 'demo', athleteId: 'g1-a' });
  assert.equal(parseRoute('/', '#/a/g1-a').view, 'home', 'no meet, no filter');
  // Temporary: the shape shared before 2026-09-13 parses (docs/shims.md).
  assert.deepEqual(parseRoute('/', '#/c/demo/a/g1-a'), { view: 'athleteLink', compId: 'demo', athleteId: 'g1-a' });
  // The club quick-filter's link is /s/ for seura, as /o/ is the
  // multi-event's.
  assert.deepEqual(parseRoute('/c/20224', '#/s/591'), { view: 'clubLink', compId: '20224', orgId: '591' });
  assert.deepEqual(
    parseRoute('/', '#/c/20224/s/591'),
    { view: 'clubLink', compId: '20224', orgId: '591' },
    'the old shape',
  );
  // Both kinds of focusLink parse back into their routes.
  assert.deepEqual(routeOf(focusLink('20224', { kind: 'club', id: '591' })), {
    view: 'clubLink',
    compId: '20224',
    orgId: '591',
  });
  assert.deepEqual(routeOf(focusLink('demo', { kind: 'athlete', id: 'g1-a' })), {
    view: 'athleteLink',
    compId: 'demo',
    athleteId: 'g1-a',
  });
  // A made id keeps å, ä and ö (docs/elsewhere.md), which a URL encodes.
  // (Break on purpose: make parseLinkHash's /a/ id [\w-]+.)
  assert.deepEqual(routeOf(focusLink('maraton-2026', { kind: 'athlete', id: 'ol-12-venlamäkimallinen' })), {
    view: 'athleteLink',
    compId: 'maraton-2026',
    athleteId: 'ol-12-venlamäkimallinen',
  });
  assert.deepEqual(routeOf(focusLink('maraton-2026', { kind: 'club', id: 'ol-mäkimallinkisa' })), {
    view: 'clubLink',
    compId: 'maraton-2026',
    orgId: 'ol-mäkimallinkisa',
  });
  assert.deepEqual(routeOf(medalsPath('maraton-2026', [], 'ol-mäkimallinkisa')), {
    view: 'medals',
    compId: 'maraton-2026',
    ages: [],
    club: 'ol-mäkimallinkisa',
  });
  assert.equal(routeOf(`/mestaruudet${seasonHash('sm', 2026, [], 'ol-mäkimallinkisa')}`).club, 'ol-mäkimallinkisa');
  // The kenttä link is written by hand, so its shape is pinned here
  // (docs/venues.md).
  assert.deepEqual(parseRoute('/c/demo/k/demola-mallikentta'), {
    view: 'venueLink',
    compId: 'demo',
    venueId: 'demola-mallikentta',
  });
  assert.deepEqual(parseRoute('/c/demo/k/400'), { view: 'venueLink', compId: 'demo', venueId: '400' });
  assert.equal(parseRoute('/c/demo/k/demola-mallikentta/d/2026-08-08').view, 'home', 'no day on it');
  // The day's hurdle sheet is always dated, and a dateless path is home.
  assert.deepEqual(parseRoute('/c/demo/aidat/2026-08-08'), { view: 'hurdleSheet', compId: 'demo', date: '8.8.2026' });
  // A day is YYYY-MM-DD in the path and the schedule's key in the route, and
  // the builders round-trip. (Break on purpose: make dayPath write the key.)
  assert.equal(dayPath('demo', '8.8.2026'), '/c/demo/d/2026-08-08');
  assert.equal(parseRoute(dayPath('demo', '31.12.2026')).date, '31.12.2026');
  assert.equal(parseRoute(hurdleSheetPath('demo', '7.8.2026')).date, '7.8.2026');
  assert.equal(parseRoute('/c/demo/d/8.8.2026').view, 'home', 'the Worker redirects the D.M.YYYY path');
  // Temporary: a day's D.M.YYYY path redirects to its YYYY-MM-DD one
  // (legacyDayPath, docs/shims.md).
  assert.deepEqual(
    ['/c/20224/d/8.8.2026', '/c/demo/aidat/31.12.2026', '/c/demo/d/2026-08-08', '/c/demo/g/8.8.2026'].map(
      legacyDayPath,
    ),
    ['/c/20224/d/2026-08-08', '/c/demo/aidat/2026-12-31', null, null],
  );
  assert.equal(parseRoute('/c/demo/aidat').view, 'home', 'no dateless form');
  // The table page has its own path and fragment (renderHurdleTable,
  // app/tables.js).
  assert.equal(TABLE_PAGE_PATH, '/mitat');
  const none = { tab: 'aidat', ages: [], venueId: null, open: null };
  const at = (fields) => ({ ...none, ...fields });
  assert.deepEqual(parseTablePageHash(''), none);
  assert.deepEqual(parseTablePageHash('#/'), none);
  assert.deepEqual(parseTablePageHash('#/nonsense'), none);
  assert.deepEqual(parseTablePageHash('#/esteet/12'), none, 'no such tab');
  // A fragment with no tab reads as the hurdle tab.
  assert.deepEqual(parseTablePageHash('#/12,13'), at({ ages: [12, 13] }));
  assert.deepEqual(parseTablePageHash('#/k/demola-mallikentta'), at({ venueId: 'demola-mallikentta' }));
  assert.deepEqual(
    parseTablePageHash('#/40,0/k/demola-mallikentta'),
    at({ ages: [0, 40], venueId: 'demola-mallikentta' }),
  );
  assert.deepEqual(parseTablePageHash('#/k/200'), at({ venueId: '200' }), 'a bare length, as the venue link');
  assert.deepEqual(parseTablePageHash('#/valineet'), at({ tab: 'valineet' }));
  assert.deepEqual(
    parseTablePageHash('#/valineet/13/k/ulkoradat'),
    at({ tab: 'valineet', ages: [13], venueId: 'ulkoradat' }),
  );
  assert.deepEqual(parseTablePageHash('#/aidat/k/ulkoradat'), at({ venueId: 'ulkoradat' }));
  // A relay's or a steeple's link opens its folded section.
  assert.deepEqual(parseTablePageHash('#/aidat/k/ulkoradat/viestit'), at({ venueId: 'ulkoradat', open: 'viestit' }));
  assert.deepEqual(parseTablePageHash('#/esteet'), at({ open: 'esteet' }));
  assert.equal(tablePageHash('aidat', [40, 12, 0], 'x'), '#/aidat/12,0,40/k/x');
  assert.equal(tablePageHash('aidat', [], null), '#/aidat');
  assert.equal(tablePageHash('valineet', [], '200'), '#/valineet/k/200', 'no empty segment before the kenttä');
  assert.equal(tablePageHash('aidat', [], 'x', 'viestit'), '#/aidat/k/x/viestit');
  assert.deepEqual(
    parseTablePageHash(tablePageHash('valineet', [65, 17], 'demola-mallikentta')),
    at({ tab: 'valineet', ages: [17, 65], venueId: 'demola-mallikentta' }),
  );
  assert.deepEqual(
    parseTablePageHash(tablePageHash('aidat', [12], 'x', 'esteet')),
    at({ ages: [12], venueId: 'x', open: 'esteet' }),
  );

  // On the championship page, no scope in the fragment is the list of scopes.
  assert.equal(MEDAL_SEASON_PAGE_PATH, '/mestaruudet');
  const noSeason = { scopeId: null, year: null, ages: [], club: null };
  assert.deepEqual(parseSeasonHash(''), noSeason);
  assert.deepEqual(parseSeasonHash('#/'), noSeason);
  assert.deepEqual(parseSeasonHash('#/2026'), { ...noSeason, year: 2026 }, "a year alone is the scopes' list");
  assert.deepEqual(parseSeasonHash('#/2026/13'), noSeason, 'nothing after a bare year');
  assert.deepEqual(parseSeasonHash('#/demy/2026/k/x'), noSeason);
  assert.deepEqual(parseSeasonHash('%E0'), noSeason, 'a malformed escape');
  assert.deepEqual(parseSeasonHash('#/demolainen'), { scopeId: 'demolainen', year: null, ages: [], club: null });
  assert.deepEqual(parseSeasonHash('#/demy/2026'), { scopeId: 'demy', year: 2026, ages: [], club: null });
  assert.deepEqual(parseSeasonHash('#/demy/2026/15,9,9'), { scopeId: 'demy', year: 2026, ages: [9, 15], club: null });
  assert.deepEqual(
    parseSeasonHash('#/demy/13'),
    { scopeId: 'demy', year: null, ages: [13], club: null },
    'ages without a year',
  );
  assert.equal(seasonHash('demy', 2026, [40, 12, 0]), '#/demy/2026/12,0,40');
  // A masters' row can be filed at Age 30, and the ages still have one order.
  // (Break on purpose: sort yleinen as 30.)
  assert.equal(seasonHash('demy', 2026, [30, 0]), seasonHash('demy', 2026, [0, 30]));
  assert.equal(seasonHash('demy'), '#/demy');
  assert.equal(seasonHash(null), '#/');
  assert.deepEqual(parseSeasonHash(seasonHash('maly', 2025, [17, 14])), {
    scopeId: 'maly',
    year: 2025,
    ages: [14, 17],
    club: null,
  });
  assert.deepEqual(
    parseSeasonHash(seasonHash('maly', 2025, [17], '123')),
    { scopeId: 'maly', year: 2025, ages: [17], club: '123' },
    'the picked club last',
  );
  assert.deepEqual(
    parseSeasonHash('#/demy/s/7'),
    { scopeId: 'demy', year: null, ages: [], club: '7' },
    'a club without a year',
  );
  assert.equal(seasonHash(null, null, [], '7'), '#/', 'no club without a scope');
  assert.equal(seasonHash(null, 2025, [13], '7'), '#/2025', 'the year alone without a scope');
  // The cup's page opens bare, on the osakilpailut, a piiri or the finals.
  // (Break on purpose: read `finaalit` as a piiri, or give no scope the
  // osakilpailut.)
  const cupAt = (over) => ({ view: 'cupSeason', tab: null, piiriId: null, year: null, club: null, ...over });
  assert.deepEqual(parseRoute(CUP_SEASON_PAGE_PATH, ''), cupAt({}));
  assert.deepEqual(
    parseRoute(CUP_SEASON_PAGE_PATH, seasonHash(null, 2025)),
    cupAt({ year: 2025 }),
    'a year alone opens on its own tab',
  );
  assert.deepEqual(
    parseRoute('/seuracup', seasonHash(CUP_TAB_ROUNDS, 2026, [], '7')),
    cupAt({ tab: 'osakilpailut', year: 2026, club: '7' }),
  );
  assert.deepEqual(
    parseRoute('/seuracup', '#/helsy/2026/s/7'),
    cupAt({ tab: 'osakilpailut', piiriId: 'helsy', year: 2026, club: '7' }),
  );
  assert.deepEqual(
    parseRoute('/seuracup', '#/helsy/13'),
    cupAt({ tab: 'osakilpailut', piiriId: 'helsy' }),
    'no ages on the cup',
  );
  assert.deepEqual(parseRoute('/seuracup', seasonHash(CUP_TAB_FINALS, 2026)), cupAt({ tab: 'finaalit', year: 2026 }));
  assert.deepEqual(parseRoute('/seuracup', '#/finaalit/s/7'), cupAt({ tab: 'finaalit' }), "no club on the finals' tab");
  // A multi-event's standings are keyed by its label, spaces included.
  assert.deepEqual(parseRoute('/c/20363/o/N17 7-ottelu'), { view: 'combined', compId: '20363', key: 'N17 7-ottelu' });
  assert.equal(parseRoute('/c/20363/o/N17%207-ottelu').key, 'N17 7-ottelu');
  assert.equal(parseRoute('/c/20363/o/N17 7-ottelu?w=abcdef123456').view, 'home');
  // The club cup's standings are a literal segment with no key, matched
  // before the competition route.
  assert.deepEqual(parseRoute('/c/20354/cup'), { view: 'cup', compId: '20354', club: null });
  assert.deepEqual(
    parseRoute(cupPath('20354', '4121')),
    { view: 'cup', compId: '20354', club: '4121' },
    'the picked club after it',
  );
  assert.equal(cupPath('20354'), '/c/20354/cup');
  // Temporary: a club's page shared before 2026-09-17 reads as the pick
  // (docs/shims.md).
  assert.deepEqual(parseRoute('/c/20354/cup/4121'), { view: 'cup', compId: '20354', club: '4121' });
  assert.equal(parseRoute('/c/20354/cup/s').view, 'home', 'no club named');
  assert.deepEqual(parseRoute('/c/20354/mitalit'), { view: 'medals', compId: '20354', ages: [], club: null });
  assert.deepEqual(
    parseRoute(medalsPath('20354', [15, 0, 13, 15])),
    { view: 'medals', compId: '20354', ages: [13, 15, 0], club: null },
    'the age chips on it',
  );
  assert.deepEqual(
    parseRoute(medalsPath('20354', [17], '4121')),
    { view: 'medals', compId: '20354', ages: [17], club: '4121' },
    'the picked club after them',
  );
  assert.deepEqual(parseRoute('/c/20354/mitalit/s/4121'), { view: 'medals', compId: '20354', ages: [], club: '4121' });
  // A meet that stands alone is keyed "<word>-<year>" (ALONE_ID_RE), which
  // every route of a meet takes. (Break on purpose: make parseRoute's ids
  // `\w+`.)
  assert.deepEqual(
    [parseRoute('/c/maraton-2026'), parseRoute('/c/maraton-2026/mitalit'), parseRoute('/c/maraton-2026/d/2026-08-08')],
    [
      { view: 'comp', compId: 'maraton-2026' },
      { view: 'medals', compId: 'maraton-2026', ages: [], club: null },
      { view: 'comp', compId: 'maraton-2026', date: '8.8.2026' },
    ],
  );
  assert.deepEqual(
    [ALONE_ID_RE.test('maraton-2026'), ALONE_ID_RE.test('20354'), ALONE_ID_RE.test('demo')],
    [true, false, false],
  );
  assert.equal(medalsPath('20354'), '/c/20354/mitalit');
  assert.equal(parseRoute('/c/20354/mitalit/x').view, 'home');
  assert.equal(parseRoute('/c/20354/cup/d/2026-08-08').view, 'home', 'no day on it');
  assert.equal(parseRoute('/c/cup').view, 'comp', 'a competition is still a competition');
  // The lap counter's route is tried before the group route. (Break on
  // purpose: swap the two, and this reads `group` with `/laps` in its key.)
  assert.deepEqual(parseRoute('/c/demo/g/2026-08-08T12:00:00+03:00|4x100m viesti/laps'), {
    view: 'laps',
    compId: 'demo',
    key: '2026-08-08T12:00:00+03:00|4x100m viesti',
  });
  assert.equal(
    parseRoute('/c/demo/g/2026-08-08T12:00:00+03:00|Kuula').view,
    'group',
    'a start without the suffix is still the ordinary event view',
  );
  assert.deepEqual(parseRoute('/', '#/w/abcdef123456'), { view: 'watchLink', watchId: 'abcdef123456' });
  // A Watch's link may name the meet it was shared from, where it lands.
  assert.deepEqual(parseRoute('/c/20224', '#/w/abcdef123456'), {
    view: 'watchLink',
    watchId: 'abcdef123456',
    compId: '20224',
  });
  assert.deepEqual(
    parseRoute('/', '#/w/abcdef123456/c/20224'),
    { view: 'watchLink', watchId: 'abcdef123456', compId: '20224' },
    'the shape shared before 13.9.2026',
  );
  assert.equal(parseRoute('/c/20224', '#/w/abcdef123456/c/20169').compId, '20224', 'the path wins over an old suffix');
  // The edit link adds the editToken as its last segment, so a read link is
  // an edit link's prefix (parseLinkHash, lib/routes.js).
  const tok = '0123456789abcdef0123456789abcdef';
  assert.deepEqual(parseRoute('/', `#/w/abcdef123456/e/${tok}`), {
    view: 'watchLink',
    watchId: 'abcdef123456',
    editToken: tok,
  });
  assert.deepEqual(parseRoute('/c/20224', `#/w/abcdef123456/e/${tok}`), {
    view: 'watchLink',
    watchId: 'abcdef123456',
    compId: '20224',
    editToken: tok,
  });
  assert.deepEqual(
    parseRoute('/', `#/w/abcdef123456/c/20224/e/${tok}`),
    { view: 'watchLink', watchId: 'abcdef123456', compId: '20224', editToken: tok },
    'the old shape',
  );
  // The suffixes are ordered, so /e/ before /c/ is no route. (Break on
  // purpose: make the two optional groups interchangeable, and this reads as
  // a watchLink with the meet and the token swapped.)
  assert.equal(parseRoute('/', `#/w/abcdef123456/e/${tok}/c/20224`).view, 'home');
  // An absent suffix is an absent key, not an undefined one.
  assert.deepEqual(Object.keys(parseRoute('/', '#/w/abcdef123456')), ['view', 'watchId']);
  // A Watch's link carries no day, and nothing longer is a route.
  assert.equal(parseRoute('/', '#/w/abcdef123456/d/2026-08-08').view, 'home');
  assert.equal(parseRoute('/', '#/w/abcdef123456/c/20224/d/2026-08-08').view, 'home');
  assert.equal(parseRoute('/', `#/w/abcdef123456/c/20224/e/${tok}/d/2026-08-08`).view, 'home');
  // Every link watchLink builds parses back into its route. (Break on
  // purpose: write the meet into the fragment after the token, and the last
  // of these falls through to home.)
  for (const [compId, editToken] of [
    [null, null],
    ['20224', null],
    [null, tok],
    ['20224', tok],
  ]) {
    const route = routeOf(watchLink('abcdef123456', compId, editToken));
    assert.equal(route.view, 'watchLink', watchLink('abcdef123456', compId, editToken));
    assert.equal(route.watchId, 'abcdef123456');
    assert.equal(route.compId ?? null, compId);
    assert.equal(route.editToken ?? null, editToken);
  }
  assert.equal(watchLink('abcdef123456'), '/#/w/abcdef123456', 'the read link is unchanged');
  assert.equal(
    watchLink('abcdef123456', '20224', tok),
    `/c/20224#/w/abcdef123456/e/${tok}`,
    'the meet in the path, so a preview names it',
  );
  assert.equal(focusLink('20224', { kind: 'club', id: '591' }), '/c/20224#/s/591');

  // The pairing link carries the whole registry (keyringLinkHash).
  const tok2 = 'fedcba9876543210fedcba9876543210';
  const rows = [
    { watchId: 'abcdef123456', editToken: tok },
    { watchId: '123456abcdef', editToken: null },
  ];
  assert.equal(keyringLinkHash(rows), `#/k/abcdef123456:${tok},123456abcdef`);
  assert.deepEqual(
    parseRoute('/', keyringLinkHash(rows)),
    { view: 'pairLink', pairs: [{ watchId: 'abcdef123456', editToken: tok }, { watchId: '123456abcdef' }] },
    'the link the menu hands out parses back into the route it was built from',
  );
  // A list this device can only read travels as its id alone. (Break on
  // purpose: drop the `editToken === undefined` branch in keyringPairs, and
  // this carries `editToken: undefined`.)
  assert.deepEqual(keyringPairs('123456abcdef'), [{ watchId: '123456abcdef' }]);
  assert.deepEqual(Object.keys(keyringPairs('123456abcdef')[0]), ['watchId']);
  // A mangled segment costs only itself. (Break on purpose: return [] on the
  // first bad part, and the two good ones go too.)
  assert.deepEqual(keyringPairs(`abcdef123456:${tok},:${tok2},x:y:z,,123456abcdef`), [
    { watchId: 'abcdef123456', editToken: tok },
    { watchId: '123456abcdef' },
  ]);
  // A repeated id keeps its first appearance, in the registry's order.
  assert.deepEqual(keyringPairs(`abcdef123456:${tok},abcdef123456:${tok2}`), [
    { watchId: 'abcdef123456', editToken: tok },
  ]);
  // The registry's own cap bounds the link.
  assert.equal(keyringPairs(Array.from({ length: 40 }, (_, i) => `w${i}`).join(',')).length, 30);
  // A link with nothing parseable in it is no route.
  assert.equal(parseRoute('/', '#/k/').view, 'home');
  assert.equal(parseRoute('/', '#/k/:::').view, 'home');
  assert.equal(parseRoute('/', `#/k/abcdef123456:${tok}/c/20224`).view, 'home', 'no suffixes on this one');
  // A link can arrive by paste (pastedLink). What came with it is stripped,
  // and the rest has to be a route.
  const shared = watchLink('abcdef123456', '20224', tok);
  assert.equal(
    pastedLink(`https://kisat.matilainen.fi${shared}`),
    shared,
    'the link the app hands out is what comes back out of a paste of it',
  );
  assert.equal(pastedLink(shared), shared, 'the hash alone is a paste too');
  assert.equal(
    pastedLink(`https://juoksut.matilainen.fi${shared}`),
    shared,
    'either host: what the route needs is the hash',
  );
  // A meet that stands alone keeps its path. (Break on purpose: make the
  // path's id \w+, and the paste lands on home.)
  const alone = watchLink('abcdef123456', 'maraton-2026', tok);
  assert.equal(pastedLink(`https://kisat.matilainen.fi${alone}`), alone);
  // A paste out of a chat carries the words around it and the sentence's
  // punctuation. (Break on purpose: match to the end of the string, and both
  // of these come back null.)
  assert.equal(pastedLink(`Katso tämä: https://kisat.matilainen.fi${shared}.`), shared);
  assert.equal(pastedLink(`(https://kisat.matilainen.fi${shared})\nterveisin T`), shared);
  // The pairing link keeps its : and , through the strip. (Break on purpose:
  // drop them from its branch of the match, and this comes back as the first
  // id alone.)
  assert.equal(pastedLink(`https://kisat.matilainen.fi/${keyringLinkHash(rows)}`), `/${keyringLinkHash(rows)}`);
  // A Watch link holds no : or , so one after it belongs to the sentence.
  // (Break on purpose: match both shapes with one class, and the trailing
  // comma makes parseLinkHash refuse the link.)
  assert.equal(pastedLink(`kato tästä https://kisat.matilainen.fi${shared}, moi`), shared);
  // A pairing link keeps a trailing comma, which keyringPairs skips as an
  // empty pair.
  assert.deepEqual(
    routeOf(pastedLink(`${keyringLinkHash(rows)}, terveisin T`)).pairs,
    keyringPairs(keyringLinkHash(rows).slice(4)),
  );
  // Only a Watch or a pairing link is taken. The match's class and the route
  // each refuse the rest, so widening one changes nothing here.
  assert.equal(pastedLink('https://kisat.matilainen.fi/c/20224#/a/i1-a'), null);
  assert.equal(pastedLink('https://kisat.matilainen.fi/c/20224'), null);
  // The shape shared before 2026-09-13 and a bare read link are taken too.
  assert.equal(
    pastedLink(`https://kisat.matilainen.fi/#/w/abcdef123456/c/20224/e/${tok}`),
    `/#/w/abcdef123456/c/20224/e/${tok}`,
  );
  assert.equal(pastedLink('https://kisat.matilainen.fi/#/w/abcdef123456'), '/#/w/abcdef123456');
  // No link, a half-parsed link and an empty registry give nothing.
  assert.equal(pastedLink('moikka, muistatko lähettää sen linkin'), null);
  assert.equal(pastedLink(''), null);
  assert.equal(pastedLink(null), null);
  assert.equal(pastedLink('#/w/'), null);
  assert.equal(pastedLink('#/k/'), null);
  // The route alone refuses a /w/ shape that is no route. (Break on purpose:
  // return m[0] whatever parseLinkHash makes of it, and this comes back a
  // link.)
  assert.equal(
    pastedLink(`#/w/abcdef123456/e/${tok}/c/20224`),
    null,
    'a shape parseLinkHash refuses is not made a route by being pasted',
  );

  // A path with a ?w= query is no route and falls through to home. (Break on
  // purpose: make the group route's key `(.+)`, and the second of these
  // matches a group.)
  assert.equal(parseRoute('/c/20224/d/2026-08-08?w=abcdef123456').view, 'home');
  assert.equal(parseRoute('/c/demo/g/x|y?w=abcdef123456').view, 'home');
  assert.equal(parseRoute('/', '#/%ZZ').view, 'home', 'an undecodable hash must not throw');
  assert.equal(parseRoute('/%ZZ').view, 'home', 'nor an undecodable path');
  assert.equal(parseRoute('/nonsense/route').view, 'home');
  assert.equal(parseRoute(null).view, 'home');

  // A view is a path and an activation link is a fragment, never the other
  // way round (docs/architecture.md). (Break on purpose: parse the hash on
  // every path, and the second of these reads a watchLink under a meet.)
  assert.equal(parseRoute('/', '#/c/20224').view, 'home', 'a view is not a fragment');
  assert.equal(
    parseRoute('/c/20224/d/2026-08-08', '#/w/abcdef123456').view,
    'comp',
    'a fragment under any other view is ignored',
  );
  assert.equal(parseRoute('/c/20224', '#/c/20224').view, 'comp', 'and so is a view fragment under a meet');
  assert.equal(parseRoute('/c/20224', '#/k/abcdef123456').view, 'comp', 'the pairing link lands on home alone');
  assert.equal(parseRoute('/c/20224/a/g1-a').view, 'home', 'the quick-filter link is not a path');
  assert.equal(parseRoute('/w/abcdef123456').view, 'home', 'nor is a Watch link');
  assert.deepEqual(parseLinkHash('#/c/20224/s/591'), parseRoute('/', '#/c/20224/s/591'));
  // The table page goes through the same router.
  assert.deepEqual(parseRoute(TABLE_PAGE_PATH, '#/valineet/13/k/ulkoradat'), {
    view: 'implementTable',
    ages: [13],
    venueId: 'ulkoradat',
    open: null,
  });
  assert.equal(parseRoute(TABLE_PAGE_PATH).view, 'hurdleTable');
  assert.deepEqual(TABLE_TAB_VIEWS, { aidat: 'hurdleTable', valineet: 'implementTable' });
  assert.deepEqual(parseRoute(MEDAL_SEASON_PAGE_PATH, '#/demy/2026/13'), {
    view: 'medalSeason',
    scopeId: 'demy',
    year: 2026,
    ages: [13],
    club: null,
  });
  assert.equal(parseRoute(`${MEDAL_SEASON_PAGE_PATH}/demy`).view, 'home', 'the scope is not a path');

  // Temporary: a view's fragment shared before 2026-09-12 becomes its path at
  // boot (legacyRoutePath, docs/shims.md). An activation link or a fragment
  // that was never a view gives null.
  assert.equal(legacyRoutePath('#/c/20224/d/2026-08-08'), '/c/20224/d/2026-08-08');
  assert.equal(legacyRoutePath('#/c/20224/d/8.8.2026'), '/c/20224/d/2026-08-08', 'with its day as YYYY-MM-DD');
  assert.equal(
    legacyRoutePath('#/c/demo/g/2026-08-08T12%3A00%3A00%2B03%3A00%7CKuula'),
    '/c/demo/g/2026-08-08T12%3A00%3A00%2B03%3A00%7CKuula',
    'encoded as the browser holds it',
  );
  assert.equal(
    legacyRoutePath('#/c/demo/k/demola-mallikentta'),
    '/c/demo/k/demola-mallikentta',
    'the kenttä link is a path too',
  );
  assert.equal(legacyRoutePath('#/c/demo/a/g1-a'), null);
  assert.equal(legacyRoutePath('#/w/abcdef123456/c/20224'), null);
  assert.equal(legacyRoutePath('#/'), null);
  assert.equal(legacyRoutePath(''), null);
  assert.equal(legacyRoutePath('#/c/20224/x/y'), null, 'a fragment that was never a route stays where it is');

  // An id typed into home's search box jumps to its route. (Break on purpose:
  // drop the anchors, and "20224 kalevan" comes back a path.)
  assert.equal(searchJumpPath('20224'), '/c/20224');
  assert.equal(parseRoute(searchJumpPath('20224')).compId, '20224');
  assert.equal(searchJumpPath(' 20224 '), '/c/20224', 'a paste brings whitespace with it');
  // Everything else is a name to search for, not a jump.
  assert.equal(searchJumpPath('kalevan kisat'), null);
  assert.equal(searchJumpPath('20224 kalevan'), null);
  // A demo meet's id jumps too, as the demos have no row on the front page.
  assert.equal(searchJumpPath(DEMO_ID), `/c/${DEMO_ID}`);
  assert.equal(searchJumpPath(` ${DEMO_CUP_ID.toUpperCase()} `), `/c/${DEMO_CUP_ID}`);
  assert.equal(parseRoute(searchJumpPath(DEMO_CUP_ID)).compId, DEMO_CUP_ID);
  // A word that is no demo id stays a search. (Break on purpose: take any \w+
  // as an id.)
  assert.equal(searchJumpPath('demot'), null);
  // A page reloads for a module it failed to load once a minute at most, and
  // one with no readable time may. (Break on purpose: return true.)
  const now = 1_000_000;
  assert.equal(reloadDue(null, now), true);
  assert.equal(reloadDue('not a time', now), true);
  assert.equal(reloadDue(String(now - RELOAD_GAP_MS - 1), now), true);
  assert.equal(reloadDue(String(now - 1000), now), false, 'a page that just reloaded shows the error');
  // app/data.js loads demo.js for these ids alone, so each must name a demo
  // meet. (Break on purpose: add a word to DEMO_IDS.)
  for (const id of DEMO_IDS) assert.ok(demoMeet(id), `${id} is a demo meet`);
  assert.equal(isDemoId(20224), false);
  assert.equal(searchJumpPath('2026'), '/c/2026', 'a year reads as an id; nothing tells them apart');
  assert.equal(searchJumpPath(''), null);
  assert.equal(searchJumpPath(null), null);
});

// --- Layers: what the back gesture does to a sheet or the quick-filter
// (docs/architecture.md, "Layers") ---
test('layers', () => {
  // With nothing stacked, every press is a route traversal.
  assert.equal(layerPopAction(null, null, 0), 'route');
  // A layer is open and the reader stands on its entry, so back closes it.
  assert.equal(layerPopAction(7, 7, 0), 'close');
  // A rewind the app has in flight settles, whatever the entry. (Break on
  // purpose: drop the pendingBack branch, and closing one sheet takes the
  // layer under it too.)
  assert.equal(layerPopAction(7, 7, 1), 'settle');
  assert.equal(layerPopAction(null, null, 1), 'settle');
  // A sentinel buried under a navigation, such as an event opened from the
  // quick-filter, leaves back to the route.
  assert.equal(layerPopAction(7, null, 0), 'route');
  // A stale entry left by a torn-down sheet is no open layer's sentinel.
  assert.equal(layerPopAction(null, 7, 0), 'route');
  assert.equal(layerPopAction(9, 7, 0), 'route');

  // Closing from inside the page keeps the sentinel while a layer remains.
  assert.equal(layerCloseAction(7, 7, 1), 'keep');
  // The last layer closing on its own entry gives the entry back.
  assert.equal(layerCloseAction(7, 7, 0), 'rewind');
  // A buried or lost entry is dropped. (Break on purpose: rewind these, and
  // the header's back arrow leaves the meet instead of clearing the filter.)
  assert.equal(layerCloseAction(7, null, 0), 'drop');
  assert.equal(layerCloseAction(null, null, 0), 'drop');
  assert.equal(layerCloseAction(null, 7, 0), 'drop');
});

// --- menuAnchorPos / anchorMoved: where an anchored menu lands ---
test('menu anchoring', () => {
  const view = { width: 1000, height: 800 };
  const card = { width: 340, height: 200 };
  const at = (left, top, w = 120, h = 36) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });

  // The card aligns with the button's left edge, 6px under it.
  assert.deepEqual(menuAnchorPos(at(200, 100), card, view), { left: 200, top: 142 });
  // A button near the right edge pulls the card in to the 12px margin.
  // (Break on purpose: drop the Math.min, and the card hangs off the edge.)
  assert.deepEqual(menuAnchorPos(at(900, 100), card, view), { left: 648, top: 142 });
  // A button near the left edge does not take the card past the margin.
  assert.deepEqual(menuAnchorPos(at(4, 100), card, view).left, 12);
  // With no room below, the card flips above the button. (Break on purpose:
  // always return `below`, and the card runs off the bottom.)
  assert.deepEqual(menuAnchorPos(at(200, 700), card, view), { left: 200, top: 494 });
  // With room for neither, the card pins to the top margin and scrolls
  // itself.
  assert.deepEqual(menuAnchorPos(at(200, 400), { width: 340, height: 780 }, view).top, 12);
  // A card wider than the viewport pins to the margin.
  assert.equal(menuAnchorPos(at(200, 100), { width: 1200, height: 200 }, view).left, 12);

  // The page under a menu still scrolls, so the button can move out from
  // under the card.
  const btn = at(200, 100);
  assert.equal(anchorMoved(btn, at(200, 100)), false, 'a still page closes nothing');
  assert.equal(anchorMoved(btn, at(200, 60)), true, 'the page scrolled under it');
  // A sideways move counts too.
  assert.equal(anchorMoved(btn, at(140, 100)), true);
  // A pixel of slack absorbs a fractional re-measure. (Break on purpose: drop
  // the slack, and this closes a menu on a page that never moved.)
  assert.equal(anchorMoved(btn, at(200.02, 100.4)), false);
  assert.equal(anchorMoved(btn, at(200, 101.5)), true, 'but a real pixel and a half is a move');
});

// --- siteMode: the host picks the mode, ?mode= only on a dev host
// (docs/architecture.md) ---
test('siteMode', () => {
  assert.equal(siteMode('juoksut.matilainen.fi', ''), 'juoksut');
  assert.equal(siteMode('kisat.matilainen.fi', ''), 'kisat');
  assert.equal(siteMode('KISAT.matilainen.fi', ''), 'kisat', 'a host is case-insensitive');
  assert.equal(siteMode('JUOKSUT.matilainen.fi', ''), 'juoksut');
  // The first label must be exactly juoksut, as a tap log lives on one
  // origin.
  assert.equal(siteMode('juoksut-staging.matilainen.fi', ''), 'kisat');
  assert.equal(siteMode('www.juoksut.matilainen.fi', ''), 'kisat');
  assert.equal(siteMode('', ''), 'kisat', 'no host at all (a file:// page) is the default mode');
  // A dev host serves both modes, so the query string picks.
  assert.equal(siteMode('localhost', '?mode=juoksut'), 'juoksut');
  assert.equal(siteMode('localhost', '?mode=kisat'), 'kisat');
  assert.equal(
    siteMode('127.0.0.1', '?probe=probe-heats&mode=juoksut'),
    'juoksut',
    'the parameter need not be the first one',
  );
  assert.equal(siteMode('kisat.localhost', '?mode=juoksut'), 'juoksut');
  assert.equal(siteMode('localhost', ''), 'kisat', 'localhost with no override is Kisat');
  assert.equal(siteMode('kisat.example.workers.dev', '?mode=juoksut'), 'juoksut');
  assert.equal(
    siteMode('juoksut-dev-kisat.example.workers.dev', ''),
    'kisat',
    'a preview with no override is Kisat, whatever the branch was called',
  );
  assert.equal(siteMode('localhost', '?mode=nonsense'), 'kisat', 'an unknown mode is ignored');
  // (Break on purpose: drop the dev-host guard, and this one flips to
  // 'juoksut'.)
  assert.equal(
    siteMode('kisat.matilainen.fi', '?mode=juoksut'),
    'kisat',
    'the override is dev-only: production mode comes from the host alone',
  );
  assert.equal(siteMode('juoksut.matilainen.fi', '?mode=kisat'), 'juoksut');
  assert.equal(siteMode(null, null), 'kisat', 'missing arguments must not throw');

  // isDevHost also decides whether a route of the other mode leaves for the
  // other host (renderRoute, app.js).
  assert.equal(isDevHost('localhost'), true);
  assert.equal(isDevHost('kisat.localhost'), true);
  assert.equal(isDevHost('127.0.0.1'), true);
  assert.equal(isDevHost(''), true, 'a file:// page has no host to leave');
  assert.equal(isDevHost('kisat.example.workers.dev'), true);
  // (Break on purpose: match 'workers.dev' without the dot, and this one
  // turns true.)
  assert.equal(isDevHost('not-workers.dev'), false);
  assert.equal(isDevHost('workers.dev.matilainen.fi'), false);
  assert.equal(isDevHost('kisat.matilainen.fi'), false);
  assert.equal(isDevHost('juoksut.matilainen.fi'), false);

  const modeOf = (url) => routeMode(parseRoute(...url.split('#')));
  assert.equal(modeOf('/c/demo/g/x/laps'), 'juoksut', "the counter's taps are the Juoksut origin's");
  assert.equal(modeOf('/c/demo/k/400'), 'juoksut');
  assert.equal(modeOf('/c/demo/aidat/2026-08-08'), 'juoksut');
  assert.equal(modeOf('/c/demo/mitalit'), 'kisat');
  assert.equal(modeOf(`${MEDAL_SEASON_PAGE_PATH}#/sul`), 'kisat');
  assert.equal(modeOf(CUP_SEASON_PAGE_PATH), 'kisat');
  assert.equal(modeOf('/#/w/abcdef123456'), 'kisat', 'a follow-list is Kisat mode alone');
  assert.equal(modeOf('/c/demo#/a/9001'), 'kisat');
  assert.deepEqual(
    ['/', '/c/demo', '/c/demo/g/x', '/c/demo/o/x', '/c/democup/cup', TABLE_PAGE_PATH].map(modeOf),
    [null, null, null, null, null, null],
    'the rest render in both',
  );
  // A meet that stands alone is Kisat's. (Break on purpose: test ALONE_ID_RE
  // before the Juoksut views, and its counter URL turns Kisat's.)
  assert.deepEqual(
    ['/c/maraton-2026', '/c/maraton-2026/d/2026-09-12', '/c/maraton-2026/g/x', '/c/maraton-2026/o/x'].map(modeOf),
    ['kisat', 'kisat', 'kisat', 'kisat'],
  );
  assert.equal(modeOf('/c/maraton-2026/g/x/laps'), 'juoksut');
});

// A preview whose secret asks for its own data reads the preview namespaces.
// Any other deploy keeps its own, and the secret alone never falls back to
// production's KV. (Break on purpose: return env where a namespace is missing.)
test('previewEnv', () => {
  const prod = { ROSTER: 'roster', WATCHES: 'watches', ASSETS: 'assets' };
  const preview = { ...prod, ROSTER_PREVIEW: 'roster-preview', WATCHES_PREVIEW: 'watches-preview' };
  assert.equal(previewEnv(prod), prod, 'production keeps its KV');
  assert.equal(previewEnv(preview), preview, 'a preview without the secret shares production data');
  const own = previewEnv({ ...preview, PREVIEW_DATA: 'own' });
  assert.deepEqual(
    [own.ROSTER, own.WATCHES, own.ASSETS],
    ['roster-preview', 'watches-preview', 'assets'],
    'the secret swaps both namespaces and keeps every other binding',
  );
  assert.throws(() => previewEnv({ ...prod, PREVIEW_DATA: 'own' }), /no preview namespace/);
});

// --- siteAssetPath: the identity files the two hosts cannot share
// (SITE_ASSETS, lib/routes.js) ---
test('siteAssetPath', () => {
  assert.equal(siteAssetPath('/manifest.webmanifest', 'juoksut'), '/manifest-juoksut.webmanifest');
  assert.equal(siteAssetPath('/icon.svg', 'juoksut'), '/icon-juoksut.svg');
  assert.equal(siteAssetPath('/apple-touch-icon.png', 'juoksut'), '/apple-touch-icon-juoksut.png');

  // In Kisat mode null means serve what was asked for. (Break on purpose:
  // return the juoksut file whatever the mode.)
  assert.equal(siteAssetPath('/manifest.webmanifest', 'kisat'), null);
  assert.equal(siteAssetPath('/icon.svg', 'kisat'), null);

  // Only the three files at the root swap. siteMeta, below, rewrites the
  // document.
  assert.equal(siteAssetPath('/index.html', 'juoksut'), null);
  assert.equal(siteAssetPath('/app.js', 'juoksut'), null);
  assert.equal(siteAssetPath('/', 'juoksut'), null);
  // A swapped name does not swap again.
  assert.equal(siteAssetPath('/manifest-juoksut.webmanifest', 'juoksut'), null);
  assert.equal(siteAssetPath('/icon-juoksut.svg', 'juoksut'), null);
});

// --- siteMeta: the title and preview tags a crawler reads in the served
// document (docs/backend.md, "The document, and what a preview says") ---
test('siteMeta', () => {
  assert.equal(siteMeta('kisat'), null, "index.html ships Kisat's own strings untouched");
  assert.equal(siteMeta('juoksut').title, 'Juoksut');
  assert.match(siteMeta('juoksut').description, /juoksukiso/);
  assert.equal(siteMeta('juoksut', '/index.html').title, 'Juoksut');
  // The table pages name themselves on both hosts.
  assert.equal(siteMeta('juoksut', TABLE_PAGE_PATH).title, 'Aita- ja välinemitat · Juoksut');
  assert.equal(siteMeta('kisat', TABLE_PAGE_PATH).title, 'Aita- ja välinemitat · Kisat');
  assert.match(siteMeta('kisat', TABLE_PAGE_PATH).description, /^Aitajuoksujen/);
  assert.equal(siteMeta('kisat', '/seuracup').title, 'Seuracup · Kisat');
  assert.equal(siteMeta('juoksut', '/seuracup').title, 'Juoksut', "the cup year is Kisat's");
  // The championship page names itself on Kisat alone.
  assert.equal(siteMeta('kisat', MEDAL_SEASON_PAGE_PATH).title, 'Mestaruuskilpailut · Kisat');
  assert.equal(siteMeta('juoksut', MEDAL_SEASON_PAGE_PATH).title, 'Juoksut');
  // A meet's path is previewed per meet, on either host and under any view.
  // The row comes from the calendar's listing, else from /properties
  // (docs/backend.md).
  const row = {
    name: 'Testilän kisat',
    location: 'Testilä',
    organizationName: 'Testilän Kisa',
    date: '2026-08-07',
    days: ['7.8.2026', '8.8.2026', '9.8.2026'],
  };
  assert.deepEqual(siteMeta('kisat', '/c/20224', row), {
    title: 'Testilän kisat · Kisat',
    description: 'Testilä · Testilän Kisa · 7.8.–9.8.2026',
    siteName: 'Kisat',
  });
  assert.equal(
    siteMeta('juoksut', TABLE_PAGE_PATH).siteName,
    'Juoksut',
    'og:site_name stays the site, whatever the page',
  );
  assert.equal(siteMeta('juoksut', '/c/20224/g/x', row).title, 'Testilän kisat · Juoksut');
  assert.equal(
    siteMeta('kisat', '/c/20224', { ...row, days: [] }).description,
    'Testilä · Testilän Kisa · 7.8.2026',
    "the listing's one date where no schedule has been read",
  );
  assert.equal(
    siteMeta('kisat', '/c/20224', { name: 'X', location: 'Kilpailupaikka', organizationName: '', date: '' })
      .description,
    '',
    'nothing known is nothing said, not a stray ·',
  );
  assert.deepEqual(
    propertiesMeetRow({
      Competition: {
        Id: 20224,
        Name: 'Testilän kisat',
        BeginDate: '2026-08-07T09:00:00+00:00',
        Organization: 'Testilän Kisa',
      },
    }),
    { name: 'Testilän kisat', location: '', organizationName: 'Testilän Kisa', date: '2026-08-07', days: [] },
  );
  assert.equal(propertiesMeetRow({ Settings: [] }), null);
  assert.equal(propertiesMeetRow(null), null);
  assert.equal(isoToFiDay('2026-08-07'), '7.8.2026');
  assert.equal(isoToFiDay('2026-12-31'), '31.12.2026');
  assert.equal(isoToFiDay(''), '');

  // An HTMLRewriter selector that matches nothing fails silently, so the tags
  // worker.js rewrites must exist. (Break on purpose: rename one of these.)
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const head = html.split('</head>')[0];
  for (const tag of [
    '<title>',
    'name="description"',
    'property="og:title"',
    'property="og:site_name"',
    'property="og:description"',
  ]) {
    assert.ok(head.includes(tag), `index.html carries ${tag}`);
  }
  assert.ok(html.includes('<script type="module"'), 'preloadModules writes its lines before this tag');
  // The install prompt makes the same claim as the preview.
  const manifest = (name) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
  assert.equal(siteMeta('juoksut').description, manifest('../public/manifest-juoksut.webmanifest').description);
  assert.ok(head.includes(`content="${manifest('../public/manifest.webmanifest').description}"`));
});

// --- compViewState/compViewUpdate: the per-competition view state, read
// into one shape whatever localStorage holds (docs/architecture.md) ---
test('compViewState/compViewUpdate', () => {
  const defaults = {
    watchId: null,
    mode: 'watched',
    focus: null,
    cats: 'run',
    ages: [],
    events: [],
    counts: false,
    ottelut: true,
    recentOpen: false,
    scopes: null,
  };
  assert.deepEqual(compViewState([], 'c1'), defaults);
  assert.deepEqual(compViewState('garbage', 'c1'), defaults, 'a corrupt store reads as defaults, never throws');
  assert.deepEqual(
    compViewState([{ compId: 'c1', mode: 'sideways' }], 'c1'),
    defaults,
    'an unknown mode normalizes to watched, not passed through',
  );
  assert.equal(
    compViewState([{ compId: '#home', recentOpen: 'yes' }], '#home').recentOpen,
    false,
    'only a stored true opens Viimeksi katsotut',
  );

  let list = compViewUpdate([], 'c1', { watchId: 'w1' });
  assert.deepEqual(compViewState(list, 'c1'), { ...defaults, watchId: 'w1' });
  list = compViewUpdate(list, 'c1', { mode: 'all' });
  assert.deepEqual(
    compViewState(list, 'c1'),
    { ...defaults, watchId: 'w1', mode: 'all' },
    'a patch leaves the fields it does not name alone',
  );
  // The medals' scopes are kept once each by id and capped, and garbage is
  // dropped (normalizeScopes, lib/routes.js).
  list = compViewUpdate(list, 'c1', {
    scopes: [
      { id: 'helsy', cover: { ages: [15, '16', 15], events: ['', 'kolmiloikka', 3] } },
      { id: 'naid' },
      { id: 'helsy', cover: null },
      7,
      { id: '' },
    ],
  });
  assert.deepEqual(compViewState(list, 'c1').scopes, [
    { id: 'helsy', cover: { ages: [15], events: ['kolmiloikka'] } },
    { id: 'naid', cover: null },
  ]);
  assert.deepEqual(
    compViewState([{ compId: 'c1', scopes: [{ id: 'a', cover: {} }] }], 'c1').scopes,
    [{ id: 'a', cover: { ages: null, events: null } }],
    "a cover of every start is not the name's",
  );
  assert.equal(compViewState([{ compId: 'c1', scopes: 'helsy' }], 'c1').scopes, null, 'not a list: unset');
  assert.equal(
    compViewState([{ compId: 'c1', scopes: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id })) }], 'c1').scopes.length,
    5,
  );
  list = compViewUpdate(list, 'c1', { scopes: [] });
  assert.deepEqual(compViewState(list, 'c1').scopes, [], 'chosen none is not unset');
  // Temporary: a choice stored as piirit ids reads as scopes (docs/shims.md).
  assert.deepEqual(compViewState([{ compId: 'c1', piirit: ['helsy', 'naid'] }], 'c1').scopes, [
    { id: 'helsy', cover: null },
    { id: 'naid', cover: null },
  ]);
  assert.equal(
    'piirit' in compViewUpdate([{ compId: 'c1', piirit: ['helsy'] }], 'c1', { mode: 'all' })[0],
    false,
    'written back as scopes',
  );
  // Only a stored false folds the Ottelut section.
  assert.equal(compViewState([{ compId: 'c1', mode: 'all' }], 'c1').ottelut, true);
  assert.equal(compViewState([{ compId: 'c1', ottelut: false }], 'c1').ottelut, false);
  assert.equal(compViewState([{ compId: 'c1', ottelut: 'no' }], 'c1').ottelut, true);
  // The class and discipline filter keeps each choice once and drops garbage.
  list = compViewUpdate(list, 'c1', { ages: [13, '15', 13, 0], events: ['Pituus', '', 7, 'Pituus'] });
  assert.deepEqual(compViewState(list, 'c1').ages, [13, 0]);
  assert.deepEqual(compViewState(list, 'c1').events, ['Pituus']);
  assert.deepEqual(
    compViewState([{ compId: 'c1', ages: '13', events: 'Pituus' }], 'c1').ages,
    [],
    'not a list: none chosen',
  );
  list = compViewUpdate(list, 'c1', { focus: { id: 123, name: 'Emma', mode: 'watched' } });
  assert.deepEqual(
    compViewState(list, 'c1').focus,
    { kind: 'athlete', id: '123', name: 'Emma', mode: 'watched' },
    'the id is stringified on the way in, same as roster ids everywhere else, and an unmarked focus is a person',
  );
  list = compViewUpdate(list, 'c1', { focus: { kind: 'club', id: 2, name: 'Mallikylän Vire' } });
  assert.deepEqual(
    compViewState(list, 'c1').focus,
    { kind: 'club', id: '2', name: 'Mallikylän Vire', mode: 'watched' },
    'a club is the other kind, and starts watched like any other quick-filter',
  );
  assert.equal(
    compViewState(compViewUpdate(list, 'c1', { focus: { kind: 'sideways', id: '1' } }), 'c1').focus.kind,
    'athlete',
    'an unknown kind reads as a person rather than dropping the filter',
  );
  list = compViewUpdate(list, 'c1', { focus: null });
  assert.equal(compViewState(list, 'c1').focus, null, 'null clears a field the same way a value sets one');
  list = compViewUpdate(list, 'c1', { watchId: null });
  assert.equal(compViewState(list, 'c1').watchId, null);

  // The cap evicts the least recently touched competition. (Break on
  // purpose: drop the slice in compViewUpdate, and the length assertion fails.)
  let many = [];
  for (let i = 0; i < 11; i += 1) many = compViewUpdate(many, `c${i}`, { mode: 'all' });
  assert.equal(many.length, 10);
  assert.equal(
    many.some((x) => x.compId === 'c0'),
    false,
  );
  many = compViewUpdate(many, 'c5', { mode: 'watched' });
  assert.equal(many[0].compId, 'c5', 'touching a competition moves it to the front');
  // Home's row keeps its choices however many meets are touched after it.
  // (Break on purpose: cap every row alike.)
  many = compViewUpdate(many, '#home', { recentOpen: true, scopes: [{ id: 'maly' }] });
  for (let i = 0; i < 11; i += 1) many = compViewUpdate(many, `d${i}`, { mode: 'all' });
  assert.equal(compViewState(many, '#home').recentOpen, true);
  assert.equal(many.filter((x) => x.compId !== '#home').length, 10);
});

// --- The class and discipline filter (docs/views.md) ---
test('class and discipline filter', () => {
  const schedule = demoSchedule();
  const day = Object.values(schedule)[0];
  const choices = meetFilterChoices(schedule);
  // A row's class is read off its event name, not off the Age it is filed at
  // (e49, docs/tuloslista-api.md).
  // (Break on purpose: read startAge first.)
  assert.equal(rowClassAge(day.find((r) => r.EventName === 'M65 60m aidat')), 65);
  assert.equal(choices.ages.includes(30), false);
  assert.deepEqual(choices.ages, [9, 11, 13, 15, 17, 19, 0, 50, 65], 'class order, yleinen before the masters');
  assert.equal(
    rowClassAge({ EventName: 'M/N15 4x800m viesti', Age: '15' }),
    15,
    'a token that names no class leaves it to the filing',
  );
  assert.equal(rowClassAge({ EventName: 'M/N 4x100m aitaviesti', Age: '' }), null);
  // A multi-event's leg is the discipline it is. (Break on purpose: drop
  // multiEventLeg from rowDiscipline.)
  assert.equal(
    choices.events.some((e) => /ottelu/.test(e)),
    false,
  );
  assert.deepEqual(choices.events.slice(0, 3), ['40m', '60m', '60m aidat'], 'numbers as numbers');
  assert.deepEqual(choices.events.slice(-3), ['Korkeus', 'Kuula', 'Pituus'], 'the field last');
  assert.equal(meetFilterChoices(schedule, RUN_CATEGORIES).events.includes('Pituus'), false);

  assert.equal(filterRows(day, { ages: [], events: [] }), day, 'nothing chosen keeps the day as it is');
  const whole = groupRounds(day).find((g) => g.event === '60m');
  const narrowed = groupRounds(filterRows(day, { ages: [13] }, schedule)).find((g) => g.event === '60m');
  assert.deepEqual(
    whole.entries.map((e) => e.label),
    ['P11', 'T11', 'P13', 'T13'],
  );
  assert.deepEqual(
    narrowed.entries.map((e) => e.label),
    ['P13', 'T13'],
  );
  assert.equal(narrowed.key, whole.key, 'the row still opens the whole start');
  assert.deepEqual(
    filterRows(day, { events: ['pituus'] }).map((r) => r.EventName),
    ['N Pituus', 'N Pituus', 'T9 3-ottelu  Pituus', 'P9 3-ottelu  Pituus'],
    'folded, the legs with it',
  );
  assert.deepEqual(
    filterRows(day, { ages: [9], events: ['Pituus', 'Kuula'] }).map((r) => r.EventName),
    ['T9 3-ottelu  Pituus', 'T9 3-ottelu  Kuula', 'P9 3-ottelu  Pituus', 'P9 3-ottelu  Kuula'],
    'both halves hold',
  );

  // A choice with no chip cannot be unticked, so it does not filter. (Break on
  // purpose: return the pick as stored.)
  assert.deepEqual(activeFilter({ ages: [13, 14], events: ['pituus', 'Moukari'] }, choices), {
    ages: [13],
    events: ['Pituus'],
  });
  assert.deepEqual(activeFilter(null, choices), { ages: [], events: [] });

  const detailed = whole.entries.map((e) => ({ label: e.label, schedRound: e.round }));
  assert.deepEqual(
    filterCategories(detailed, [13, 0]).map((d) => d.label),
    ['P13', 'T13'],
  );
  assert.equal(filterCategories(detailed, [15]), detailed, 'a start of other classes stays whole');
  assert.equal(filterCategories(detailed, []), detailed);
});

// --- The cross-meet default: a competition with no stored row takes the
// Watch picked last, anywhere ---
test('cross-meet default follow-list', () => {
  assert.equal(
    compViewState([], 'new', 'w1').watchId,
    'w1',
    'a never-visited competition inherits the active follow-list',
  );
  const chosen = compViewUpdate([], 'c1', { watchId: null }, 'w1');
  assert.equal(
    compViewState(chosen, 'c1', 'w1').watchId,
    null,
    'an explicit "Ei seurantaa" is not re-defaulted back to the active list',
  );
  assert.equal(compViewState(chosen, 'c2', 'w1').watchId, 'w1', 'while every other competition still inherits it');

  // A patch that names no watch writes the inherited one into the row it
  // creates. (Break on purpose: drop the defaultWatchId that compViewUpdate
  // passes to compViewState.)
  const tapped = compViewUpdate([], 'fresh', { focus: { id: 'a1', name: 'Emma' } }, 'w1');
  assert.equal(
    compViewState(tapped, 'fresh', 'w1').watchId,
    'w1',
    'activating the quick-filter must not drop the inherited follow-list underneath it',
  );
  const moded = compViewSetMode([], 'fresh2', 'all', 'w1');
  assert.equal(compViewState(moded, 'fresh2', 'w1').watchId, 'w1', 'and neither must flipping the mode');
});

// --- compViewMode/compViewSetMode: the quick-filter has its own mode ---
test('compViewMode/compViewSetMode', () => {
  let list = compViewUpdate([], 'c1', { watchId: 'w1', mode: 'all' });
  assert.equal(compViewMode(compViewState(list, 'c1')), 'all', "no focus: the watch's own mode is in effect");

  list = compViewUpdate(list, 'c1', { focus: { id: 'a1', name: 'Emma', mode: 'watched' } });
  assert.equal(
    compViewMode(compViewState(list, 'c1')),
    'watched',
    'the quick-filter is in effect, and it starts at watched even though the watch was on all',
  );
  assert.equal(compViewState(list, 'c1').mode, 'all', "the watch's own mode is untouched underneath");

  list = compViewSetMode(list, 'c1', 'all');
  assert.equal(compViewState(list, 'c1').focus.mode, 'all');
  list = compViewSetMode(list, 'c1', 'watched');
  assert.equal(compViewState(list, 'c1').focus.mode, 'watched');
  assert.equal(
    compViewState(list, 'c1').mode,
    'all',
    'break the slot routing on purpose (write { mode } unconditionally) and this is what fails: ' +
      "toggling under the quick-filter must not touch the watch's mode",
  );

  list = compViewUpdate(list, 'c1', { focus: null });
  assert.equal(compViewMode(compViewState(list, 'c1')), 'all', 'the watch is back on all, as left');

  // With no quick-filter, the toggle writes the watch's mode.
  list = compViewSetMode(list, 'c1', 'watched');
  assert.equal(compViewState(list, 'c1').mode, 'watched');

  // A stored focus with a junk or missing mode reads as watched.
  assert.equal(
    compViewMode(compViewState([{ compId: 'c2', focus: { id: 'a9', name: 'X', mode: 'sideways' } }], 'c2')),
    'watched',
  );
  assert.equal(compViewMode(compViewState([{ compId: 'c2', focus: { id: 'a9', name: 'X' } }], 'c2')), 'watched');
});

// --- Juoksut mode's category toggle (docs/architecture.md) ---
test('Juoksut mode category toggle', () => {
  assert.equal(compViewState([], 'c1').cats, 'run', 'unset means Ratalajit');
  assert.equal(
    compViewState([{ compId: 'c1', cats: 'sideways' }], 'c1').cats,
    'run',
    'junk normalizes to run, never passed through',
  );
  let list = compViewUpdate([], 'c1', { cats: 'all' });
  assert.equal(compViewState(list, 'c1').cats, 'all');

  // A dev host keeps both modes' toggles in one stored row, so neither may
  // move the other.
  list = compViewSetMode(list, 'c1', 'all');
  assert.equal(compViewState(list, 'c1').cats, 'all', 'the mode toggle leaves cats alone');
  list = compViewUpdate(list, 'c1', { cats: 'run' });
  assert.equal(compViewState(list, 'c1').mode, 'all', 'and the category toggle leaves the mode alone');

  // RUN_CATEGORIES drops the demo day's field starts and nothing else.
  const schedule = demoSchedule();
  const day = Object.keys(schedule)[0];
  const all = groupRounds(schedule[day]);
  const run = groupRounds(schedule[day], RUN_CATEGORIES);
  const fieldStarts = all.filter((g) => g.category === 'Field');
  assert.ok(fieldStarts.length > 0, 'the fixture has field starts, or this proves nothing');
  assert.equal(run.length, all.length - fieldStarts.length);
  assert.ok(run.every((g) => g.category === 'Track' || g.category === 'Relay'));
  assert.ok(
    run.some((g) => g.category === 'Relay'),
    'a relay is a ratalaji — dropping Relay from RUN_CATEGORIES fails here',
  );
});
