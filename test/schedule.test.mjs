// Tests how the schedule's rounds become starts, and each round's status,
// counts and field (docs/views.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCupMeet } from '../public/lib/cup.js';
import { tsKey } from '../public/lib/dates.js';
import { coversStart, meetCoverChoices, startLine } from '../public/lib/districts.js';
import { scheduleEventOrder } from '../public/lib/digest.js';
import {
  attemptColumns,
  bestsParts,
  heatsInOrder,
  parseResult,
  qualBadge,
  qualPending,
  qualificationNote,
  resultPending,
  roundAllocated,
  verticalJumpHeights,
  verticalJumpRow,
  verticalMarkText,
  windAided,
} from '../public/lib/results.js';
import {
  API,
  betterStatus,
  combinedEventStatus,
  compareCategories,
  countLine,
  defaultResultView,
  eventStore,
  fieldMayChange,
  filedStart,
  groupForKey,
  groupRounds,
  groupStatuses,
  hasEarlierRound,
  hasEntrants,
  meetGone,
  meetPhase,
  parseEventName,
  previousRound,
  previousRoundField,
  reconcileStatuses,
  roundDetail,
  roundDetails,
  roundGroupKey,
  scheduleStatuses,
  startCounts,
  startFinished,
  startKeyOf,
} from '../public/lib/schedule.js';
import { DEMO_CUP_ID, DEMO_EVENTS, DEMO_ID, demoResponse, demoSchedule } from '../public/demo.js';

// --- parseEventName ---
assert.deepEqual(parseEventName('M19 200m kelaus T54'), {
  sex: 'M19',
  event: '200m kelaus',
  cls: 'T54',
  label: 'M19 T54',
});
assert.deepEqual(parseEventName('N 200m Avoin').event, '200m');
// A field event's name has no classification token, so the tail is the event.
assert.deepEqual(parseEventName('M16 Moukari'), { sex: 'M16', event: 'Moukari', cls: '', label: 'M16' });
assert.deepEqual(parseEventName('N Pituus'), { sex: 'N', event: 'Pituus', cls: '', label: 'N' });
// A relay's formula first names no class (docs/tuloslista-api.md).
// (Break on purpose: take the formula as the class, and the event is "viesti".)
assert.deepEqual(parseEventName('6x200m viesti'), { sex: '', event: '6x200m viesti', cls: '', label: '' });
assert.deepEqual(parseEventName('8x50m viesti mixed').event, '8x50m viesti mixed', '20485');
assert.deepEqual(
  parseEventName('6 x 400 m - mixed'),
  { sex: '', event: '6 x 400 m - mixed', cls: '', label: '' },
  '18913: spaced, the "6" no class',
);
assert.equal(parseEventName('M/N 4x100m viesti').sex, 'M/N', "a formula after the class is the event's");
// (Break on purpose: read any first token as the class, and the relay's word
// becomes one.)
assert.deepEqual(
  parseEventName('Sukkulaviesti 16x60m'),
  { sex: '', event: 'Sukkulaviesti 16x60m', cls: '', label: '' },
  '20651',
);
assert.equal(parseEventName('N Ruotsalaisviesti').sex, 'N', "the word after the class is the event's");

// --- A start whose name names no class ---
test('A start whose name names no class', () => {
  const relay = {
    EventName: '6x200m viesti',
    Name: 'Loppukilpailu',
    Category: 'Relay',
    Age: '0',
    BeginDateTimeWithTZ: '2025-03-02T15:50:00.0000000+00:00',
  };
  const groups = groupRounds([relay, { ...relay, EventName: 'M17 60m', Age: '17', Category: 'Track' }]);
  assert.equal(groups[0].key, '2025-03-02T15:50:00.0000000+00:00|60m');
  assert.equal(groups[1].key, '2025-03-02T15:50:00.0000000+00:00|6x200m viesti');
  // Temporary: groupForKey's third find opens a link shared before
  // 2026-09-16 (docs/shims.md). (Break on purpose: drop it, and the link
  // opens nothing.)
  assert.equal(groupForKey(groups, '2025-03-02T15:50:00.0000000+00:00|viesti'), groups[1], 'the key before 16.9.2026');
  assert.equal(groupForKey(groups, '2025-03-02T15:50:00.0000000+00:00|6x200m viesti'), groups[1]);
  assert.equal(groupForKey(groups, '2025-03-02T15:50:00.0000000+00:00|60'), null);
  const shuttle = groupRounds([{ ...relay, EventName: 'Sukkulaviesti 16x60m' }]);
  assert.equal(shuttle[0].key, '2025-03-02T15:50:00.0000000+00:00|Sukkulaviesti 16x60m');
  assert.equal(
    groupForKey(shuttle, '2025-03-02T15:50:00.0000000+00:00|16x60m'),
    shuttle[0],
    "20651's key before 17.9.2026",
  );
  const spaced = groupRounds([{ ...relay, EventName: '6 x 400 m - mixed' }]);
  assert.equal(
    groupForKey(spaced, '2025-03-02T15:50:00.0000000+00:00|x 400 m - mixed'),
    spaced[0],
    "18913's key before 16.9.2026",
  );
  // A classless relay is filed as the adult men (docs/tuloslista-api.md), so
  // filedStart files it under the meet's oldest named youth class.
  // (Break on purpose: file it at its own Age, and the chips gain yleinen.)
  const youth = {
    '20.2.2026': [
      { ...relay, EventName: 'N17 60m', Age: '17' },
      { ...relay, EventName: 'M19 60m', Age: '19' },
      { ...relay, EventName: 'N22 60m', Age: '22' },
      relay,
    ],
  };
  assert.equal(filedStart(relay, youth).Age, '22');
  assert.deepEqual(meetCoverChoices(youth).ages, [17, 19, 22], 'no yleinen chip');
  assert.equal(
    coversStart({ ages: [17, 19, 22], events: null }, filedStart(relay, youth)),
    true,
    "the championship's classes hold it",
  );
  assert.equal(
    coversStart({ ages: [17], events: null }, filedStart(relay, youth)),
    false,
    'the 17 chip alone does not',
  );
  assert.equal(filedStart({ ...relay, EventName: 'N Paino' }, youth).Age, '0', 'a start naming its class stands');
  assert.equal(
    filedStart(relay, {
      '1.1.2026': [{ ...relay, EventName: 'M 60m', Age: '0' }, { ...relay, EventName: 'M35 60m', Age: '35' }, relay],
    }).Age,
    '0',
    'no youth class: as filed',
  );
  // A picked club's lines show the filed relay under any chosen youth class
  // the meet runs, but it counts under its own class only. (Break on purpose:
  // drop startLine's second half, and the 17 chip hides the relay.)
  const moved = filedStart(relay, youth);
  const starts = [moved, ...youth['20.2.2026'].slice(0, 3)];
  const chip = (...ages) => ({ ages, events: null });
  assert.deepEqual(startLine(chip(17), moved, starts), { counted: false, only: 22 });
  assert.deepEqual(startLine(chip(22), moved, starts), { counted: true, only: 22 });
  assert.deepEqual(startLine(null, moved, starts), { counted: true, only: null }, 'no chips, no note');
  assert.equal(startLine(chip(35), moved, starts), null, 'a class the meet does not run');
  assert.equal(startLine(chip(17), youth['20.2.2026'][1], starts), null, 'a start naming its class: as it counts');
  console.log('classless start ok');
});

// --- groupRounds: Track, Field and Relay together ---
test('groupRounds: Track, Field and Relay together', () => {
  const rounds = [
    {
      EventName: 'N15 4x100m viesti',
      Name: 'Loppukilpailu',
      Category: 'Relay',
      Status: 'Official',
      BeginDateTimeWithTZ: '2026-07-31T13:05:00.0000000+00:00',
    },
    {
      EventName: 'M 200m',
      Name: 'Alkuerät',
      Category: 'Track',
      Status: 'Official',
      BeginDateTimeWithTZ: '2026-07-31T13:00:00.0000000+00:00',
    },
    {
      EventName: 'M Kuula',
      Name: 'Loppukilpailu',
      Category: 'Field',
      Status: 'Official',
      BeginDateTimeWithTZ: '2026-07-31T13:00:00.0000000+00:00',
    },
    // It shares the Kuula's time and event name, so it joins that start.
    {
      EventName: 'N Kuula',
      Name: 'Loppukilpailu',
      Category: 'Field',
      Status: 'Progress',
      BeginDateTimeWithTZ: '2026-07-31T13:00:00.0000000+00:00',
    },
  ];
  const groups = groupRounds(rounds);
  assert.equal(groups.length, 3, 'track + field + relay, unfiltered');
  const kuula = groups.find((g) => g.event === 'Kuula');
  assert.equal(kuula.entries.length, 2, 'M and N Kuula share one row');
  // A start's status is the least advanced of its categories.
  assert.equal(kuula.status, 'Progress');
  // A category filter narrows the starts, as Juoksut's RUN_CATEGORIES does.
  assert.equal(groupRounds(rounds, 'Field').length, 1);
  assert.equal(groupRounds(rounds, ['Track', 'Relay']).length, 2);
});
// A competition's rows do not all carry one UTC offset, so a start's place in
// the day comes from the instant (docs/tuloslista-api.md). (Break on purpose:
// compare a.ts to b.ts as strings, and the 80m aidat lands after the Keihäs.)
test('groupRounds', () => {
  const at = (ts, name) => ({
    EventName: name,
    Name: 'Loppukilpailu',
    Category: /aidat|m$/.test(name) ? 'Track' : 'Field',
    Status: 'Official',
    BeginDateTimeWithTZ: ts,
  });
  const groups = groupRounds([
    at('2026-08-15T07:50:00.0000000+00:00', 'M15 5-ottelu  100m aidat'),
    at('2026-08-15T10:00:00.0000000+00:00', 'M15 5-ottelu  Keihäs'),
    at('2026-08-15T10:00:00.0000000+03:00', 'T14 5-ottelu  80m aidat'),
  ]);
  assert.deepEqual(
    groups.map((g) => g.event),
    ['5-ottelu 80m aidat', '5-ottelu 100m aidat', '5-ottelu Keihäs'],
    'the 10.00 start leads the day, whatever offset its own row carries',
  );
  assert.equal(tsKey('2026-08-15T10:00:00.0000000+03:00') < tsKey('2026-08-15T07:50:00.0000000+00:00'), true);
  assert.equal(tsKey('not a timestamp'), Infinity, 'an unreadable time sorts last, not first');
  // The digest's own event order reads the same way (scheduleEventOrder).
  assert.deepEqual(
    scheduleEventOrder({
      '15.8.2026': [
        { EventId: 'late', BeginDateTimeWithTZ: '2026-08-15T10:00:00.0000000+00:00' },
        { EventId: 'first', BeginDateTimeWithTZ: '2026-08-15T10:00:00.0000000+03:00' },
      ],
    }),
    ['first', 'late'],
  );
});

// --- compareCategories: a start's categories in programme order ---
test('compareCategories', () => {
  const order = (labels) => [...labels].sort(compareCategories);
  // Class labels do not sort as text (docs/tuloslista-api.md). A real start's
  // schedule lists T9, P9, T11, P11, T13, P13, M15, N17, M17, N19. It differs
  // from this order only in putting girls before boys within an age.
  assert.deepEqual(order(['M15', 'M17', 'N17', 'N19', 'P11', 'P13', 'P9', 'T11', 'T13', 'T9']), [
    'P9',
    'T9',
    'P11',
    'T11',
    'P13',
    'T13',
    'M15',
    'M17',
    'N17',
    'N19',
  ]);
  // Youth come first, then adults, then masters. Age leads gender among the
  // masters too, and only MASTERS_MIN_AGE tells M17 from M50. (Break on
  // purpose: sort M50 as youth, and it lands before M.)
  assert.deepEqual(order(['M50', 'M', 'M17', 'N35', 'N']), ['M17', 'M', 'N', 'N35', 'M50']);
  // Within one age men and boys come first, then women and girls, then mixed.
  assert.deepEqual(order(['Mixed 15', 'N15', 'M15']), ['M15', 'N15', 'Mixed 15']);
  // A para classification breaks ties within one category. The age leads.
  assert.deepEqual(order(['M19 T54', 'M17', 'M19 F57']), ['M17', 'M19 F57', 'M19 T54']);
  // An unrecognised label sorts last, and two such labels sort by their text.
  assert.deepEqual(order(['?', 'M', 'Avoin', 'T13']), ['T13', 'M', '?', 'Avoin']);
  assert.deepEqual(order(['N', 'M']), ['M', 'N']);
});

// --- groupStatuses: a start's categories can be in different phases ---
test('groupStatuses', () => {
  const kuula = (name, status) => ({
    EventName: name,
    Name: 'Loppukilpailu',
    Category: 'Field',
    Status: status,
    BeginDateTimeWithTZ: '2026-07-31T13:00:00.0000000+00:00',
  });
  const [agreed] = groupRounds([kuula('M15 Kuula', 'Official'), kuula('N15 Kuula', 'Official')]);
  assert.deepEqual(
    groupStatuses(agreed.entries),
    [{ status: 'Official', labels: ['M15', 'N15'] }],
    'categories in one phase stay one chip for the whole row',
  );
  // A category nobody entered can stay Unallocated after its start is run
  // (docs/tuloslista-api.md). The start's status then says it is not drawn.
  const [mixed] = groupRounds([
    kuula('M15 Kuula', 'Official'),
    kuula('M16 Kuula', 'Unallocated'),
    kuula('N15 Kuula', 'Official'),
  ]);
  assert.equal(mixed.status, 'Unallocated', 'g.status is still the least advanced of them');
  assert.deepEqual(
    groupStatuses(mixed.entries),
    [
      { status: 'Official', labels: ['M15', 'N15'] },
      { status: 'Unallocated', labels: ['M16'] },
    ],
    "each phase names the categories it covers, in the entries' own order",
  );
});

// --- hasEntrants: the category nobody entered ---
test('hasEntrants', () => {
  // An allocated round's own heats decide.
  assert.equal(hasEntrants(DEMO_EVENTS.e2.Rounds[0], []), true);
  assert.equal(
    hasEntrants({ Heats: [{ Index: 1, Allocations: [] }] }, []),
    false,
    'a drawn-but-empty heat is nobody, not somebody',
  );
  // An undrawn round can carry an empty heat shell (docs/tuloslista-api.md).
  // Its entrants are the Enrollments.
  assert.equal(
    hasEntrants({ Heats: [{ Index: 1, Allocations: [] }] }, DEMO_EVENTS.e6.Enrollments),
    true,
    'a heat shell falls through to the enrollments, exactly like an empty Heats[]',
  );
  // e11 is a shell with no enrollments behind it.
  assert.equal(hasEntrants(DEMO_EVENTS.e11.Rounds[0], DEMO_EVENTS.e11.Enrollments), false);
  // With no round the event's Enrollments decide. e6 has enrollments only,
  // and nobody entered e8.
  assert.equal(hasEntrants(null, DEMO_EVENTS.e6.Enrollments), true);
  assert.equal(hasEntrants(DEMO_EVENTS.e8.Rounds?.[0], DEMO_EVENTS.e8.Enrollments), false);
  assert.equal(hasEntrants(undefined, undefined), false);
  // A round with no heats yet falls through to the enrollments too.
  assert.equal(hasEntrants({ Heats: [] }, DEMO_EVENTS.e6.Enrollments), true);
});

// --- defaultResultView: which layout a start opens on ---
test('defaultResultView', () => {
  const rounds = DEMO_EVENTS.e9.Rounds;
  const alkuerat = rounds.find((r) => r.Id === 'r9a'); // Official, 4 heats
  const valierat = rounds.find((r) => r.Id === 'r9v'); // Progress, heat 2 not run
  const loppu = rounds.find((r) => r.Id === 'r9f'); // Unallocated, no heats
  assert.equal(defaultResultView([alkuerat]), 'total', 'a finished round opens as one list');
  assert.equal(defaultResultView([valierat]), 'heats', 'one still being run does not');
  // A start is only as finished as its least finished round.
  assert.equal(defaultResultView([alkuerat, valierat]), 'heats');
  // A category nobody entered stays Unallocated for good
  // (docs/tuloslista-api.md). It has no heats to merge and gets no vote.
  assert.equal(defaultResultView([alkuerat, loppu]), 'total', 'a heatless leftover category does not get a vote');
  assert.equal(defaultResultView([loppu]), 'heats', 'nothing to merge, nothing to decide');
  // The same leftover as a heat shell (docs/tuloslista-api.md) gets
  // no vote either.
  const shellLeftover = { Status: 'Unallocated', Heats: [{ Index: 1, Allocations: [] }] };
  assert.equal(
    defaultResultView([alkuerat, shellLeftover]),
    'total',
    'a heat-shell leftover category does not get a vote either',
  );
  assert.equal(defaultResultView([shellLeftover]), 'heats');
  // With medals on offer a finished start opens on them.
  assert.equal(defaultResultView([alkuerat], true), 'medals');
  assert.equal(defaultResultView([valierat], true), 'heats');
  assert.equal(defaultResultView([]), 'heats');
  assert.equal(defaultResultView(undefined), 'heats');
});

// --- roundAllocated: has this round's field actually been drawn ---
test('roundAllocated', () => {
  assert.equal(roundAllocated(DEMO_EVENTS.e2.Rounds[0]), true, 'a round with allocations');
  assert.equal(roundAllocated({ Heats: [] }), false, 'an empty Heats[]');
  assert.equal(roundAllocated({}), false, 'no Heats key at all');
  assert.equal(roundAllocated(null), false);
  // A heat shell is a non-empty Heats[] that holds nobody
  // (docs/tuloslista-api.md). e11 is that shape in the fixture.
  assert.equal(roundAllocated(DEMO_EVENTS.e11.Rounds[0]), false, 'a heat shell is not a drawn field');
  assert.equal(
    DEMO_EVENTS.e11.Rounds[0].Heats.length,
    1,
    'and the fixture really is a shell, not an empty Heats[] — or the line above proves nothing',
  );
  assert.equal(roundAllocated({ Heats: [{ Index: 1, Allocations: [] }] }), false);
  assert.equal(roundAllocated({ Heats: [{ Index: 1 }] }), false, 'nor is a heat with no Allocations key');
  // One drawn heat is enough.
  assert.equal(
    roundAllocated({
      Heats: [
        { Index: 1, Allocations: [] },
        { Index: 2, Allocations: [{ Id: 'a' }] },
      ],
    }),
    true,
  );
});

// --- reconcileStatuses: the more advanced of a round's two Status copies
// wins (measured 2026-08-12, docs/tuloslista-api.md) ---
test('reconcileStatuses', () => {
  assert.equal(betterStatus('Progress', 'Official'), 'Official');
  assert.equal(betterStatus('Official', 'Progress'), 'Official', 'and the same either way round');
  assert.equal(betterStatus('Unallocated', 'Allocated'), 'Allocated');
  assert.equal(betterStatus('Progress', undefined), 'Progress', 'a round no schedule names keeps its own');
  assert.equal(
    betterStatus('Progress', 'Nonsense'),
    'Progress',
    'an unknown status never wins over one this app can reason about',
  );

  const schedule = {
    '8.8.2026': [
      { Id: 'r1', Status: 'Official' },
      { Id: 'r2', Status: 'Progress' },
    ],
    '9.8.2026': [{ Id: 'r3', Status: 'Official' }],
  };
  const byId = scheduleStatuses(schedule);
  assert.deepEqual(
    [...byId.entries()],
    [
      ['r1', 'Official'],
      ['r2', 'Progress'],
      ['r3', 'Official'],
    ],
    "every day, since an event's rounds can sit on different ones",
  );
  const data = {
    Name: 'N 100m',
    Rounds: [
      { Id: 'r1', Status: 'Progress' },
      { Id: 'r2', Status: 'Progress' },
      { Id: 'r3', Status: 'Official' },
      { Id: 'r9', Status: 'Allocated' },
    ],
  };
  const fixed = reconcileStatuses(data, byId);
  assert.deepEqual(
    fixed.Rounds.map((r) => r.Status),
    ['Official', 'Progress', 'Official', 'Allocated'],
  );
  assert.equal(fixed.Name, 'N 100m', 'the rest of the resource comes through untouched');
  assert.deepEqual(
    data.Rounds.map((r) => r.Status),
    ['Progress', 'Progress', 'Official', 'Allocated'],
    'and nothing is written back into the fetched object',
  );
  assert.equal(fixed.Rounds[1], data.Rounds[1], 'a round that needs no fixing is not even copied');
  assert.deepEqual(reconcileStatuses(null, byId).Rounds, []);
  assert.deepEqual(
    reconcileStatuses(data, null).Rounds.map((r) => r.Status),
    ['Progress', 'Progress', 'Official', 'Allocated'],
    'no schedule to reconcile against is a no-op',
  );

  // demo.js's r2 carries the measured shape. (Break on purpose: give r2 its
  // schedule row's status in demo.js, and the check that the results copy is
  // stale fails.)
  const demoById = scheduleStatuses(demoSchedule());
  const kuula = DEMO_EVENTS.e2.Rounds.find((r) => r.Id === 'r2');
  assert.equal(kuula.Status, 'Progress', 'the results resource is the stale copy');
  assert.equal(demoById.get('r2'), 'Official', 'the schedule row is the fresh one');
  const kuulaFixed = reconcileStatuses(DEMO_EVENTS.e2, demoById).Rounds.find((r) => r.Id === 'r2');
  assert.equal(kuulaFixed.Status, 'Official');
  // Once reconciled, the placing is not muted and the start opens on its
  // total.
  assert.equal(resultPending(kuula), true, 'unreconciled, a finished round still reads as pending');
  assert.equal(resultPending(kuulaFixed), false);
  assert.equal(defaultResultView([kuula]), 'heats', 'unreconciled, a finished start opens on Erät');
  assert.equal(defaultResultView([kuulaFixed]), 'total');
});

// --- eventStore: one document per EventId, however many rounds ask ---
test('eventStore', async () => {
  const schedule = demoSchedule();
  const day = Object.keys(schedule)[0];
  const groups = groupRounds(schedule[day]);
  let loads = 0;
  const storeOf = () =>
    eventStore(async (eventId) => {
      loads += 1;
      return demoResponse(`${API}/results/${DEMO_ID}/${eventId}`);
    });

  // e9's three rounds are three schedule rows of one event.
  const rounds = ['Alkuerät', 'Välierät', 'Loppukilpailu'].map((name) =>
    groups.find((g) => g.event === '200m' && g.roundName === name),
  );
  assert.equal(rounds.filter(Boolean).length, 3, 'the fixture still has the three 200m rounds');
  assert.equal(new Set(rounds.map((g) => g.entries[0].round.EventId)).size, 1, 'and they share one EventId');
  {
    const store = storeOf();
    loads = 0;
    const detailed = [];
    for (const g of rounds) detailed.push(await roundDetails(g.entries, store));
    assert.equal(loads, 1, 'three rounds of one event, one document');
    // Each round is picked by its own Id. (Break on purpose: return
    // data.Rounds[0] from roundDetail, and this is three Alkuerät.)
    assert.deepEqual(
      detailed.map((d) => d[0].round.Id),
      ['r9a', 'r9v', 'r9f'],
    );
    assert.deepEqual(
      detailed.map((d) => d[0].schedRound.Id),
      ['r9a', 'r9v', 'r9f'],
    );
    assert.equal(detailed[0][0].missing, false);
  }

  // Concurrent askers share the one in-flight promise. (Break on purpose:
  // cache the awaited value in eventStore, and this reads 3.)
  {
    const store = storeOf();
    loads = 0;
    await Promise.all(rounds.map((g) => roundDetails(g.entries, store)));
    assert.equal(loads, 1);
  }

  // A start's categories are separate events and separate documents.
  {
    const store = storeOf();
    loads = 0;
    const aidat = groups.find((g) => g.event === '400m aidat');
    const detailed = await roundDetails(aidat.entries, store);
    assert.equal(loads, 3, 'P13, M and N 400m aidat are three events');
    assert.deepEqual(
      detailed.map((d) => d.label),
      ['P13', 'M', 'N'],
    );
    await roundDetails(aidat.entries, store);
    assert.equal(loads, 3, 'and the second pass over the same start fetches nothing');
  }

  // A category nobody entered can answer 404 (docs/tuloslista-api.md). The
  // 404 stays on its own entry and is cached, and a timeout is no 404.
  {
    let tries = 0;
    const store = eventStore(async () => {
      tries += 1;
      const err = new Error('nope');
      err.status = 404;
      throw err;
    });
    const entry = { label: 'M70', round: { Id: 'x1', EventId: 'ex' } };
    const d = roundDetail(entry, await store.get('ex'));
    assert.equal(d.missing, true);
    assert.equal(d.data, null);
    assert.equal(d.round, null);
    assert.equal(d.label, 'M70', 'the entry keeps its own fields');
    const timeout = eventStore(async () => {
      throw new Error('timeout');
    });
    assert.equal(roundDetail(entry, await timeout.get('ex')).missing, false, 'a timeout is not a 404');
    await store.get('ex');
    assert.equal(tries, 1, 'a 404 is an answer, and is cached like one');
  }
});

// A meet can vanish from /competition/{id} and /properties while its events'
// results still answer (docs/tuloslista-api.md, "The listing").
test('meetGone', () => {
  const failed = (status, url) => Object.assign(new Error('x'), { status, url });
  assert.equal(meetGone(failed(404, `${API}/competition/123`)), true, 'the schedule');
  assert.equal(meetGone(failed(404, `${API}/competition/123/properties`)), true, 'the properties');
  assert.equal(meetGone(failed(500, `${API}/competition/123`)), false, 'a failure is no answer');
  assert.equal(meetGone(failed(404, `${API}/results/123/456`)), false, 'a class nobody entered');
  assert.equal(meetGone(failed(404, `${API}/competition`)), false, 'the listing');
  assert.equal(meetGone(failed(404, '/api/results/123')), false, 'a grafted meet');
  assert.equal(meetGone(new Error('timeout')), false, 'a timeout');
  assert.equal(meetGone(null), false);
});

// --- startCounts/countLine: the day list's erät and osallistujat
// (docs/views.md) ---
test('startCounts', async () => {
  const schedule = demoSchedule();
  const day = Object.keys(schedule)[0];
  const groups = groupRounds(schedule[day]);
  const store = eventStore(async (eventId) => demoResponse(`${API}/results/${DEMO_ID}/${eventId}`));
  const countsOf = async (event, roundName = null) => {
    const g = groups.find((x) => x.event === event && (!roundName || x.roundName === roundName));
    assert.ok(g, `the fixture still has ${event}`);
    return startCounts(await roundDetails(g.entries, store));
  };

  // Classes sharing a draw count its heats once. The 3000m has a shared draw
  // and a leftover class. (Break on purpose: sum each category's own Heats,
  // and this start claims 4 erää.)
  {
    const c = await countsOf('3000m');
    assert.equal(c.length, 2, 'the shared draw is one row, the leftover its own');
    assert.deepEqual({ label: c[0].label, heats: c[0].heats, field: c[0].field }, { label: null, heats: 2, field: 12 });
    assert.equal(countLine(c[0]), '2 erää · 12 osallistujaa');
    assert.equal(c[1].label, 'M65');
    assert.equal(countLine(c[1]), 'Ei ilmoittautuneita');
  }

  {
    const c = await countsOf('400m aidat');
    assert.deepEqual(
      c.map((x) => x.label),
      ['P13', 'M', 'N'],
    );
    assert.deepEqual(c.map(countLine), ['Ei ilmoittautuneita', '1 erä · 2 osallistujaa', 'Ei ilmoittautuneita']);
  }

  // A class whose document answers 404 says so, and claims nobody entered
  // only where its document says it (docs/tuloslista-api.md). (Break on
  // purpose: drop the `missing` row from startCounts, and the line is empty.)
  {
    const g = groups.find((x) => x.event === '400m aidat');
    const p13 = g.entries.find((e) => e.label === 'P13').round.EventId;
    const holed = eventStore(async (eventId) => {
      if (eventId !== p13) return demoResponse(`${API}/results/${DEMO_ID}/${eventId}`);
      const err = new Error('BlobNotFound');
      err.status = 404;
      throw err;
    });
    const c = startCounts(await roundDetails(g.entries, holed));
    assert.deepEqual(c.map(countLine), ['Ei tietoja', '1 erä · 2 osallistujaa', 'Ei ilmoittautuneita']);
  }

  // Before the draw a later round counts the earlier round's field, not the
  // event's entries. (Break on purpose: drop previousRoundField from
  // startCounts, and the line is empty.)
  {
    const c = await countsOf('200m', 'Loppukilpailu');
    assert.equal(c[0].heats, null, 'nothing drawn, so no erät');
    assert.equal(countLine(c[0]), '6 osallistujaa');
    const first = await countsOf('Keihäs');
    assert.equal(countLine(first[0]), '1/2 varmistanutta');
  }

  // These are the two states of the start page's notice (confirmNote).
  // (Break on purpose: drop countLine's confirmed gate, and the start nobody
  // has confirmed in reads "0/3 varmistanutta".)
  {
    const at = async (time, event) => {
      const g = groups.find((x) => x.event === event && x.ts.includes(`T${time}`));
      assert.ok(g, `the fixture still has ${event} at ${time}`);
      return startCounts(await roundDetails(g.entries, store));
    };
    assert.equal(countLine((await at('14:30', 'Korkeus'))[0]), '1/4 varmistanutta');
    const none = (await at('15:00', 'Kuula')).find((c) => c.label === 'T13');
    assert.equal(countLine(none), '3 ilmoittautunutta');
  }

  // (Break on purpose: drop the relay branch and this start reads
  // "5 osallistujaa" for five four-person teams.)
  assert.equal(countLine((await countsOf('4x400m viesti'))[0]), '1 erä · 5 joukkuetta');

  // A start with a leftover Unallocated category has still been run
  // (docs/tuloslista-api.md). (Break on purpose: ask `every` in
  // startFinished, and the 400m aidat reads as still to come.)
  {
    const finished = (event) => startFinished(groups.find((x) => x.event === event).entries);
    assert.equal(finished('400m aidat'), true, 'a leftover does not hold a start open');
    assert.equal(finished('4x400m viesti'), true);
    assert.equal(finished('3000m'), false, 'one under way is not done');
    assert.equal(finished('Keihäs'), false, 'nor one still to be drawn');
    assert.equal(startFinished([]), false);
  }

  // Every unit the line carries has its Finnish singular.
  assert.equal(countLine({ heats: 1, field: 1 }), '1 erä · 1 osallistuja');
  assert.equal(countLine({ heats: 2, field: 2 }), '2 erää · 2 osallistujaa');
  assert.equal(countLine({ heats: null, field: 1, entered: true }), '1 ilmoittautunut');
  assert.equal(countLine({ heats: null, field: 1, entered: true, confirmed: 1 }), '1/1 varmistanutta');
  assert.equal(countLine({ heats: null, field: 1, relay: true }), '1 joukkue');
  assert.equal(countLine({ heats: null, field: null }), '', 'nothing known, nothing said');
});

// --- demo fixture: the shapes the renderers need, with no network ---
test('demo fixture', () => {
  const schedule = demoSchedule();
  const day = Object.keys(schedule)[0];
  const groups = groupRounds(schedule[day]);
  // Several categories share a start, so there are fewer starts than rows. A
  // multi-event's legs are ordinary starts here (combinedEventStarts).
  assert.equal(groups.length, 42, 'the demo starts, across Track/Field/Relay');
  assert.ok(groups.some((g) => g.category === 'Track'));
  assert.ok(groups.some((g) => g.category === 'Field'));
  assert.ok(groups.some((g) => g.category === 'Relay'));
  // The 400m aidat mixes phases, since nobody entered two of its categories.
  // groupStatuses splits them.
  const aidat = groups.find((g) => g.event === '400m aidat');
  assert.equal(aidat.entries.length, 3, 'P13, M and N 400m aidat share one start');
  assert.equal(aidat.status, 'Unallocated', 'aggregated down to the leftover categories');
  // The start keeps programme order (compareCategories). The event view moves
  // a category nobody entered last (renderGroup).
  assert.deepEqual(
    aidat.entries.map((e) => e.label),
    ['P13', 'M', 'N'],
  );
  assert.deepEqual(groupStatuses(aidat.entries), [
    { status: 'Unallocated', labels: ['P13', 'N'] },
    { status: 'Official', labels: ['M'] },
  ]);

  // e3 is two schedule rows of one EventId, one per round.
  const pituusRounds = DEMO_EVENTS.e3.Rounds;
  const karsinta = pituusRounds.find((r) => r.Id === 'r3q');
  const finaali = pituusRounds.find((r) => r.Id === 'r3');
  assert.equal(attemptColumns(finaali.Heats[0].Allocations), 6, 'one 6-attempt row (top 8) beside one 3-attempt row');

  // Every heat of the Karsinta takes the round's widest row as its column
  // count (docs/tuloslista-api.md).
  const allKarsintaAllocs = karsinta.Heats.flatMap((h) => h.Allocations);
  assert.equal(attemptColumns(allKarsintaAllocs), 3);
  assert.equal(attemptColumns(karsinta.Heats[1].Allocations), 2, 'heat 2 alone maxes out at 2 attempts');
  const note = qualificationNote(karsinta, true);
  assert.equal(note, 'Jatkoonpääsy: 5.25 (Q) ja 12 parasta (q)');
  const badges = allKarsintaAllocs.map((a) => qualBadge(a)).sort();
  assert.deepEqual(badges, ['', 'Q', 'Q', 'q'], 'two auto qualifiers, one count-based, one out');

  // e32 is a round caught half run. The heat headings' state chip (heatChip,
  // app/event.js) needs both halves.
  const alkuerat100 = DEMO_EVENTS.e32.Rounds[0];
  assert.equal(alkuerat100.Status, 'Progress');
  assert.deepEqual(
    heatsInOrder(alkuerat100).map((h) => h.Allocations.some((a) => a.Result)),
    [true, true, true, false, false],
    'three heats run, two still to come',
  );
  assert.equal(
    defaultResultView([alkuerat100]),
    'heats',
    'a round still being run opens on its heats, where the chips are',
  );
  // Its cut is on time alone, with QRank empty (docs/tuloslista-api.md).
  assert.equal(qualificationNote(alkuerat100, false), 'Jatkoonpääsy: 6 nopeinta aikaa (q)');
  const badges100 = heatsInOrder(alkuerat100).flatMap((h) => h.Allocations.map(qualBadge));
  assert.equal(badges100.filter((b) => b === 'q').length, 6, 'six standing fill-ins, and no Q anywhere');
  assert.equal(badges100.filter((b) => b === 'Q').length, 0);
  // The sixth place is a dead heat with the flag on one of the two, as the API
  // can leave it (docs/tuloslista-api.md). A third row with the same time is
  // ranked apart and misses the cut.
  const withRound = heatsInOrder(alkuerat100).flatMap((h) => h.Allocations.map((a) => qualBadge(a, alkuerat100)));
  assert.equal(withRound.filter((b) => b === 'q').length, 7, 'the dead heat at the cut advances both');
  const badgeFor = (name) =>
    qualBadge(
      heatsInOrder(alkuerat100)
        .flatMap((h) => h.Allocations)
        .find((a) => a.Name === name),
      alkuerat100,
    );
  assert.equal(badgeFor('Alisa Mittainen'), 'q', 'the half of the dead heat the API left blank');
  assert.equal(badgeFor('Aada Mallinen'), '', 'and the same time on a rank of its own still misses the cut');
  assert.ok(qualPending(alkuerat100), 'and every one of them can still be bumped by the two unrun heats');
  assert.deepEqual(
    heatsInOrder(alkuerat100).map((h) => h.Wind),
    ['+1,5', '+2,0', '+2,4', null, null],
    'an unrun heat has no reading at all — not even the NM sentinel e9 carries',
  );
  // The run heats' winds are legal, exactly at the limit and aided (beatsMark).
  assert.deepEqual(
    heatsInOrder(alkuerat100)
      .slice(0, 3)
      .map((h) => windAided(h.Wind)),
    [false, false, true],
  );

  // e33 is a field start drawn and not yet thrown, so it has no attempt
  // columns (startListTable, app/event.js), as no attempt is taken yet
  // (docs/tuloslista-api.md).
  const kiekko = DEMO_EVENTS.e33.Rounds[0];
  const kiekkoAllocs = kiekko.Heats[0].Allocations;
  assert.equal(kiekko.Status, 'Allocated');
  assert.ok(roundAllocated(kiekko), 'the ring is drawn — this is not the unallocated case e6 covers');
  assert.equal(attemptColumns(kiekkoAllocs), 0, 'and nothing has been thrown, so there is no grid to draw');
  assert.deepEqual(
    kiekkoAllocs.map((a) => a.Position),
    [1, 2, 3, 4, 5, 6],
    'the throwing order is the whole point',
  );
  assert.ok(
    kiekkoAllocs.every((a) => !a.Result),
    'no result on any row',
  );
  // The table renders allocations, so the bests must be on them.
  assert.equal(kiekkoAllocs.filter((a) => a.SB).length, 5, "five have a season's best");
  assert.equal(kiekkoAllocs.filter((a) => !a.SB && !a.PB).length, 1, 'and one has never thrown a mark at all');
  const bestPb = kiekkoAllocs.find((a) => a.PB !== a.SB);
  assert.ok(
    bestPb && Number(bestPb.PB) > Number(bestPb.SB),
    'one throws further than she has this year — a field PB is the bigger of the two, not the smaller',
  );

  const korkeus = DEMO_EVENTS.e4.Rounds[0].Heats[0].Allocations;
  assert.deepEqual(verticalJumpHeights(korkeus), [180, 185, 190, 195]);
  assert.equal(verticalJumpRow(korkeus[0]).get(180), undefined, 'entered at 190, no 180 attempt');
  const noHeight = korkeus.find((a) => a.Result === 'NH');
  assert.equal(verticalMarkText(noHeight.Result), 'NH', 'a non-numeric Result code, not a cm figure');
  // e4's row mixes the two units, and both print in metres.
  const veikko = korkeus.find((a) => a.Result === '190');
  assert.deepEqual(
    [verticalMarkText(veikko.Result), ...bestsParts(veikko).map((b) => verticalMarkText(b.value))],
    ['1.90', '1.88'],
    'one unit on the row whichever unit the meet typed',
  );

  const keihas = DEMO_EVENTS.e6;
  assert.equal(keihas.Rounds.length, 0, 'unallocated: enrollments only, the fallback-table case');
  assert.equal(keihas.Enrollments.length, 2);

  // Every status is on the schedule, so every chip can be seen.
  assert.deepEqual([...new Set(schedule[day].map((r) => r.Status))].sort(), [
    'Allocated',
    'Official',
    'Progress',
    'Unallocated',
  ]);

  // Every row with an SB has a PB at least as good. Rows with both, with a PB
  // alone and with neither must all stay in the fixture.
  {
    let both = 0;
    let pbOnly = 0;
    let neither = 0;
    for (const [, data] of Object.entries(DEMO_EVENTS)) {
      const entries = [
        ...(data.Enrollments || []),
        ...(data.Rounds || []).flatMap((r) => (r.Heats || []).flatMap((h) => h.Allocations || [])),
      ];
      // A smaller time is better and a bigger field mark is. parseResult reads
      // a field mark as null, and null <= null would pass every field row.
      const field = data.EventCategory === 'Field';
      const better = (x, y) => (field ? Number(x) >= Number(y) : parseResult(x) <= parseResult(y));
      for (const a of entries) {
        const sb = a.SB || '';
        const pb = a.PB || '';
        if (sb) {
          assert.ok(pb, `${a.Name} has an SB (${sb}) but no PB`);
          assert.ok(better(pb, sb), `${a.Name} has a PB (${pb}) worse than their SB (${sb})`);
          both += 1;
        } else if (pb) pbOnly += 1;
        else neither += 1;
      }
    }
    assert.ok(
      both > 0 && pbOnly > 0 && neither > 0,
      `the fixture needs all three: both=${both} pbOnly=${pbOnly} neither=${neither}`,
    );
  }

  assert.equal(demoResponse(`${API}/competition/${DEMO_ID}`)[Object.keys(schedule)[0]].length, 57);
  // The home page does not list the demo, but its properties still answer.
  assert.equal(demoResponse(`${API}/competition/${DEMO_ID}/properties`).Competition.Id, DEMO_ID);
  // democup is the club cup, which the demo meet is not. Each answers only for
  // its own events.
  assert.equal(
    isCupMeet(demoResponse(`${API}/competition/${DEMO_ID}/properties`)),
    false,
    'the meet keeps its SeuraCUPPoints and is no cup, the way 20224 does',
  );
  assert.equal(demoResponse(`${API}/competition/${DEMO_CUP_ID}/properties`).Competition.Id, DEMO_CUP_ID);
  assert.equal(demoResponse(`${API}/competition/${DEMO_CUP_ID}`)[Object.keys(demoSchedule(DEMO_CUP_ID))[0]].length, 7);
  assert.equal(demoResponse(`${API}/results/${DEMO_CUP_ID}/c1`).Name, 'T11 60m');
  assert.equal(
    demoResponse(`${API}/results/${DEMO_ID}/c1`).Name,
    'Tuntematon',
    "and neither meet answers for the other's events",
  );
  assert.equal(demoResponse(`${API}/competition/nosuch/properties`), null);
});

// --- roundGroupKey: groupRounds' own key, or a start's link finds nothing ---
test('roundGroupKey', () => {
  const schedule = demoSchedule();
  const day = Object.keys(schedule)[0];
  const groups = groupRounds(schedule[day]);
  for (const round of schedule[day]) {
    const g = groups.find((x) => x.entries.some((e) => e.round === round));
    assert.equal(roundGroupKey(round), g.key, `roundGroupKey must match groupRounds' own key for ${round.EventName}`);
  }
});

// --- roundGroupKey: one start's rows under two offsets are one start ---
// (docs/tuloslista-api.md). (Break on purpose: key on the raw
// BeginDateTimeWithTZ, and the demo's Kolmiloikka splits in two.)
test('roundGroupKey: one start under two offsets', () => {
  const schedule = demoSchedule();
  const day = Object.keys(schedule)[0];
  const rows = schedule[day].filter((r) => /Kolmiloikka/.test(r.EventName));
  assert.notEqual(rows[0].BeginDateTimeWithTZ, rows[1].BeginDateTimeWithTZ, 'the demo writes M15 under another offset');
  const groups = groupRounds(rows);
  assert.deepEqual(
    groups.map((g) => g.entries.map((e) => e.label)),
    [['M15', 'N15']],
  );
  for (const r of rows) assert.equal(roundGroupKey(r), groups[0].key);
  assert.equal(
    roundGroupKey({ BeginDateTimeWithTZ: '2026-09-19T12:00:00.0000000+03:00', EventName: 'M35 Polkujuoksu 8 km' }),
    '2026-09-19T09:00:00.0000000+00:00|Polkujuoksu 8 km',
  );
  // A time with no offset has no instant of its own, so it stays as written.
  assert.equal(
    roundGroupKey({ BeginDateTimeWithTZ: '2026-08-08T11:00', EventName: 'H21 Sprintti' }),
    '2026-08-08T11:00|Sprintti',
  );
  // Temporary: a key written under its row's own offset still opens its
  // start, and a count stored under it moves to the new key (startKeyOf,
  // docs/shims.md). (Break on purpose: drop groupForKey's second find.)
  const old = `${rows.find((r) => roundGroupKey(r) !== `${r.BeginDateTimeWithTZ}|Kolmiloikka`).BeginDateTimeWithTZ}|Kolmiloikka`;
  assert.equal(groupForKey(groups, old), groups[0], 'the key before 19.10.2026');
  assert.equal(startKeyOf(old), groups[0].key);
  assert.equal(startKeyOf('no bar'), 'no bar');
});

// --- previousRoundField: an undrawn round's field off the round before it,
// shaped after a real three-round event (docs/views.md) ---
test('previousRoundField', () => {
  const alkuerat = {
    Id: 'p1',
    Index: 0,
    Status: 'Official',
    Heats: [
      {
        Index: 1,
        Allocations: [
          { Id: 'p1a', QRank: true, QResult: false },
          { Id: 'p1b', QRank: false, QResult: true },
          { Id: 'p1c', QRank: false, QResult: false },
          { Id: 'p1d', QRank: false, QResult: false },
        ],
      },
    ],
  };
  const valierat = {
    Id: 'p2',
    Index: 1,
    Status: 'Allocated',
    Heats: [
      {
        Index: 1,
        Allocations: [
          { Id: 'p1a', QRank: false, QResult: false },
          { Id: 'p1b', QRank: false, QResult: false },
        ],
      },
    ],
  };
  const loppukilpailu = { Id: 'p3', Index: 2, Status: 'Unallocated', Heats: [] };
  const rounds = [alkuerat, valierat, loppukilpailu];

  const finalField = previousRoundField(rounds, loppukilpailu);
  assert.deepEqual(
    finalField.map((a) => a.Id),
    ['p1a', 'p1b'],
    'the final falls back to Välierät (the closer round), not all the way back to Alkuerät',
  );

  const semiField = previousRoundField(rounds, valierat);
  assert.deepEqual(
    semiField.map((a) => a.Id),
    ['p1a', 'p1b'],
    'Alkuerät is Official, so its own fallback is narrowed to just the qualifiers (QRank/QResult), not all 4 entrants',
  );

  assert.equal(previousRoundField(rounds, alkuerat), null, 'nothing comes before the first round');
  assert.equal(previousRoundField(null, loppukilpailu), null, 'no Rounds at all: nothing to fall back to');
  assert.equal(previousRoundField(rounds, null), null, 'no round being displayed: nothing to compare Index against');
  assert.equal(
    previousRoundField(rounds, { Id: 'x' }),
    null,
    'a round with no Index (e.g. Rounds[] lookup miss) also gives up cleanly',
  );

  const officialNoBadges = {
    Id: 'p4',
    Index: 0,
    Status: 'Official',
    Heats: [{ Index: 1, Allocations: [{ Id: 'p4a', QRank: false, QResult: false }] }],
  };
  assert.deepEqual(
    previousRoundField([officialNoBadges, { Id: 'p5', Index: 1, Status: 'Unallocated', Heats: [] }], {
      Id: 'p5',
      Index: 1,
    }),
    officialNoBadges.Heats[0].Allocations,
    'an Official round with no QRank/QResult true anywhere still returns its full field, not []',
  );

  // A dead heat at the cut sends both halves through, since the narrowing
  // asks qualBadge (docs/tuloslista-api.md).
  const withDeadHeat = {
    Id: 'p6',
    Index: 0,
    Status: 'Official',
    Heats: [
      {
        Index: 1,
        Allocations: [
          { Id: 'p6a', ResultRank: 1, HeatRank: 1, QRank: false, QResult: true },
          { Id: 'p6b', ResultRank: 2, HeatRank: 2, QRank: false, QResult: true },
          { Id: 'p6c', ResultRank: 2, HeatRank: 2, QRank: false, QResult: false },
          { Id: 'p6d', ResultRank: 4, HeatRank: 4, QRank: false, QResult: false },
        ],
      },
    ],
  };
  assert.deepEqual(
    previousRoundField([withDeadHeat, { Id: 'p7', Index: 1, Status: 'Unallocated', Heats: [] }], {
      Id: 'p7',
      Index: 1,
    }).map((a) => a.Id),
    ['p6a', 'p6b', 'p6c'],
    "the tied third is in the next round's field; the runner behind them still is not",
  );
});

// --- previousRound: the nearest earlier round with a drawn field, an
// undrawn stage in between skipped ---
test('previousRound', () => {
  const alkuerat = { Id: 'q1', Index: 0, Status: 'Official', Heats: [{ Allocations: [{ Id: 'q1a' }] }] };
  const valierat = { Id: 'q2', Index: 1, Status: 'Unallocated', Heats: [] };
  const loppukilpailu = { Id: 'q3', Index: 2, Status: 'Unallocated', Heats: [] };
  const rounds = [alkuerat, valierat, loppukilpailu];

  assert.equal(
    previousRound(rounds, loppukilpailu)?.Id,
    'q1',
    'Välierät has no Heats yet either, so the link skips past it to Alkuerät, not the schedule-adjacent-but-empty Välierät',
  );
  assert.equal(previousRound(rounds, alkuerat), null, 'nothing before the first round');
  assert.equal(previousRound(rounds, null), null);

  // A heat shell in between is skipped too (docs/tuloslista-api.md).
  const shellValierat = { Id: 's2', Index: 1, Status: 'Unallocated', Heats: [{ Index: 1, Allocations: [] }] };
  const shellRounds = [alkuerat, shellValierat, loppukilpailu];
  assert.equal(
    previousRound(shellRounds, loppukilpailu)?.Id,
    'q1',
    'a heat-shell round in between is skipped over too, not treated as the round with data',
  );
  assert.deepEqual(
    previousRoundField(shellRounds, loppukilpailu),
    [{ Id: 'q1a' }],
    'so the field comes from Alkuerät, not back as an empty list from the shell',
  );
});

// --- fieldMayChange: whether previousRoundField's field can still change,
// which the "Osallistujat voivat vielä muuttua" note says (docs/views.md) ---
test('fieldMayChange', () => {
  const withCut = (id, index, status) => ({
    Id: id,
    Index: index,
    Status: status,
    Heats: [
      {
        Index: 1,
        Allocations: [
          { Id: `${id}a`, QRank: false, QResult: true },
          { Id: `${id}b`, QRank: false, QResult: false },
        ],
      },
    ],
  });
  const undrawn = (id, index) => ({ Id: id, Index: index, Status: 'Unallocated', Heats: [] });

  // A finished round with a cut settles the undrawn final's field.
  const alkuerat = withCut('t1', 0, 'Official');
  const loppu = undrawn('t2', 1);
  assert.equal(
    fieldMayChange([alkuerat, loppu], loppu),
    false,
    "a finished round's own qualifiers are the final's field, lanes drawn or not",
  );
  assert.deepEqual(
    previousRoundField([alkuerat, loppu], loppu).map((a) => a.Id),
    ['t1a'],
    'and that is exactly the narrowed list the note was being printed over',
  );

  // A running round's fill-ins are a standing count, so the field moves.
  const running = withCut('t3', 0, 'Progress');
  const loppu2 = undrawn('t4', 1);
  assert.equal(fieldMayChange([running, loppu2], loppu2), true);

  // A finished round with no cut hands over its whole field, which is only
  // a guess.
  const noCut = { Id: 't5', Index: 0, Status: 'Official', Heats: [{ Index: 1, Allocations: [{ Id: 't5a' }] }] };
  const loppu3 = undrawn('t6', 1);
  assert.equal(fieldMayChange([noCut, loppu3], loppu3), true);

  // previousRound skips an unrun stage, so the final can show Alkuerät's
  // qualifiers while the Välierät that picks its field is still to come.
  const skipped = [withCut('t7', 0, 'Official'), undrawn('t8', 1), undrawn('t9', 2)];
  assert.equal(previousRound(skipped, skipped[2])?.Id, 't7', 'the undrawn Välierät is skipped over');
  assert.equal(
    fieldMayChange(skipped, skipped[2]),
    true,
    'so the names shown are a stage out of date, however Official the round they came from',
  );

  // With nothing earlier drawn the caller shows the raw Enrollments, which
  // the earlier round can still narrow.
  const notDrawn = [undrawn('t10', 0), undrawn('t11', 1)];
  assert.equal(fieldMayChange(notDrawn, notDrawn[1]), true, 'an earlier round exists, though none is drawn');
  assert.equal(fieldMayChange(notDrawn, notDrawn[0]), false, 'the first round has nothing to wait on');
  assert.equal(fieldMayChange([alkuerat, loppu], alkuerat), false, 'nothing precedes the first round');
  assert.equal(fieldMayChange(null, loppu), false);
  assert.equal(fieldMayChange([alkuerat, loppu], null), false);

  const e10Rounds = DEMO_EVENTS.e10.Rounds;
  assert.equal(
    fieldMayChange(
      e10Rounds,
      e10Rounds.find((r) => r.Id === 'r10f'),
    ),
    false,
    "M 800m: Alkuerät finished and cut, so the final's three are settled",
  );
  const e9Rounds = DEMO_EVENTS.e9.Rounds;
  assert.equal(
    fieldMayChange(
      e9Rounds,
      e9Rounds.find((r) => r.Id === 'r9f'),
    ),
    true,
    "N 200m: Välierät still has a heat to run, so the final's field really can move",
  );
});

// --- hasEarlierRound: whether any round comes earlier, drawn or not, for
// the event view's notice (docs/views.md) ---
test('hasEarlierRound', () => {
  const alkuerat = { Id: 'r1', Index: 0, Status: 'Unallocated', Heats: [] };
  const valierat = { Id: 'r2', Index: 1, Status: 'Unallocated', Heats: [] };
  const rounds = [alkuerat, valierat];

  assert.equal(
    hasEarlierRound(rounds, valierat),
    true,
    'Alkuerät precedes Välierät even though neither has heats yet — previousRound itself would say null here',
  );
  assert.equal(
    previousRound(rounds, valierat),
    null,
    'proves the two really do disagree in this case, not just in theory',
  );
  assert.equal(hasEarlierRound(rounds, alkuerat), false, 'nothing precedes the first round');
  assert.equal(hasEarlierRound(rounds, null), false, 'no round being displayed: nothing to compare Index against');
  assert.equal(hasEarlierRound(rounds, { Id: 'x' }), false, 'a round with no Index also gives up cleanly');
  assert.equal(hasEarlierRound(null, valierat), false, 'no Rounds at all');
});

// --- meetPhase: a competition's phase, a leftover category left out
// (docs/tuloslista-api.md) ---
test('meetPhase', () => {
  const events = Object.keys(DEMO_EVENTS).map((eventId) => ({ eventId, data: DEMO_EVENTS[eventId] }));
  assert.equal(meetPhase(demoSchedule(), events), 'Progress', 'the demo has races run and races still to come');
  assert.equal(meetPhase({}, []), 'Unallocated', 'nothing scheduled at all');

  // These are empty classes left `Allocated` over a heat shell
  // (docs/tuloslista-api.md).
  const shell = { Id: 'r-empty', Heats: [{ Index: 1, Allocations: [] }] };
  const ran = { Id: 'r-ran', Heats: [{ Index: 1, Allocations: [{ Id: 'a1' }] }] };
  const schedule = {
    '12.8.2026': [
      { EventId: 'walkT', Id: 'r-ran', Status: 'Official' },
      { EventId: 'walkP', Id: 'r-empty', Status: 'Allocated' },
      { EventId: 'muu', Id: 'r-ran', Status: 'Official' },
    ],
  };
  const results = [
    { eventId: 'walkT', data: { Rounds: [ran], Enrollments: [{ Id: 'a1' }] } },
    { eventId: 'walkP', data: { Rounds: [shell], Enrollments: [] } },
    { eventId: 'muu', data: { Rounds: [ran], Enrollments: [{ Id: 'a1' }] } },
  ];
  assert.equal(
    meetPhase(schedule, results),
    'Official',
    'the category nobody entered does not get to keep the meet running',
  );
  // (Break on purpose: drop the hasEntrants filter, and this is 'Progress'.)
  assert.equal(
    combinedEventStatus(schedule['12.8.2026'].map((r) => r.Status)),
    'Progress',
    'proves the filter is what changes the answer, not the aggregate',
  );

  // A category whose results are a 404 is an empty leftover
  // (docs/tuloslista-api.md).
  assert.equal(
    meetPhase(
      schedule,
      results.filter((r) => r.eventId !== 'walkP'),
    ),
    'Official',
    'a category whose results 404 counts as nobody entered, not as unfinished',
  );

  // A drawn round with empty Enrollments still has entrants (roundAllocated).
  assert.equal(
    meetPhase({ d: [{ EventId: 'x', Id: 'r-ran', Status: 'Allocated' }] }, [
      { eventId: 'x', data: { Rounds: [ran], Enrollments: [] } },
    ]),
    'Allocated',
    'drawn and about to run, and it says so',
  );
});
