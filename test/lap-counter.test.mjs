// Tests the lap counter (docs/lap-counter.md). The relay cases are measured
// races, under their own names.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTs } from '../public/lib/dates.js';
import {
  BAND_HOLD_MS,
  BAND_MIN_FIELD,
  BAND_SLOTS,
  BOARD_SWAP_METRES,
  LEAD_METRES,
  SPLIT_MIN_FIELD,
  TAP_GUARD_MS,
  anchorStart,
  bandQueue,
  bandSlots,
  boardLeader,
  correctedStart,
  crossingsFor,
  crossingsOf,
  defaultTrack,
  deriveLaps,
  dropIndex,
  finishText,
  firstSegment,
  fmtElapsed,
  fmtShift,
  handTimeMs,
  heatLapMs,
  isShuttleRelay,
  isTrackLength,
  lapPrompts,
  lapTimeMs,
  lapsBehind,
  lapsHelp,
  legCrossings,
  medianOf,
  movedOrder,
  myRows,
  nextCall,
  packCrossings,
  raceDistance,
  raceOrder,
  refreshesSnapshot,
  reorderCrossing,
  reorderSpans,
  repairTime,
  sortTiles,
  startNote,
  startsClock,
  tapGuardMs,
  tileAnchor,
  tileDensity,
} from '../public/lib/lap-counter.js';
import { heatWind, overallPlaces, parseResult, relayLegCount, relayLegs, relayLineup } from '../public/lib/results.js';
import { API, groupRounds } from '../public/lib/schedule.js';
import { DEMO_ID, demoResponse, demoSchedule } from '../public/demo.js';

// --- the counting starts: the lap counter's relays (e12-e15) and its
// individual race (e16), read the way renderLaps reads them ---
test('counting starts', () => {
  const schedule = demoSchedule();
  const day = Object.keys(schedule)[0];
  const groups = groupRounds(schedule[day]);
  // Each start has one category, and its schedule row names the round, as
  // loadGroup resolves it.
  const start = (event) => {
    const [entry] = groups.find((g) => g.event === event).entries;
    const data = demoResponse(`${API}/results/${DEMO_ID}/${entry.round.EventId}`);
    const round = data.Rounds.find((r) => r.Id === entry.round.Id);
    return { data, round, allocs: round.Heats[0].Allocations };
  };

  // Over many crossings a tile is named by its bib, since the lanes stop
  // meaning anything (tileAnchor).
  {
    const { data, round, allocs } = start('4x800m viesti');
    const dist = raceDistance(data.EventType, data.Name);
    assert.equal(dist, 3200, 'four 800 m legs');
    assert.equal(crossingsFor(dist, 400), 8);
    assert.equal(crossingsFor(dist, 200), 16);
    assert.equal(round.Status, 'Allocated', 'drawn, not run — the state the counter opens on');
    const rows = allocs.map((a) => ({ id: a.Id, lane: a.Position, bib: a.Number }));
    assert.equal(tileAnchor(rows[0], crossingsFor(dist, 400)), '#911');
    const events = [];
    let t = 0;
    for (let lap = 0; lap < 8; lap += 1) for (const r of rows) events.push({ id: r.id, t: (t += 10_000) });
    const { byId, finished } = deriveLaps(events, 8);
    assert.deepEqual(
      finished,
      rows.map((r) => r.id),
      'every team finishes, in tap order',
    );
    assert.deepEqual(
      raceOrder(rows, byId).map((r) => r.id),
      finished,
      'and the standings agree with the finish once everyone is home',
    );
  }

  // The shuttle relay's 240 m is two crossings in a hall by arithmetic, but
  // the team crosses the line once.
  {
    const { data, round, allocs } = start('4x60m aitaviesti');
    const dist = raceDistance(data.EventType, data.Name);
    assert.equal(dist, 240);
    assert.equal(isShuttleRelay(data.EventType, data.Name), true);
    assert.equal(crossingsFor(dist, 200), 2, 'the arithmetic on its own, which is the bug');
    assert.equal(crossingsFor(dist, 200, true), 1, 'one crossing in a hall');
    assert.equal(crossingsFor(dist, 400, true), 1, 'and one outdoors');
    // A team runs in two lanes and the API names one
    // (docs/tuloslista-api.md). On one crossing the lane names the tile.
    assert.deepEqual(
      allocs.map((a) => a.Position),
      [2, 4, 6],
    );
    assert.equal(tileAnchor({ lane: 2, bib: 105 }, 1), 'R2');
    // The enrollment carries the whole pool and the allocation the lineup
    // (docs/tuloslista-api.md).
    const legs = relayLegCount(data.EventType, data.Name);
    assert.equal(legs, 4);
    assert.equal(data.Enrollments[1].Athletes.length, 7, 'seven entered');
    assert.deepEqual(
      relayLineup(data.Enrollments[1], legs).map((a) => a.Surname),
      ['Testinen', 'Harjoitinen', 'Demoinen', 'Vauhtinen'],
      'the first four by Index run',
    );
    assert.deepEqual(relayLegs(allocs[1], legs), ['Testinen', 'Harjoitinen', 'Demoinen', 'Vauhtinen']);
    // A 60 m leg is short enough for a wind, so only the Category gate keeps
    // this reading off the page.
    assert.equal(round.Heats[0].Wind, '+1,4', 'the fixture must carry a reading, or the next line proves nothing');
    assert.equal(heatWind(round.Heats[0], data.EventType), null, 'a relay is never wind-legal');
  }

  // The 3x400 m is filed under the 4x400 m type (docs/tuloslista-api.md).
  // Trusting the type adds two laps in a hall.
  {
    const { data, allocs } = start('3x400m viesti');
    assert.equal(data.EventType.TeamSize, 4, 'the type claims four legs');
    assert.equal(relayLegCount(data.EventType, data.Name), 3, 'the name says three');
    assert.equal(relayLegs(allocs[0]).length, 3, 'and the teams run three');
    const dist = raceDistance(data.EventType, data.Name);
    assert.equal(dist, 1200);
    assert.equal(crossingsFor(dist, 200), 6, 'six laps of a hall');
    assert.equal(crossingsFor(raceDistance(data.EventType), 200), 8, 'eight, if the type is believed');
    assert.equal(crossingsFor(dist, 400), 3);
    assert.equal(isShuttleRelay(data.EventType, data.Name), false);
  }

  // The individual race is being run, and its first lap is a part lap.
  {
    const { data, round, allocs } = start('1500m');
    const dist = raceDistance(data.EventType, data.Name);
    assert.equal(dist, 1500);
    assert.equal(round.Status, 'Progress', 'being run, which is when it is counted');
    assert.equal(allocs.length, 8);
    assert.equal(
      allocs.every((a) => a.Result == null),
      true,
      'and nobody has finished',
    );
    assert.equal(crossingsFor(dist, 400), 4);
    assert.equal(crossingsFor(dist, 200), 8);
    assert.equal(firstSegment(dist, 400), 300, 'the opening stretch is not a full lap');

    // Before any crossing a season's best is the only pace there is, and
    // lapPrompts turns it into the wait for the first crossing.
    const rows = allocs.map((a) => ({
      id: a.Id,
      lane: a.Position,
      sbMs: parseResult(a.SB) != null ? parseResult(a.SB) * 10 : null,
    }));
    const fastest = allocs.find((a) => a.SB === '4.18,90');
    assert.ok(fastest, 'the seeded runner is in the field');
    const seeded = lapPrompts(rows, new Map(), {
      total: 4,
      distance: dist,
      track: 400,
      startTs: 0,
      now: 1000,
    }).get(fastest.Id);
    assert.equal(Math.round(seeded.lapMs / 100) / 10, 69, 'lap pace from the seed time');
    assert.equal(Math.round(seeded.eta / 1000), 52, 'the opening 300 m at that pace');
    assert.deepEqual(seeded.call, { kind: 'laps', laps: 3 });
    // A runner with no SB gets no estimate.
    const unseeded = lapPrompts(rows, new Map(), { total: 4, distance: dist, track: 400, now: 1000 }).get(
      allocs.find((a) => !a.SB).Id,
    );
    assert.equal(unseeded.state, 'unknown');
  }

  // In a hall the 3x600m hands over at the 3rd and 6th crossings, and each
  // team's next runner gets a lap of warning.
  {
    const { data, allocs } = start('3x600m viesti');
    const dist = raceDistance(data.EventType, data.Name);
    const legs = relayLegCount(data.EventType, data.Name);
    assert.equal(dist, 1800);
    assert.equal(legs, 3);
    assert.equal(allocs.length, 11, 'eleven teams, as in the measured heat');
    const total = crossingsFor(dist, 200);
    const perLeg = legCrossings(dist, 200, legs);
    assert.equal(total, 9);
    assert.equal(perLeg, 3);
    // One team is counted through the race, reading the call at each step.
    const me = { id: allocs[0].Id, lane: allocs[0].Position };
    const events = [];
    const kinds = [];
    for (let c = 0; c < total; c += 1) {
      const { byId } = deriveLaps(events, total);
      kinds.push(lapPrompts([me], byId, { total, distance: dist, track: 200, perLeg }).get(me.id).call.kind);
      events.push({ id: me.id, t: (c + 1) * 40_000 });
    }
    assert.deepEqual(
      kinds,
      ['laps', 'laps', 'exchange', 'laps', 'laps', 'exchange', 'laps', 'bell', 'finish'],
      'the handovers land where the legs end',
    );
    const { byId } = deriveLaps(events, total);
    assert.equal(byId.get(me.id).count, total);
    assert.equal(
      lapPrompts([me], byId, { total, distance: dist, track: 200, perLeg }).get(me.id).state,
      'finished',
      'and the prompt stops asking for anything',
    );
    // Outdoors a 600 m leg is one and a half laps, so no handover is at the
    // line.
    assert.equal(legCrossings(dist, 400, legs), 0);
  }
});

// --- raceDistance + crossings, over every relay of two real meets (a relay's
// Length is one leg, docs/tuloslista-api.md) ---
test('raceDistance', () => {
  const relay = (name, TeamSize, Length) => raceDistance({ Category: 'Relay', TeamSize, Length, Name: name });
  const cases = [
    // name,            teamSize, leg, total, on 400 m, on 200 m
    // The aitaviesti rows are the arithmetic alone. A shuttle relay is one
    // crossing (isShuttleRelay, below).
    ['4x50m viesti', 4, 50, 200, 1, 1],
    ['4x60m aitaviesti', 4, 60, 240, 1, 2],
    ['4x80m aitaviesti', 4, 80, 320, 1, 2],
    ['4x100m viesti', 4, 100, 400, 1, 2],
    ['4x200m viesti', 4, 200, 800, 2, 4],
    ['4x400m viesti', 4, 400, 1600, 4, 8],
    ['4x600m viesti', 4, 600, 2400, 6, 12],
    ['4x800m viesti', 4, 800, 3200, 8, 16],
  ];
  for (const [name, size, leg, total, on400, on200] of cases) {
    assert.equal(relay(name, size, leg), total, `${name} distance`);
    assert.equal(crossingsFor(total, 400), on400, `${name} on a 400 m track`);
    assert.equal(crossingsFor(total, 200), on200, `${name} on a 200 m track`);
  }
  // An individual event's race distance is its Length.
  assert.equal(raceDistance({ Category: 'Track', TeamSize: 1, Length: 1500 }), 1500);
  assert.equal(raceDistance(undefined), 0);
  // Without TeamSize the type's name or code gives the legs.
  assert.equal(raceDistance({ Category: 'Relay', Length: 400, Name: '4x400m viesti' }), 1600);
  assert.equal(raceDistance({ Category: 'Relay', Length: 400, Code: '4x400mr' }), 1600);
  // A plain 400 m is never multiplied.
  assert.equal(raceDistance({ Category: 'Track', Length: 400, Name: '400m' }), 400);

  // A P9 3x400m viesti can be filed under the 4x400 m EventType
  // (docs/tuloslista-api.md, "Relays"). The event's name gives the legs.
  const mistyped = {
    Category: 'Relay',
    SubCategory: 'Sprint',
    TeamSize: 4,
    Length: 400,
    Name: '4x400m viesti',
    Code: '4x400mr',
  };
  assert.equal(raceDistance(mistyped), 1600, 'the type on its own is wrong');
  assert.equal(raceDistance(mistyped, 'P9 3x400m viesti'), 1200);
  assert.equal(crossingsFor(raceDistance(mistyped, 'P9 3x400m viesti'), 200), 6);
  // The same override leaves an agreeing name alone, and both spellings of
  // a series name parse the same.
  assert.equal(raceDistance({ Category: 'Relay', TeamSize: 4, Length: 100 }, 'Mixed 15 4x100m viesti'), 400);
  assert.equal(raceDistance({ Category: 'Relay', TeamSize: 4, Length: 100 }, 'Mixed15 4x100m viesti'), 400);
  // A Track event's name is not read for legs, even one holding an NxM.
  assert.equal(raceDistance({ Category: 'Track', TeamSize: 1, Length: 1500 }, 'M 1500m'), 1500);
  assert.equal(raceDistance({ Category: 'Track', TeamSize: 1, Length: 1500 }, 'M 4x100m'), 1500);
});

// --- Splitting a field between counters ---
test('myRows', () => {
  const rows = [1, 2, 3, 4, 5].map((id) => ({ id, name: `R${id}` }));
  const ids = (rs) => rs.map((r) => r.id);

  // The subset keeps the roster's order, whatever order it was picked in.
  assert.deepEqual(ids(myRows(rows, [4, 1])), [1, 4]);
  assert.deepEqual(ids(myRows(rows, [3])), [3]);

  // Nobody picked means the whole field.
  assert.deepEqual(ids(myRows(rows, [])), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(myRows(rows, null)), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(myRows(rows, undefined)), [1, 2, 3, 4, 5]);

  // A selection off a re-fetched roster, with new allocation ids, matches
  // nobody and shows the whole field.
  assert.deepEqual(ids(myRows(rows, [91, 92])), [1, 2, 3, 4, 5], 'a stale selection is not an empty grid');
  // A half-stale one keeps what still exists.
  assert.deepEqual(ids(myRows(rows, [2, 91])), [2]);

  // Two counters with disjoint picks cover the field once between them.
  const a = myRows(rows, [1, 2, 3]);
  const b = myRows(rows, [4, 5]);
  assert.deepEqual([...ids(a), ...ids(b)].sort(), [1, 2, 3, 4, 5]);
  assert.equal(
    ids(a).some((id) => ids(b).includes(id)),
    false,
    'disjoint',
  );
});

// --- The counter's roster snapshot ---
test('refreshesSnapshot', () => {
  const heats = [{ index: 1, rows: [{ id: 1 }] }];
  const stored = { heats };
  const both = [{ data: {} }, { data: {} }];
  const oneFailed = [{ data: {} }, { data: null }];
  assert.equal(refreshesSnapshot(both, heats, stored), true);
  // Over a stored roster, a failed category would take its competitors off
  // the grid, and undrawn shells would leave no tiles.
  assert.equal(refreshesSnapshot(oneFailed, heats, stored), false);
  assert.equal(refreshesSnapshot(both, [], stored), false);
  assert.equal(refreshesSnapshot([{ data: null }], [], stored), false);
  // With nothing stored, any category that answered is better than none.
  assert.equal(refreshesSnapshot(oneFailed, heats, undefined), true);
  assert.equal(refreshesSnapshot(oneFailed, heats, { heats: [] }), true);
  assert.equal(refreshesSnapshot([{ data: null }], [], undefined), false);
});

// --- lapsHelp: the ? explains this screen and no other ---
test('lapsHelp', () => {
  const terms = (opts) => lapsHelp(opts).map(([term]) => term);
  const what = (opts, term) => lapsHelp(opts).find(([t]) => t === term)?.[1] ?? '';

  // The help leaves out what a race settled on one crossing never shows.
  const sprint = terms({ total: 1, perLeg: 0, biggestHeat: 8 });
  for (const gone of ['Iso numero', '🔔', '🏁', '🤝', 'Kierrostaulu', '👥 Omat']) {
    assert.equal(sprint.includes(gone), false, `${gone} has no place in a one-crossing race`);
  }
  // What is left still says how to tap, in the sprint's own way.
  assert.deepEqual(sprint, ['Kello', 'Ruutu', 'Alarivi', 'Lista']);
  assert.match(what({ total: 1 }, 'Ruutu'), /maaliintulojärjestyksessä/);
  assert.match(what({ total: 4 }, 'Ruutu'), /jokaisella ylityksellä/);

  // A distance race has the bell and the board but no handover.
  const race = terms({ total: 12, perLeg: 0, biggestHeat: 12 });
  assert.equal(race.includes('🔔'), true);
  assert.equal(race.includes('Kierrostaulu'), true);
  assert.equal(race.includes('🤝'), false, '🤝 never appears where nothing hands over');
  // Nor does a relay whose handovers are not at the line (perLeg 0).
  assert.equal(terms({ total: 6, perLeg: 0 }).includes('🤝'), false);
  assert.equal(terms({ total: 6, perLeg: 3 }).includes('🤝'), true);
  // The 🤝 comes before the 🔔, and both come before the 🏁.
  const relay = terms({ total: 6, perLeg: 3 });
  assert.ok(relay.indexOf('🤝') < relay.indexOf('🔔'));
  assert.ok(relay.indexOf('🔔') < relay.indexOf('🏁'));

  // The split is explained from the heat size at which its chip is drawn.
  assert.equal(SPLIT_MIN_FIELD, 6);
  assert.equal(terms({ total: 12, biggestHeat: 5 }).includes('👥 Omat'), false);
  assert.equal(terms({ total: 12, biggestHeat: 6 }).includes('👥 Omat'), true);
  // The pack chip shows in any race with laps, whatever the heat's size.
  assert.equal(terms({ total: 12, biggestHeat: 2 }).includes('⏱ kirjaamatta'), true);
  // The band is explained from the heat size at which the view draws it.
  assert.equal(BAND_MIN_FIELD, 9);
  assert.equal(terms({ total: 12, biggestHeat: 8 }).includes('Ylärivi'), false);
  assert.equal(terms({ total: 12, biggestHeat: 9 }).includes('Ylärivi'), true);
  assert.equal(terms({ total: 1, biggestHeat: 12 }).includes('Ylärivi'), false);

  // An empty term would leave its meaning in a column of its own.
  for (const total of [1, 6]) {
    for (const [term, meaning] of lapsHelp({ total, perLeg: 3, biggestHeat: 9 })) {
      assert.equal(typeof term === 'string' && term.length > 0, true);
      assert.equal(typeof meaning === 'string' && meaning.length > 2, true);
    }
  }
});

// --- Shuttle relays: the 4x60m aitaviesti ---
test('shuttle relays', () => {
  const shuttle = {
    Category: 'Relay',
    SubCategory: 'Hurdles',
    TeamSize: 4,
    Length: 60,
    Name: '4x60m aitaviesti',
  };
  assert.equal(isShuttleRelay(shuttle, 'P11 4x60m aitaviesti'), true);
  // The sub-category alone is enough, and so is the name alone.
  assert.equal(isShuttleRelay({ Category: 'Relay', SubCategory: 'Hurdles', TeamSize: 4, Length: 60 }), true);
  assert.equal(isShuttleRelay({ Category: 'Relay', TeamSize: 4, Length: 80 }, 'P13 4x80m aitaviesti'), true);
  // A flat one is filed as a plain relay, and only its name says shuttle.
  const flat = { Category: 'Relay', SubCategory: 'Sprint', TeamSize: 16, Length: 60, Name: '16x60m viesti' };
  assert.equal(isShuttleRelay(flat, 'Sukkulaviesti 16x60m'), true, '20651');
  // A relay run round the track is not a shuttle, whatever the distance...
  assert.equal(
    isShuttleRelay({ Category: 'Relay', SubCategory: 'Sprint', TeamSize: 4, Length: 200 }, 'P9 4x200m viesti'),
    false,
  );
  assert.equal(
    isShuttleRelay({ Category: 'Relay', SubCategory: 'Run', TeamSize: 3, Length: 600 }, 'P11 3x600m viesti'),
    false,
  );
  // ...and neither is an individual hurdles race, which is not a relay.
  assert.equal(
    isShuttleRelay({ Category: 'Track', SubCategory: 'Hurdles', TeamSize: 1, Length: 60 }, 'P11 60m aidat'),
    false,
  );
  assert.equal(isShuttleRelay(undefined), false);

  // 240 m on a 200 m track computes to two crossings, and a shuttle is one.
  assert.equal(crossingsFor(240, 200), 2, 'the arithmetic on its own is wrong');
  assert.equal(crossingsFor(240, 200, true), 1);
  assert.equal(crossingsFor(240, 400, true), 1);
  // One crossing means the lane names the team, though these teams carry
  // bibs (docs/tuloslista-api.md, "Categories, names and identity").
  assert.equal(tileAnchor({ lane: 4, bib: '57' }, crossingsFor(240, 200, true)), 'R4');
});

// --- which number names a competitor on a tile ---
test('tileAnchor + sortTiles', () => {
  const withBoth = { bib: 101, lane: 3 };
  const noBib = { bib: null, lane: 5 };
  // Over several laps the bib names the competitor.
  assert.equal(tileAnchor(withBoth, 4), '#101');
  // On one crossing the lane does.
  assert.equal(tileAnchor(withBoth, 1), 'R3');
  // Whichever one exists names them, as on a sprint relay.
  assert.equal(tileAnchor(noBib, 4), 'R5');
  assert.equal(tileAnchor({ bib: 7, lane: null }, 1), '#7');
  assert.equal(tileAnchor({}, 4), '?');

  // Tiles sort by the number that names them.
  const rows = [
    { bib: 12, lane: 1 },
    { bib: 9, lane: 2 },
    { bib: 101, lane: 3 },
  ];
  assert.deepEqual(
    sortTiles(rows, 4).map((r) => r.bib),
    [9, 12, 101],
    'bib order, numeric',
  );
  assert.deepEqual(
    sortTiles(rows, 1).map((r) => r.lane),
    [1, 2, 3],
    'lane order',
  );
  // A bibless field sorts by lane at any lap count.
  const bibless = [
    { bib: null, lane: 3 },
    { bib: null, lane: 1 },
  ];
  assert.deepEqual(
    sortTiles(bibless, 8).map((r) => r.lane),
    [1, 3],
  );
  // A field with some bibs missing puts the bibs first and the rest in lane
  // order. Choosing bib or lane per pair makes the comparator intransitive.
  const mixed = [
    { bib: 12, lane: 3 },
    { bib: null, lane: 1 },
    { bib: 5, lane: 2 },
    { bib: null, lane: 4 },
  ];
  assert.deepEqual(
    sortTiles(mixed, 8).map((r) => r.bib ?? `L${r.lane}`),
    [5, 12, 'L1', 'L4'],
    'bibs first, then bibless by lane',
  );
});

// --- tileDensity: the grid follows the field, never the viewport's height ---
test('tileDensity', () => {
  // The column tiers are tileDensity's own.
  for (const [tiles, density] of [
    [1, 2],
    [8, 2],
    [9, 3],
    [15, 3],
    [16, 4],
    [24, 4],
  ]) {
    assert.equal(tileDensity(tiles), density, `${tiles} tiles`);
  }
  // The band starts where the grid stops being two columns.
  assert.equal(tileDensity(BAND_MIN_FIELD - 1), 2);
  assert.equal(tileDensity(BAND_MIN_FIELD), 3);
});

// --- lap counter ---
assert.equal(crossingsFor(400), 1);
assert.equal(crossingsFor(800), 2);
assert.equal(crossingsFor(1500), 4);
// A hall's own lap divides the same way, whole metres or not.
assert.equal(crossingsFor(1500, 170), 9);
assert.equal(firstSegment(1500, 170), 140);
assert.equal(crossingsFor(800, 300), 3);
assert.equal(firstSegment(800, 300), 200);
assert.equal(crossingsFor(1500, 325.33), 5);
assert.ok(Math.abs(firstSegment(1500, 325.33) - 198.68) < 1e-9);
assert.equal(legCrossings(1200, 300, 4), 1, 'a 4x300 m on 300 m hands over at the line');
assert.equal(legCrossings(2400, 170, 4), 0, 'a 4x600 m on 170 m does not');
// (Break on purpose: let isTrackLength take a straight, two laps or a string.)
for (const n of [400, 200, 170, 300, 325.33, 304.1]) assert.ok(isTrackLength(n), `${n} m`);
for (const n of [60, 800, '200', NaN, null, undefined]) assert.ok(!isTrackLength(n), `${n}`);
assert.equal(crossingsFor(3000), 8);
assert.equal(crossingsFor(5000), 13);
assert.equal(crossingsFor(10000), 25);
assert.equal(crossingsFor(200, 200), 1);
assert.equal(crossingsFor(800, 200), 4);
assert.equal(crossingsFor(1500, 200), 8);
assert.equal(crossingsFor(3000, 200), 15);

// The season picks the track a meet opens on. Both edges of both seasons are
// tested, so an off-by-one month fails.
test('defaultTrack', () => {
  const on = (y, m, d) => defaultTrack(new Date(y, m - 1, d));
  assert.equal(on(2026, 5, 1), 400, 'the outdoor season opens on 1 May');
  assert.equal(on(2026, 7, 15), 400);
  assert.equal(on(2026, 9, 30), 400, 'the outdoor season runs to the end of September');
  assert.equal(on(2026, 10, 1), 200, 'the indoor season opens on 1 October');
  assert.equal(on(2026, 12, 31), 200, 'the indoor season carries over the year');
  assert.equal(on(2027, 1, 1), 200);
  assert.equal(on(2027, 4, 30), 200, 'the indoor season runs to the end of April');
  // The app calls it on a parsed API timestamp.
  assert.equal(defaultTrack(parseTs('2026-02-14T13:05:00.0000000+00:00')), 200);
  assert.equal(defaultTrack(parseTs('2026-07-31T13:05:00.0000000+00:00')), 400);
  // A start with no readable date falls back to the outdoor track.
  assert.equal(defaultTrack(parseTs('')), 400);
  assert.equal(defaultTrack(undefined), 400);
  assert.equal(defaultTrack(null), 400);
});

test('crossingsFor + deriveLaps', () => {
  // b finishes first, and a's tap after finishing is ignored.
  const events = [
    { id: 'a', t: 100 },
    { id: 'b', t: 110 },
    { id: 'b', t: 200 },
    { id: 'a', t: 210 },
    { id: 'a', t: 220 },
  ];
  const { byId, finished } = deriveLaps(events, 2);
  assert.deepEqual(finished, ['b', 'a']);
  assert.equal(byId.get('b').pos, 1);
  assert.equal(byId.get('a').pos, 2);
  assert.equal(byId.get('a').finishT, 210);
  assert.equal(byId.get('a').count, 2);
  // Undo pops the last event and derives again.
  const undone = deriveLaps(events.slice(0, -1), 2);
  assert.deepEqual(undone.finished, ['b', 'a']);
  assert.equal(deriveLaps(events.slice(0, 3), 2).finished.length, 1);
});

// --- Correcting the order the boxes were tapped in ---
// A reorder hands the crossings' times round between the competitors
// (docs/lap-counter.md).
test('Correcting the order the boxes were tapped in', () => {
  const total = 2;
  const events = [
    { id: 'a', t: 1000 },
    { id: 'b', t: 1100 },
    // b was tapped first at the finish, but a crossed first.
    { id: 'b', t: 60_000 },
    { id: 'a', t: 60_400 },
  ];
  const plain = deriveLaps(events, total);
  assert.deepEqual(plain.finished, ['b', 'a']);

  const fixed = deriveLaps([...events, { order: ['a', 'b'], n: 2, t: 70_000 }], total);
  assert.deepEqual(fixed.finished, ['a', 'b'], 'the order the operator says it was');
  assert.equal(fixed.byId.get('a').finishT, 60_000, 'and the earlier time went with the place');
  assert.equal(fixed.byId.get('b').finishT, 60_400);
  assert.equal(fixed.byId.get('a').pos, 1);
  assert.equal(fixed.byId.get('b').pos, 2);
  assert.deepEqual(
    [...plain.byId.values()].flatMap((st) => st.times).sort((x, y) => x - y),
    [...fixed.byId.values()].flatMap((st) => st.times).sort((x, y) => x - y),
    'a reorder never changes what was recorded, only whose it is',
  );
  // The crossings before the corrected one are untouched.
  assert.deepEqual(fixed.byId.get('a').times, [1000, 60_000]);
  assert.deepEqual(fixed.byId.get('b').times, [1100, 60_400]);

  // A reorder is a log entry, so undo pops it.
  const undone = deriveLaps([...events, { order: ['a', 'b'], n: 2, t: 70_000 }].slice(0, -1), total);
  assert.deepEqual(undone.finished, ['b', 'a'], 'undo puts the tapped order back');
  // Each reorder applies to the state as it stands, so a later one wins.
  const back = deriveLaps(
    [...events, { order: ['a', 'b'], n: 2, t: 70_000 }, { order: ['b', 'a'], n: 2, t: 71_000 }],
    total,
  );
  assert.deepEqual(back.finished, ['b', 'a']);
  assert.equal(back.byId.get('b').finishT, 60_000, 'the times followed back too');

  // Mid-race the standings follow the last crossing's times, so a reorder
  // there fixes the list.
  {
    const rows = [
      { id: 'a', lane: 1 },
      { id: 'b', lane: 2 },
    ];
    const mid = [
      { id: 'b', t: 60_000 },
      { id: 'a', t: 60_300 },
    ];
    assert.deepEqual(
      raceOrder(rows, deriveLaps(mid, 4).byId).map((r) => r.id),
      ['b', 'a'],
    );
    const swapped = deriveLaps([...mid, { order: ['a', 'b'], n: 1, t: 61_000 }], 4);
    assert.deepEqual(
      raceOrder(rows, swapped.byId).map((r) => r.id),
      ['a', 'b'],
    );
    assert.equal(swapped.byId.get('a').count, 1, 'and nobody gained or lost a crossing');
    assert.equal(swapped.byId.get('b').count, 1);
  }

  // A repaired crossing's ~ belongs to the time and changes hands with it.
  {
    const est = [
      { id: 'a', t: 60_000, est: true },
      { id: 'b', t: 60_400 },
    ];
    const before = deriveLaps(est, 1);
    assert.equal(before.byId.get('a').est, true);
    assert.equal(before.byId.get('b').est, undefined);
    const after = deriveLaps([...est, { order: ['b', 'a'], n: 1, t: 61_000 }], 1).byId;
    assert.equal(after.get('b').est, true, "the estimated time is now b's");
    assert.equal(after.get('a').est, undefined);
  }
});

// reorderCrossing refuses what is not a mis-tap and changes nothing.
test('reorderCrossing refuses what is not a mis-tap and changes nothing', () => {
  const byId = deriveLaps(
    [
      { id: 'a', t: 1000 },
      { id: 'b', t: 1100 },
      { id: 'a', t: 61_000 },
      { id: 'b', t: 61_200 },
    ],
    4,
  ).byId;
  assert.equal(reorderCrossing(byId, ['a'], 2), false, 'one competitor is not an order');
  assert.equal(reorderCrossing(byId, ['a', 'zz'], 2), false, 'somebody who is not in the race');
  assert.equal(reorderCrossing(byId, ['a', 'b'], 3), false, 'a crossing neither has run yet');
  assert.deepEqual(byId.get('a').times, [1000, 61_000], 'and a refusal changes nothing');
  assert.equal(reorderCrossing(byId, ['b', 'a'], 2), true);
  assert.deepEqual(byId.get('b').times, [1100, 61_000]);
  assert.deepEqual(byId.get('a').times, [1000, 61_200]);
});
test('reorderCrossing', () => {
  // Two runners a lap apart share a crossing number but not a moment.
  // Swapping them would give b a negative lap, so it is refused.
  const events = [
    { id: 'a', t: 20_000 },
    { id: 'a', t: 100_000 },
    { id: 'b', t: 110_000 },
    { id: 'b', t: 200_000 },
  ];
  const byId = deriveLaps(events, 4).byId;
  assert.equal(reorderCrossing(byId, ['b', 'a'], 2), false);
  assert.deepEqual(byId.get('a').times, [20_000, 100_000], 'refused whole');
  assert.deepEqual(byId.get('b').times, [110_000, 200_000]);
  // The log entry is inert if it ever gets written anyway.
  assert.deepEqual(
    deriveLaps([...events, { order: ['b', 'a'], n: 2, t: 210_000 }], 4).byId.get('a').times,
    [20_000, 100_000],
  );
});

// --- reorderSpans: who may be dragged past whom ---
test('reorderSpans', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  // a and b share one count, c and d another, and e has nothing tapped.
  const byId = new Map([
    ['a', { count: 3 }],
    ['b', { count: 3 }],
    ['c', { count: 2 }],
    ['d', { count: 2 }],
    ['e', { count: 0 }],
  ]);
  assert.deepEqual(reorderSpans(rows, byId), [
    [0, 2],
    [2, 4],
  ]);
  // Untapped rows have no order to correct, and nor does a lone competitor
  // on a count of their own.
  assert.deepEqual(reorderSpans([{ id: 'a' }, { id: 'c' }, { id: 'e' }], byId), []);
  // A competitor out of the race is in no span, whether behind a runner or
  // leading the run.
  assert.deepEqual(reorderSpans(rows, byId, { b: 'DNF' }), [[2, 4]]);
  assert.deepEqual(reorderSpans(rows, byId, { a: 'DNF' }), [[2, 4]]);
  assert.deepEqual(
    reorderSpans(rows, byId, { a: 'DNF', b: 'DQ' }),
    [[2, 4]],
    'two who are out are not an order either',
  );
  assert.deepEqual(reorderSpans([], byId), []);
});

// --- dropIndex + movedOrder: where a dragged row lands ---
test('dropIndex', () => {
  const h = [40, 40, 40, 40];
  assert.equal(dropIndex(0, h, 0), 0);
  assert.equal(dropIndex(0, h, 19), 0, 'not yet past the midpoint of the next row');
  assert.equal(dropIndex(0, h, 20), 1, 'past it, so it takes that place');
  assert.equal(dropIndex(0, h, 59), 1);
  assert.equal(dropIndex(0, h, 60), 2);
  assert.equal(dropIndex(0, h, 5000), 3, 'and never past the end of its span');
  assert.equal(dropIndex(3, h, -20), 2);
  assert.equal(dropIndex(3, h, -5000), 0);
  // Row heights differ where a name wraps, so each row's own height counts.
  assert.equal(dropIndex(0, [40, 80, 40], 30), 0, 'a tall row takes longer to pass');
  assert.equal(dropIndex(0, [40, 80, 40], 41), 1);

  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(movedOrder(rows, 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(movedOrder(rows, 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(movedOrder(rows, 1, 1), ['a', 'b', 'c']);
});

// --- fmtElapsed ---
// A hand time rounds up to the next tenth (World Athletics).
assert.equal(fmtElapsed(12399), '12,4', '12.399 s rounds up to 12,4, not down to 12,3');
assert.equal(fmtElapsed(12301), '12,4', 'even one ms past the tenth rounds up');
assert.equal(fmtElapsed(12300), '12,3', 'an exact tenth is not bumped to the next one');
assert.equal(fmtElapsed(0), '0,0');
assert.equal(fmtElapsed(1), '0,1', '1 ms already owes the next tenth');
assert.equal(fmtElapsed(65_001), '1.05,1', 'minutes appear once the race passes 60 s');

// --- raceOrder ---
test('raceOrder', () => {
  const rows = [
    { id: 'a', lane: 1 },
    { id: 'b', lane: 2 },
    { id: 'c', lane: 3 },
    { id: 'd', lane: 4 },
  ];
  const events = [
    { id: 'b', t: 100 },
    { id: 'a', t: 110 },
    { id: 'a', t: 200 },
    { id: 'b', t: 210 },
    { id: 'c', t: 220 },
  ];
  // a reached 2 crossings before b, c has 1 and d none.
  const { byId } = deriveLaps(events, 3);
  assert.deepEqual(
    raceOrder(rows, byId).map((r) => r.id),
    ['a', 'b', 'c', 'd'],
  );
  // A finisher moves ahead of everyone, in finish order.
  const done = deriveLaps([...events, { id: 'b', t: 300 }], 3);
  assert.deepEqual(
    raceOrder(rows, done.byId).map((r) => r.id),
    ['b', 'a', 'c', 'd'],
  );
  // With no taps the rows keep lane order.
  assert.deepEqual(
    raceOrder(rows, deriveLaps([], 3).byId).map((r) => r.id),
    ['a', 'b', 'c', 'd'],
  );
  // A missing lane sorts as 0. An absent lane, unlike a null one, would
  // make the comparison NaN.
  const laneless = [{ id: 'y', lane: 2 }, { id: 'x' }];
  assert.deepEqual(
    raceOrder(laneless, deriveLaps([], 3).byId).map((r) => r.id),
    ['x', 'y'],
  );
});

// --- parseResult (hundredths of a second) ---
assert.equal(parseResult('26,14'), 2614);
assert.equal(parseResult('9,01'), 901);
assert.equal(parseResult('2.05,3'), 12530); // one decimal is tenths
assert.equal(parseResult('31.05,44'), 186544);
assert.equal(parseResult('DNS'), null);
assert.equal(parseResult(''), null);
assert.equal(parseResult(null), null);

// --- overallPlaces (merged-field places across categories) ---
// Equal times share a place and the next one skips past them.
assert.deepEqual(
  overallPlaces([2691, 2744, 2744, 2908, null]),
  [1, 2, 2, 4, null],
  'a tie is 2., 2., 4. — never 2., 3.',
);
assert.deepEqual(overallPlaces([1200, 1200]), [1, 1]);
assert.deepEqual(overallPlaces([null, null]), [null, null]);
assert.deepEqual(overallPlaces([]), []);

// --- finishText (a finish time only when the clock covers it) ---
assert.equal(finishText(1000, { finishT: 13400 }), '12,4');
assert.equal(
  finishText(1000, { finishT: 13400, est: true }),
  '~12,4',
  'a time resting on a repaired crossing carries the ~',
);
assert.equal(finishText(null, { finishT: 13400 }), null, 'clock never started');
assert.equal(finishText(1000, undefined), null, 'no crossings at all');
assert.equal(finishText(20000, { finishT: 13400 }), null, 'clock started after the finish: no negative-time garbage');

// --- lap prompting ---
test('lap timing', () => {
  // The opening stretch is not a full lap.
  assert.equal(firstSegment(1500, 400), 300);
  assert.equal(firstSegment(3000, 400), 200);
  assert.equal(firstSegment(800, 400), 400, 'an exact multiple opens on a full lap');
  assert.equal(firstSegment(5000, 400), 200);
  assert.equal(firstSegment(1500, 200), 100);

  assert.equal(medianOf([]), null);
  assert.equal(medianOf([5]), 5);
  assert.equal(medianOf([9, 1, 5]), 5, 'unsorted input');
  assert.equal(medianOf([1, 3, 5, 7]), 4);

  // The call is the number of laps left after the coming crossing.
  assert.deepEqual(nextCall(0, 4), { kind: 'laps', laps: 3 });
  assert.deepEqual(nextCall(2, 4), { kind: 'bell' }, 'the bell rings on the crossing that starts the last lap');
  assert.deepEqual(nextCall(3, 4), { kind: 'finish' });
  assert.equal(nextCall(4, 4), null, 'already finished');
  assert.deepEqual(nextCall(0, 1), { kind: 'finish' }, 'a single-crossing race');

  // A relay's handovers as a youth 3x600 m runs them in a hall, three laps a
  // leg (docs/lap-counter.md, "The changeover").
  {
    const perLeg = legCrossings(1800, 200, 3);
    assert.equal(perLeg, 3, 'three hall laps to a leg');
    const kinds = [];
    for (let c = 0; c < 9; c += 1) kinds.push(nextCall(c, 9, perLeg).kind);
    assert.deepEqual(kinds, [
      'laps',
      'laps',
      'exchange', // leg 1 hands over on its 3rd crossing
      'laps',
      'laps',
      'exchange', // leg 2
      'laps',
      'bell',
      'finish', // leg 3 ends the race
    ]);
    // The 🤝 shows a lap before the exchange. `next` is the leg about to
    // start, the runner to send.
    assert.deepEqual(nextCall(2, 9, perLeg), { kind: 'exchange', leg: 1, next: 2 });
    assert.deepEqual(nextCall(5, 9, perLeg), { kind: 'exchange', leg: 2, next: 3 });
    // Without the leg count it is a lap number.
    assert.deepEqual(nextCall(2, 9), { kind: 'laps', laps: 6 });
  }

  // Every crossing is a handover when a leg is one lap, and the bell
  // outranks the one it falls on (docs/lap-counter.md, "The changeover").
  {
    const perLeg = legCrossings(1600, 400, 4);
    assert.equal(perLeg, 1);
    assert.deepEqual(nextCall(0, 4, perLeg), { kind: 'exchange', leg: 1, next: 2 });
    assert.deepEqual(
      nextCall(2, 4, perLeg),
      { kind: 'bell', exchange: true, next: 4 },
      'the bell is not swallowed by the handover',
    );
    assert.deepEqual(nextCall(3, 4, perLeg), { kind: 'finish' }, 'the finish outranks everything');
  }

  // The bell stands alone mid-leg wherever a leg is longer than one lap.
  {
    const perLeg = legCrossings(1800, 200, 3);
    assert.deepEqual(nextCall(7, 9, perLeg), { kind: 'bell' });
    // The two meet only when perLeg is 1, since the bell is at total - 2
    // and total is a whole number of legs.
    for (const [dist, track, legs] of [
      [1800, 200, 3],
      [1200, 200, 3],
      [3200, 400, 4],
      [2400, 400, 4],
    ]) {
      const pl = legCrossings(dist, track, legs);
      const tot = Math.ceil(dist / track);
      assert.equal(nextCall(tot - 2, tot, pl).kind, 'bell', `${dist}/${track}: bell stands alone`);
    }
  }

  // A leg that is not a whole number of laps gets no handover prompts
  // (docs/lap-counter.md, "The changeover").
  assert.equal(legCrossings(1800, 400, 3), 0, '600 m is not a whole 400 m lap');
  assert.equal(legCrossings(1200, 200, 3), 2, 'but a 3x400 m in a hall is');
  assert.equal(legCrossings(3200, 400, 4), 2, 'and a 4x800 m outdoors is');
  // A race of one leg, or with no distance or track, has none.
  assert.equal(legCrossings(3000, 400, 1), 0);
  assert.equal(legCrossings(0, 200, 3), 0);
  assert.equal(legCrossings(1800, 0, 3), 0);

  // The median of the last three laps ignores one shaky tap.
  const t = (...xs) => xs.map((s) => s * 1000);
  assert.equal(lapTimeMs(t(0, 80, 160, 240)), 80_000);
  assert.equal(lapTimeMs(t(0, 80, 81, 161)), 80_000, 'a double tap does not drag the estimate');
  // With one crossing it scales the opening segment up to a full lap.
  assert.equal(lapTimeMs(t(60), { startTs: 0, distance: 1500, track: 400 }), 80_000, '300 m in 60 s is an 80 s lap');
  // With nothing tapped, the seed time stands in.
  assert.equal(
    lapTimeMs([], { distance: 3000, track: 400, seedMs: 600_000 }),
    80_000,
    '3000 m in 10:00 is an 80 s lap',
  );
  assert.equal(lapTimeMs([]), null, 'and otherwise there is no estimate');

  // The lap window never crosses a handover (docs/lap-counter.md, "Being
  // ready 30–40 m out"). The legs here run 40 s, 55 s and 48 s laps.
  {
    const at = [];
    let now = 0;
    for (const lap of [40, 40, 40, 55, 55, 55, 48, 48, 48]) at.push((now += lap * 1000));
    const est = (n, opts) => lapTimeMs(at.slice(0, n), opts) / 1000;

    // The first lap of a new leg reads the new runner alone.
    assert.equal(est(4), 40, 'without perLeg the previous child is still predicting');
    assert.equal(est(4, { perLeg: 3 }), 55, 'with it, the child actually running');
    assert.equal(est(7), 55, 'and again at the second handover');
    assert.equal(est(7, { perLeg: 3 }), 48);

    // Inside a leg both agree.
    for (const n of [2, 3, 5, 6, 8, 9]) {
      assert.equal(est(n, { perLeg: 3 }), est(n), `crossing ${n} is unchanged`);
    }

    // At the handover the new runner has no lap, so the team's history
    // stands in.
    assert.equal(est(3, { perLeg: 3 }), 40, 'no laps of her own yet');
    assert.equal(est(6, { perLeg: 3 }), 55);

    // On a two-lap leg (4x800 m outdoors) the new leg's first lap stands
    // alone.
    const two = [];
    now = 0;
    for (const lap of [60, 60, 90, 90]) two.push((now += lap * 1000));
    assert.equal(lapTimeMs(two.slice(0, 3)) / 1000, 75, 'the median of one old lap and one new');
    assert.equal(lapTimeMs(two.slice(0, 3), { perLeg: 2 }) / 1000, 90, 'just the new one');
  }
});

test('lapPrompts', () => {
  // A 3000 m on a 400 m track opens on a 200 m stretch.
  const total = 8,
    distance = 3000,
    track = 400;
  const rows = [
    { id: 'a', lane: 1 },
    { id: 'b', lane: 2 },
    { id: 'c', lane: 3 },
  ];
  const S = 1000;
  // a has four crossings on 80 s laps, b has three, and c is untapped.
  const events = [
    { id: 'a', t: 40 * S },
    { id: 'b', t: 45 * S },
    { id: 'a', t: 120 * S },
    { id: 'b', t: 130 * S },
    { id: 'a', t: 200 * S },
    { id: 'b', t: 215 * S },
    { id: 'a', t: 280 * S },
  ];
  const { byId } = deriveLaps(events, total);
  const at = (now) => lapPrompts(rows, byId, { total, distance, track, now: now * S });

  // 50 m at an 80 s lap is 10 s of warning (docs/lap-counter.md,
  // "Being ready 30–40 m out").
  const p = at(340).get('a');
  assert.equal(p.lapMs, 80_000);
  assert.equal(p.eta, 360 * S, 'four crossings done, next at 280 + 80');
  assert.deepEqual(p.call, { kind: 'laps', laps: 3 }, 'four crossings left, shout 3 on the next');
  assert.equal(p.state, 'waiting', '20 s out is not due yet');
  assert.equal(at(350).get('a').state, 'due', '10 s out is due');
  assert.equal(at(359).get('a').state, 'due');
  assert.equal(at(369).get('a').state, 'due', 'still due just after the estimate');
  assert.equal(at(372).get('a').state, 'overdue', 'a whole window late is a missed press');

  // Only the finish is expected a few per cent early. (Break on purpose: set
  // LAST_LAP_FACTOR to 1.)
  {
    const eta = (n) => {
      const taps = Array.from({ length: n }, (_, i) => ({ id: 'a', t: (40 + i * 80) * S }));
      return lapPrompts([rows[0]], deriveLaps(taps, total).byId, { total, distance, track, now: 0 }).get('a').eta;
    };
    assert.equal(eta(total - 2), 520 * S, 'the crossing that rings the bell is a whole lap out');
    const finish = eta(total - 1);
    assert.ok(finish < 600 * S && finish >= 596 * S, `the finish is due a little before 600 s, not at ${finish / S}`);
  }

  // c has no crossing and no start time, so c is unknown.
  assert.equal(at(340).get('c').state, 'unknown');
  assert.equal(at(340).get('c').call.laps, 7);

  // The lap board follows the leader still running, a crossing ahead of b.
  const leader = boardLeader(rows, byId, at(340));
  assert.equal(leader.row.id, 'a');
  assert.deepEqual(leader.prompt.call, { kind: 'laps', laps: 3 });

  // Out of the race means no call, and the board moves on.
  const outPrompts = lapPrompts(rows, byId, { total, distance, track, now: 340 * S, done: { a: 'DNF' } });
  assert.equal(outPrompts.get('a').state, 'out');
  assert.equal(outPrompts.get('a').call, null);
  assert.equal(boardLeader(rows, byId, outPrompts).row.id, 'b');

  // Finished competitors need no action at all.
  const done = deriveLaps(
    Array.from({ length: total }, (_, i) => ({ id: 'a', t: (i + 1) * 80 * S })),
    total,
  );
  const finished = lapPrompts([rows[0]], done.byId, { total, distance, track, now: 700 * S });
  assert.equal(finished.get('a').state, 'finished');
  assert.equal(finished.get('a').call, null);

  // The board stays at zero with a finished leader (docs/lap-counter.md,
  // "The lap board").
  {
    const mixed = deriveLaps(
      [
        ...Array.from({ length: total }, (_, i) => ({ id: 'a', t: (i + 1) * 80 * S })),
        { id: 'b', t: 90 * S },
        { id: 'b', t: 180 * S },
      ],
      total,
    );
    const rows2 = [
      { id: 'a', lane: 1 },
      { id: 'b', lane: 2 },
    ];
    const p2 = lapPrompts(rows2, mixed.byId, { total, distance, track, now: 700 * S });
    const lead = boardLeader(rows2, mixed.byId, p2);
    assert.equal(lead.row.id, 'a', 'the finished leader still owns the board');
    assert.equal(lead.prompt.state, 'finished');
    assert.equal(total - lead.prompt.count, 0, 'the board reads zero');
    // A leader out of the race loses it.
    const outP = lapPrompts(rows2, mixed.byId, { total, distance, track, now: 700 * S, done: { a: 'DNF' } });
    assert.equal(boardLeader(rows2, mixed.byId, outP).row.id, 'b');
  }

  // A walker on a 2-minute lap gets the same 50 m of warning in more seconds.
  const walk = [{ id: 'w', lane: 1 }];
  const walkEvents = [
    { id: 'w', t: 120 * S },
    { id: 'w', t: 240 * S },
  ];
  const wById = deriveLaps(walkEvents, total).byId;
  const wp = (now) => lapPrompts(walk, wById, { total, distance, track, now: now * S }).get('w');
  assert.equal(wp(340).lapMs, 120_000);
  assert.equal(wp(344).state, 'waiting', '16 s out');
  assert.equal(wp(345).state, 'due', '15 s out is 50 m at this pace');
  assert.equal(LEAD_METRES, 50);
});

// --- how far from the line, at their own pace ---
test('metresAway', () => {
  const total = 8,
    distance = 3000,
    track = 400,
    S = 1000;
  const rows = [{ id: 'a', lane: 1 }];
  // a runs 80 s laps on a 400 m track.
  const byId = deriveLaps(
    [
      { id: 'a', t: 80 * S },
      { id: 'a', t: 160 * S },
    ],
    total,
  ).byId;
  const at = (now) => lapPrompts(rows, byId, { total, distance, track, now: now * S }).get('a');

  assert.equal(Math.round(at(220).metresAway), 100, '20 s before the estimate is 100 m out');
  assert.equal(Math.round(at(230).metresAway), 50, 'and 10 s before it is 50 m');
  assert.equal(Math.round(at(240).metresAway), 0, 'at the estimate they are on the line');
  assert.ok(at(245).metresAway < 0, 'past the estimate and still not tapped');

  // The board swaps at 100 m and the tile lights at 50 m, on the same pace.
  assert.equal(BOARD_SWAP_METRES, 100);
  assert.ok(at(219).metresAway > BOARD_SWAP_METRES, 'not yet');
  assert.ok(at(221).metresAway <= BOARD_SWAP_METRES, 'from here the board swaps');
  assert.equal(at(221).state, 'waiting', 'but the tile is not due yet');
  assert.equal(at(231).state, 'due', 'the tile lights up at 50 m');

  const wById = deriveLaps(
    [
      { id: 'a', t: 120 * S },
      { id: 'a', t: 240 * S },
    ],
    total,
  ).byId;
  const w = lapPrompts(rows, wById, { total, distance, track, now: 330 * S }).get('a');
  assert.equal(Math.round(w.metresAway), 100, '30 s out on a 2-minute lap is 100 m');
});

// --- repairing a missed crossing ---
test('repairing a missed crossing', () => {
  const S = 1000;
  // A crossing noticed at 95 s on an 80 s lap is recorded at 80 s.
  assert.equal(repairTime({ lastT: 0, eta: 80 * S, now: 95 * S }), 80 * S);
  // A repair never lands in the future.
  assert.equal(repairTime({ lastT: 0, eta: 200 * S, now: 95 * S }), 95 * S - 1);
  // Nor before the crossing it follows.
  assert.equal(repairTime({ lastT: 90 * S, eta: 10 * S, now: 95 * S }), 90 * S + 1);
  // With no pace to go on it records the press, just before now.
  assert.equal(repairTime({ lastT: 0, eta: null, now: 100 * S }), 100 * S - 1);
  assert.equal(repairTime({ lastT: null, startTs: 20 * S, eta: null, now: 100 * S }), 100 * S - 1);
  assert.equal(repairTime({ now: 100 * S }), 100 * S - 1);

  // Where the first segment is a whole lap, a midpoint repair would put the
  // next crossing at now.
  // (Break on purpose: use `(after + now) / 2` in repairTime.)
  {
    const total = 4,
      distance = 800,
      track = 200;
    const rows = [{ id: 'a', lane: 1 }];
    const startTs = 0;
    const now = 120 * S;
    const t = repairTime({ lastT: null, eta: null, startTs, now });
    const st = deriveLaps([{ id: 'a', t, est: true }], total).byId;
    const p = lapPrompts(rows, st, { total, distance, track, startTs, now }).get('a');
    assert.notEqual(p.state, 'due', 'a repair does not land the next crossing on top of itself');
    assert.notEqual(p.state, 'overdue');
    assert.ok(p.msAway > 0, 'the next crossing is still ahead');
  }
});

// The log is read in time order, so a repair entered late sorts into
// place.
test('The log is read in time order, so a repair entered late sorts into place', () => {
  const total = 4;
  const taps = [
    { id: 'a', t: 80_000 },
    { id: 'a', t: 240_000 },
  ];
  // Two taps 160 s apart on 80 s laps miss a crossing.
  assert.deepEqual(deriveLaps(taps, total).byId.get('a').times, [80_000, 240_000]);
  // Repairing it appends an event that sorts into the middle.
  const repaired = [...taps, { id: 'a', t: repairTime({ lastT: 80_000, eta: 160_000, now: 245_000 }), est: true }];
  const st = deriveLaps(repaired, total).byId.get('a');
  assert.deepEqual(st.times, [80_000, 160_000, 240_000], 'in time order, not entry order');
  assert.equal(st.count, 3);
  assert.equal(st.est, true, 'the athlete carries an estimated time');
  assert.equal(lapTimeMs(st.times), 80_000, 'and the pace estimate is right again');
  // Undo still removes what was entered last, whatever its timestamp.
  assert.deepEqual(deriveLaps(repaired.slice(0, -1), total).byId.get('a').times, [80_000, 240_000]);
  // A log with no repair carries no estimate.
  assert.equal(deriveLaps(taps, total).byId.get('a').est, undefined);
});

// A repair entered after b's finish can still place a ahead of b.
test('repairTime', () => {
  const total = 1;
  const events = [
    { id: 'b', t: 61_000 }, // tapped as b crossed
    { id: 'a', t: 60_000, est: true }, // a's crossing, noticed later
  ];
  assert.deepEqual(
    deriveLaps(events, total).finished,
    ['a', 'b'],
    'a crossed first, whatever order the two were entered in',
  );
  assert.equal(deriveLaps(events, total).byId.get('a').pos, 1);
  assert.equal(deriveLaps(events, total).byId.get('b').pos, 2);
});

// --- the heat's own pace, for a competitor with none of their own ---
test('heatLapMs', () => {
  const S = 1000;
  const rows = [
    { id: 'a', lane: 1 },
    { id: 'b', lane: 2 },
    { id: 'c', lane: 3 },
  ];
  // a and b are running, and c has no tap and no seed.
  const events = [];
  for (let n = 1; n <= 4; n += 1) {
    events.push({ id: 'a', t: n * 60 * S });
    events.push({ id: 'b', t: n * 70 * S });
  }
  const { byId } = deriveLaps(events, 15);
  assert.equal(heatLapMs(rows, byId), 65_000, 'the median of the laps there are');
  // With nobody's laps to measure there is no heat pace.
  assert.equal(heatLapMs([rows[0]], deriveLaps([], 15).byId), null);
  // Somebody out of the race lends no laps.
  assert.equal(heatLapMs(rows, byId, { done: { b: 'DNF' } }), 60_000);

  // With no pace of their own, c takes the heat's.
  // (Break on purpose: drop `fieldMs` from lapTimeMs's fallbacks.)
  const p = lapPrompts(rows, byId, {
    total: 15,
    distance: 3000,
    track: 200,
    startTs: 0,
    now: 250 * S,
  }).get('c');
  assert.equal(p.lapMs, 65_000, "the field's pace stands in");
  assert.equal(p.state, 'overdue', 'and says c is long overdue rather than saying nothing');

  // A seed of their own wins over the heat's pace.
  const withSb = lapPrompts([{ id: 'c', lane: 3, sbMs: 600_000 }], byId, {
    total: 15,
    distance: 3000,
    track: 200,
    startTs: 0,
    now: 250 * S,
  }).get('c');
  assert.equal(withSb.lapMs, 40_000, '3000 m in 10:00 is a 40 s lap on a 200 m track');
  // The PB stands in where there is no SB.
  // (Break on purpose: drop `?? row.pbMs` from lapPrompts.)
  const withPb = lapPrompts([{ id: 'c', lane: 3, pbMs: 600_000 }], byId, {
    total: 15,
    distance: 3000,
    track: 200,
    startTs: 0,
    now: 250 * S,
  }).get('c');
  assert.equal(withPb.lapMs, 40_000, 'the personal best is a seed too');
});

// --- one press for a whole pack ---
// A 3000 m in a hall with eighteen runners, of whom only the leader and the
// tail are tapped (docs/lap-counter.md, "Recording a pack").
test('packCrossings', () => {
  const S = 1000;
  const total = 15,
    distance = 3000,
    track = 200,
    startTs = 0;
  const rows = Array.from({ length: 18 }, (_, i) => ({ id: `r${i}`, lane: 1, bib: 100 + i }));
  const events = [];
  // Four full laps are counted, the field crossing in about 6 s.
  for (let lap = 1; lap <= 4; lap += 1) {
    rows.forEach((r, i) => events.push({ id: r.id, t: lap * 45 * S + i * 350 }));
  }
  // On the fifth only the leader and the tail were tapped.
  const fifth = 5 * 45 * S;
  events.push({ id: 'r0', t: fifth });
  events.push({ id: 'r17', t: fifth + 17 * 350 });
  const now = fifth + 25 * S;
  const { byId } = deriveLaps(events, total);
  const opts = { total, distance, track, startTs, now };
  const prompts = lapPrompts(rows, byId, opts);
  const late = rows.filter((r) => prompts.get(r.id).state === 'overdue');
  assert.equal(late.length, 16, 'the sixteen nobody got to');

  const pack = packCrossings(rows, byId, { ...opts, ids: late.map((r) => r.id) });
  assert.equal(pack.length, 16);
  assert.ok(
    pack.every((c) => c.est),
    'every one of them is an estimate',
  );
  assert.ok(
    pack.every((c) => c.t >= fifth && c.t <= fifth + 17 * 350),
    'bracketed by the presses that were made',
  );

  // A competitor whose pace puts them over the line before the leader's
  // press is held at the window's edge.
  // (Break on purpose: drop the `lo`/`hi` clamp in packCrossings.)
  {
    const quick = [];
    // r7 has run 30 s laps to the rest's 45 s.
    for (let lap = 1; lap <= 4; lap += 1) {
      rows.forEach((r, i) =>
        quick.push({
          id: r.id,
          t: r.id === 'r7' ? lap * 30 * S : lap * 45 * S + i * 350,
        }),
      );
    }
    quick.push({ id: 'r0', t: fifth });
    quick.push({ id: 'r17', t: fifth + 17 * 350 });
    const qById = deriveLaps(quick, total).byId;
    const qLate = rows.filter((r) => r.id !== 'r0' && r.id !== 'r17');
    const qPack = packCrossings(rows, qById, { ...opts, ids: qLate.map((r) => r.id) });
    const r7 = qPack.find((c) => c.id === 'r7');
    assert.equal(r7.t, fifth, 'held at the near edge of the window, not before it');
    assert.ok(
      qPack.every((c) => c.t >= fifth),
      'and nobody is put in front of the leader',
    );
  }
  // The times rise strictly, in the order the pack already stood in.
  assert.deepEqual(
    [...pack].sort((a, b) => a.t - b.t),
    pack,
    'in standings order',
  );
  assert.equal(new Set(pack.map((c) => c.t)).size, 16, 'and no two share a moment');

  const after = deriveLaps([...events, { pack, t: now }], total);
  assert.deepEqual([...new Set(rows.map((r) => after.byId.get(r.id).count))], [5], 'the whole field is on five');
  assert.deepEqual(
    [...new Set(rows.map((r) => lapPrompts(rows, after.byId, opts).get(r.id).state))],
    ['waiting'],
    'and nobody is overdue any more',
  );
  // Undo takes the pack back whole.
  assert.deepEqual(deriveLaps([...events, { pack, t: now }].slice(0, -1), total).byId.get('r1').count, 4);

  // A late press gives the same times, since the presses made anchor them.
  const later = packCrossings(rows, byId, { ...opts, now: now + 12 * S, ids: late.map((r) => r.id) });
  assert.deepEqual(later, pack, 'the same crossings twelve seconds later');

  // The finish is never in a pack.
  // (Break on purpose: drop the `p.count < total - 1` filter.)
  {
    const upTo14 = [];
    for (let lap = 1; lap <= 14; lap += 1) {
      rows.forEach((r, i) => upTo14.push({ id: r.id, t: lap * 45 * S + i * 350 }));
    }
    const late14 = deriveLaps(upTo14, total).byId;
    const at = 15 * 45 * S + 60 * S;
    assert.deepEqual(
      packCrossings(rows, late14, { total, distance, track, startTs, now: at, ids: rows.map((r) => r.id) }),
      [],
      'a time nobody took is not a result',
    );
  }

  // crossingsOf returns a pack's crossings, or a corrected clock zero could
  // land after one of them.
  // (Break on purpose: make crossingsOf return [] for a pack.)
  assert.equal(
    [
      { id: 'a', t: 1 },
      { pack, t: now },
      { order: ['a', 'b'], n: 2, t: 3 },
    ].flatMap(crossingsOf).length,
    17,
  );
});

// --- who has been lapped ---
// The crossing count alone flickers, so the pace estimate settles it.
test('lapsBehind', () => {
  const S = 1000;
  const total = 15,
    distance = 3000,
    track = 200,
    startTs = 0;
  const rows = [
    { id: 'lead', lane: 1 },
    { id: 'mid', lane: 2 },
    { id: 'slow', lane: 3 },
  ];
  const paces = { lead: 45, mid: 50, slow: 60 };
  const at = (secs) => {
    const events = [];
    for (const r of rows) {
      for (let n = 1; n * paces[r.id] <= secs; n += 1) events.push({ id: r.id, t: n * paces[r.id] * S });
    }
    const { byId } = deriveLaps(events, total);
    const prompts = lapPrompts(rows, byId, { total, distance, track, startTs, now: secs * S });
    return lapsBehind(rows, prompts, track);
  };
  // A second after the leader crosses, mid is one crossing down but under a
  // lap behind.
  // (Break on purpose: use `p.count` alone as the progress in lapsBehind.)
  assert.equal(at(271).get('mid'), 0, 'one crossing down is not a lap down');
  assert.equal(at(300).get('mid'), 0, "mid is on the leader's lap at 300 s");
  assert.equal(at(300).get('slow'), 1, 'and slow has been lapped once');
  assert.equal(at(450).get('mid'), 1);
  assert.equal(at(600).get('slow'), 3, 'three laps down by 600 s');
  assert.equal(at(300).get('lead'), 0, 'the leader is never behind themselves');

  // An untapped competitor must not drift past the line and read as the
  // leader.
  // (Break on purpose: drop the Math.min(1, …) clamp on the lap fraction.)
  {
    const events = [];
    for (let n = 1; n <= 6; n += 1) events.push({ id: 'lead', t: n * 45 * S });
    const { byId } = deriveLaps(events, total);
    const prompts = lapPrompts(rows, byId, { total, distance, track, startTs, now: 400 * S });
    const behind = lapsBehind(rows, prompts, track);
    assert.equal(behind.get('lead'), 0, 'the one being counted is still the leader');
    assert.ok(behind.get('mid') > 0, 'and the untapped ones read as behind, which they are');
  }

  // A leader out of the race is not measured.
  {
    const events = [{ id: 'slow', t: 60 * S }];
    const { byId } = deriveLaps(events, total);
    const prompts = lapPrompts(rows, byId, {
      total,
      distance,
      track,
      startTs,
      now: 100 * S,
      done: { lead: 'DNF' },
    });
    assert.equal(lapsBehind(rows, prompts, track).has('lead'), false);
  }
});

// --- the next-up band ---
// A slot is held until the crossing in it is recorded (docs/lap-counter.md,
// "The next-up band").
test('the next-up band', () => {
  const S = 1000;
  const total = 15,
    distance = 3000,
    track = 200,
    startTs = 0;
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, lane: i + 1 }));
  // Six runners are 4 s apart on 45 s laps, four crossings in.
  const events = [];
  for (let lap = 1; lap <= 4; lap += 1) {
    rows.forEach((r, i) => events.push({ id: r.id, t: lap * 45 * S + i * 4 * S }));
  }
  const { byId } = deriveLaps(events, total);
  const at = (secs) => lapPrompts(rows, byId, { total, distance, track, startTs, now: secs * S });

  // The band reaches 150 m, about 34 s at a 45 s lap on 200 m. The six are
  // expected at the line from 225 s, 4 s apart.
  assert.deepEqual(bandQueue(rows, at(196)), ['r0', 'r1'], 'the two nearest, nearest first');
  // Everyone is inside it as the field comes round.
  assert.equal(bandQueue(rows, at(225)).length, 6);
  // Nobody is, in the middle of a lap.
  assert.deepEqual(bandQueue(rows, at(190)), []);
  // An overdue competitor leads the queue.
  // (Break on purpose: sort bandQueue by |metresAway|.)
  {
    const late = deriveLaps(
      events.filter((e) => !(e.id === 'r5' && e.t > 3 * 45 * S)),
      total,
    ).byId;
    const q = bandQueue(rows, lapPrompts(rows, late, { total, distance, track, startTs, now: 225 * S }));
    assert.equal(q[0], 'r5', 'the one whose crossing never landed comes first');
  }

  // --- the slots ---
  const ids = (b) => b.map((s) => s?.id ?? null);
  // Free slots fill leftmost, nearest first.
  let b = bandSlots(null, ['a', 'b'], { now: 0 });
  assert.deepEqual(ids(b), ['a', 'b', null]);
  assert.equal(b.length, BAND_SLOTS);

  // A closer runner arriving pushes nobody along.
  // (Break on purpose: rebuild the slots from `approaching` each time.)
  b = bandSlots(b, ['c', 'a', 'b'], { now: 100 });
  assert.deepEqual(ids(b), ['a', 'b', 'c'], 'the newcomer takes the free slot, not the front');

  // A recorded slot stays empty for BAND_HOLD_MS, so a fumbled second press
  // lands on nothing.
  // (Break on purpose: drop the freeAt hold in bandSlots.)
  b = bandSlots(b, ['b', 'c'], { now: 1000 });
  assert.deepEqual(ids(b), [null, 'b', 'c']);
  b = bandSlots(b, ['b', 'c', 'd'], { now: 1000 + BAND_HOLD_MS - 1 });
  assert.deepEqual(ids(b), [null, 'b', 'c'], 'still dead, so d waits');
  b = bandSlots(b, ['b', 'c', 'd'], { now: 1000 + BAND_HOLD_MS });
  assert.deepEqual(ids(b), ['d', 'b', 'c'], 'and then it opens');

  // The others held their slots throughout.
  assert.equal(ids(b)[1], 'b');
  assert.equal(ids(b)[2], 'c');

  // Competitors beyond the slots stay off the band.
  b = bandSlots(null, ['a', 'b', 'c', 'd', 'e'], { now: 0 });
  assert.deepEqual(ids(b), ['a', 'b', 'c']);
  // a is recorded, and its slot stays empty even with others waiting.
  b = bandSlots(b, ['d', 'b', 'c', 'e'], { now: 100 });
  assert.deepEqual(ids(b), [null, 'b', 'c']);
  // Then the free slot goes to whoever is nearest of those left out.
  b = bandSlots(b, ['d', 'b', 'c', 'e'], { now: 100 + BAND_HOLD_MS });
  assert.deepEqual(ids(b), ['d', 'b', 'c'], 'd was ahead of e');
});

// --- refusing a press that cannot be a lap ---
test('tapGuardMs', () => {
  const S = 1000;
  // With no lap measured the flat guard applies.
  assert.equal(tapGuardMs([]), TAP_GUARD_MS);
  assert.equal(tapGuardMs([10 * S]), TAP_GUARD_MS, 'one crossing is not a lap time');
  // The guard is half a lap.
  assert.equal(tapGuardMs([0, 80 * S, 160 * S]), 40 * S);
  // A race walker's guard is longer, in the same proportion.
  assert.equal(tapGuardMs([0, 120 * S, 240 * S]), 60 * S);
  // A sprint relay leg of a few seconds never drops below the flat guard.
  assert.equal(
    tapGuardMs([0, 4 * S, 8 * S]),
    TAP_GUARD_MS,
    'half of a 4 s lap is under the fumble guard, so the guard wins',
  );
  // The guard follows the median lap, so one bad lap does not widen it.
  assert.equal(tapGuardMs([0, 80 * S, 81 * S, 161 * S]), 40 * S);
});

// --- which keydown starts the clock ---
test('startsClock', () => {
  // Space and enter start it from a keyboard or a Bluetooth remote.
  assert.equal(startsClock({ key: ' ' }), true);
  assert.equal(startsClock({ key: 'Spacebar' }), true, 'the old name for space');
  assert.equal(startsClock({ key: 'Enter' }), true);

  // The Tab Active3's side key arrives with no key name, no code and
  // keyCode 0 (docs/lap-counter.md, "Clock, keys and the screen staying on").
  assert.equal(
    startsClock({ key: 'Unidentified' }),
    true,
    'the side key reports no identity, which is the only thing there is to match on',
  );

  // Everything else is somebody typing.
  for (const key of ['a', 'Escape', 'ArrowLeft', 'Tab', 'F5', '1', 'Shift', '']) {
    assert.equal(startsClock({ key }), false, `${JSON.stringify(key)} must not start a race`);
  }

  // A held key's repeats start nothing.
  assert.equal(startsClock({ key: ' ', repeat: true }), false);
  assert.equal(startsClock({ key: 'Unidentified', repeat: true }), false);

  // A modifier means a shortcut was meant, not a start.
  for (const mod of ['meta', 'ctrl', 'alt']) {
    assert.equal(startsClock({ key: ' ', [mod]: true }), false, `${mod}+space is a shortcut`);
    assert.equal(startsClock({ key: 'Unidentified', [mod]: true }), false);
  }

  // An open sheet takes the press, whichever key it came from.
  assert.equal(startsClock({ key: ' ', sheetOpen: true }), false);
  assert.equal(startsClock({ key: 'Enter', sheetOpen: true }), false);
  assert.equal(startsClock({ key: 'Unidentified', sheetOpen: true }), false);

  // A focused control takes space and enter for itself.
  for (const tag of ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'button']) {
    assert.equal(startsClock({ key: ' ', targetTag: tag }), false, `${tag} answers for space`);
    assert.equal(startsClock({ key: 'Enter', targetTag: tag }), false, `${tag} answers for enter`);
  }
  assert.equal(startsClock({ key: ' ', targetTag: 'DIV' }), true, 'nothing focused answers for it');

  // The side key activates nothing, so that guard skips it. Focus sits on a
  // button after any tap, and the key would go dead there.
  for (const tag of ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(
      startsClock({ key: 'Unidentified', targetTag: tag }),
      true,
      `the side key must still start the clock with a focused ${tag}`,
    );
  }
});

// --- correcting the clock ---
test('correcting the clock', () => {
  // handTimeMs reads the grammar the app writes times in.
  assert.equal(handTimeMs('26,14'), 26140);
  assert.equal(handTimeMs('2.05,3'), 125300, 'm.ss,t with tenths');
  assert.equal(handTimeMs('1.00,0'), 60000);
  for (const bad of ['DNF', '', 'kaksi', '2:05,3', null, undefined]) {
    assert.equal(handTimeMs(bad), null, `${JSON.stringify(bad)} is not a time`);
  }

  // If this crossing was really at 26,14, the zero was 26.14 s before it.
  assert.equal(anchorStart(1_000_000, '26,14'), 973_860);
  assert.equal(anchorStart(1_000_000, 'DNF'), null);
  assert.equal(anchorStart(null, '26,14'), null, 'no crossing, nothing to anchor to');

  // A nudge with nothing in the way lands where it was asked to.
  assert.deepEqual(correctedStart(1_000_000), { ts: 1_000_000, limited: null });
  assert.deepEqual(correctedStart(999_000.4), { ts: 999_000, limited: null }, 'rounded to the ms');
  assert.equal(correctedStart(NaN), null);
  assert.equal(correctedStart('kello'), null);

  // The zero may not pass a logged crossing, or finishText would drop the
  // times it meant to fix.
  assert.deepEqual(
    correctedStart(1_000_050, { firstCrossing: 1_000_000 }),
    { ts: 999_999, limited: 'crossing' },
    'clamped to just before the first crossing',
  );
  assert.deepEqual(
    correctedStart(999_000, { firstCrossing: 1_000_000 }),
    { ts: 999_000, limited: null },
    'before the first crossing is untouched',
  );

  // Nor may it sit in the future.
  assert.deepEqual(correctedStart(2_000, { now: 1_000 }), { ts: 1_000, limited: 'now' });

  // A heat with nothing logged can only hit the ceiling of now.
  assert.equal(
    correctedStart(2_000, { firstCrossing: null, now: 1_000 }).limited,
    'now',
    'no crossings, so the ceiling that bit was now — the other sentence would be a lie',
  );

  // With both in play the earlier ceiling wins, whichever it is.
  assert.deepEqual(
    correctedStart(9_000, { firstCrossing: 5_000, now: 8_000 }),
    { ts: 4_999, limited: 'crossing' },
    'the crossing is earlier than now',
  );
  assert.deepEqual(
    correctedStart(9_000, { firstCrossing: 8_000, now: 6_000 }),
    { ts: 6_000, limited: 'now' },
    'now is earlier than the crossing',
  );

  // The operator reads fmtShift back before committing.
  assert.equal(fmtShift(2400), '2,4 s');
  assert.equal(fmtShift(-2400), '−2,4 s', 'a minus sign, not a hyphen');
  assert.equal(fmtShift(0), '0,0 s');
  assert.equal(fmtShift(2449), '2,4 s');
  assert.equal(fmtShift(2450), '2,5 s');
  assert.equal(fmtShift(60_000), '60,0 s');

  // The export notes a changed zero.
  assert.equal(startNote({ startTs: null, startTs0: null }), null, 'no clock, nothing to say');
  assert.equal(startNote({ startTs: 1000, startTs0: 1000 }), null, 'untouched, nothing to say');
  assert.equal(
    startNote({ startTs: 1000, startTs0: null }),
    'lähtöaika asetettu jälkikäteen',
    'never pressed, fitted to the crossings afterwards',
  );
  assert.equal(
    startNote({ startTs: 1000, startTs0: 3400 }),
    'lähtöaikaa korjattu 2,4 s',
    'the start moved earlier, so every time grew',
  );
  assert.equal(
    startNote({ startTs: 3400, startTs0: 1000 }),
    'lähtöaikaa korjattu −2,4 s',
    'the start moved later, so every time shrank',
  );

  // A correction moves every time by the same amount and reorders nobody.
  {
    const start0 = 1_000_000;
    const a = { finishT: start0 + 61_000 };
    const b = { finishT: start0 + 63_400 };
    const before = [finishText(start0, a), finishText(start0, b)];
    const { ts } = correctedStart(start0 - 2_400, { firstCrossing: a.finishT });
    const after = [finishText(ts, a), finishText(ts, b)];
    assert.deepEqual(before, ['1.01,0', '1.03,4']);
    assert.deepEqual(after, ['1.03,4', '1.05,8'], 'both grew by exactly the shift');
    assert.equal(
      handTimeMs(after[1]) - handTimeMs(after[0]),
      handTimeMs(before[1]) - handTimeMs(before[0]),
      'the gap between them is untouched, so no place can change',
    );
  }
});
