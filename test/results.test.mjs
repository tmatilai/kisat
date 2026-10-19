// Tests how a round's heats and results read. That covers the ranks, the
// winds, the relays, the field tables and the qualification (docs/views.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WIND_LEGAL_MAX_MPS,
  allocKey,
  athleteCard,
  attemptColumns,
  beatsMark,
  bestsParts,
  bibNumbersUsed,
  displayRank,
  earlierMarks,
  heatFinishOrder,
  heatPlaces,
  heatWind,
  heatsAreShared,
  heatsInOrder,
  isRelayEventType,
  laneDrawn,
  mergeHeats,
  officialRank,
  parseWind,
  qualBadge,
  qualPending,
  qualificationNote,
  relayInfo,
  relayLegCount,
  relayLegParts,
  relayLegs,
  relayLineup,
  resultPending,
  resultWind,
  roundAbbrev,
  roundAllocated,
  roundFieldSize,
  sortResults,
  totalResults,
  verticalJumpHeights,
  verticalJumpRow,
  verticalMarkText,
  windAided,
} from '../public/lib/results.js';
import { API, groupRounds, groupStatuses } from '../public/lib/schedule.js';
import { findAthleteAllocations } from '../public/lib/watch.js';
import { DEMO_EVENTS, DEMO_ID, demoResponse, demoSchedule } from '../public/demo.js';

// --- heatsInOrder: a round's Heats[] does not arrive in heat order ---
test('heatsInOrder', () => {
  // r9a carries an out-of-order Heats[] (docs/tuloslista-api.md).
  const alkuerat = DEMO_EVENTS.e9.Rounds.find((r) => r.Id === 'r9a');
  assert.deepEqual(
    alkuerat.Heats.map((h) => h.Index),
    [1, 3, 4, 2],
    "the fixture still carries the API's own out-of-order Heats[]",
  );
  assert.deepEqual(
    heatsInOrder(alkuerat).map((h) => h.Index),
    [1, 2, 3, 4],
  );
  // Heat 2's own runners move with it.
  assert.deepEqual(
    heatsInOrder(alkuerat)[1].Allocations.map((a) => a.Id),
    ['i3', 'i4'],
  );
  assert.deepEqual(heatsInOrder({ Heats: [] }), []);
  assert.deepEqual(heatsInOrder(undefined), []);
  // It returns a copy and leaves the round's own order alone.
  assert.notEqual(heatsInOrder(alkuerat), alkuerat.Heats);
  assert.deepEqual(
    alkuerat.Heats.map((h) => h.Index),
    [1, 3, 4, 2],
  );
  // findAthleteAllocations reads heats in the same order. The raw Heats[]
  // lists heat 3 before heat 2.
  const club = {
    athleteIds: new Set(['i4-a', 'i5-a']),
    namedAthleteIds: new Set(),
    clubIds: new Set(),
  };
  assert.deepEqual(
    findAthleteAllocations(alkuerat, club).map((m) => m.heatIndex),
    [2, 3],
  );
});

// --- heatWind: a track heat's reading, where it governs a result ---
test('heatWind', () => {
  const sprint = DEMO_EVENTS.e9; // A 200 m falls under the wind rule.
  const alkuerat = sprint.Rounds.find((r) => r.Id === 'r9a');
  const valierat = sprint.Rounds.find((r) => r.Id === 'r9v');
  assert.equal(heatWind(heatsInOrder(alkuerat)[0], sprint.EventType), '+0,2');
  // '0,0' is a reading, and a truthiness check must not drop it.
  assert.equal(heatWind(heatsInOrder(alkuerat)[3], sprint.EventType), '0,0');
  // 'NM' means not measured, and it is not printed.
  assert.equal(heatWind(valierat.Heats[1], sprint.EventType), null);
  assert.equal(heatWind({ Wind: null }, sprint.EventType), null);
  assert.equal(heatWind(undefined, sprint.EventType), null);

  // The distance gate hides e7's own reading and any reading on e10's 800 m.
  const hurdles = DEMO_EVENTS.e7;
  assert.equal(
    hurdles.Rounds[0].Heats[0].Wind,
    '−1,7',
    'the fixture still carries a reading on a race the reading does not govern',
  );
  assert.equal(heatWind(hurdles.Rounds[0].Heats[0], hurdles.EventType), null);
  assert.equal(heatWind({ Wind: '+1,0' }, DEMO_EVENTS.e10.EventType), null);
  // The gate includes 200 m.
  assert.equal(heatWind({ Wind: '+1,0' }, { Category: 'Track', Length: 200 }), '+1,0');
  assert.equal(heatWind({ Wind: '+1,0' }, { Category: 'Track', Length: 201 }), null);
  // A relay's Length is one leg, so Category keeps a 4x100 out
  // (docs/tuloslista-api.md).
  const relay = DEMO_EVENTS.e5.EventType;
  assert.equal(relay.Length, 100);
  assert.equal(heatWind({ Wind: '+1,0' }, relay), null);
  // A field heat reads no wind, since a jump's wind is per attempt
  // (docs/tuloslista-api.md).
  assert.equal(heatWind({ Wind: '+1,0' }, DEMO_EVENTS.e3.EventType), null);
  assert.equal(heatWind({ Wind: '+1,0' }, undefined), null);
  assert.equal(heatWind({ Wind: '+1,0' }, { Category: 'Track' }), null);
});

// --- parseWind / windAided / resultWind: a row's wind and the legal limit ---
test('resultWind', () => {
  assert.equal(parseWind('+2,1'), 2.1);
  assert.equal(parseWind('-0,4'), -0.4, 'the API sends an ASCII hyphen');
  assert.equal(parseWind('−0,4'), -0.4, 'the fixture carries a typographic minus');
  assert.equal(parseWind('0,0'), 0, 'a dead calm is a reading, not an absence');
  assert.equal(parseWind('NM'), null, 'the not-measured sentinel is not a number');
  assert.equal(parseWind(null), null);
  assert.equal(parseWind(''), null);
  assert.equal(parseWind('kova'), null);

  assert.equal(WIND_LEGAL_MAX_MPS, 2.0);
  assert.equal(windAided('+2,1'), true);
  assert.equal(windAided('+2,0'), false, 'equal to the limit is legal');
  assert.equal(windAided('+1,9'), false);
  assert.equal(windAided('-3,0'), false, 'a headwind never aids anything, however strong');
  // An unknown wind is not aided, since whole meets publish no reading.
  assert.equal(windAided(null), false);
  assert.equal(windAided('NM'), false);

  // A track row carries its heat's reading, which a merged list reads
  // (docs/tuloslista-api.md).
  const sprint = DEMO_EVENTS.e32;
  const heat3 = heatsInOrder(sprint.Rounds[0])[2];
  assert.equal(heat3.Allocations[0].Wind, heat3.Wind, "every allocation carries its heat's reading");
  assert.equal(resultWind(heat3.Allocations[0], sprint.EventType), '+2,4');
  const heat4 = heatsInOrder(sprint.Rounds[0])[3];
  assert.equal(resultWind(heat4.Allocations[0], sprint.EventType), null, 'an unrun heat has none to carry');
  // A row's copy is ignored in an event no reading governs.
  const hurdle = DEMO_EVENTS.e7.Rounds[0].Heats[0].Allocations[0];
  assert.equal(hurdle.Wind, '−1,7');
  assert.equal(resultWind(hurdle, DEMO_EVENTS.e7.EventType), null);

  // A horizontal jump has no heat reading. Its row's wind is the one of the
  // attempt its Result came from.
  const pituus = DEMO_EVENTS.e3;
  const [katri, silvia] = pituus.Rounds[1].Heats[0].Allocations;
  assert.equal(pituus.Rounds[1].Heats[0].Wind, null, 'a field heat carries none');
  assert.equal(resultWind(silvia, pituus.EventType), '+2,3');
  assert.equal(silvia.Attempts[3].Line2, '+2,3', "and it is the winning attempt's, not the last attempt's");
  assert.equal(silvia.Attempts[5].Line2, '+1,1');
  assert.equal(resultWind(katri, pituus.EventType), '+0,1');
  // Throws and vertical jumps read no wind, whatever a row carries.
  assert.equal(resultWind({ Wind: '+3,0' }, DEMO_EVENTS.e2.EventType), null);
  assert.equal(resultWind({ Wind: '+3,0' }, DEMO_EVENTS.e4.EventType), null);
  assert.equal(resultWind({ Wind: '+3,0' }, DEMO_EVENTS.e5.EventType), null, 'nor is a relay leg of 100 m');
  assert.equal(resultWind({ Wind: 'NM' }, sprint.EventType), null);
  assert.equal(resultWind(undefined, sprint.EventType), null);
});

// --- sortResults: where a row with a result and no rank goes ---
test('sortResults', () => {
  // e4's two guests clear the same bar and were drawn against the countback.
  // (Break on purpose: drop verticalCountback from sortResults, and the draw
  // decides the tie.)
  assert.deepEqual(
    sortResults(DEMO_EVENTS.e4.Rounds[0].Heats[0].Allocations).map((a) => a.Id),
    ['d1', 'd2', 'd5', 'd4', 'd3'],
  );

  // The countback's second step is fewer failures below the bar. Horizontal
  // attempts carry a wind and no pattern, so they have no countback.
  const jumps = (rows) =>
    sortResults(
      rows.map(([Id, Result, attempts], i) => ({
        Id,
        Position: i + 1,
        Result,
        Attempts: attempts.map(([Line1, Line2]) => ({ Line1, Line2 })),
      })),
    ).map((a) => a.Id);
  assert.deepEqual(
    jumps([
      [
        'a',
        '210',
        [
          ['200', 'xxo'],
          ['210', 'xo'],
        ],
      ],
      [
        'b',
        '210',
        [
          ['190', '-'],
          ['200', 'o'],
          ['210', 'xo'],
        ],
      ],
    ]),
    ['b', 'a'],
    'fewer failures below the bar',
  );
  assert.deepEqual(
    jumps([
      [
        'a',
        '5.20',
        [
          ['5.10', '+1.2'],
          ['5.20', '+0.4'],
        ],
      ],
      ['b', '5.20', [['5.20', '+0.8']]],
    ]),
    ['a', 'b'],
    'a horizontal tie keeps the draw',
  );

  // The separator says which way a result sorts. A comma
  // makes a time and a point makes a field mark.
  const order = (results) =>
    sortResults(results.map((Result, i) => ({ Id: Result, Position: i + 1, Result }))).map((a) => a.Id);
  assert.deepEqual(order(['11,50', '11,20']), ['11,20', '11,50'], 'a time: the quicker one leads');
  assert.deepEqual(order(['11.50', '11.20']), ['11.50', '11.20'], 'a field mark: the longer one leads');
  assert.deepEqual(order(['DNS', '11,20']), ['11,20', 'DNS'], 'nothing parseable stays behind a result');
});

// --- totalResults: a multi-heat round read as one ranked list ---
test('totalResults', () => {
  const alkuerat = DEMO_EVENTS.e9.Rounds.find((r) => r.Id === 'r9a');
  const rows = totalResults(alkuerat);
  assert.equal(rows.length, 8, "every heat's allocations, not just one heat's");
  // ResultRank is round-wide (docs/tuloslista-api.md), so the merged list
  // follows it.
  assert.deepEqual(
    rows.map((a) => a.ResultRank),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(
    rows.map((a) => a.Id),
    ['i3', 'i1', 'i5', 'i7', 'i6', 'i2', 'i4', 'i8'],
  );
  // Each row keeps the heat it came from as heatIndex.
  assert.deepEqual(
    rows.slice(0, 4).map((a) => a.heatIndex),
    [2, 1, 3, 4],
  );
  // The rows are copies, so the round gains no field.
  assert.equal(alkuerat.Heats[0].Allocations[0].heatIndex, undefined);
  assert.equal(alkuerat.Heats.length, 4);
  // A round still being run lists its unrun rows last, in draw order
  // (sortResults). e9's Välierät has heat 2 drawn and not run.
  const valierat = DEMO_EVENTS.e9.Rounds.find((r) => r.Id === 'r9v');
  assert.deepEqual(
    totalResults(valierat).map((a) => a.Id),
    ['i1', 'i2', 'i5', 'i3', 'i6', 'i7'],
  );
  // A field round's ResultRank is round-wide too (e3's Karsinta).
  const karsinta = DEMO_EVENTS.e3.Rounds.find((r) => r.Id === 'r3q');
  assert.deepEqual(
    totalResults(karsinta).map((a) => [a.Id, a.heatIndex]),
    [
      ['c4', 2],
      ['c3', 2],
      ['c5', 1],
      ['c6', 1],
    ],
  );
  assert.deepEqual(totalResults({ Heats: [] }), []);
  assert.deepEqual(totalResults(undefined), []);
});

// --- displayRank: which of the two placings a results row prints ---
test('displayRank', () => {
  const alkuerat = DEMO_EVENTS.e9.Rounds.find((r) => r.Id === 'r9a');
  // Inside a heat a row prints its placing in the heat, not ResultRank.
  const heat1 = alkuerat.Heats.find((h) => h.Index === 1).Allocations;
  assert.deepEqual(heat1.map(displayRank), [1, 2]);
  assert.deepEqual(
    heat1.map((a) => a.ResultRank),
    [2, 6],
  );
  assert.deepEqual(
    heatsInOrder(alkuerat).map((h) => h.Allocations.map(displayRank)),
    [
      [1, 2],
      [1, 2],
      [1, 2],
      [1, 2],
    ],
  );
  // A merged row (heatIndex set) prints the round-wide place instead.
  assert.deepEqual(totalResults(alkuerat).map(displayRank), [1, 2, 3, 4, 5, 6, 7, 8]);
  // A single-heat round's two ranks agree (docs/tuloslista-api.md).
  const final = DEMO_EVENTS.e1.Rounds[0].Heats[0].Allocations;
  assert.deepEqual(
    final.map(displayRank),
    final.map((a) => a.ResultRank),
  );
  // A row with no HeatRank prints ResultRank. A guest has neither and gets
  // the "—" cell.
  assert.equal(displayRank({ ResultRank: 4 }), 4);
  assert.equal(displayRank({ ResultRank: 4, HeatRank: 1 }), 1);
  assert.equal(displayRank({ ResultRank: 4, HeatRank: 1, heatIndex: 2 }), 4);
  assert.equal(displayRank({ Result: '11,42' }), null);
  assert.equal(displayRank(undefined), null);

  // officialRank is the "N. kaikista" tag beside a Mitalit row's Sija. It
  // shows only where the two placings differ.
  assert.equal(officialRank({ scopeRank: 1, ResultRank: 3 }), 3);
  assert.equal(officialRank({ scopeRank: 3, ResultRank: 3 }), null, 'a scope holding the field says it twice');
  assert.equal(officialRank({ scopeRank: null, ResultRank: 3 }), 3, 'under no scope the only place the row has');
  assert.equal(officialRank({ scopeRank: null, ResultRank: null }), null);
  assert.equal(officialRank({ ResultRank: 3 }), null, 'no scope table, no second placing');
  assert.equal(officialRank(undefined), null);
});

// --- relays: the legs, the lineup and what makes an entry a team ---
test('relays', () => {
  assert.deepEqual(relayLegs({ Athletes: [{ Index: 0, Surname: 'Nollanen' }], AthleteOrders: [] }), []);
  assert.deepEqual(
    relayLegs({
      AthleteOrders: [
        { Index: 2, Athlete: { Surname: 'Toka' } },
        { Index: 1, Athlete: { Surname: 'Eka' } },
      ],
    }),
    ['Eka', 'Toka'],
  );
  // A runner followed by name is marked only among the legs.
  // (Break on purpose: mark off Athletes[] whole, and the followed reserve
  // shows as a marked leg. Never mark, and the followed leg goes unmarked.)
  const pool = {
    Athletes: [
      { Index: 1, Id: 11, Surname: 'Eka' },
      { Index: 2, Id: 12, Surname: 'Toka' },
      { Index: 3, Id: 13, Surname: 'Vara' },
    ],
  };
  assert.deepEqual(relayLegParts(pool, 2, new Set(['12', '13'])), [
    { name: 'Eka', followed: false },
    { name: 'Toka', followed: true },
  ]);
  assert.deepEqual(relayLegParts(pool, 2), [
    { name: 'Eka', followed: false },
    { name: 'Toka', followed: false },
  ]);
  assert.deepEqual(relayLegParts({ Athletes: [{ Index: 0, Id: 1, Surname: 'Nollanen' }] }, 0, new Set(['1'])), []);
  assert.equal(isRelayEventType({ Category: 'Relay', TeamSize: 4 }), true);
  assert.equal(isRelayEventType({ Category: 'Track', TeamSize: 1 }), false);
  assert.equal(
    relayLegCount(
      { Category: 'Relay', TeamSize: 4, Length: 400, Name: '4x400m viesti', Code: '4x400mr' },
      'P9 3x400m viesti',
    ),
    3,
    'the round name wins over a wrong TeamSize (docs/tuloslista-api.md, "Relays")',
  );

  // relayLineup is who a team fields, and a follow-list matches on it
  // (allocMatches). A team can enter more names than it has legs
  // (docs/tuloslista-api.md).
  const entered = {
    Athletes: [
      { Index: 3, Id: 'c' },
      { Index: 1, Id: 'a' },
      { Index: 2, Id: 'b' },
      { Index: 4, Id: 'd' },
    ],
  };
  assert.deepEqual(
    relayLineup(entered, 2).map((a) => a.Id),
    ['a', 'b'],
    'by Index, capped at the leg count (break on purpose: drop the slice and the pool comes too)',
  );
  assert.deepEqual(
    relayLineup(entered, 0).map((a) => a.Id),
    ['a', 'b', 'c', 'd'],
    'no leg count known: everything entered, rather than nothing',
  );
  assert.deepEqual(
    relayLineup(
      {
        Athletes: [
          { Index: 1, Id: 'a' },
          { Index: 2, Id: 'b' },
        ],
        AthleteOrders: [
          { Index: 1, Athlete: { Id: 'x' } },
          { Index: 2, Athlete: { Id: 'y' } },
        ],
      },
      2,
    ).map((a) => a.Id),
    ['x', 'y'],
    "an allocated round's own order wins over the entry list",
  );

  // relayInfo tells a team's entry from a person's.
  assert.deepEqual(
    relayInfo({ EventCategory: 'Relay', EventType: { Category: 'Relay', TeamSize: 4 }, Name: 'M 4x100m viesti' }),
    { relay: true, legCount: 4 },
  );
  assert.deepEqual(relayInfo({ EventCategory: 'Field', EventType: { Category: 'Field' }, Name: 'N Keihäs' }), {
    relay: false,
    legCount: 1,
  });
  assert.equal(
    relayInfo({ EventCategory: 'Relay', EventType: null, Name: 'Viesti' }).relay,
    true,
    'a payload that says Relay is one even when its EventType does not',
  );
  assert.deepEqual(relayInfo(null), { relay: false, legCount: 1 });
});

// --- attemptColumns: rows of one heat differ in length, and the widest
// counts (docs/tuloslista-api.md) ---
test('attemptColumns', () => {
  // The 3-attempt row comes first, so reading the first row alone fails.
  const allocs = [
    { Attempts: [{ Line1: '4.85' }, { Line1: '4.72' }, { Line1: '4.90' }] },
    {
      Attempts: [
        { Line1: '5.13' },
        { Line1: '5.11' },
        { Line1: '5.31' },
        { Line1: 'x' },
        { Line1: '5.08' },
        { Line1: '3.89' },
      ],
    },
  ];
  assert.equal(attemptColumns(allocs), 6);
  assert.equal(attemptColumns([allocs[0]]), 3);
  assert.equal(attemptColumns([]), 0);
});

// --- bibNumbersUsed: the Nro column shows if any row has a bib ---
test('bibNumbersUsed', () => {
  assert.equal(bibNumbersUsed([{ Number: 21 }, { Number: 22 }]), true);
  assert.equal(bibNumbersUsed([{ Number: null }, { Number: '' }]), false, 'no row carries one');
  assert.equal(bibNumbersUsed([{ Number: null }, { Number: 22 }]), true, 'one row is enough to keep the column');
  assert.equal(bibNumbersUsed([]), false);
});

// --- verticalJumpHeights/verticalJumpRow: the columns are every height
// anybody attempted, since a row lacks the heights it skipped ---
test('verticalJumpHeights/verticalJumpRow', () => {
  const a = {
    Attempts: [
      { Line1: '180', Line2: 'o' },
      { Line1: '185', Line2: 'o' },
      { Line1: '190', Line2: 'xo' },
    ],
  };
  const b = {
    Attempts: [
      { Line1: '190', Line2: 'o' },
      { Line1: '195', Line2: 'xxx' },
    ],
  };
  assert.deepEqual(verticalJumpHeights([a, b]), [180, 185, 190, 195], 'union, sorted, not either row alone');
  const rowA = verticalJumpRow(a);
  const rowB = verticalJumpRow(b);
  assert.equal(rowA.get(180), 'o');
  assert.equal(rowB.get(180), undefined, 'b never attempted 180 — must read as missing, not a foul');
  assert.equal(rowB.get(190), 'o');
});

// --- verticalMarkText: both spellings of a bar read the same, and a code
// stays a code ---
test('verticalMarkText', () => {
  assert.equal(verticalMarkText('460'), '4.60');
  assert.equal(verticalMarkText('4.60'), '4.60', 'the same height, spelled the way a meet enters a best');
  assert.equal(verticalMarkText('185'), '1.85');
  assert.equal(verticalMarkText('1.85'), '1.85');
  assert.equal(verticalMarkText('1.4'), '1.40', 'a one-decimal best still reads to the centimetre');
  assert.equal(verticalMarkText('NH'), 'NH');
  assert.equal(verticalMarkText('DNS'), 'DNS');
  assert.equal(verticalMarkText(null), '');
  assert.equal(verticalMarkText(''), '');
});

// --- qualificationNote/qualBadge: a round's cut reads by category
// (docs/tuloslista-api.md) ---
test('qualificationNote/qualBadge', () => {
  assert.equal(
    qualificationNote({ QRank: '5.25', QResult: '12' }, true),
    'Jatkoonpääsy: 5.25 (Q) ja 12 parasta (q)',
    'the exact wording tuloslista shows for N16 Pituus Karsinta',
  );
  assert.equal(
    qualificationNote({ QRank: '3', QResult: '6' }, false),
    'Jatkoonpääsy: 3 parasta/erä (Q) ja 6 nopeinta aikaa (q)',
  );
  assert.equal(qualificationNote({ QRank: '', QResult: '' }, true), null, 'a final has no cut');
  assert.equal(qualificationNote(null, true), null);
  assert.equal(qualBadge({ QRank: true, QResult: false }), 'Q');
  assert.equal(qualBadge({ QRank: false, QResult: true }), 'q');
  assert.equal(qualBadge({ QRank: false, QResult: false }), '');
});

// --- qualBadge with the round: a tie at the cut shares the badge
// (docs/tuloslista-api.md). A "q" follows ResultRank and a "Q" HeatRank. ---
test('qualBadge tied qualifiers', () => {
  const alloc = (o) => ({ QRank: false, QResult: false, ...o });
  // tied and deadHeat share ResultRank 6 across two heats, and only tied is
  // flagged. slower has the same mark on a rank of its own.
  const tied = alloc({ Id: 1, Result: '12,61', ResultRank: 6, HeatRank: 2, QResult: true });
  const deadHeat = alloc({ Id: 2, Result: '12,61', ResultRank: 6, HeatRank: 1 });
  const slower = alloc({ Id: 3, Result: '12,61', ResultRank: 8, HeatRank: 3 });
  const dq = alloc({ Id: 4, Result: 'DQ', ResultRank: null, HeatRank: null });
  const auto = alloc({ Id: 5, Result: '12,30', ResultRank: 3, HeatRank: 1, QRank: true });
  // No measured round flags a row with no rank. flaggedDq keeps two null
  // ranks from counting as a tie.
  const flaggedDq = alloc({ Id: 10, Result: 'DNS', ResultRank: null, HeatRank: null, QResult: true });
  const round = { Heats: [{ Allocations: [tied, auto] }, { Allocations: [deadHeat, slower, dq, flaggedDq] }] };

  assert.equal(
    qualBadge(deadHeat, round),
    'q',
    'tied on ResultRank with a fill-in qualifier, in another heat: the same "q"',
  );
  assert.equal(qualBadge(deadHeat), '', "and only with the round — alone it is still the API's own flag");
  assert.equal(qualBadge(slower, round), '', 'the same time on a rank of its own earns nothing');
  assert.equal(qualBadge(dq, round), '', 'and an unranked row ties with nobody, not even another unranked one');
  assert.equal(qualBadge(tied, round), 'q', 'the qualifier keeps its own badge');

  // A "Q" is decided inside its heat, so it follows HeatRank there alone.
  const deadHeatAuto = alloc({ Id: 6, Result: '12,30', ResultRank: 3, HeatRank: 1 });
  const otherHeat = alloc({ Id: 7, Result: '12,30', ResultRank: 3, HeatRank: 1 });
  const twoHeats = { Heats: [{ Allocations: [auto, deadHeatAuto] }, { Allocations: [otherHeat] }] };
  assert.equal(qualBadge(deadHeatAuto, twoHeats), 'Q', 'a dead heat for the last automatic place takes it too');
  assert.equal(qualBadge(otherHeat, twoHeats), '', "another heat's winner does not inherit it");

  // The two never cross, since an automatic qualifier is out of the pool the
  // fill-ins are drawn from.
  assert.equal(
    qualBadge(otherHeat, { Heats: [{ Allocations: [auto] }, { Allocations: [otherHeat] }] }),
    '',
    'sharing a ResultRank with a "Q" gives no "q"',
  );
  assert.equal(
    qualBadge(alloc({ Id: 9, Result: '12,61', ResultRank: 6, HeatRank: 2 }), {
      Heats: [{ Allocations: [tied, alloc({ Id: 9, Result: '12,61', ResultRank: 6, HeatRank: 2 })] }],
    }),
    'q',
    'and a "q" is no reason to call a heat\'s own tie an automatic qualifier',
  );
});

// --- qualPending: over several heats a "q" can change until the round is
// Official (docs/tuloslista-api.md) ---
test('qualPending/resultPending', () => {
  assert.equal(
    qualPending({ Status: 'Progress', Heats: [{}, {}] }),
    true,
    'two heats, round not yet Official: a fill-in qualifier can still change',
  );
  assert.equal(
    qualPending({ Status: 'Official', Heats: [{}, {}] }),
    false,
    'every heat done and confirmed: nothing left to change it',
  );
  assert.equal(
    qualPending({ Status: 'Progress', Heats: [{}] }),
    false,
    'a single-heat round has no other heat to wait on',
  );
  assert.equal(qualPending({ Status: 'Progress', Heats: [] }), false);
  assert.equal(qualPending(null), false);

  // resultPending asks whether a placing can still move. A single field heat
  // moves with every attempt, so the heat count does not matter.
  assert.equal(
    resultPending({ Status: 'Progress', Heats: [{}] }),
    true,
    'one heat still being contested moves its own placings',
  );
  assert.equal(resultPending({ Status: 'Official', Heats: [{}] }), false);
  assert.equal(resultPending({ Status: 'Allocated' }), true);
  assert.equal(resultPending(null), true, 'nothing known is not "confirmed"');
});

// --- heatPlaces: the placing in this heat, not the rank over the round ---
test('heatPlaces', () => {
  const row = (id, lane, Result, ResultRank) => ({ lane, alloc: { Id: id, Result, ResultRank } });
  // A heat's winner can rank 6th over the round.
  const heat = [row('a', 1, '13,05', 6), row('b', 2, '13,71', 24), row('c', 3, '14,46', 38), row('d', 4, '14,30', 35)];
  const p = heatPlaces(heat);
  assert.deepEqual(
    [...'abcd'].map((k) => p.get(k)),
    [1, 2, 4, 3],
    'placed within the heat',
  );
  // Equal times share a place and the next skips past, as ranks do.
  assert.deepEqual(
    [...heatPlaces([row('a', 1, '12,74'), row('b', 2, '12,74'), row('c', 3, '13,00')]).entries()],
    [
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ],
  );
  // A row with no time gets no place.
  const dns = heatPlaces([row('a', 1, '12,74'), row('b', 2, 'DNS'), row('c', 3, 'DNF')]);
  assert.equal(dns.get('a'), 1);
  assert.equal(dns.has('b'), false);
  assert.equal(dns.has('c'), false);
  // A shared heat holds two categories that each bring a HeatRank of 1, so
  // the place comes from the times.
  const merged = [
    { lane: 1, label: 'M', alloc: { Id: 'm1', Result: '13,50', HeatRank: 1 } },
    { lane: 2, label: 'N', alloc: { Id: 'n1', Result: '13,20', HeatRank: 1 } },
  ];
  assert.deepEqual(
    [...heatPlaces(merged).entries()],
    [
      ['n1', 1],
      ['m1', 2],
    ],
  );
  assert.equal(heatPlaces([]).size, 0);
  assert.equal(heatPlaces(null).size, 0);
});

// --- heatFinishOrder: a shared heat's rows as the race finished ---
test('heatFinishOrder', () => {
  const row = (id, lane, Result, label) => ({ lane, label, alloc: { Id: id, Result } });
  const heat = [
    row('a', 1, 'DNS', 'M'),
    row('b', 2, '13,50', 'N'),
    row('c', 3, '13,20', 'M'),
    row('d', 4, 'DNF', 'N'),
    row('e', 5, '13,20', 'N'),
    row('f', 6, '12,90', 'M'),
  ];
  const order = heatFinishOrder(heat);
  assert.deepEqual(
    order.map((r) => r.alloc.Id),
    ['f', 'c', 'e', 'b', 'a', 'd'],
    'fastest first over both classes, a tie and the no-times by lane',
  );
  assert.deepEqual(
    heat.map((r) => r.alloc.Id),
    [...'abcdef'],
    'the lane order is left alone',
  );
  // The table's rows and its Sija column are one order.
  const places = heatPlaces(heat);
  assert.deepEqual(
    order.map((r) => places.get(r.alloc.Id)),
    [1, 2, 2, 4, undefined, undefined],
  );
  assert.deepEqual(heatFinishOrder(null), []);
});

// --- the starts whose categories share a physical heat: mergeHeats,
// heatPlaces and heatsAreShared ---
test('shared heats', () => {
  const schedule = demoSchedule();
  const day = Object.keys(schedule)[0];
  const groups = groupRounds(schedule[day]);
  // Loads every category of a start the way the event view does.
  const load = (event) =>
    groups
      .find((g) => g.event === event)
      .entries.map((e) => {
        const data = demoResponse(`${API}/results/${DEMO_ID}/${e.round.EventId}`);
        return { label: e.label, data, round: data.Rounds.find((r) => r.Id === e.round.Id) };
      });

  // The 3000m is being run. Two classes interleave by lane over the same two
  // heats, and a third class never ran.
  {
    const det = load('3000m');
    assert.deepEqual(
      det.map((d) => d.label),
      ['M19', 'M', 'M65'],
      'programme order: youth, then adults, then masters',
    );
    assert.equal(
      roundAllocated(det.find((d) => d.label === 'M65').round),
      false,
      'the leftover brings nothing to the heats below',
    );
    // One status cannot describe this start, since two classes are racing and
    // the third never will (groupStatuses).
    const g = groups.find((x) => x.event === '3000m');
    assert.equal(g.status, 'Unallocated', 'the aggregate is the least advanced');
    assert.deepEqual(groupStatuses(g.entries), [
      { status: 'Progress', labels: ['M19', 'M'] },
      { status: 'Unallocated', labels: ['M65'] },
    ]);

    const heats = mergeHeats(det);
    assert.deepEqual(
      heats.map((h) => h.index),
      [1, 2],
    );
    assert.deepEqual(
      heats.map((h) => h.rows.length),
      [7, 5],
    );
    for (const h of heats) {
      assert.deepEqual(
        h.rows.map((r) => r.lane),
        [...h.rows.map((r) => r.lane)].sort((a, b) => a - b),
        'merged rows read down the lanes',
      );
    }
    // Neither class's own table reads down the track. (Break on purpose: give
    // each class its own block of lanes in demo.js and these fail.)
    assert.deepEqual(
      heats[0].rows.map((r) => r.label),
      ['M', 'M19', 'M', 'M19', 'M', 'M19', 'M'],
    );
    assert.deepEqual(
      heats[1].rows.map((r) => r.label),
      ['M19', 'M', 'M19', 'M', 'M19'],
    );
    // Nobody has finished, so there is no place to compute.
    assert.equal(heatPlaces(heats[0].rows).size, 0);

    // No 3000 m reading is wind-legal, and mergeHeats applies heatWind's gate
    // as it merges. (Break on purpose: pass h.Wind straight through in
    // mergeHeats and this reads −2,6.)
    for (const d of det) {
      for (const h of d.round.Heats || []) assert.equal(heatWind(h, d.data.EventType), null);
    }
    assert.equal(
      det.some((d) => d.round.Heats.some((h) => h.Wind)),
      true,
      'there is a raw Wind here, or the gate above proves nothing',
    );
    assert.equal(heats[0].wind, null);
    assert.equal(heats[1].wind, null);

    assert.equal(heatsAreShared(heats), true);
  }

  // The 200m kelaus is finished, so the same shape has results to place.
  {
    const det = load('200m kelaus');
    assert.deepEqual(
      det.map((d) => d.label),
      ['M19 T54', 'M T54'],
      'the para classification rides along on the label without disturbing the order',
    );
    const [heat] = mergeHeats(det);
    assert.equal(heat.rows.length, 7);
    assert.deepEqual(
      heat.rows.map((r) => r.lane),
      [2, 3, 4, 5, 6, 7, 8],
    );
    // A 200 m reading is one the page prints.
    assert.equal(heatWind(det[0].round.Heats[0], det[0].data.EventType), '−0,4');

    // Each category ranks its own round, so the merged heat has two 1sts and
    // heatPlaces computes its own.
    assert.equal(
      heat.rows.filter((r) => r.alloc.ResultRank === 1).length,
      2,
      'two winners in one heat, or the next assertion proves nothing',
    );
    const places = heatPlaces(heat.rows);
    assert.deepEqual(
      [...places.entries()],
      [
        ['p2', 1],
        ['p1', 2],
        ['p3', 3],
        ['q1', 4],
        ['q2', 5],
        ['q3', 6],
      ],
      'placed over everyone in the heat, whatever class they are in',
    );
    assert.equal(places.has('p4'), false, 'and the DNS is absent rather than last');

    // A category sorts its ranked rows first, then a timed guest, then the
    // rest.
    const sortedBy = (label) =>
      sortResults(det.find((d) => d.label === label).round.Heats.flatMap((h) => h.Allocations)).map((a) => a.Result);
    assert.deepEqual(sortedBy('M T54'), ['26,91', '27,44', '29,08', 'DNS']);
    assert.deepEqual(
      sortedBy('M19 T54'),
      ['30,12', '31,55', '32,40'],
      'the guest keeps their time and their place in the order',
    );
  }

  // The 4x400m viesti shares a heat between two classes' teams, and the winner
  // is in the smaller class.
  {
    const det = load('4x400m viesti');
    assert.deepEqual(
      det.map((d) => d.label),
      ['N15', 'Mixed 15'],
      'a mixed class reads after the single-sex one of the same age',
    );
    const [heat] = mergeHeats(det);
    assert.equal(heat.rows.length, 5);
    assert.deepEqual(
      heat.rows.map((r) => r.lane),
      [2, 3, 4, 5, 7],
    );
    const places = heatPlaces(heat.rows);
    assert.equal(places.get('x1'), 1, "the fastest team in the heat is Mixed 15's, not N15's");
    assert.equal(
      det[0].round.Heats[0].Allocations[0].ResultRank,
      1,
      "…while N15's own round still calls its first team 1st",
    );
    assert.equal(places.has('t3'), false, 'the DNF is placed nowhere');
    // A team entered with more names than legs names only those who run.
    const legs = relayLegCount(det[0].data.EventType, det[0].data.Name);
    assert.equal(legs, 4);
    assert.equal(det[0].data.Enrollments[0].Athletes.length, 6, 'six entered');
    assert.deepEqual(relayLegs(heat.rows.find((r) => r.alloc.Id === 't1').alloc, legs), [
      'Testinen',
      'Kokeinen',
      'Näytteinen',
      'Demoinen',
    ]);
    assert.equal(heatsAreShared([heat]), true, 'teams share a heat the same way people do');
  }

  // These starts must not count as shared. heatsAreShared means neither
  // "several heats" nor "several categories".
  {
    assert.equal(heatsAreShared(mergeHeats(load('200m kelaus'))), true, 'the positive, again');
    // Four heats of one category are each already that category's own table.
    const sprint = mergeHeats(load('200m'));
    assert.equal(sprint.length, 4);
    assert.equal(heatsAreShared(sprint), false);
    // Three categories, but only one was drawn. e8 has no round and e11 an
    // empty heat shell. The shell is heat 1 too, so it merges in and adds no
    // row.
    const hurdles = mergeHeats(load('400m aidat'));
    assert.deepEqual(
      hurdles.map((h) => h.rows.length),
      [2],
    );
    assert.equal(heatsAreShared(hurdles), false);
    assert.equal(heatsAreShared([]), false);
    assert.equal(heatsAreShared(null), false);
  }

  // The 60m has four classes over two shared heats, and only the T classes run
  // in both. The heats and the draw follow measured meets.
  {
    const det = load('60m');
    assert.deepEqual(
      det.map((d) => d.label),
      ['P11', 'T11', 'P13', 'T13'],
      'programme order: the 11s before the 13s, boys before girls',
    );
    // A class's own heat count is not the start's.
    assert.deepEqual(
      det.map((d) => `${d.label}:${d.round.Heats.length}`),
      ['P11:1', 'T11:2', 'P13:1', 'T13:2'],
      'P13 ran only heat 1, P11 only heat 2, and both T classes ran in each',
    );
    const heats = mergeHeats(det);
    assert.deepEqual(
      heats.map((h) => h.index),
      [1, 2],
    );
    assert.deepEqual(
      heats.map((h) => h.rows.length),
      [6, 6],
    );
    // Each heat is one draw of lanes 1 to 6, so these were two races and not
    // four. (Break on purpose: give two rows of one heat the same lane in
    // demo.js and the start is not shared.)
    for (const h of heats) {
      assert.deepEqual(
        h.rows.map((r) => r.lane),
        [1, 2, 3, 4, 5, 6],
      );
      assert.equal(h.lanes, true);
    }
    assert.deepEqual(
      heats[0].rows.map((r) => r.label),
      ['T13', 'P13', 'T11', 'P13', 'T13', 'T11'],
    );
    assert.deepEqual(
      heats[1].rows.map((r) => r.label),
      ['T11', 'P11', 'T13', 'P11', 'T13', 'T11'],
    );
    assert.equal(heatsAreShared(heats), true);

    // One race has three rankings. The T13 winner is third in the race, and
    // first of her class in the round and in the heat.
    const winner = heats[0].rows.find((r) => r.label === 'T13' && r.alloc.ResultRank === 1);
    assert.equal(heatPlaces(heats[0].rows).get(winner.alloc.Id), 3);
    assert.equal(winner.alloc.HeatRank, 1);
    const ranksOf = (label) =>
      det
        .find((d) => d.label === label)
        .round.Heats.flatMap((h) => h.Allocations)
        .map((a) => a.ResultRank)
        .sort((a, b) => a - b);
    assert.deepEqual(ranksOf('T13'), [1, 2, 3, 4], 'four runners over two heats, ranked as one round');
    assert.deepEqual(ranksOf('P13'), [1, 2]);
    // The two heats ran in different winds, and 60 m is short enough for them
    // to count (heatWind).
    assert.deepEqual(
      heats.map((h) => h.wind),
      ['+0,2', '−0,5'],
    );
  }

  // The field start looks like a shared heat and is not. Each class draws its
  // own order from 1 and calls it heat 1 (laneDrawn, docs/tuloslista-api.md).
  {
    const det = load('Kolmiloikka');
    assert.deepEqual(
      det.map((d) => d.label),
      ['M15', 'N15'],
    );
    const [heat] = mergeHeats(det);
    assert.equal(heat.rows.length, 6, 'both classes are in the merge all the same');
    assert.deepEqual(
      heat.rows.map((r) => r.lane),
      [1, 1, 2, 2, 3, 3],
      'every draw number is used twice — a lane is not what this is',
    );
    assert.equal(
      new Set(heat.rows.map((r) => r.label)).size,
      2,
      'two labels, so label count alone would call this shared',
    );
    assert.equal(heat.lanes, false);
    assert.equal(heatsAreShared([heat]), false);
    // Nor could the rows be ranked. A field mark is dot-separated and bigger
    // is better, so none parses as a time (docs/tuloslista-api.md).
    assert.equal(heatPlaces(heat.rows).size, 0);
    assert.equal(
      heat.rows.every((r) => r.alloc.Result),
      true,
      'every one of them has a result, or the line above proves nothing',
    );
    // Two field classes numbered as one draw are not shared either, since the
    // category gate decides before the lanes are read. (Break on purpose:
    // delete the laneDrawn line in mergeHeats and this reads as shared.)
    const field = (label, lanes) => ({
      label,
      data: { EventType: det[0].data.EventType },
      round: { Heats: [{ Index: 1, Allocations: lanes.map((p) => ({ Id: `${label}-${p}`, Position: p })) }] },
    });
    const [apart] = mergeHeats([field('M15', [1, 3, 5]), field('N15', [2, 4, 6])]);
    assert.deepEqual(
      apart.rows.map((r) => r.lane),
      [1, 2, 3, 4, 5, 6],
      'each number used once, so the lanes alone would pass this as one draw',
    );
    assert.equal(apart.lanes, false);
    assert.equal(heatsAreShared([apart]), false);
    // The track starts keep their flag, or the gate would switch off every
    // shared-heat table.
    assert.equal(mergeHeats(load('200m kelaus'))[0].lanes, true);
    assert.equal(mergeHeats(load('4x400m viesti'))[0].lanes, true, 'a relay is drawn in lanes too');
  }

  // The 400m makes the same mistake on the track, where the category gate
  // cannot see it. Two classes each drew their own lanes under heat 1, as many
  // real starts do (docs/tuloslista-api.md).
  {
    const det = load('400m');
    assert.deepEqual(
      det.map((d) => d.label),
      ['M17', 'M'],
    );
    const [heat] = mergeHeats(det);
    assert.equal(heat.rows.length, 6);
    assert.deepEqual(
      heat.rows.map((r) => r.lane),
      [3, 4, 4, 5, 5, 6],
      'six runners over four lanes, which never happened',
    );
    assert.equal(
      new Set(heat.rows.map((r) => r.label)).size,
      2,
      'two labels and a Track event, so both of the earlier gates pass it',
    );
    assert.equal(laneDrawn(det[0].data.EventType), true, 'the category gate has no objection');
    assert.equal(heat.lanes, false, 'the lanes themselves are what say no');
    assert.equal(heatsAreShared([heat]), false);
    // The times rank well enough, so only the lanes catch this. (Break on
    // purpose: draw the two classes into lanes of their own in demo.js and this
    // start claims a shared heat.)
    assert.equal(heatPlaces(heat.rows).size, 6);
  }

  // Every multi-class heat must be one draw, since the answer picks one layout
  // for the whole start. A start with one heat one draw and another two
  // loses its shared layout to that.
  {
    const clean = mergeHeats(load('200m kelaus'));
    const collide = mergeHeats(load('400m'));
    assert.equal(heatsAreShared(clean), true);
    assert.equal(
      heatsAreShared([...clean, ...collide]),
      false,
      'one heat that is really two races takes the whole start with it',
    );
    // (Break on purpose: make heatsAreShared use `some` and this fails.)
  }
});

// --- roundFieldSize: the "3/8" denominator next to a bare ResultRank ---
test('roundFieldSize', () => {
  assert.equal(roundFieldSize(DEMO_EVENTS.e2.Rounds[0]), 3, 'M Kuula: one heat, 3 allocations');
  const pituusFinal = DEMO_EVENTS.e3.Rounds.find((r) => r.Id === 'r3');
  assert.equal(roundFieldSize(pituusFinal), 2);
  const karsinta = DEMO_EVENTS.e3.Rounds.find((r) => r.Id === 'r3q');
  assert.equal(roundFieldSize(karsinta), 4, 'two heats, 2 allocations each');
  assert.equal(roundFieldSize(null), 0);
  assert.equal(roundFieldSize({ Heats: [] }), 0);
});

// --- roundAbbrev: an earlier round's label. Only measured names abbreviate ---
test('roundAbbrev', () => {
  assert.equal(roundAbbrev('Alkuerät'), 'AE');
  assert.equal(roundAbbrev('Välierät'), 'VE');
  assert.equal(roundAbbrev('Karsinta'), 'K');
  assert.equal(
    roundAbbrev('Loppukilpailu'),
    'Loppukilpailu',
    'deliberately not abbreviated: it is what a single-round event calls its only round, so it is almost never an earlier one',
  );
  assert.equal(
    roundAbbrev('A-finaali'),
    'A-finaali',
    'a name never measured keeps itself — an invented abbreviation would be a guess where the full word is merely wide',
  );
  assert.equal(roundAbbrev(null), '', 'a round with no name at all heads its column with nothing');
  assert.equal(roundAbbrev(undefined), '');
});

// --- allocKey / earlierMarks / bestsParts / beatsMark: what the name cell
// carries besides the name ---
test('name-cell asides', () => {
  const ind = { TeamId: 7, Athletes: [{ Id: 100 }], Result: '12,43' };
  assert.equal(allocKey(ind), 't7', 'TeamId wins where there is one: it is the only key a relay also has');
  assert.equal(allocKey({ Athletes: [{ Id: 100 }] }), 'a100', 'an entry with no TeamId falls back to its sole athlete');
  assert.equal(
    allocKey({ Athletes: [{ Id: 1 }, { Id: 2 }] }),
    null,
    'a team with no TeamId cannot be keyed on any one of its athletes',
  );
  assert.equal(allocKey(null), null);
  // A team and an athlete with the same id get different keys.
  assert.notEqual(allocKey({ TeamId: 100 }), allocKey({ Athletes: [{ Id: 100 }] }));

  const alku = {
    Id: 'r1',
    Index: 0,
    Name: 'Alkuerät',
    Status: 'Official',
    Heats: [
      {
        Index: 1,
        Allocations: [
          { TeamId: 1, Result: '12,43', QRank: true },
          { TeamId: 2, Result: '12,74' },
          { TeamId: 3, Result: null },
        ],
      },
    ],
  };
  const vali = {
    Id: 'r2',
    Index: 1,
    Name: 'Välierät',
    Status: 'Official',
    Heats: [{ Index: 1, Allocations: [{ TeamId: 1, Result: '12,21' }] }],
  };
  const final = { Id: 'r3', Index: 2, Name: 'Loppukilpailu', Status: 'Unallocated', Heats: [] };

  const marks = earlierMarks([alku, vali, final], final);
  assert.deepEqual(
    marks.get('t1').map((m) => [m.label, m.result]),
    [
      ['VE', '12,21'],
      ['AE', '12,43'],
    ],
    'nearest round first, so a caller can take [0] as "previous" without counting stages',
  );
  assert.equal(marks.get('t1')[0].round, vali, 'each mark carries the round that awarded it, for the Q/q badge');
  assert.deepEqual(
    marks.get('t2').map((m) => m.label),
    ['AE'],
    'somebody who did not reach Välierät has only the one',
  );
  assert.equal(
    marks.get('t3'),
    undefined,
    'a name drawn into a heat that was never run has nothing to say — an empty mark would read as a bad one',
  );
  assert.equal(earlierMarks([alku, vali, final], alku).size, 0, 'the first round has nothing behind it');
  assert.equal(earlierMarks([alku], null).size, 0, 'no round being rendered: nothing to compare Index against');
  assert.equal(earlierMarks(null, final).size, 0, 'no Rounds at all');
  // An undrawn round's heat shell is no earlier round (docs/tuloslista-api.md).
  const shell = { Id: 'r0', Index: 0, Name: 'Alkuerät', Heats: [{ Index: 1, Allocations: [] }] };
  assert.equal(earlierMarks([shell, final], final).size, 0, 'an empty heat shell is not an earlier round with marks');

  assert.deepEqual(
    bestsParts({ PB: '12,55', SB: '12,55' }),
    [{ label: 'PB&SB', value: '12,55' }],
    'one number, one label — and a joint one, since a bare "PB" could not be told from a row with no SB',
  );
  assert.deepEqual(bestsParts({ PB: '12,23', SB: '12,49' }), [
    { label: 'PB', value: '12,23' },
    { label: 'SB', value: '12,49' },
  ]);
  assert.deepEqual(
    bestsParts({ PB: '12,23', SB: '' }),
    [{ label: 'PB', value: '12,23' }],
    'a missing SB says nothing about the athlete — 3-11% of measured rows are this',
  );
  assert.deepEqual(bestsParts({ PB: '', SB: '12,49' }), [{ label: 'SB', value: '12,49' }]);
  assert.deepEqual(bestsParts({}), [], 'neither: nothing at all, never a dash');
  assert.deepEqual(bestsParts(null), []);

  // --- athleteCard: the sheet a tapped name opens ---
  const runner = {
    TeamId: 1,
    Name: 'Aino Kokeinen',
    Number: 143,
    Organization: { Name: 'Mallikylän Vire', NameShort: 'MalV' },
  };
  const card = athleteCard(runner, marks.get('t1'));
  assert.equal(card.name, 'Aino Kokeinen');
  assert.equal(card.club, 'Mallikylän Vire', 'the full club name: a sheet has the width a day-list column has not');
  assert.equal(card.bib, '143');
  assert.deepEqual(
    card.marks,
    [
      { label: 'Välierät', result: '12,21' },
      { label: 'Alkuerät', result: '12,43' },
    ],
    'every earlier round, nearest first, under its full name — the row itself has width for [0] alone',
  );
  assert.deepEqual(
    athleteCard({ Organization: { NameShort: 'MalV' } }),
    { name: '', club: 'MalV', bib: null, marks: [] },
    'a short name is better than none, and no bib is no bib — never a dash or a 0',
  );
  assert.equal(athleteCard({ Number: 0 }).bib, null, 'a meet that numbers nobody has no Nro to print');
  assert.deepEqual(athleteCard(null).marks, [], 'nothing at all still builds a card');
  assert.deepEqual(
    athleteCard(runner, marks.get('t2')).marks,
    [{ label: 'Alkuerät', result: '12,74' }],
    'somebody who reached only the first round has the one line',
  );

  // Direction and format both come off the category, never from the string.
  assert.equal(beatsMark('12,21', '12,23', 'Track'), true, 'a faster time beats the best');
  assert.equal(beatsMark('12,43', '12,23', 'Track'), false);
  assert.equal(beatsMark('12,23', '12,23', 'Track'), false, 'equalling is not beating');
  assert.equal(beatsMark('1.52,10', '1.53,40', 'Track'), true, 'minutes parse too');
  assert.equal(beatsMark('11,42', '11,50', 'Relay'), true, 'a relay is timed like any other track event');
  assert.equal(beatsMark('6.02', '5.99', 'Field'), true, 'a longer field mark beats the best');
  assert.equal(beatsMark('5.58', '6.25', 'Field'), false);
  assert.equal(
    beatsMark('441', '440', 'Field'),
    true,
    'a vertical jump is whole centimetres on both sides — measured, its bests are not the metres a horizontal jump uses',
  );

  // A field mark's decimal point is its unit, on either side
  // (docs/tuloslista-api.md).
  assert.equal(
    beatsMark('123', '1.40', 'Field'),
    false,
    'a 1,23 m clearance is not past a 1.40 m PB, though 123 > 1.40 as bare numbers un-muted the whole start',
  );
  assert.equal(
    beatsMark('123', '1.16', 'Field'),
    true,
    'and it is past a 1.16 m one — refusing to compare mismatched units would mute a real PB here too',
  );
  assert.equal(
    beatsMark('4.64', '464', 'Field'),
    false,
    "the same meet's long jump has it the other way round: 4.64 m is that 464 cm best exactly, not past it",
  );
  assert.equal(beatsMark('4.65', '464', 'Field'), true, 'a centimetre further and it is');
  assert.equal(beatsMark('1.41', '1.40', 'Field'), true, 'two metre marks compare as they always did');
  assert.equal(beatsMark('123', '140', 'Field'), false, 'and so do two centimetre ones');
  // The same two strings answer the other way under the other category.
  assert.equal(beatsMark('5.58', '6.25', 'Track'), false);
  assert.equal(beatsMark('6.25', '5.58', 'Field'), true);
  assert.equal(beatsMark('DNF', '12,23', 'Track'), false, 'anything unparseable is false, never a guess');
  assert.equal(beatsMark('12,21', 'NH', 'Field'), false);
  assert.equal(beatsMark('12,21', '', 'Track'), false, 'no best to beat');
  assert.equal(beatsMark(null, '12,23', 'Track'), false, 'no result yet');
  assert.equal(beatsMark('5.58', '5.58', 'Field'), false);

  // A mark in a wind over +2.0 passes no best.
  assert.equal(beatsMark('12,21', '12,23', 'Track', '+2,1'), false, 'wind-aided: beat on the clock, not as a best');
  assert.equal(beatsMark('12,21', '12,23', 'Track', '+2,0'), true, 'the limit itself is legal');
  assert.equal(beatsMark('6.02', '5.99', 'Field', '+3,6'), false, 'a horizontal jump the same way');
  assert.equal(beatsMark('12,21', '12,23', 'Track', '-2,6'), true, 'a headwind is not a reason to mute anything');
  assert.equal(beatsMark('12,21', '12,23', 'Track', 'NM'), true, 'unknown is not aided');
  assert.equal(beatsMark('12,21', '12,23', 'Track'), true, 'and neither is a caller with no reading to give');

  // The view asks the same of the fixture, whose heats carry a wind each (e32).
  const alkuerat100 = DEMO_EVENTS.e32.Rounds[0];
  const et100 = DEMO_EVENTS.e32.EventType;
  const beaten = (h, i) => {
    const a = heatsInOrder(alkuerat100)[h].Allocations[i];
    return bestsParts(a).map((b) => beatsMark(a.Result, b.value, et100.Category, resultWind(a, et100)));
  };
  assert.deepEqual(beaten(0, 1), [false, true], 'heat 1 (+1,5): a PB that stands, an SB that falls');
  assert.deepEqual(beaten(1, 1), [false, true], 'heat 2 (+2,0): the limit is legal, so the same SB un-mutes');
  assert.deepEqual(beaten(2, 0), [false, false], 'heat 3 (+2,4): 12,19 past a 12,22 SB, and muted for the wind');
  // Without the wind, heat 3's row un-mutes like the other two.
  const wrong = heatsInOrder(alkuerat100)[2].Allocations[0];
  assert.equal(beatsMark(wrong.Result, wrong.SB, 'Track', null), true);

  // A horizontal jump reads each row's own wind, not the heat's (e3).
  const [katri, silvia] = DEMO_EVENTS.e3.Rounds[1].Heats[0].Allocations;
  const etPituus = DEMO_EVENTS.e3.EventType;
  assert.equal(
    beatsMark(katri.Result, katri.SB, etPituus.Category, resultWind(katri, etPituus)),
    true,
    "4.90 into +0,1 passes a 4.88 season's best",
  );
  assert.equal(
    beatsMark(katri.Result, katri.PB, etPituus.Category, resultWind(katri, etPituus)),
    false,
    'and still falls short of the 4.95 lifetime one',
  );
  assert.equal(
    beatsMark(silvia.Result, silvia.PB, etPituus.Category, resultWind(silvia, etPituus)),
    false,
    '5.61 past a 5.55 PB&SB, but into +2,3',
  );
  assert.equal(
    beatsMark(silvia.Result, silvia.PB, etPituus.Category, null),
    true,
    'without the wind it reads as a clear beat, which is the bug the wind check exists to catch',
  );

  // The fixture's high jump has its bests in metres (e4), as a measured one had.
  // Each row is decided by its own mark.
  const korkeusRows = DEMO_EVENTS.e4.Rounds[0].Heats[0].Allocations;
  const etKorkeus = DEMO_EVENTS.e4.EventType;
  const beatenCm = (a) =>
    bestsParts(a).map((b) => beatsMark(a.Result, b.value, etKorkeus.Category, resultWind(a, etKorkeus)));
  assert.deepEqual(
    korkeusRows.map(beatenCm),
    [[true], [false, false], [], [], []],
    '190 passed a 1.88 m best; 195 did not pass a 1.98 m one, and only equalled the 1.95 m SB',
  );
  // The same bests written in centimetres give the same answers.
  const asCm = (a) => bestsParts(a).map((b) => beatsMark(a.Result, b.value.replace('.', ''), etKorkeus.Category));
  assert.deepEqual(korkeusRows.map(asCm), korkeusRows.map(beatenCm));
});
