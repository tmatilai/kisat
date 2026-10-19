// Tests the multi-events, whose legs are events of their own (docs/views.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  combinedAthleteKey,
  combinedEventStarts,
  combinedGap,
  combinedLeaderPoints,
  combinedLegColumns,
  combinedStarted,
  combinedTotals,
  combinedWithdrawn,
  multiEventLeg,
} from '../public/lib/combined.js';
import { buildDigest, scanDigest } from '../public/lib/digest.js';
import { roundAllocated } from '../public/lib/results.js';
import { buildRoster, combinedEventRoots } from '../public/lib/roster.js';
import { combinedEventStatus, leastStatus, roundGroupKey } from '../public/lib/schedule.js';
import { DEMO_EVENTS, demoSchedule } from '../public/demo.js';

// --- combined events (moniottelu): the legs found by name and the standings
// read off the root, in the shapes docs/tuloslista-api.md describes ---
test('combined events', () => {
  // A leg is found by its name alone (docs/tuloslista-api.md).
  assert.deepEqual(multiEventLeg('N17 7-ottelu  Korkeus'), {
    label: 'N17 7-ottelu',
    kind: '7-ottelu',
    discipline: 'Korkeus',
  });
  assert.equal(multiEventLeg('T9 3-ottelu  40m').discipline, '40m');
  assert.equal(multiEventLeg('M22 10-ottelu  110m aidat').label, 'M22 10-ottelu');
  assert.equal(multiEventLeg('N Pituus'), null);
  assert.equal(multiEventLeg('M19 200m kelaus T54'), null);
  // A row that names the multi-event with no discipline is not a leg.
  assert.equal(multiEventLeg('N17 7-ottelu'), null);

  assert.equal(leastStatus(['Official', 'Official']), 'Official');
  assert.equal(leastStatus(['Official', 'Progress', 'Allocated']), 'Allocated');
  assert.equal(
    leastStatus(['Official', 'Kummallinen']),
    'Unallocated',
    'a status this app has never heard of can only hold the answer back',
  );
  assert.equal(leastStatus([]), 'Unallocated');

  // A multi-event can span two days and is still one (docs/tuloslista-api.md).
  // (Break on purpose: put the date in combinedEventStarts' grouping key and
  // this splits in two.)
  const row = (eventId, name, status, ts) => ({
    EventId: eventId,
    Id: `r${eventId}`,
    EventName: name,
    Name: 'Loppukilpailu',
    Category: /m$|aidat/.test(name) ? 'Track' : 'Field',
    Status: status,
    BeginDateTimeWithTZ: ts,
  });
  const twoDays = {
    '15.8.2026': [
      row('540460', 'N17 7-ottelu  100m aidat', 'Official', '2026-08-15T10:00:00.0000000+00:00'),
      row('540454', 'N17 7-ottelu  Korkeus', 'Progress', '2026-08-15T11:00:00.0000000+00:00'),
      row('540455', 'N17 7-ottelu  Kuula', 'Allocated', '2026-08-15T13:00:00.0000000+00:00'),
      row('540456', 'N17 7-ottelu  200m', 'Unallocated', '2026-08-15T15:00:00.0000000+00:00'),
      row('540470', 'N17 Kolmiloikka', 'Official', '2026-08-15T12:00:00.0000000+00:00'),
      row('540480', 'N19 7-ottelu  100m aidat', 'Official', '2026-08-15T10:10:00.0000000+00:00'),
    ],
    '16.8.2026': [
      row('540457', 'N17 7-ottelu  Pituus', 'Unallocated', '2026-08-16T10:00:00.0000000+00:00'),
      row('540458', 'N17 7-ottelu  Keihäs', 'Unallocated', '2026-08-16T12:00:00.0000000+00:00'),
      row('540459', 'N17 7-ottelu  800m', 'Unallocated', '2026-08-16T15:00:00.0000000+00:00'),
    ],
  };
  const twoDayStarts = combinedEventStarts(twoDays);
  assert.deepEqual(
    twoDayStarts.map((s) => s.label),
    ['N17 7-ottelu', 'N19 7-ottelu'],
    'two multi-events, in programme order, and the ordinary Kolmiloikka is neither',
  );
  const hept = twoDayStarts[0];
  assert.equal(hept.legs.length, 7, 'all seven, whichever day they fall on');
  assert.deepEqual(hept.dates, ['15.8.2026', '16.8.2026']);
  assert.deepEqual(
    hept.legs.map((l) => l.discipline),
    ['100m aidat', 'Korkeus', 'Kuula', '200m', 'Pituus', 'Keihäs', '800m'],
    'schedule order: day, then time',
  );
  // A multi-event is under way once any leg is. (Break on purpose: use
  // leastStatus here and this reads Unallocated.)
  assert.equal(hept.status, 'Progress', 'one leg run makes the whole multi-event under way');
  assert.equal(combinedEventStatus(['Official', 'Official']), 'Official', 'and it is finished only when every leg is');
  assert.equal(combinedEventStatus(['Official', 'Unallocated']), 'Progress');
  assert.equal(
    combinedEventStatus(['Allocated', 'Unallocated']),
    'Unallocated',
    'before it starts, the least advanced of the phases still ahead',
  );
  assert.equal(combinedEventStatus(['Allocated', 'Allocated']), 'Allocated');
  assert.equal(combinedEventStatus([]), 'Unallocated');
  // A drawn ottelu has not started, so its confirmation count still shows
  // (combinedStarted). (Break on purpose: count Allocated as started and the
  // count goes as soon as the draw lands.)
  assert.equal(combinedStarted('Unallocated'), false);
  assert.equal(combinedStarted('Allocated'), false);
  assert.equal(combinedStarted('Progress'), true);
  assert.equal(combinedStarted('Official'), true);
  assert.equal(hept.key, hept.label, "the route key is the label — a text key, like a start's own");

  const demoStarts = combinedEventStarts(demoSchedule());
  assert.deepEqual(
    demoStarts.map((s) => s.label),
    ['P9 3-ottelu', 'T9 3-ottelu', 'T11 3-ottelu'],
    "programme order, the boys' class before the girls' and the younger first (compareCategories)",
  );
  const t9 = demoStarts.find((s) => s.label === 'T9 3-ottelu');
  const p9 = demoStarts.find((s) => s.label === 'P9 3-ottelu');
  assert.deepEqual(
    t9.legs.map((l) => l.eventId),
    ['e34', 'e35', 'e36'],
  );
  assert.equal(
    t9.status,
    'Progress',
    'the 40m is over and the Pituus running, so the ottelu is under way whatever the Kuula says',
  );
  assert.equal(p9.status, 'Allocated', 'the second is drawn and has not started');
  assert.equal(
    demoStarts.find((s) => s.label === 'T11 3-ottelu').status,
    'Unallocated',
    'and the third is still undrawn',
  );

  // The standings come off the root, whose SubEvents[] carries each leg whole
  // (docs/tuloslista-api.md).
  const root = DEMO_EVENTS.e37;
  const rows = combinedTotals(root);
  assert.deepEqual(
    rows.map((a) => a.Result),
    ['392', '350', '316', '302', '134', '401', 'DNF'],
    "the root's own round: the points total as Result, placed by ResultRank",
  );
  // The guest and the withdrawal are ranked nowhere, so both sort after the
  // placed rows (docs/tuloslista-api.md).
  assert.equal(rows[5].Name, 'Ilona Vierainen');
  assert.equal(rows[5].ResultRank, null);
  assert.ok(rows[5].NotInCompetition);
  assert.equal(rows[6].Name, 'Pihla Harjoitinen');
  assert.equal(rows[6].ResultRank, null);
  // A withdrawal leaves no gap behind it (docs/tuloslista-api.md).
  assert.deepEqual(
    rows.map((a) => a.ResultRank).filter((r) => r != null),
    [1, 2, 3, 4, 5],
  );
  // (Break on purpose: read a non-numeric total as 0 in combinedWithdrawn and
  // nobody is out.)
  assert.deepEqual(
    [...combinedWithdrawn(rows)],
    ['o5-a'],
    'out of the ottelu: a total that is not a number, DNS and DNF alike',
  );
  assert.equal(combinedWithdrawn(rows).has('o7-a'), false, 'a guest is ranked nowhere and is not out');
  assert.equal(combinedWithdrawn([]).size, 0);
  assert.equal(
    combinedWithdrawn(combinedTotals(DEMO_EVENTS.e41)).size,
    0,
    'an entry list standing in for an unstarted root yields nobody',
  );
  // The root's heat is a container, not a race. (Break on purpose: keep
  // totalResults' heatIndex on these rows and every name grows "Erä 0".)
  assert.ok(
    rows.every((a) => a.heatIndex === undefined),
    'no heat to have left behind',
  );
  const legs = combinedLegColumns(root, t9.legs);
  // SubEvents[].Index is the contest order (docs/tuloslista-api.md).
  // (Break on purpose: drop the Index sort in combinedLegColumns and the
  // columns come out in the array's order.)
  assert.deepEqual(
    legs.map((l) => l.label),
    ['40m', 'Pituus', 'Kuula'],
    'the order the legs are contested in, from SubEvents[].Index',
  );
  // (Break on purpose: read a leg's field from Rounds[0].Heats[0] and the
  // 40m column loses its second heat.)
  assert.equal(legs[0].results.size, 7, 'both heats of the 40m, not the first alone');
  assert.equal(
    [...legs[1].results.values()].filter((a) => a.Result).length,
    5,
    'five of seven have jumped — the other two get a blank cell, not a zero',
  );
  assert.ok(
    [...legs[2].results.values()].every((a) => !a.Result),
    'the Kuula is drawn and untouched: a column with nothing in it yet',
  );
  // A column's status comes from the schedule, since the leg's own round is a
  // stale copy (reconcileStatuses). (Break on purpose: read the status off the
  // SubEvent's round and the finished 40m reads "kesken".)
  assert.equal(DEMO_EVENTS.e34.Rounds[0].Status, 'Progress', 'the fixture must keep the stale copy');
  assert.deepEqual(
    legs.map((l) => l.status),
    ['Official', 'Progress', 'Allocated'],
  );
  // A column's key is the one the day list's rows link with.
  const keyOf = (discipline) => roundGroupKey(t9.legs.find((l) => l.discipline === discipline).round);
  assert.deepEqual(
    legs.map((l) => l.key),
    ['40m', 'Pituus', 'Kuula'].map(keyOf),
    "each in its own column, which is the contest order and not the schedule's",
  );
  assert.deepEqual(
    combinedLegColumns(root).map((l) => l.key),
    [null, null, null],
    'with no schedule to match against there is no start to open',
  );
  // With no schedule the status falls back to each SubEvent's own rounds.
  assert.deepEqual(
    combinedLegColumns(root).map((l) => l.status),
    ['Progress', 'Progress', 'Allocated'],
  );

  // Root and legs join on the per-competition athlete id
  // (docs/tuloslista-api.md). A numeric total is the sum of the legs' points.
  // A withdrawal's total is not a number, so it is left out.
  const scored = rows.filter((a) => Number.isFinite(Number(a.Result)));
  assert.equal(scored.length, rows.length - 1);
  assert.deepEqual(
    scored.map((a) => legs.reduce((sum, l) => sum + (l.results.get(combinedAthleteKey(a))?.CEPoints ?? 0), 0)),
    scored.map((a) => Number(a.Result)),
  );
  assert.equal(combinedAthleteKey(rows[0]), 'o1-a');
  assert.equal(combinedAthleteKey({}), '', 'a row with no athlete joins to nothing rather than throwing');

  // The root's round stays Unallocated however finished the meet is
  // (docs/tuloslista-api.md), so the status comes from the legs.
  assert.equal(root.Rounds[0].Status, 'Unallocated');
  assert.equal(root.RootId, 0, 'a non-zero RootId is what makes a leg a leg');
  assert.deepEqual(combinedLegColumns({}), [], 'nothing to show is not an error');
  assert.deepEqual(combinedTotals({}), []);

  // The gap is measured from the row ranked first, not the biggest total,
  // since a guest can out-score the leader (docs/tuloslista-api.md).
  // (Break on purpose: take the leader from Math.max of the totals and every
  // other row reports a deficit to the guest.)
  const leader = combinedLeaderPoints(rows);
  assert.equal(leader, 392);
  assert.deepEqual(
    rows.map((a) => combinedGap(a, leader)),
    [null, -42, -76, -90, -258, 9, null],
  );
  assert.equal(combinedLeaderPoints([]), null, 'nothing ranked first is nothing to measure against');
  assert.equal(combinedGap({ Result: '3000' }, null), null);
  // A withdrawal's total is DNF or DNS (docs/tuloslista-api.md), and a
  // subtraction against it would print "NaN".
  assert.equal(combinedGap({ Result: 'DNF' }, leader), null);
  assert.equal(combinedGap({ Result: 'DNS' }, leader), null);
  assert.equal(combinedGap({ Result: '' }, leader), null, 'and an empty total is not a deficit of 392');
  assert.equal(combinedGap({}, leader), null);
  assert.equal(combinedLeaderPoints([{ ResultRank: 1, Result: 'DNF' }]), null);

  // The unstarted multi-event's root is a heat shell, so the entry list is
  // its only field (docs/tuloslista-api.md). (Break on purpose: drop
  // the Enrollments fallback in combinedTotals and this is [].)
  const empty = DEMO_EVENTS.e41;
  assert.equal(roundAllocated(empty.Rounds[0]), false, 'a heat shell is not a drawn field');
  const entered = combinedTotals(empty);
  assert.deepEqual(
    entered.map((a) => a.Name),
    ['Eino Demoinen', 'Väinö Testinen', 'Toivo Mallinen', 'Aarne Kokeinen'],
  );
  assert.ok(
    entered.every((a) => !a.Result && a.ResultRank == null),
    "nothing to rank them by, which is what the standings' em dashes say",
  );
  assert.equal(combinedLeaderPoints(entered), null, 'and so no gap on any row');
  // The legs are drawn, so their columns exist with nothing in them.
  const emptyLegs = combinedLegColumns(empty, p9.legs);
  assert.deepEqual(
    emptyLegs.map((l) => l.label),
    ['40m', 'Pituus', 'Kuula'],
  );
  assert.ok(emptyLegs.every((l) => l.results.size === 4 && [...l.results.values()].every((a) => !a.Result)));
  assert.ok(
    entered.every((a) => emptyLegs[0].results.has(combinedAthleteKey(a))),
    'an enrolment joins to a leg on the same athlete id an allocation does',
  );

  // Every allocation carries CEPoints, 0 outside a multi-event
  // (docs/tuloslista-api.md). The fixture keeps both halves true, or nothing
  // tests the IsCombinedEvent gate.
  for (const [eventId, data] of Object.entries(DEMO_EVENTS)) {
    const allocs = (data.Rounds || []).flatMap((r) => (r.Heats || []).flatMap((h) => h.Allocations || []));
    for (const a of allocs) {
      assert.ok(a.CEPoints != null, `${eventId}: ${a.Name} has no CEPoints at all`);
      if (!data.IsCombinedEvent) assert.equal(a.CEPoints, 0, `${eventId}: ${a.Name} scores outside a multi-event`);
    }
  }
  assert.ok(
    DEMO_EVENTS.e34.Rounds[0].Heats[0].Allocations.every((a) => a.CEPoints > 0),
    'and the legs must actually carry points, or the gate above proves nothing',
  );
});

// --- combinedEventRoots: a multi-event's legs are one entry on the front
// page, named after the root (docs/tuloslista-api.md) ---
test('combinedEventRoots', () => {
  const club = { Id: 1, Name: 'Demon Urheilijat', NameShort: 'DemU' };
  const her = { Id: 900, LicenseId: 'L900', Firstname: 'Ilona', Surname: 'Ottelinen', Organization: club };
  const entered = { Enrollments: [{ Organization: club, Athletes: [her] }] };
  const leg = (eventId, name) => ({
    eventId,
    data: { ...entered, Name: name, IsCombinedEvent: true, RootId: 540453, RootName: 'N17 7-ottelu' },
  });
  const events = [
    leg('540460', 'N17 7-ottelu  100m aidat'),
    leg('540454', 'N17 7-ottelu  Korkeus'),
    { eventId: '540470', data: { ...entered, Name: 'N17 Kolmiloikka' } },
    leg('540459', 'N17 7-ottelu  800m'),
  ];
  const roots = combinedEventRoots(events);
  assert.equal(roots.size, 3, 'the three legs, not the ordinary event beside them');
  assert.deepEqual(roots.get('540454'), { id: '540453', name: 'N17 7-ottelu' });

  // The root's own resource carries IsCombinedEvent with RootId 0. Only a
  // non-zero RootId marks a leg.
  assert.equal(
    combinedEventRoots([
      { eventId: '540453', data: { Name: 'N17 7-ottelu', IsCombinedEvent: true, RootId: 0, RootName: null } },
    ]).size,
    0,
  );
  assert.equal(
    combinedEventRoots([{ eventId: '540454', data: { ...events[1].data, RootName: '' } }]).size,
    0,
    'a root with no name is nothing to collapse to — the legs stay as they are',
  );

  // The root sits at its first leg. (Break on purpose: keep the last leg in
  // buildDigest, and the two events swap.)
  const digest = buildDigest(buildRoster(events), ['15.8.2026'], ['540460', '540454', '540470', '540459'], roots);
  assert.deepEqual(
    scanDigest(digest, [{ type: 'athlete', id: 'L900' }]),
    [{ name: 'Ilona Ottelinen', club: 'DemU', events: ['N17 7-ottelu', 'N17 Kolmiloikka'], via: 'athlete' }],
    "seven legs would fill the row's whole line budget on their own",
  );

  // Without the roots each leg is an event of its own.
  assert.equal(
    scanDigest(buildDigest(buildRoster(events), ['15.8.2026'], ['540460', '540454', '540470', '540459']), [
      { type: 'athlete', id: 'L900' },
    ])[0].events.length,
    4,
  );
});
