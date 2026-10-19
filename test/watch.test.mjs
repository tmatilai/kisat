// Tests the follow-lists, the quick-filter and the confirmations
// (docs/views.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoEventResults } from './fixtures.mjs';
import { combinedCounts } from '../public/lib/combined.js';
import {
  confirmCloses,
  confirmCount,
  confirmNote,
  confirmRows,
  confirmSetting,
  confirmStartAt,
  watchConfirmations,
} from '../public/lib/confirmation.js';
import { tsKey } from '../public/lib/dates.js';
import { allocMark, allocPosition, markFormat, relayInfo } from '../public/lib/results.js';
import { buildRoster } from '../public/lib/roster.js';
import { API, countLine, eventStore, groupRounds, roundDetails } from '../public/lib/schedule.js';
import {
  allocMatches,
  copyWatchLabel,
  filterEventIds,
  findAthleteAllocations,
  focusTargets,
  matchedEntries,
  normalizeWatchEntries,
  normalizeWatchInput,
  watchConflictMerge,
  watchEntriesWith,
  watchEntryAthleteIds,
  watchEntryForAthlete,
  watchGroups,
  watchRegistryAdd,
  watchRegistryRemove,
  watchTargets,
} from '../public/lib/watch.js';
import { DEMO_EVENTS, DEMO_ID, demoResponse, demoSchedule } from '../public/demo.js';

// --- normalizeWatchInput/normalizeWatchEntries: the check a Watch POST or
// PUT body passes before KV. Both carry { label, entries } ---
test('normalizeWatchInput/normalizeWatchEntries', () => {
  const valid = normalizeWatchInput({
    label: '  Demon Urheilijat  ',
    entries: [{ type: 'club', id: '42', name: 'Demon Urheilijat', enabled: true }],
  });
  assert.deepEqual(
    valid,
    {
      label: 'Demon Urheilijat',
      entries: [{ type: 'club', id: '42', name: 'Demon Urheilijat', enabled: true }],
    },
    'trims label, keeps a well-formed entry as-is',
  );

  assert.equal(normalizeWatchInput(null), null);
  assert.equal(normalizeWatchInput({}), null, 'entries is required');
  assert.equal(normalizeWatchInput({ entries: 'nope' }), null, 'entries must be an array');
  assert.equal(normalizeWatchInput({ entries: [{ type: 'friend', id: '1' }] }), null, 'type must be athlete or club');
  assert.equal(normalizeWatchInput({ entries: [{ type: 'athlete', id: '' }] }), null, 'a blank id is not an entry');
  assert.equal(
    normalizeWatchInput({
      entries: Array.from({ length: 101 }, (_, i) => ({ type: 'athlete', id: String(i) })),
    }),
    null,
    'break the entry-count cap on purpose: 101 must be rejected',
  );

  // A duplicate type+id collapses to one entry and is no error.
  const deduped = normalizeWatchEntries([
    { type: 'athlete', id: '7', name: 'Elsa Testinen' },
    { type: 'athlete', id: '7', name: 'Elsa Testinen (stale)' },
  ]);
  assert.equal(deduped.length, 1, 'the same type+id twice must collapse to one entry');
  assert.equal(deduped[0].enabled, true, 'enabled defaults true when omitted');

  const edit = normalizeWatchInput({ label: 'x'.repeat(200), entries: [] });
  assert.equal(edit.label.length, 80, 'label is capped, not rejected outright');
  // A competitionId in the body is not written to KV.
  assert.deepEqual(normalizeWatchInput({ competitionId: '20224', entries: [] }), { label: '', entries: [] });
});

// --- watchEntryForAthlete: the athlete sheet's "Lisää seurantaan", from this
// competition's athlete id to the entry a Watch stores ---
test('watchEntryForAthlete', () => {
  const roster = buildRoster(demoEventResults());
  const emma = roster.athletes.find((a) => a.name === 'Emma Mittainen');
  assert.deepEqual(watchEntryForAthlete(roster, emma.id), {
    type: 'athlete',
    id: emma.licenseId,
    name: 'Emma Mittainen',
    enabled: true,
  });
  // The entry keys on the licence, since the athlete id identifies an entry
  // and not a person (docs/tuloslista-api.md, "Categories, names and
  // identity"). (Break on purpose: return `id: found.id`, and the check above
  // fails.)
  assert.ok(
    emma.licenseId !== String(emma.id),
    'the fixture must actually distinguish the two ids, or this test proves nothing',
  );
  assert.equal(
    watchEntryForAthlete(roster, emma.licenseId),
    null,
    'and it is the competition id going in, not the licence',
  );
  // The entry resolves back to the row it was built from.
  assert.deepEqual(watchEntryAthleteIds(watchEntryForAthlete(roster, emma.id), roster), new Set([String(emma.id)]));

  assert.equal(watchEntryForAthlete(roster, 'nobody'), null);
  assert.equal(watchEntryForAthlete(null, 'a1-a'), null);
  // An athlete with no licence gives no entry, as in rosterPeople.
  assert.equal(watchEntryForAthlete({ athletes: [{ id: 'x3', licenseId: '', name: 'Ei Lisenssiä' }] }, 'x3'), null);
});

// --- watchEntriesWith: adding one entry to a list that may already hold it.
// The add menu's tick and the PUT read the same answer ---
test('watchEntriesWith', () => {
  const emma = { type: 'athlete', id: '1001', name: 'Emma Mittainen', enabled: true };
  const club = { type: 'club', id: '591', name: 'Demon Urheilijat', enabled: true };

  const fresh = watchEntriesWith([club], emma);
  assert.deepEqual(fresh, { entries: [club, emma], changed: true });
  // A new entry goes at the end, since the edit sheet lists stored order.
  assert.equal(fresh.entries[1], emma);

  // An entry already on and enabled changes nothing. (Break on purpose:
  // return `changed: true` here, and the menu ticks nothing.)
  assert.deepEqual(watchEntriesWith([club, emma], emma), { entries: [club, emma], changed: false });
  // type+id is the identity, as in normalizeWatchEntries, whatever the name
  // or the id's type.
  assert.equal(watchEntriesWith([{ ...emma, name: 'Mittainen Emma' }], emma).changed, false);
  assert.equal(watchEntriesWith([{ ...emma, id: 1001 }], emma).changed, false);
  // A club and an athlete that happen to share an id are two entries.
  assert.equal(watchEntriesWith([{ ...club, id: '1001' }], emma).changed, true);

  // A disabled entry is switched back on in place, and that is a change. An
  // appended copy would be dropped, since normalizeWatchEntries keeps the
  // first of two.
  const back = watchEntriesWith([{ ...emma, enabled: false }, club], emma);
  assert.deepEqual(back, { entries: [emma, club], changed: true });
  assert.equal(back.entries[1], club);
  // The stored name wins over the incoming one.
  assert.equal(watchEntriesWith([{ ...emma, enabled: false, name: 'Emma M.' }], emma).entries[0].name, 'Emma M.');

  assert.deepEqual(watchEntriesWith([], emma), { entries: [emma], changed: true });
  assert.deepEqual(watchEntriesWith(null, emma), { entries: [emma], changed: true });
});

// --- watchConflictMerge: what the edit sheet holds after a 409 ---
test('watchConflictMerge', () => {
  const emma = { type: 'athlete', id: '1001', name: 'Emma Mittainen', enabled: true };
  const nea = { type: 'athlete', id: '1002', name: 'Nea Merkkinen', enabled: true };
  const onni = { type: 'athlete', id: '1003', name: 'Onni Harjoitinen', enabled: true };
  const club = { type: 'club', id: '591', name: 'Demon Urheilijat', enabled: true };
  const base = { label: 'Demo', entries: [emma, club] };

  // The sheet took Emma off and put Nea on. Another device put Onni on.
  // (Break on purpose: compare with the sheet alone and Emma comes back.)
  const fresh = { label: 'Demo', entries: [emma, club, onni] };
  const merged = watchConflictMerge(base, fresh, 'Demo', [club, nea]);
  assert.deepEqual(merged.added, [onni], 'only what arrived since the sheet loaded');
  assert.deepEqual(merged.entries, [club, nea, onni], 'a removal on this sheet stays removed');
  // What the other device removed comes back, since only additions merge.
  assert.deepEqual(watchConflictMerge(base, { label: 'Demo', entries: [emma] }, 'Demo', [emma, club]).entries, [
    emma,
    club,
  ]);
  // A switched-off entry is the same entry, whatever its switch reads.
  assert.deepEqual(
    watchConflictMerge(base, { label: 'Demo', entries: [{ ...emma, enabled: false }, club] }, 'Demo', [emma, club])
      .added,
    [],
  );
  assert.deepEqual(
    watchConflictMerge(base, { label: 'Demo', entries: [{ ...club, id: '1001' }] }, 'Demo', [emma]).added,
    [{ ...club, id: '1001' }],
    'a club and an athlete sharing an id are two entries',
  );

  // The merge keeps the reader's label if they changed it, else the other
  // device's.
  // (Break on purpose: always keep the sheet's label, and the second reads
  // "Demo".)
  assert.equal(watchConflictMerge(base, { ...fresh, label: 'Demot' }, 'Omat', [emma]).label, 'Omat');
  assert.equal(watchConflictMerge(base, { ...fresh, label: 'Demot' }, 'Demo', [emma]).label, 'Demot');
});

// --- watchEntryAthleteIds/watchTargets/filterEventIds/watchGroups: a Watch's
// entries matched against the demo roster and a day's schedule ---
test('watchEntryAthleteIds/watchTargets/filterEventIds/watchGroups', () => {
  const roster = buildRoster(demoEventResults());
  const emma = roster.athletes.find((a) => a.name === 'Emma Mittainen');
  const nea = roster.athletes.find((a) => a.name === 'Nea Merkkinen');
  const tuomas = roster.athletes.find((a) => a.name === 'Tuomas Kokeinen');
  assert.notEqual(emma.organizationId, nea.organizationId, 'the two Keihäs entrants are on different clubs');

  // An athlete entry stores the LicenseId, since Athletes[].Id identifies an
  // entry and not a person (docs/tuloslista-api.md, "Categories, names and
  // identity").
  assert.ok(
    emma.licenseId && emma.licenseId !== String(emma.id),
    'the fixture must actually distinguish the two ids, or this test proves nothing',
  );
  assert.deepEqual(
    watchEntryAthleteIds({ type: 'athlete', id: emma.licenseId }, roster),
    new Set([String(emma.id)]),
    "a license resolves to this competition's own athlete id",
  );
  assert.deepEqual(
    watchEntryAthleteIds({ type: 'athlete', id: emma.id }, roster),
    new Set(),
    'and a competition-scoped athlete id resolves to nothing — it is not what an entry holds',
  );
  assert.deepEqual(
    watchEntryAthleteIds({ type: 'club', id: emma.organizationId }, roster),
    new Set([
      'a1-a',
      'b1-a',
      'c3-a',
      'd1-a',
      'f1-0',
      'f1-1',
      'f1-3',
      'g1-a',
      'h1-a',
      'i1-a',
      'i5-a',
      'j1-a',
      'k1-a',
      'k6-a',
      'l1-a',
      'm1-a',
      'm5-a',
      'n4-a',
      'o1-a',
      'p1-a',
      'q3-a',
      'u1-a',
      'u6-a',
      'v1-a',
      'v2-a',
      'w2-a',
      'w7-a',
      'w10-a',
      'y1-a',
      'y4-a',
      'z12-a',
      'z16-a',
      'z3-a',
      'z8-a',
      'ai1-a',
      'ot1-a',
      'st1-a',
    ]),
    'a club entry expands to every roster athlete in that organization, not just one',
  );
  assert.deepEqual(
    watchEntryAthleteIds(
      { type: 'athlete', id: roster.athletes.find((a) => a.name === 'Ville Mallinen').licenseId },
      roster,
    ),
    new Set(['a1-a', 'f1-0']),
    'and a licence to every enrollment id that person has here — his own event and his relay leg',
  );
  assert.deepEqual(
    watchEntryAthleteIds({ type: 'athlete', id: '99999999' }, roster),
    new Set(),
    'an athlete not entered in this competition matches nothing, rather than erroring',
  );
  assert.deepEqual(watchEntryAthleteIds({ type: 'club', id: '4242' }, roster), new Set());

  // watchTargets resolves the entries to id sets, and filterEventIds turns
  // those into the EventIds they touch.
  const emmaTargets = watchTargets([{ type: 'athlete', id: emma.licenseId, enabled: true }], roster);
  assert.deepEqual(
    watchTargets(
      [
        { type: 'athlete', id: emma.licenseId, enabled: true },
        { type: 'athlete', id: '9', enabled: false },
        { type: 'club', id: 1 },
      ],
      null,
    ).licences,
    new Set([String(emma.licenseId)]),
    'the people followed by name, without a roster',
  );
  assert.deepEqual(emmaTargets.athleteIds, new Set([String(emma.id)]));
  assert.deepEqual(
    emmaTargets.namedAthleteIds,
    new Set([String(emma.id)]),
    'an athlete entry is somebody followed by name — the set a relay team is matched against',
  );
  assert.equal(emmaTargets.clubIds.size, 0);
  const eventIds = filterEventIds(emmaTargets, roster);
  assert.deepEqual(eventIds, new Set(['e6']));
  assert.equal(
    filterEventIds(watchTargets([], roster), roster).size,
    0,
    'no entries resolved (a disabled entry, or nobody entered here) means no events',
  );
  assert.equal(
    watchTargets([{ type: 'club', id: 1, enabled: false }], roster).clubIds.size,
    0,
    'a toggled-off entry resolves to nothing at all, club included',
  );

  // A club entry resolves to its athletes and to the club. A relay matches a
  // club entry on the club alone (docs/tuloslista-api.md).
  const demuTargets = watchTargets([{ type: 'club', id: 1, enabled: true }], roster);
  assert.deepEqual(demuTargets.clubIds, new Set(['1']));
  assert.equal(demuTargets.namedAthleteIds.size, 0, 'a club follows nobody by name');
  assert.deepEqual(
    filterEventIds(demuTargets, roster),
    new Set([
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
      'e6',
      'e7',
      'e9',
      'e10',
      'e16',
      'e17',
      'e18',
      'e20',
      'e21',
      'e24',
      'e25',
      'e26',
      'e27',
      'e30',
      'e32',
      'e33',
      'e34',
      'e35',
      'e36',
      'e38',
      'e39',
      'e40',
      'e45',
      'e47',
      'e51',
      'e56',
      'e57',
      'e58',
    ]),
    'every individual event a DemU athlete is entered in — each multi-event as its three legs, since ' +
      'that is what the schedule has — plus the relay through the team the club entered',
  );

  // A club's athlete whose only entry is another club's relay team does not
  // bring that relay (docs/tuloslista-api.md).
  const malvTargets = watchTargets([{ type: 'club', id: 2, enabled: true }], roster);
  assert.ok(malvTargets.athleteIds.has(String(tuomas.id)), 'he is on their roster all the same');
  assert.deepEqual(
    filterEventIds(malvTargets, roster),
    new Set([
      'e5',
      'e6',
      'e7',
      'e9',
      'e10',
      'e16',
      'e17',
      'e18',
      'e20',
      'e21',
      'e27',
      'e28',
      'e31',
      'e32',
      'e33',
      'e34',
      'e35',
      'e36',
      'e38',
      'e39',
      'e40',
      'e45',
      'e51',
      'e56',
      'e57',
      'e58',
    ]),
  );
  // Without the club's own team the relay drops out. (Break on purpose: match
  // a relay on `covered` as an individual event, and e5 lands in this set.)
  const noMalvTeam = { athletes: roster.athletes.filter((a) => !String(a.id).startsWith('f2-')) };
  assert.deepEqual(
    filterEventIds(watchTargets([{ type: 'club', id: 2, enabled: true }], noMalvTeam), noMalvTeam),
    new Set([
      'e6',
      'e7',
      'e9',
      'e10',
      'e16',
      'e17',
      'e18',
      'e20',
      'e21',
      'e27',
      'e28',
      'e31',
      'e32',
      'e33',
      'e34',
      'e35',
      'e36',
      'e38',
      'e39',
      'e40',
      'e45',
      'e51',
      'e56',
      'e57',
      'e58',
    ]),
    "a club's athlete in somebody else's team does not pull that team's relay in — the rest of the club's " +
      'own individual entries still match',
  );

  // Followed by name, that athlete brings the relay, as the digest does.
  const tuomasEvents = filterEventIds(
    watchTargets([{ type: 'athlete', id: tuomas.licenseId, enabled: true }], roster),
    roster,
  );
  assert.deepEqual(tuomasEvents, new Set(['e5']));

  const schedule = demoSchedule();
  const day = Object.keys(schedule)[0];
  const groups = watchGroups(schedule[day], eventIds);
  assert.equal(groups.length, 1, 'only Keihäs (e6) matches this watch');
  assert.equal(groups[0].event, 'Keihäs');
  // An empty set of EventIds leaves no group.
  assert.equal(watchGroups(schedule[day], new Set()).length, 0);
});

// --- focusTargets: the quick-filter in a follow-list's three sets ---
test('focusTargets', () => {
  const roster = buildRoster(demoEventResults());
  const emma = roster.athletes.find((a) => a.name === 'Emma Mittainen');

  // A person's stored id is already a roster athlete id, so a person
  // resolves with no roster.
  const person = focusTargets({ kind: 'athlete', id: emma.id, name: emma.name }, null);
  assert.deepEqual(person.athleteIds, new Set([String(emma.id)]));
  assert.deepEqual(
    person.namedAthleteIds,
    new Set([String(emma.id)]),
    "by name, so their relay team matches the way a named Watch entry's does",
  );
  assert.equal(person.clubIds.size, 0);
  // An unmarked focus is a person (normalizeCompView says so too).
  assert.deepEqual(focusTargets({ id: emma.id }, null).athleteIds, new Set([String(emma.id)]));

  // A club resolves as a one-entry follow-list through the roster, since an
  // individual row is matched on its athletes. (Break on purpose: give a club
  // the athlete shape, and clubIds is empty.)
  const club = focusTargets({ kind: 'club', id: 1, name: 'Demon Urheilijat' }, roster);
  assert.deepEqual(
    club,
    watchTargets([{ type: 'club', id: '1', name: 'Demon Urheilijat', enabled: true }], roster),
    'exactly what following that club alone resolves to',
  );
  assert.deepEqual(club.clubIds, new Set(['1']));
  assert.equal(club.namedAthleteIds.size, 0, 'a club follows nobody by name');
  assert.ok(club.athleteIds.size > 1, 'and the roster is what turns it into people');

  assert.equal(focusTargets({ kind: 'club', id: '4242', name: 'Ei ketään' }, roster).athleteIds.size, 0);
});

// --- allocMatches: whether one allocation or entry belongs to a filter ---
test('allocMatches', () => {
  const targets = (o) => ({
    athleteIds: new Set(o.athleteIds || []),
    namedAthleteIds: new Set(o.namedAthleteIds || []),
    clubIds: new Set(o.clubIds || []),
  });
  const individual = { Athletes: [{ Id: 'x1' }], Organization: { Id: 9 } };
  assert.equal(allocMatches(individual, targets({ athleteIds: ['x1'] })), true);
  assert.equal(allocMatches(individual, targets({ athleteIds: ['x2'] })), false);
  assert.equal(allocMatches(individual, targets({})), false, 'empty target sets match nothing');
  assert.equal(allocMatches(individual, null), false, 'no targets at all (no watch context) matches nothing');
  assert.equal(
    allocMatches(individual, targets({ clubIds: ['9'] })),
    false,
    "an individual row is matched through the roster's athlete ids, not the row's own club",
  );

  // A relay row matches its club or a followed runner, never a name in its
  // pool (relayLineup).
  const relay = {
    Organization: { Id: 5 },
    AthleteOrders: [
      { Index: 1, Athlete: { Id: 'r1' } },
      { Index: 2, Athlete: { Id: 'r2' } },
    ],
    Athletes: [
      { Index: 1, Id: 'r1' },
      { Index: 2, Id: 'r2' },
      { Index: 3, Id: 'reserve' },
    ],
  };
  const team = { relay: true, legCount: 2 };
  assert.equal(allocMatches(relay, targets({ clubIds: ['5'] }), team), true, "the team's own club");
  assert.equal(allocMatches(relay, targets({ clubIds: ['6'] }), team), false);
  assert.equal(
    allocMatches(relay, targets({ namedAthleteIds: ['r2'] }), team),
    true,
    'a followed person running in it, via AthleteOrders',
  );
  assert.equal(
    allocMatches(relay, targets({ athleteIds: ['r2'] }), team),
    false,
    "but not a person reached only through their club — a relay is the entering club's",
  );
  assert.equal(
    allocMatches(relay, targets({ namedAthleteIds: ['reserve'] }), team),
    false,
    "and not one of the extra entered names either (break on purpose: drop relayLineup's slice)",
  );
  // An entry has no AthleteOrders, so its runners are the first legCount
  // names by Index (docs/tuloslista-api.md).
  const enrolled = { Organization: { Id: 5 }, Athletes: relay.Athletes };
  assert.equal(allocMatches(enrolled, targets({ namedAthleteIds: ['r2'] }), team), true);
  assert.equal(allocMatches(enrolled, targets({ namedAthleteIds: ['reserve'] }), team), false);
});

// --- findAthleteAllocations: a filter's rows in a loaded round, relays too ---
test('findAthleteAllocations', () => {
  const only = (ids, key = 'athleteIds') => ({
    athleteIds: new Set(),
    namedAthleteIds: new Set(),
    clubIds: new Set(),
    [key]: new Set(ids),
  });
  const round = DEMO_EVENTS.e2.Rounds[0];
  const found = findAthleteAllocations(round, only(['b1-a']));
  assert.equal(found.length, 1);
  assert.equal(found[0].heatIndex, 1);
  assert.equal(found[0].alloc.Id, 'b1');
  assert.equal(findAthleteAllocations(round, only(['nobody'])).length, 0);

  const relayRound = DEMO_EVENTS.e5.Rounds[0];
  const team = relayInfo(DEMO_EVENTS.e5);
  assert.deepEqual(team, { relay: true, legCount: 4 });
  const relayFound = findAthleteAllocations(relayRound, only(['f1-2'], 'namedAthleteIds'), team);
  assert.equal(relayFound.length, 1, 'a followed relay runner is found via AthleteOrders, not just Athletes');
  assert.equal(relayFound[0].alloc.Id, 'f1');
  // A club entry matches the club's own team, not the team one of its
  // athletes runs in for another club (docs/tuloslista-api.md).
  const malv = findAthleteAllocations(relayRound, only(['2'], 'clubIds'), team);
  assert.deepEqual(
    malv.map((m) => m.alloc.Id),
    ['f2'],
  );
  assert.deepEqual(
    findAthleteAllocations(relayRound, only(['1'], 'clubIds'), team).map((m) => m.alloc.Id),
    ['f1'],
  );
});

// --- matchedEntries: a drawn round's rows, or the entries before a draw ---
test('matchedEntries', () => {
  const ids = (list) => ({ athleteIds: new Set(list), namedAthleteIds: new Set(), clubIds: new Set() });
  const allocated = matchedEntries(DEMO_EVENTS.e2.Rounds[0], null, ids(['b1-a']));
  assert.equal(allocated.length, 1);
  assert.equal(allocated[0].alloc.Id, 'b1');
  assert.equal(allocated[0].total, 3, 'field size comes from roundFieldSize once a round exists');
  assert.equal(allocated[0].heatIndex, 1);
  assert.equal(allocated[0].heatCount, 1, 'M Kuula has just the one heat');

  const unallocated = matchedEntries(null, DEMO_EVENTS.e6.Enrollments, ids(['g1-a']));
  assert.equal(unallocated.length, 1);
  assert.equal(unallocated[0].alloc.Id, 'g1');
  assert.equal(unallocated[0].total, null, 'no round yet, so no field size either');
  assert.equal(unallocated[0].heatIndex, null, 'nor a heat — nothing is drawn yet');

  // An undrawn round can be in Rounds[] with an empty or missing Heats
  // (docs/tuloslista-api.md). (Break on purpose: test `if (round)`, and the
  // entered athlete is not found.)
  const shellRound = { Id: 'r1', Heats: [] };
  assert.deepEqual(
    matchedEntries(shellRound, DEMO_EVENTS.e6.Enrollments, ids(['g1-a'])),
    matchedEntries(null, DEMO_EVENTS.e6.Enrollments, ids(['g1-a'])),
    'an empty-Heats round must fall through to enrollments exactly like no round at all',
  );
  assert.deepEqual(
    matchedEntries({ Id: 'r1' }, DEMO_EVENTS.e6.Enrollments, ids(['g1-a'])),
    matchedEntries(null, DEMO_EVENTS.e6.Enrollments, ids(['g1-a'])),
    'a missing Heats key (not even an empty array) must also fall through',
  );
  // The heat shell is the third undrawn shape (docs/tuloslista-api.md).
  // (Break on purpose: test `Heats.length`, and nobody is found.)
  const heatShell = { Id: 'r1', Heats: [{ Index: 1, Allocations: [] }] };
  assert.deepEqual(
    matchedEntries(heatShell, DEMO_EVENTS.e6.Enrollments, ids(['g1-a'])),
    matchedEntries(null, DEMO_EVENTS.e6.Enrollments, ids(['g1-a'])),
    'a heat shell with no allocations must fall through to enrollments too',
  );

  assert.deepEqual(matchedEntries(null, null, ids(['g1-a'])), [], 'no round and no enrollments: nothing to match');
  assert.deepEqual(matchedEntries(DEMO_EVENTS.e2.Rounds[0], null, ids(['nobody'])), []);

  const karsinta = DEMO_EVENTS.e3.Rounds.find((r) => r.Id === 'r3q');
  const multiHeat = matchedEntries(karsinta, null, ids(['c4-a']));
  assert.equal(multiHeat[0].heatIndex, 2, 'c4 (Iina Demoinen) is in heat 2');
  assert.equal(multiHeat[0].heatCount, 2, 'the round has two heats total');

  // stripResults is set when the rows are previousRoundField's, borrowed
  // from an earlier round (groupLines, app/meet.js). Their results must not
  // read as this round's.
  const prevAlloc = {
    Id: 'z1',
    Athletes: [{ Id: 'z1-a' }],
    Result: '11.42',
    ResultRank: 2,
    HeatRank: 1,
    Wind: '+1.2',
    QRank: true,
    QResult: false,
  };
  const stripped = matchedEntries(null, [prevAlloc], ids(['z1-a']), null, true);
  assert.equal(stripped.length, 1);
  assert.equal(stripped[0].alloc.Result, null, "a previous round's Result must not read as this round's own");
  assert.equal(stripped[0].alloc.ResultRank, null);
  assert.equal(stripped[0].alloc.HeatRank, null);
  assert.equal(stripped[0].alloc.Wind, null);
  assert.equal(stripped[0].alloc.QRank, false, "a previous round's qualification badge must not carry over either");
  assert.equal(stripped[0].alloc.QResult, false);
  assert.equal(stripped[0].alloc.Id, 'z1', 'stripping must not touch identity fields');

  // Without the flag the rows come back as they are.
  const kept = matchedEntries(null, [prevAlloc], ids(['z1-a']));
  assert.equal(kept[0].alloc.Result, '11.42');
  assert.equal(kept[0].alloc.QRank, true);
});

// --- allocPosition/allocMark: the placing and the mark on a followed line
// of the day list (docs/views.md) ---
test('allocPosition/allocMark', () => {
  const ids = (list) => ({ athleteIds: new Set(list), namedAthleteIds: new Set(), clubIds: new Set() });
  const position = (round, id) => {
    const m = matchedEntries(round, null, ids([id]))[0];
    return allocPosition(m.alloc, m.total, m.heatIndex, m.heatCount, round);
  };
  // e9's Välierät has run one heat of two.
  const semi = DEMO_EVENTS.e9.Rounds.find((r) => r.Id === 'r9v');
  assert.deepEqual(
    position(semi, 'i1-a'),
    { text: '1/6', pending: true },
    'the rank over the whole round, muted while the round can move',
  );
  assert.deepEqual(position(semi, 'i3-a'), { text: 'Erä 2/2', pending: false }, 'before a result, the drawn heat');
  const karsinta = DEMO_EVENTS.e3.Rounds.find((r) => r.Id === 'r3q');
  assert.deepEqual(position(karsinta, 'c4-a'), { text: '1/4', pending: false }, 'an Official round is not muted');
  // (Break on purpose: mute on qualPending and the Korkeus, one heat still
  // being jumped, reads as final.)
  const korkeus = DEMO_EVENTS.e4.Rounds[0];
  assert.deepEqual(position(korkeus, 'd1-a'), { text: '1/5', pending: true });
  // (Break on purpose: drop `heatCount > 1` and this reads "Erä 1/1".)
  assert.deepEqual(
    allocPosition({ ResultRank: null }, 5, 1, 1, korkeus),
    { text: '', pending: false },
    'one heat is not worth naming',
  );
  assert.deepEqual(
    allocPosition({ ResultRank: 3 }, null, null, null, null).text,
    '3.',
    'no field size, no denominator',
  );
  const entry = matchedEntries(null, DEMO_EVENTS.e6.Enrollments, ids(['g1-a']))[0];
  assert.deepEqual(
    allocPosition(entry.alloc, entry.total, entry.heatIndex, entry.heatCount, null),
    { text: '', pending: false },
    'an entry list has neither',
  );

  // A vertical jump prints every number in metres, the Result in centimetres
  // and the best in metres alike. (Break on purpose: have markFormat return
  // PLAIN_MARK for every event and the first reads "190".)
  const jumper = (id) => korkeus.Heats[0].Allocations.find((a) => a.Id === id);
  assert.equal(allocMark(jumper('d2'), DEMO_EVENTS.e4), '1.90');
  assert.equal(markFormat(DEMO_EVENTS.e4)(jumper('d2').PB), '1.88');
  assert.equal(allocMark(jumper('d3'), DEMO_EVENTS.e4), 'NH');
  assert.equal(
    allocMark(DEMO_EVENTS.e1.Rounds[0].Heats[0].Allocations[0], DEMO_EVENTS.e1),
    '11,42',
    'any other event prints the Result as it came',
  );
  assert.equal(allocMark(DEMO_EVENTS.e2.Rounds[0].Heats[0].Allocations[2], DEMO_EVENTS.e2), '', 'no result, no mark');
  assert.equal(markFormat(null)(null), '');
});

// --- confirmSetting/confirmNote: varmistus, gated on the meet
// (docs/tuloslista-api.md) ---
test('confirmSetting/confirmNote', () => {
  assert.deepEqual(confirmSetting(demoResponse(`/competition/${DEMO_ID}/properties`)), { minutes: 60 });
  assert.deepEqual(
    confirmSetting({ Settings: [{ Type: 1, Index: 1, IntValue: 90, StringValue: 'off' }] }),
    { minutes: 90 },
    'the value is not read: 20510 reads "off" and confirmed 83 of its 126 teams',
  );
  assert.equal(
    confirmSetting({ Settings: [{ Type: 3, Index: 0, IntValue: 1, StringValue: 'KKFIImport' }] }),
    null,
    'the cup marker is not this. (Break on purpose: drop the Type test and every cup meet grows a deadline)',
  );
  assert.equal(confirmSetting({ Settings: [] }), null, 'most meets carry no such entry');
  assert.equal(confirmSetting(null), null);

  const on = { minutes: 60 };
  const nobody = [{ Confirmed: false }, { Confirmed: false }];
  const someone = [{ Confirmed: true }, { Confirmed: false }, { Confirmed: false }];

  // (Break on purpose: return the count whatever the gate says, and a meet
  // that confirms nobody gets a count.)
  assert.equal(
    confirmNote(nobody, null, ''),
    null,
    'no setting and nobody confirmed: the commonest meet there is, and it means nothing',
  );
  assert.equal(
    confirmNote(someone, null, '').confirmed,
    1,
    'no setting but somebody confirmed anyway — 20337 and 20571 both do this',
  );
  const untouched = confirmNote(nobody, on, '');
  assert.ok(
    untouched,
    'the setting alone is enough, and has to be: before anybody confirms it is the only signal there is',
  );
  assert.equal(untouched.total, 2);
  // (Break on purpose: read the value as `setting?.on`, and this one fails.)
  const offMeet = confirmNote(nobody, { minutes: 90 }, '');
  assert.ok(offMeet, 'including on the meet whose switch reads "off" — 20510\'s undrawn relays are this exact row');
  assert.equal(offMeet.total, 2);
  assert.equal(confirmNote([], on, ''), null, 'nobody entered: no count to give');
  assert.equal(confirmNote(null, on, ''), null);

  // The deadline counts back from the start, compared as an instant
  // (docs/tuloslista-api.md).
  const ts = '2026-08-26T14:30:00.0000000+00:00';
  const starts = tsKey(ts);
  const closes = starts - 60 * 60 * 1000;
  assert.equal(confirmNote(nobody, on, ts, closes - 1).closesTs, closes, "the start, minus the setting's own minutes");
  assert.equal(confirmNote(nobody, on, ts, closes - 1).closed, false);
  assert.equal(confirmNote(nobody, on, ts, closes).closed, true, 'the deadline itself is past it');
  assert.equal(confirmNote(nobody, on, ts, starts).closed, true);
  // One wall time under two offsets is two instants, as one competition's
  // rows carry (docs/tuloslista-api.md). (Break on purpose: read the
  // string's hours, not tsKey's instant, and both answer alike.)
  const between = closes - 2 * 60 * 60 * 1000;
  assert.equal(confirmNote(nobody, on, ts, between).closed, false, 'still open under +00:00');
  assert.equal(
    confirmNote(nobody, on, '2026-08-26T14:30:00.0000000+03:00', between).closed,
    true,
    'and three hours shut under +03:00',
  );

  assert.equal(
    confirmNote(nobody, { minutes: 0 }, ts).closesTs,
    null,
    'a setting with no minutes has no deadline to print',
  );
  assert.equal(
    confirmNote(someone, null, ts).closesTs,
    null,
    'gated in on the data alone, so there is no setting to take a deadline from',
  );
  assert.equal(
    confirmNote(nobody, on, 'ei aikaleimaa').closesTs,
    null,
    'an unparseable start time gives no deadline rather than one in 1970',
  );

  // e6 is the entry list before any draw.
  const keihas = confirmNote(
    DEMO_EVENTS.e6.Enrollments,
    confirmSetting(demoResponse(`/competition/${DEMO_ID}/properties`)),
    DEMO_EVENTS.e6.Rounds[0]?.BeginDateTimeWithTZ || '',
  );
  assert.equal(keihas.total, 2);
  assert.equal(keihas.confirmed, 1);

  // A multi-event counts its root's entries, and a leg counts its own
  // (docs/tuloslista-api.md). (Break on purpose: give e56 its root's
  // list, and it reads 2/3.)
  const ottelu = (e) => confirmCount(confirmNote(e.Enrollments, on, ''));
  assert.equal(ottelu(DEMO_EVENTS.e59), 'Varmistaneita 2/3');
  assert.equal(ottelu(DEMO_EVENTS.e57), 'Varmistaneita 2/3');
  assert.equal(ottelu(DEMO_EVENTS.e56), 'Varmistaneita 1/3');

  // The Ottelut box uses the day list's words (combinedCounts). It counts no
  // erät, since the root's one heat is a container (docs/tuloslista-api.md).
  assert.equal(countLine(combinedCounts(DEMO_EVENTS.e59)), '2/3 varmistanutta');
  assert.equal(combinedCounts(DEMO_EVENTS.e59).heats, null);
  assert.equal(countLine(combinedCounts(DEMO_EVENTS.e41)), '3/4 varmistanutta');
  // A zero confirmed keeps the entry count (countLine).
  assert.equal(countLine(combinedCounts({ Enrollments: [{}, {}, {}] })), '3 ilmoittautunutta');
  assert.equal(countLine(combinedCounts({ Enrollments: [] })), 'Ei ilmoittautuneita');
  // A root that failed to load says nothing. (Break on purpose: drop the
  // guard in combinedCounts.)
  assert.equal(countLine(combinedCounts(null)), '');

  // confirmCloses writes the text after the count, the deadline or that it
  // has passed. app/follow.js supplies the clock formatter.
  const fmt = () => '13.30';
  assert.equal(confirmCloses(confirmNote(nobody, on, ts, closes - 1), fmt), 'sulkeutuu 13.30');
  assert.equal(confirmCloses(confirmNote(nobody, on, ts, closes), fmt), 'Varmistus sulkeutunut');
  assert.equal(
    confirmCloses(confirmNote(nobody, on, ts, closes), fmt, true),
    'sulkeutunut',
    'a row says it in the words the count beside it leaves to be said',
  );
  assert.equal(
    confirmCloses(confirmNote(nobody, { minutes: 0 }, ts), fmt),
    null,
    'no deadline to compute, so no half to print',
  );
  assert.equal(confirmCloses(null, fmt), null);

  // A multi-event confirms once, before its first leg, so each leg counts
  // back from the first (docs/tuloslista-api.md). (Break on purpose: count a
  // leg from its own row, and the Kuula's check fails.)
  const rows = Object.values(demoSchedule()).flat();
  const row = (name) => rows.find((r) => r.EventName === name);
  const startsAt = confirmStartAt(demoSchedule());
  const opener = row('P9 3-ottelu  40m').BeginDateTimeWithTZ;
  assert.ok(
    tsKey(row('P9 3-ottelu  Kuula').BeginDateTimeWithTZ) > tsKey(opener),
    'the fixture still runs the legs at three different times',
  );
  assert.equal(startsAt(row('P9 3-ottelu  Kuula')), opener);
  assert.equal(startsAt(row('P9 3-ottelu  Pituus')), opener);
  assert.equal(startsAt(row('P9 3-ottelu  40m')), opener);
  assert.equal(
    startsAt(row('N Keihäs')),
    row('N Keihäs').BeginDateTimeWithTZ,
    'an ordinary start counts back from its own start',
  );
  assert.equal(startsAt({}), undefined);
});

// --- watchConfirmations: the day's own list, over a follow-list ---
test('watchConfirmations', () => {
  const on = { minutes: 60 };
  const ts = (h) => `2026-08-26T${String(h).padStart(2, '0')}:00:00.0000000+00:00`;
  const at = (h) => tsKey(ts(h));

  // The gate opens on the setting or on a confirmation in the field
  // (docs/tuloslista-api.md). (Break on purpose: drop the
  // `confirmsHere` half, and the first of these answers null.)
  const one = [{ name: 'A', label: '100 m', ts: ts(14), confirmed: true }];
  const none = [{ name: 'A', label: '100 m', ts: ts(14), confirmed: false }];
  const noSetting = watchConfirmations(one, null, true);
  assert.ok(noSetting, 'a meet that carries no setting at all (20337, 20571)');
  assert.equal(
    noSetting.rows[0].closesTs,
    null,
    'gated on the data alone, so there is no setting to take a deadline from',
  );
  assert.equal(
    watchConfirmations(none, null, false),
    null,
    'no setting and nothing confirmed: the commonest meet there is, and it says nothing',
  );
  const offMeet = watchConfirmations(none, { minutes: 60 }, false);
  assert.ok(offMeet, 'but the setting alone speaks, on a day nobody has confirmed in yet (20510)');
  assert.equal(offMeet.confirmed, 0);
  assert.equal(
    offMeet.rows[0].closesTs,
    tsKey(ts(14)) - 60 * 60 * 1000,
    'and it is the half that carries a deadline, which is the half worth acting on',
  );
  assert.equal(watchConfirmations([], on, true), null, 'nothing of mine today');
  assert.equal(watchConfirmations(null, on, true), null);

  // The data half is asked of the whole field, never of the followed rows
  // (docs/tuloslista-api.md, "Varmistus (confirmation)"). (Break on
  // purpose: gate on `list.some((e) => e.confirmed)`, and this goes silent.)
  const nobodyOfMine = watchConfirmations(none, null, true);
  assert.ok(nobodyOfMine, 'the meet confirms, so my own nought-of-one still counts');
  assert.equal(nobodyOfMine.confirmed, 0);
  assert.equal(nobodyOfMine.total, 1);
  // With no deadline at all the names decide. (Break on purpose: rank a row
  // with no deadline after any other without asking the other's.)
  const noDeadline = ['Ö', 'Bea', 'Aada'].map((name) => ({ name, label: '100 m', ts: ts(14), confirmed: false }));
  assert.deepEqual(
    watchConfirmations(noDeadline, null, true).rows.map((r) => r.name),
    ['Aada', 'Bea', 'Ö'],
  );

  // Unconfirmed rows come first, then the soonest deadline. (Break on
  // purpose: sort by closesTs alone, and Cecilia leads.)
  const day = [
    { name: 'Aada', label: '100 m', ts: ts(16), confirmed: false },
    { name: 'Bea', label: 'Pituus', ts: ts(14), confirmed: false },
    { name: 'Cecilia', label: '60 m', ts: ts(12), confirmed: true },
  ];
  const v = watchConfirmations(day, on, true, at(10));
  assert.deepEqual(
    v.rows.map((r) => r.name),
    ['Bea', 'Aada', 'Cecilia'],
  );
  assert.equal(v.total, 3);
  assert.equal(v.confirmed, 1);

  // Each row's deadline counts back from its own event's start.
  assert.deepEqual(
    v.rows.map((r) => r.closesTs),
    [at(13), at(15), at(11)],
  );
  assert.deepEqual(
    v.rows.map((r) => r.closed),
    [false, false, false],
  );
  const later = watchConfirmations(day, on, true, at(13));
  assert.deepEqual(
    later.rows.map((r) => r.closed),
    [true, false, true],
    'the deadline itself is past it, per row',
  );

  // Rows sharing a key fold into the first, as a multi-event confirms once
  // (docs/tuloslista-api.md). (Break on purpose: drop the fold, and every leg
  // is a row.)
  const leg = (name, id, disc) => ({
    name,
    label: 'T11 3-ottelu',
    key: `T11 3-ottelu|${id}`,
    ts: ts(11),
    confirmed: true,
    disc,
  });
  const ottelu = watchConfirmations(
    [
      leg('Aada', 'a1', '40m'),
      leg('Aada', 'a1', 'Korkeus'),
      leg('Aada', 'a1', 'Kuula'),
      leg('Bea', 'b1', '40m'),
      leg('Bea', 'b1', 'Korkeus'),
      { name: 'Cecilia', label: 'Pituus', ts: ts(14), confirmed: false },
    ],
    on,
    true,
    at(9),
  );
  assert.deepEqual(
    ottelu.rows.map((r) => r.name),
    ['Cecilia', 'Aada', 'Bea'],
    'five leg rows and one field entry are three entries',
  );
  assert.equal(ottelu.total, 3);
  assert.equal(ottelu.confirmed, 2);
  assert.equal(ottelu.rows[1].label, 'T11 3-ottelu', 'named for the ottelu, not for a leg of it');
  assert.equal(ottelu.rows[1].closesTs, at(10), 'under the one deadline its legs share');
  // A row with no key never folds, however alike.
  const noKey = [
    { name: 'Aada', label: '100 m', ts: ts(16), confirmed: false },
    { name: 'Aada', label: '100 m', ts: ts(16), confirmed: false },
  ];
  assert.equal(watchConfirmations(noKey, on, true).total, 2);

  // A row with no parseable start sorts last within its half.
  // (Break on purpose: let null sort as 0, and it leads the unconfirmed.)
  const odd = watchConfirmations(
    [
      { name: 'Doris', label: 'Kuula', ts: 'ei aikaleimaa', confirmed: false },
      { name: 'Bea', label: 'Pituus', ts: ts(14), confirmed: false },
    ],
    on,
    true,
    at(10),
  );
  assert.deepEqual(
    odd.rows.map((r) => r.name),
    ['Bea', 'Doris'],
  );
  assert.equal(odd.rows[1].closesTs, null);
  assert.equal(odd.rows[1].closed, false, 'no deadline is not a passed one');

  // Names break a tie between equal deadlines.
  const tied = watchConfirmations(
    [
      { name: 'Ähtäri', label: '60 m', ts: ts(14), confirmed: false },
      { name: 'Aalto', label: '60 m', ts: ts(14), confirmed: false },
    ],
    on,
    true,
    at(10),
  );
  assert.deepEqual(
    tied.rows.map((r) => r.name),
    ['Aalto', 'Ähtäri'],
  );
});

// --- confirmRows: one category's rows for watchConfirmations, off the demo ---
test('confirmRows', async () => {
  const schedule = demoSchedule();
  const groups = Object.values(schedule).flatMap((day) => groupRounds(day));
  let loads = 0;
  const store = eventStore(async (eventId) => {
    loads += 1;
    return demoResponse(`${API}/results/${DEMO_ID}/${eventId}`);
  });
  // Everybody entered in the start's events is followed.
  const everyone = (detailed) => ({
    athleteIds: new Set(
      detailed.flatMap((d) => (d.data?.Enrollments || []).flatMap((e) => e.Athletes.map((a) => a.Id))),
    ),
    namedAthleteIds: new Set(),
    clubIds: new Set(),
  });
  const rowsOf = async (name) => {
    const own = (e) => e.round.EventName === name && e.round.Name === 'Loppukilpailu';
    const g = groups.find((x) => x.entries.some(own));
    const detailed = await roundDetails(g.entries.filter(own), store);
    return confirmRows(detailed[0], g.event, everyone(detailed), relayInfo(detailed[0].data), 'ts', store);
  };

  // An undrawn entry list (e6) gives a row per followed entry.
  loads = 0;
  const keihas = await rowsOf('N Keihäs');
  assert.deepEqual(
    keihas.rows.map((r) => [r.name, r.label, r.key, r.ts, r.confirmed]),
    [
      ['Emma Mittainen', 'Keihäs', null, 'ts', true],
      ['Nea Merkkinen', 'Keihäs', null, 'ts', false],
    ],
  );
  assert.equal(keihas.confirmsHere, true);
  assert.equal(loads, 1, 'an ordinary start asks for no document beyond its own');

  // A drawn round's Allocations carry no Confirmed, and a later round's
  // Enrollments are the whole event's. (Break on purpose: drop either half of
  // the gate and that start reads a row per entrant.)
  assert.deepEqual(await rowsOf('N 1500m'), { rows: [], confirmsHere: false }, 'drawn');
  assert.deepEqual(await rowsOf('N 200m'), { rows: [], confirmsHere: false }, 'undrawn, with earlier rounds');

  // A leg is a row of its ottelu, ticked off the root's Enrollments (e59).
  // (Break on purpose: tick off the leg's own Enrollments, and Venla reads
  // unconfirmed off e56.)
  const legs = await Promise.all(
    ['T11 3-ottelu  40m', 'T11 3-ottelu  Korkeus', 'T11 3-ottelu  Kuula'].map((n) => rowsOf(n)),
  );
  const venla = legs[0].rows.find((r) => r.name === 'Venla Testinen');
  assert.equal(venla.label, 'T11 3-ottelu');
  assert.equal(venla.key, 'T11 3-ottelu|ot3-a');
  assert.equal(venla.confirmed, true);
  assert.equal(
    DEMO_EVENTS.e56.Enrollments.find((e) => e.Id === 'ot3').Confirmed,
    false,
    'the fixture still has her off the 40m alone',
  );
  // The legs fold into one row per entrant.
  const day = watchConfirmations(
    legs.flatMap((l) => l.rows),
    { minutes: 60 },
    true,
  );
  assert.deepEqual(
    day.rows.map((r) => [r.name, r.confirmed]),
    [
      ['Iiris Mallinen', false],
      ['Sofia Demoinen', true],
      ['Venla Testinen', true],
    ],
  );
});

// --- watchRegistryAdd/Remove: the device's known Watches, one flat list
// for every competition (docs/architecture.md) ---
test('watchRegistryAdd/Remove', () => {
  let list = watchRegistryAdd([], { watchId: 'w1', label: 'Eka' });
  list = watchRegistryAdd(list, { watchId: 'w2', label: 'Toka' });
  assert.deepEqual(
    list.map((w) => w.watchId),
    ['w2', 'w1'],
    'most recently added first',
  );
  assert.deepEqual(
    Object.keys(list[0]).sort(),
    ['label', 'watchId'],
    'a row carries nothing else — a stray compId here would be a leftover of the retired per-competition model',
  );

  // Re-adding a known Watch moves it to the front under its new label.
  // (Break on purpose: drop the filter in watchRegistryAdd, and the length
  // assertion fails.)
  list = watchRegistryAdd(list, { watchId: 'w1', label: 'Eka v2' });
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((w) => w.watchId),
    ['w1', 'w2'],
  );
  assert.equal(list[0].label, 'Eka v2', 'the refreshed label wins');

  let big = [];
  for (let i = 0; i < 31; i += 1) big = watchRegistryAdd(big, { watchId: `w${i}`, label: '' });
  assert.equal(big.length, 30, 'capped');
  assert.equal(
    big.some((w) => w.watchId === 'w0'),
    false,
    'the oldest entry is the one evicted',
  );

  assert.deepEqual(
    watchRegistryRemove(list, 'w1').map((w) => w.watchId),
    ['w2'],
  );
  assert.deepEqual(watchRegistryRemove(list, 'nope').length, 2, 'removing an unknown id is a no-op');

  // localStorage can hand back anything, and garbage reads as an empty list.
  assert.equal(watchRegistryAdd('garbage', { watchId: 'w9', label: '' }).length, 1);
  assert.deepEqual(watchRegistryRemove(null, 'w1'), []);
});

// --- copyWatchLabel: the name a copied list opens with, unique in the
// device's menu ---
test('copyWatchLabel', () => {
  assert.equal(copyWatchLabel('Demon Urheilijat', []), 'Demon Urheilijat (kopio)');
  // A second copy gets a number, as the first copy is in the menu too.
  assert.equal(copyWatchLabel('Kisat', ['Kisat', 'Kisat (kopio)']), 'Kisat (kopio 2)');
  assert.equal(copyWatchLabel('Kisat', ['Kisat', 'Kisat (kopio)', 'Kisat (kopio 2)']), 'Kisat (kopio 3)');
  // A gap in the numbering is filled.
  assert.equal(copyWatchLabel('Kisat', ['Kisat (kopio)', 'Kisat (kopio 3)']), 'Kisat (kopio 2)');

  // The base is cut so the suffix fits the Worker's cap (normalizeWatchLabel).
  // (Break on purpose: drop the slice in copyWatchLabel, and this fails at
  // 128.)
  const long = copyWatchLabel('x'.repeat(120), []);
  assert.equal(long.length, 80);
  assert.equal(long.endsWith(' (kopio)'), true, 'the suffix is what survives the cap, not the tail of the name');
  assert.equal(
    normalizeWatchInput({ label: long, entries: [] }).label,
    long,
    'so the Worker stores the copy under exactly the name the sheet showed',
  );

  // A list with no name copies under the menu's fallback name.
  assert.equal(copyWatchLabel('', []), 'Seuranta (kopio)');
  assert.equal(copyWatchLabel(null, null), 'Seuranta (kopio)');
  assert.equal(copyWatchLabel('  Kisat  ', []), 'Kisat (kopio)', 'the name is trimmed like every other');
});
