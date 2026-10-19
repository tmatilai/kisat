// Tests the meet, club and athlete indexes and the picker's search
// (docs/backend.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoEventResults } from './fixtures.mjs';
import { demoApiBody, demoSearchScope } from '../public/lib/demo-api.js';
import { athleteLicences } from '../public/lib/elsewhere.js';
import { meetPlace } from '../public/lib/home.js';
import { DIGEST_VERSION, buildDigest, digestPeople, scheduleEventOrder } from '../public/lib/digest.js';
import {
  ATHLETE_INDEX_VERSION,
  MEET_CRAWL_FLOOR,
  MEET_INDEX_VERSION,
  ORG_INDEX_VERSION,
  archivedListingRows,
  athleteBackfillAt,
  athleteBackfillCursor,
  digestSeasonPeople,
  isFollowableOrgId,
  listingMeets,
  meetCrawlApply,
  meetCrawlPlan,
  meetCrawlStops,
  meetIndexClosed,
  meetIndexMeets,
  mergeAthleteIndex,
  mergeMeetIndex,
  mergeOrgIndex,
  orgIndexClubs,
} from '../public/lib/indexes.js';
import { buildRoster, combinedEventRoots, relayTeams, rosterPeople } from '../public/lib/roster.js';
import { API } from '../public/lib/schedule.js';
import {
  SEARCH_ATHLETE_LIMIT,
  SEARCH_CLUB_LIMIT,
  SEARCH_MIN_CHARS,
  mergeSearchRows,
  searchAthleteIndex,
  searchBody,
  searchClubs,
  searchPeople,
  searchQuery,
} from '../public/lib/search.js';
import { DEMO_API, DEMO_CUP_ID, DEMO_ID, demoSchedule } from '../public/demo.js';

// --- The meet index and its crawler (docs/backend.md). The /properties
// answers take the API's shape (docs/tuloslista-api.md, "Endpoints") with
// invented names. ---
test('meet index', () => {
  const listing = [
    {
      Id: 20500,
      Name: 'Demon syyskisat',
      Date: '2026-09-12T12:00:00.0000000+03:00',
      Location: 'Demola',
      OrganizationName: 'Demon Urheilijat',
    },
    {
      Id: 20410,
      Name: 'Mallikylän illat',
      Date: '2026-08-20T18:00:00.0000000+03:00',
      Location: 'Kilpailupaikka',
      OrganizationName: 'Mallikylän Vire',
    },
  ];
  const props = (id, name, begin) => ({
    Settings: [],
    Competition: { Id: id, Name: name, BeginDate: begin, Organization: 'Testilän Kisa' },
  });
  const todayIso = '2026-09-13';

  const first = mergeMeetIndex(null, listingMeets(listing), { todayIso });
  assert.equal(first.changed, true);
  assert.deepEqual(
    first.index.meets,
    [
      ['20500', 'Demon syyskisat', '2026-09-12', 'Demola', 'Demon Urheilijat'],
      ['20410', 'Mallikylän illat', '2026-08-20', 'Kilpailupaikka', 'Mallikylän Vire'],
    ],
    'newest first, the raw Location kept for meetPlace',
  );
  // (Break on purpose: mark every merge changed, and the cron writes each run.)
  assert.equal(
    mergeMeetIndex(first.index, listingMeets(listing), { todayIso }).changed,
    false,
    're-merging the listing is no write',
  );
  const renamed = mergeMeetIndex(first.index, [{ id: 20500, name: 'Demon syyskisat 2026', date: '2026-09-12' }], {
    todayIso,
  });
  assert.equal(renamed.changed, true);
  assert.equal(renamed.index.meets.length, 2, 'a numeric id matches the stored string one');
  assert.equal(renamed.index.meets[0][1], 'Demon syyskisat 2026', 'a later name wins');
  assert.equal(
    mergeMeetIndex(first.index, [{ id: 1, name: '' }], { todayIso }).changed,
    false,
    'a nameless meet is not indexed',
  );
  // The index is two seasons wide (seasonYears, docs/backend.md). (Break on
  // purpose: keep every stored row, and 2025's meets stay in 2027.)
  const older = mergeMeetIndex(first.index, [{ id: 16500, name: 'Talvikisat', date: '2024-12-30' }], { todayIso });
  assert.equal(older.changed, false, 'a meet before the seasons is not indexed');
  const lastSeason = mergeMeetIndex(first.index, [{ id: 16500, name: 'Talvikisat', date: '2025-01-04' }], { todayIso });
  assert.equal(lastSeason.index.meets.length, 3, 'last season is still one of them');
  const rolled = mergeMeetIndex(lastSeason.index, listingMeets(listing), { todayIso: '2027-01-01' });
  assert.deepEqual(
    rolled.index.meets.map((r) => r[0]),
    ['20500', '20410'],
    'and is pruned once the season is two back',
  );
  assert.equal(rolled.changed, true, 'so the pruned index is written');
  assert.deepEqual(
    meetIndexMeets({ v: MEET_INDEX_VERSION + 1, meets: [['1', 'Vanha', '', '', '']] }),
    [],
    'another version reads as empty',
  );
  assert.deepEqual(meetIndexMeets(first.index)[1], {
    id: '20410',
    name: 'Mallikylän illat',
    date: '2026-08-20',
    location: 'Kilpailupaikka',
    organizationName: 'Mallikylän Vire',
  });
  // A row's sixth field is the pair its entries are closed to. A merge keeps
  // it and a null removes it. (Break on purpose: let a merged row replace the
  // stored one whole, and the rename loses the pair.)
  const paired = meetIndexClosed(first.index, [
    ['20500', ['demy', 'maly']],
    ['20410', null],
    ['1', ['demy', 'maly']],
  ]);
  assert.equal(paired.changed, true);
  assert.deepEqual(
    paired.index.meets.map((r) => r[5]),
    [['demy', 'maly'], undefined],
    'a meet not indexed gains no row',
  );
  assert.equal(
    meetIndexClosed(paired.index, [['20500', ['demy', 'maly']]]).changed,
    false,
    'the same pair is no write',
  );
  assert.equal(meetIndexClosed(paired.index, []).changed, false, 'a record not read says nothing');
  assert.equal(
    mergeMeetIndex(paired.index, listingMeets(listing), { todayIso }).changed,
    false,
    're-merging the listing beside a pair is no write',
  );
  assert.deepEqual(
    mergeMeetIndex(paired.index, [{ id: 20500, name: 'Demon syyskisat 2026', date: '2026-09-12' }], { todayIso }).index
      .meets[0][5],
    ['demy', 'maly'],
    'a renamed meet keeps its pair',
  );
  assert.deepEqual(
    meetIndexMeets(paired.index).map((m) => m.closed),
    [['demy', 'maly'], undefined],
  );
  assert.deepEqual(
    meetIndexClosed(paired.index, [['20500', null]]).index.meets,
    first.index.meets,
    'taken off, the row is as it was',
  );

  // The backfill walks down from the listing's highest id and skips what is
  // indexed.
  assert.deepEqual(
    meetCrawlPlan(null, { top: null, budget: 40 }),
    { ids: [], next: null },
    'no listing and no cursor: nowhere to start',
  );
  const plan = meetCrawlPlan(first.index, { top: 20500, budget: 3, floor: 20400 });
  assert.deepEqual(plan, { ids: [20499, 20498, 20497], next: 20496 });

  // A past meet is kept and a future one or a 404 is not. The cursor moves on.
  const run = meetCrawlApply(
    first.index,
    plan,
    [
      { id: 20499, status: 200, props: props(20499, 'Testilän kevätkisat', '2026-05-02T09:00:00+00:00') },
      { id: 20498, status: 404, props: null },
      { id: 20497, status: 200, props: props(20497, 'Testilän koulukisat', '2026-09-17T09:00:00+00:00') },
    ],
    { todayIso, floor: 20400 },
  );
  assert.deepEqual(
    run.index.meets.map((r) => r[0]),
    ['20500', '20410', '20499'],
  );
  assert.deepEqual(run.index.meets[2], ['20499', 'Testilän kevätkisat', '2026-05-02', '', 'Testilän Kisa']);
  assert.deepEqual(run.index.crawl, { next: 20496 });
  const oldRun = meetCrawlApply(
    first.index,
    plan,
    [{ id: 20499, status: 200, props: props(20499, 'Testilän talvikisat', '2024-02-03T09:00:00+00:00') }],
    { todayIso, floor: 20400 },
  );
  assert.equal(oldRun.index.meets.length, 2, 'the backfill adds no meet before the seasons');
  assert.deepEqual(
    meetCrawlPlan(run.index, { top: 20500, budget: 2, floor: 20400 }).ids,
    [20496, 20495],
    'the next run starts at the cursor, not at the top again',
  );

  // A throttled or failed ask ends the run, and the next run asks it again.
  // (Break on purpose: pass a 429 in meetCrawlStops, and 20498 is skipped.)
  assert.equal(meetCrawlStops(429), true);
  assert.equal(meetCrawlStops(0), true, 'a network error stops it too');
  assert.equal(meetCrawlStops(404), false);
  assert.equal(meetCrawlStops(200), false);
  const throttled = meetCrawlApply(
    first.index,
    plan,
    [
      { id: 20499, status: 200, props: props(20499, 'Testilän kevätkisat', '2026-05-02T09:00:00+00:00') },
      { id: 20498, status: 429, props: null },
    ],
    { todayIso, floor: 20400 },
  );
  assert.deepEqual(throttled.index.crawl, { next: 20498 });
  assert.equal(throttled.index.meets.length, 3, 'what was found before the stop is kept');

  // Past the floor the backfill is done, and a run asks and writes nothing.
  // (Break on purpose: drop the `done` check, and each run walks from the top.)
  const last = meetCrawlPlan(run.index, { top: 20500, budget: 40, floor: 20494 });
  assert.deepEqual(last.ids, [20496, 20495, 20494]);
  const done = meetCrawlApply(run.index, last, [], { todayIso, floor: 20494 }).index;
  assert.deepEqual(done.crawl, { done: true });
  const after = meetCrawlPlan(done, { top: 20600, budget: 40, floor: 20494 });
  assert.deepEqual(after, { ids: [], next: null });
  assert.equal(meetCrawlApply(done, after, [], { todayIso }).changed, false);
  assert.equal(MEET_CRAWL_FLOOR, 16460);

  // Home's search adds the index's meets the listing lacks, in its shape.
  assert.deepEqual(archivedListingRows(listing, meetIndexMeets(run.index)), [
    { Id: '20499', Name: 'Testilän kevätkisat', Date: '2026-05-02', Location: '', OrganizationName: 'Testilän Kisa' },
  ]);
  assert.equal(
    meetPlace('', 'Testilän Kisa'),
    'Testilän Kisa',
    'and meetPlace reads such a row as it reads a listed one',
  );
});

// --- mergeOrgIndex/orgIndexClubs: the club index (docs/backend.md), over the
// demo roster and invented clubs ---
test('mergeOrgIndex/orgIndexClubs', () => {
  const demoRoster = buildRoster(demoEventResults());
  const first = mergeOrgIndex(null, demoRoster.organizations);
  assert.equal(first.index.v, ORG_INDEX_VERSION);
  assert.equal(first.changed, true, 'a fresh index gains every club');
  assert.equal(first.index.orgs.length, demoRoster.organizations.length);

  // cacheOrgs (worker.js) skips the KV write when `changed` is false.
  const again = mergeOrgIndex(first.index, demoRoster.organizations);
  assert.equal(again.changed, false, 're-merging the same clubs is not a change');
  assert.deepEqual(again.index.orgs, first.index.orgs);

  // Ids are stored as strings, as a Watch entry holds them.
  const numericAgain = mergeOrgIndex(first.index, [
    { id: Number(first.index.orgs[0][0]), name: first.index.orgs[0][1], nameShort: first.index.orgs[0][2] },
  ]);
  assert.equal(numericAgain.changed, false, 'a numeric id matches the stored string one');
  assert.equal(numericAgain.index.orgs.length, first.index.orgs.length);

  // A stored index written by hand may hold numeric ids, and they match too.
  const seeded = mergeOrgIndex({ v: ORG_INDEX_VERSION, orgs: [[7, 'Seiska Urheilijat', 'SeitsU']] }, [
    { id: '7', name: 'Seiska Urheilijat', nameShort: 'SeitsU' },
  ]);
  assert.equal(seeded.changed, false, 'a stored numeric id matches an incoming string one');
  assert.deepEqual(orgIndexClubs(seeded.index), [{ id: '7', name: 'Seiska Urheilijat', nameShort: 'SeitsU' }]);

  const grown = mergeOrgIndex(first.index, [
    { id: 9001, name: 'Zeta Urheilijat', nameShort: 'ZetaU' },
    { id: 9002, name: 'Alfa Kisaajat', nameShort: 'AlfaK' },
  ]);
  assert.equal(grown.changed, true);
  assert.equal(grown.index.orgs.length, first.index.orgs.length + 2);
  const clubs = orgIndexClubs(grown.index);
  assert.deepEqual(
    clubs.map((c) => c.name),
    [...clubs.map((c) => c.name)].sort((a, b) => a.localeCompare(b, 'fi')),
    'stored by name, so the picker needs no sort of its own',
  );
  assert.deepEqual(
    clubs.find((c) => c.id === '9001'),
    { id: '9001', name: 'Zeta Urheilijat', nameShort: 'ZetaU' },
  );

  // A later name wins.
  const renamed = mergeOrgIndex(grown.index, [{ id: 9001, name: 'Zeta Urheilijat ry', nameShort: 'ZetaU' }]);
  assert.equal(renamed.changed, true, 'a rename is a change');
  assert.equal(orgIndexClubs(renamed.index).filter((c) => c.id === '9001').length, 1, 'renamed, not duplicated');
  assert.equal(orgIndexClubs(renamed.index).find((c) => c.id === '9001').name, 'Zeta Urheilijat ry');

  // A club with no name is not indexed, and nameShort stands in for a missing
  // full name. Id 0 is no club (isFollowableOrgId), and it carries a real
  // club's name (docs/tuloslista-api.md).
  const odd = mergeOrgIndex(null, [
    { id: 1, name: '', nameShort: '' },
    { id: '', name: 'Nimetön id', nameShort: '' },
    { id: 0, name: 'Pistelän Pyrintö', nameShort: 'Pyrintö' },
    { id: '0', name: 'Pistelän Pyrintö', nameShort: 'Pyrintö' },
    { id: 9, name: 'Pistelän Pyrintö', nameShort: 'PiPy' },
    { id: 2, name: '', nameShort: 'LyhytU' },
  ]);
  assert.deepEqual(orgIndexClubs(odd.index), [
    { id: '2', name: 'LyhytU', nameShort: 'LyhytU' },
    { id: '9', name: 'Pistelän Pyrintö', nameShort: 'PiPy' },
  ]);
  assert.equal(isFollowableOrgId(0), false);
  assert.equal(isFollowableOrgId('0'), false);
  assert.equal(isFollowableOrgId(9), true);

  // An index of another version reads as empty, and a merge into one starts
  // over.
  assert.deepEqual(orgIndexClubs({ v: ORG_INDEX_VERSION + 1, orgs: [['1', 'Vanha', 'V']] }), []);
  assert.deepEqual(orgIndexClubs(null), []);
  const fromOld = mergeOrgIndex({ v: ORG_INDEX_VERSION + 1, orgs: [['1', 'Vanha', 'V']] }, [
    { id: 2, name: 'Uusi', nameShort: 'U' },
  ]);
  assert.deepEqual(orgIndexClubs(fromOld.index), [{ id: '2', name: 'Uusi', nameShort: 'U' }]);
});

// --- mergeAthleteIndex/searchAthleteIndex: the athlete index
// (docs/backend.md), and the ranking every search in the picker shares ---
test('mergeAthleteIndex/searchAthleteIndex', () => {
  const demoRoster = buildRoster(demoEventResults());
  const people = rosterPeople(demoRoster);
  const first = mergeAthleteIndex(null, people, { year: 2026, todayIso: '2026-09-18' });
  assert.equal(first.index.v, ATHLETE_INDEX_VERSION);
  assert.equal(first.changed, true, 'a fresh index gains everybody');
  assert.equal(first.index.athletes.length, people.length);
  assert.deepEqual(
    first.index.athletes.map((r) => r[2]),
    [...first.index.athletes.map((r) => r[2])].sort((a, b) => a.localeCompare(b, 'fi')),
    'stored by name, so a search walks it in order and needs no sort',
  );

  // worker.js skips the KV write when `changed` is false, as on a meet's
  // second build.
  const again = mergeAthleteIndex(first.index, people, { year: 2026, todayIso: '2026-09-18' });
  assert.equal(again.changed, false, 're-merging the same people is not a change');
  assert.deepEqual(again.index.athletes, first.index.athletes);

  // The index keeps one row per licence, with the later club. rosterPeople
  // keeps one per licence and club.
  const moved = mergeAthleteIndex(
    first.index,
    [{ licenseId: first.index.athletes[0][0], organizationId: '9001', name: first.index.athletes[0][2] }],
    { year: 2026, todayIso: '2026-09-18' },
  );
  assert.equal(moved.changed, true, 'a club change is a change');
  assert.equal(moved.index.athletes.length, first.index.athletes.length, 'moved, not duplicated');
  assert.equal(moved.index.athletes.find((r) => r[0] === first.index.athletes[0][0])[1], '9001');
  // A rebuilt meet of last season leaves this season's row alone, or the row
  // would carry last season's club and leave the index a season early.
  // (Break on purpose: drop the year test in mergeAthleteIndex.)
  const rebuilt = mergeAthleteIndex(
    moved.index,
    [{ licenseId: first.index.athletes[0][0], organizationId: '100', name: first.index.athletes[0][2] }],
    { year: 2025, todayIso: '2026-09-18' },
  );
  assert.equal(rebuilt.changed, false);
  assert.deepEqual(rebuilt.index.athletes, moved.index.athletes);

  // A row with no licence or no name is not indexed, and ids are stored as
  // strings. (Break on purpose: drop the `!p.name` test, and a nameless row is
  // indexed.)
  const odd = mergeAthleteIndex(
    null,
    [
      { licenseId: '', organizationId: '1', name: 'Lisensiaatiton Lähtijä' },
      { licenseId: '5', organizationId: '1', name: '' },
      { licenseId: 7, organizationId: 1, name: 'Numero Nimikko' },
    ],
    { year: 2026, todayIso: '2026-09-18' },
  );
  assert.deepEqual(odd.index.athletes, [['7', '1', 'Numero Nimikko', 2026]]);
  assert.equal(
    mergeAthleteIndex(odd.index, [{ licenseId: '7', organizationId: '1', name: 'Numero Nimikko' }], {
      year: 2026,
      todayIso: '2026-09-18',
    }).changed,
    false,
    'a numeric id matches the stored string one',
  );

  // The index is two seasons wide (seasonYears), and the merge is its only
  // pruning (docs/backend.md). (Break on purpose: keep every year, and last
  // season's people never leave the index.)
  const old = mergeAthleteIndex(first.index, [{ licenseId: '9', organizationId: '1', name: 'Vanha Vieras' }], {
    year: 2024,
    todayIso: '2026-09-18',
  });
  assert.equal(
    old.index.athletes.some((r) => r[0] === '9'),
    false,
    'a meet outside the seasons adds nobody',
  );
  assert.equal(old.changed, false);
  const lastSeason = mergeAthleteIndex(null, [{ licenseId: '9', organizationId: '1', name: 'Vanha Vieras' }], {
    year: 2025,
    todayIso: '2026-09-18',
  });
  assert.equal(lastSeason.index.athletes.length, 1, 'last season is still one of them');
  const rolled = mergeAthleteIndex(lastSeason.index, [], { year: 2027, todayIso: '2027-05-01' });
  assert.deepEqual(rolled.index.athletes, [], 'and is pruned once the season is two back');
  assert.equal(rolled.changed, true, 'so the pruned index is written');

  // Another version reads as empty and is rebuilt.
  const fromOld = mergeAthleteIndex(
    { v: ATHLETE_INDEX_VERSION + 1, athletes: [['1', '1', 'Vanha Versio', 2026]] },
    [{ licenseId: '2', organizationId: '1', name: 'Uusi Versio' }],
    { year: 2026, todayIso: '2026-09-18' },
  );
  assert.deepEqual(fromOld.index.athletes, [['2', '1', 'Uusi Versio', 2026]]);

  // A word-start hit ranks first. (Break on purpose: rank every hit the same,
  // and a name holding the query inside a word ranks first.)
  const ranked = mergeAthleteIndex(
    null,
    [
      { licenseId: '1', organizationId: '1', name: 'Aada Someikäinen' },
      { licenseId: '2', organizationId: '1', name: 'Ylermi Meikäläinen' },
      { licenseId: '3', organizationId: '2', name: 'Zaida Meikonen' },
    ],
    { year: 2026, todayIso: '2026-09-18' },
  );
  assert.deepEqual(
    searchAthleteIndex(ranked.index, 'meik').map((p) => p.name),
    ['Ylermi Meikäläinen', 'Zaida Meikonen', 'Aada Someikäinen'],
  );
  assert.deepEqual(
    searchAthleteIndex(ranked.index, 'aada').map((p) => p.name),
    ['Aada Someikäinen'],
  );
  assert.deepEqual(
    searchAthleteIndex(ranked.index, 'ei').map((p) => p.name),
    ['Aada Someikäinen', 'Ylermi Meikäläinen', 'Zaida Meikonen'],
    'with nothing to separate them the index\u2019s own order stands',
  );

  // (Break on purpose: let '' through, and an empty query serves the whole
  // index.)
  assert.equal(SEARCH_MIN_CHARS, 2);
  assert.equal(searchQuery(' a '), '');
  assert.equal(searchQuery(' Ab '), 'ab');
  assert.deepEqual(searchAthleteIndex(first.index, 'a'), []);
  assert.deepEqual(searchAthleteIndex(first.index, ''), []);

  const many = mergeAthleteIndex(
    null,
    Array.from({ length: 40 }, (_, i) => ({
      licenseId: String(i + 100),
      organizationId: '1',
      name: `Aada Hakuinen ${i}`,
    })),
    { year: 2026, todayIso: '2026-09-18' },
  );
  assert.equal(searchAthleteIndex(many.index, 'haku').length, SEARCH_ATHLETE_LIMIT);
  assert.equal(searchAthleteIndex(many.index, 'haku', 3).length, 3);

  // The cap fills with word-start hits before any hit inside a word, even one
  // earlier in name order. (Break on purpose: stop searchRows at `limit` hits
  // of either kind, and the inside-word hits fill the cap.)
  const capped = mergeAthleteIndex(
    null,
    [
      'Aada Someikäinen',
      'Aino Someikkala',
      'Anni Someikkola',
      'Eeva Someikkonen',
      'Ylermi Meikäläinen',
      'Zaida Meikonen',
      'Zelma Meikkinen',
    ].map((name, i) => ({ licenseId: String(i + 200), organizationId: '1', name })),
    { year: 2026, todayIso: '2026-09-18' },
  );
  assert.deepEqual(
    searchAthleteIndex(capped.index, 'meik', 3).map((p) => p.name),
    ['Ylermi Meikäläinen', 'Zaida Meikonen', 'Zelma Meikkinen'],
  );
});

// --- athleteLicences: the licence the graft gives a person it made, by name
// and club (docs/elsewhere.md) ---
test('athleteLicences', () => {
  const index = mergeAthleteIndex(
    null,
    [
      { licenseId: '11', organizationId: '2', name: 'Eino Mallinen' },
      { licenseId: '12', organizationId: '3', name: 'Eino Mallinen' },
      { licenseId: '13', organizationId: '2', name: 'Inka Kisanen' },
      { licenseId: '14', organizationId: '2', name: 'Inka Kisanen' },
    ],
    { year: 2026, todayIso: '2026-09-18' },
  ).index;
  const found = athleteLicences(index);
  // (Break on purpose: key by the name alone, and two clubs' namesakes collide.
  // Let a second licence win, and a club's two answer the later one.)
  assert.deepEqual(
    [found.get('einomallinen|2'), found.get('einomallinen|3'), found.get('inkakisanen|2'), found.get('einomallinen|9')],
    ['11', '12', null, undefined],
    'a name and club answer their licence, and a name two of one club\u2019s licences share answer nothing',
  );
  assert.deepEqual(
    [
      athleteLicences(null).size,
      athleteLicences({ v: ATHLETE_INDEX_VERSION + 1, athletes: [['1', '1', 'Vanha Versio', 2026]] }).size,
    ],
    [0, 0],
  );
});

// --- The rest of the picker's search: clubs, a meet's own entrants, and the
// open meet's rows ahead of the index's (docs/backend.md) ---
test('the picker’s search', () => {
  const clubs = [
    { id: '1', name: 'Testilän Kisa', nameShort: 'TeKi' },
    { id: '2', name: 'Demon Urheilijat', nameShort: 'DemU' },
  ];
  assert.deepEqual(
    searchClubs(clubs, 'kisa').map((c) => c.id),
    ['1'],
  );
  assert.deepEqual(
    searchClubs(clubs, 'demu').map((c) => c.id),
    ['2'],
    'the short name is searched too',
  );
  assert.deepEqual(searchClubs(clubs, 'k'), [], 'and the minimum is the box’s, not the kind’s');
  assert.equal(SEARCH_CLUB_LIMIT, 15);

  const people = [
    { licenseId: '1', organizationId: '1', name: 'Aada Kisainen' },
    { licenseId: '2', organizationId: '2', name: 'Ville Mallinen' },
  ];
  assert.deepEqual(
    searchPeople(people, 'malli').map((p) => p.licenseId),
    ['2'],
  );

  // The open meet's rows come first, one row per id. (Break on purpose: drop
  // the dedup, and a person in both is offered twice.)
  const merged = mergeSearchRows(
    [{ licenseId: '2', name: 'Ville Mallinen' }],
    [
      { licenseId: '1', name: 'Aada Kisainen' },
      { licenseId: '2', name: 'Ville Mallinen' },
    ],
    (p) => p.licenseId,
    25,
  );
  assert.deepEqual(
    merged.map((p) => p.licenseId),
    ['2', '1'],
  );
  assert.equal(mergeSearchRows([{ id: 'a' }], [{ id: 'b' }, { id: 'c' }], (r) => r.id, 2).length, 2);

  // searchBody names each person's club off the meet's clubs or the index's.
  // (Break on purpose: name the clubs off the index alone, and the meet's own
  // club reads blank.)
  const index = mergeAthleteIndex(null, [{ licenseId: '3', organizationId: '2', name: 'Aada Mallinen' }], {
    year: 2026,
    todayIso: '2026-09-18',
  }).index;
  const body = searchBody({ clubs: [clubs[0]], people: [people[0]] }, [clubs[1]], index, 'aada');
  assert.deepEqual(body.athletes, [
    { licenseId: '1', organizationId: '1', name: 'Aada Kisainen', club: 'Testilän Kisa' },
    { licenseId: '3', organizationId: '2', name: 'Aada Mallinen', club: 'Demon Urheilijat' },
  ]);
  assert.deepEqual(searchBody({ clubs: [clubs[0]], people: [] }, [clubs[1]], null, 'kisa').clubs, [clubs[0]]);
  assert.deepEqual(
    searchBody({ clubs: [], people: [] }, [], null, 'a'),
    { clubs: [], athletes: [] },
    'a keystroke finds nothing',
  );

  // A real meet's entrants come off its digest (docs/backend.md). A row with
  // no licence is left out, as in the index.
  const roster = buildRoster(demoEventResults());
  const digest = buildDigest(
    roster,
    ['8.8.2026'],
    scheduleEventOrder(demoSchedule()),
    new Map(),
    relayTeams(demoEventResults()),
  );
  const fromDigest = digestPeople(digest);
  assert.equal(fromDigest.length, new Set(fromDigest.map((p) => p.licenseId)).size, 'one row per licence');
  assert.equal(
    fromDigest.some((p) => !p.licenseId),
    false,
  );
  assert.equal(searchPeople(fromDigest, 'emma mitt').length, 1, 'a digest row answers the search by name');
});

// --- demoApiBody: a demo meet's /api bodies, which app/data.js answers with
// offline and worker.js serves. test-worker.mjs asserts the same numbers ---
test('demoApiBody', () => {
  const body = (url) => demoApiBody(url, DEMO_API);
  // The roster reads the scheduled events, as a real meet's fan-out does, so
  // no athlete carries a multi-event's root. (Break on purpose: build it over
  // every event in the fixture.)
  const roster = body(`/api/roster/${DEMO_ID}`);
  const roots = new Set([...combinedEventRoots(demoEventResults()).values()].map((r) => r.id));
  assert.ok(roots.size > 0);
  assert.equal(
    roster.athletes.some((a) => a.events.some((e) => roots.has(e.eventId))),
    false,
  );
  assert.deepEqual(roster, buildRoster(demoEventResults()));

  assert.deepEqual(
    body(`/api/meet/${DEMO_CUP_ID}`).clubs.map((c) => [c.rank, c.nameShort, c.points]),
    [
      [1, 'DemU', 3820],
      [2, 'TeKi', 2960],
      [3, 'MalV', 2470],
      [4, 'NäVa', 2370],
      [5, 'HarjU', 1760],
    ],
  );
  assert.deepEqual(body(`/api/meet/${DEMO_ID}`), { cup: false, confirm: { minutes: 60 } });
  assert.deepEqual(body(`/api/cup/${DEMO_ID}`), { clubs: {} });

  // The medals count a finished multi-event's root. (Break on purpose: build
  // them over the scheduled events alone.)
  const finished = (id) =>
    Object.fromEntries(
      Object.entries(demoSchedule(id)).map(([day, list]) => [
        day,
        list.map((r) => (r.EventName.startsWith('T9 3-ottelu') ? { ...r, Status: 'Official' } : r)),
      ]),
    );
  const medals = demoApiBody(`/api/medals/${DEMO_ID}`, { ...DEMO_API, demoSchedule: finished });
  assert.deepEqual(medals.table.find((c) => c.id === '1').medals, [6, 5, 1]);

  // A search finds the meet's own rows, its clubs included.
  assert.deepEqual(
    body(`/api/search?q=testil&comp=${DEMO_ID}`).clubs.map((c) => c.name),
    ['Testilän Kisa'],
  );
  const emma = body(`/api/search?q=emma%20mitt&comp=${DEMO_ID}`).athletes;
  assert.ok(emma.length === 1 && emma[0].club, "a person carries the club's name");
  assert.deepEqual(demoSearchScope(DEMO_ID, DEMO_API).people, rosterPeople(roster));

  for (const url of [
    '/api/roster/20224',
    `/api/scan/${DEMO_ID}`,
    '/api/search?q=mitt',
    '/api/search?q=mitt&comp=20224',
    `${API}/competition/${DEMO_ID}`,
  ]) {
    assert.equal(body(url), null, `${url} is not a demo meet's /api path`);
  }
});

// --- The athlete index's backfill from the digests in KV (backfillAthletes,
// docs/backend.md) ---
test('the athlete index’s backfill', () => {
  const today = '2026-09-18';
  const digest = (days, athletes) => ({ v: DIGEST_VERSION, days, orgs: [], teams: [], athletes });
  const rows = [
    ['70000001', 1, 'Emma Mittainen', ['N Keihäs']],
    ['', 2, 'Lisensiaatiton Lähtijä', ['N Kuula']],
  ];

  // The year comes from the meet's last day, and a row with no licence is
  // left out.
  assert.deepEqual(digestSeasonPeople(digest(['7.8.2026', '8.8.2026'], rows), today), {
    year: 2026,
    people: [{ licenseId: '70000001', organizationId: '1', name: 'Emma Mittainen' }],
  });
  assert.deepEqual(digestSeasonPeople(digest(['1.6.2025'], rows), today).people.length, 1, 'last season counts');
  // (Break on purpose: drop the seasonYears test, and a meet two seasons back
  // gives its people.)
  assert.deepEqual(digestSeasonPeople(digest(['1.6.2024'], rows), today), { year: 2024, people: [] });
  assert.deepEqual(digestSeasonPeople(undefined, today).people, []);

  // The cursor is '' to start, KV's list cursor between runs, and null once
  // the walk is done.
  assert.equal(athleteBackfillCursor(null), '');
  assert.equal(athleteBackfillCursor({ v: ATHLETE_INDEX_VERSION, athletes: [] }), '');
  assert.equal(athleteBackfillCursor(athleteBackfillAt(null, 'abc')), 'abc');
  assert.equal(athleteBackfillCursor(athleteBackfillAt(null, null)), null, 'a finished walk is not repeated');
  // Another version reads as a fresh index, so the walk restarts.
  assert.equal(athleteBackfillCursor({ v: ATHLETE_INDEX_VERSION + 1, backfill: { done: true } }), '');

  // The cursor survives a merge. (Break on purpose: build the merged index
  // without spreading the base, and every run re-reads page one.)
  const walking = athleteBackfillAt(null, 'page2');
  const merged = mergeAthleteIndex(walking, [{ licenseId: '5', organizationId: '1', name: 'Aada Kisainen' }], {
    year: 2026,
    todayIso: today,
  });
  assert.equal(merged.changed, true);
  assert.equal(athleteBackfillCursor(merged.index), 'page2');
  assert.equal(merged.index.athletes.length, 1);
  // The people survive the cursor moving on.
  assert.deepEqual(athleteBackfillAt(merged.index, null).athletes, merged.index.athletes);
});

// --- rosterPeople: what the picker's search offers, one row per person where
// the roster has one per enrollment ---
test('rosterPeople', () => {
  const roster = buildRoster(demoEventResults());
  const people = rosterPeople(roster);

  // A runner in e1 and in e5's team is two roster rows under one licence
  // (docs/tuloslista-api.md). (Break on purpose: return
  // roster.athletes.filter(a => a.licenseId), and this counts two.)
  assert.equal(
    roster.athletes.filter((a) => a.name === 'Ville Mallinen').length,
    2,
    'the fixture must actually have the duplicate, or this test proves nothing',
  );
  assert.deepEqual(people.filter((p) => p.name === 'Ville Mallinen').length, 1);
  assert.equal(people.length, roster.athletes.length - 1, 'and nobody else is merged away');

  const ville = people.find((p) => p.name === 'Ville Mallinen');
  assert.equal(
    ville.licenseId,
    roster.athletes.find((a) => a.name === 'Ville Mallinen').licenseId,
    'the row carries the licence a Watch entry stores, not an enrollment id',
  );
  assert.equal(ville.organizationId, 1, 'and the club the search shows underneath the name');
  assert.deepEqual(
    people.map((p) => p.name),
    [...people.map((p) => p.name)].sort((a, b) => a.localeCompare(b, 'fi')),
    "the roster's own name order survives the merge",
  );

  // One licence under two clubs is two rows, on buildDigest's key.
  const twoClubs = rosterPeople({
    athletes: [
      { id: 'x1', licenseId: 'L1', name: 'Sama Nimi', organizationId: 1, events: [] },
      { id: 'x2', licenseId: 'L1', name: 'Sama Nimi', organizationId: 2, events: [] },
    ],
  });
  assert.equal(twoClubs.length, 2);

  // An athlete with no licence gives no row, since a Watch stores the licence.
  assert.deepEqual(rosterPeople({ athletes: [{ id: 'x3', licenseId: '', name: 'Ei Lisenssiä' }] }), []);
  assert.deepEqual(rosterPeople(null), []);
});
