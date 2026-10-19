// Tests how a start's page lays out (startPageModel, startPageView), which
// tables a class's round shows (roundTables) and what an undrawn round waits on
// (undrawnNotice), over the demo's starts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_DISTRICTS, DEMO_EVENTS, DEMO_ID, demoResponse, demoSchedule } from '../public/demo.js';
import { API, groupRounds, previousRoundField, roundDetail } from '../public/lib/schedule.js';
import { roundTables, startPageModel, startPageView, undrawnNotice } from '../public/lib/start.js';

const schedule = demoSchedule();
const groups = Object.values(schedule).flatMap((rows) => groupRounds(rows));
const scopes = (...ids) => ({ districts: DEMO_DISTRICTS, scopes: ids.map((id) => ({ id, cover: null })) });
// Loads a start's classes, and the model of its page under `extra`.
const load = (event, roundName = 'Loppukilpailu') => {
  const g = groups.find((x) => x.event === event && x.roundName === roundName);
  const detailed = g.entries.map((e) =>
    roundDetail(e, { data: demoResponse(`${API}/results/${DEMO_ID}/${e.round.EventId}`) }),
  );
  return { g, detailed };
};
const model = (event, roundName, extra = {}) => {
  const { g, detailed } = load(event, roundName);
  return startPageModel(detailed, { schedule, category: g.category, roundName: g.roundName, ...extra });
};

test('a shared start offers its heats, its classes and Mitalit', () => {
  const m = model('200m kelaus', 'Loppukilpailu', { scopeChoice: scopes('demy') });
  assert.equal(m.singleCat, false);
  assert.equal(m.shared, true);
  assert.equal(m.canCombine, true, 'a shared start always offers both views');
  assert.equal(m.offerMedals, true);
  assert.equal(m.merged.length > 0, true);
  // Its Erät view draws a table per physical heat, with plain badges. The
  // other two draw by class, and a badge ticks its class.
  assert.deepEqual(startPageView(m, 'heats'), {
    byScope: false,
    combined: false,
    heatTables: true,
    badgeToggles: false,
  });
  assert.deepEqual(startPageView(m, 'total'), {
    byScope: false,
    combined: true,
    heatTables: false,
    badgeToggles: true,
  });
  assert.deepEqual(startPageView(m, 'medals'), {
    byScope: true,
    combined: false,
    heatTables: false,
    badgeToggles: true,
  });
});

test('a class of several heats combines only once it has a result', () => {
  const heats = model('200m', 'Alkuerät');
  assert.equal(heats.singleCat, true);
  assert.deepEqual(heats.merged, [], 'one class merges nothing');
  assert.equal(heats.hasAnyResults, true);
  assert.equal(heats.canCombine, true);
  assert.equal(heats.sharedRound, 'Alkuerät');
  // The same heats before anyone has run stand alone.
  const { g, detailed } = load('200m', 'Alkuerät');
  const unrun = detailed.map((d) => ({
    ...d,
    round: {
      ...d.round,
      Heats: d.round.Heats.map((h) => ({ ...h, Allocations: h.Allocations.map(({ Result, ...a }) => a) })),
    },
  }));
  const undrawn = startPageModel(unrun, { schedule, category: g.category });
  assert.equal(undrawn.hasAnyResults, false);
  assert.equal(undrawn.canCombine, false);
  // A view the model does not offer draws nothing of it.
  assert.deepEqual(startPageView(undrawn, 'total'), {
    byScope: false,
    combined: false,
    heatTables: false,
    badgeToggles: true,
  });
});

test('Mitalit is offered on a covered final whose scopes add something', () => {
  assert.equal(model('Kuula', 'Loppukilpailu').offerMedals, false, 'no scope choice');
  assert.equal(model('Kuula', 'Loppukilpailu', { scopeChoice: scopes('demy') }).offerMedals, true);
  // SM holds the whole field, so its table is the merged list again
  // (scopeTablesAddNothing).
  assert.equal(model('Kuula', 'Loppukilpailu', { scopeChoice: scopes('sm') }).offerMedals, false);
  assert.equal(
    model('100m', 'Alkuerät', { scopeChoice: scopes('demy') }).offerMedals,
    true,
    "an event's only round is its final, whatever its name (isFinalRound)",
  );
  assert.equal(model('800m', 'Loppukilpailu', { scopeChoice: scopes('demy') }).offerMedals, false, 'nothing has run');
});

test("a leg, an aitaviesti and the lap counter's button", () => {
  const leg = model('3-ottelu 40m', 'Loppukilpailu');
  assert.equal(leg.leg, true);
  assert.equal(model('Kuula', 'Loppukilpailu').leg, false);
  const shuttle = model('4x60m aitaviesti', 'Loppukilpailu');
  assert.equal(shuttle.shuttleLanes, true);
  assert.deepEqual(shuttle.laps, { raceLength: 240, shuttle: true }, 'a relay runs its legs end to end');
  assert.deepEqual(model('4x100m viesti', 'Loppukilpailu').laps, { raceLength: 400, shuttle: false });
  assert.equal(model('Kuula', 'Loppukilpailu').laps, null, 'a field event has no counter');
  // An undrawn round's heat shell would open the counter on no tiles.
  assert.equal(model('100m aidat', 'Loppukilpailu').laps, null);
});

test('the round a title names', () => {
  const { g, detailed } = load('200m kelaus');
  const at = (d) => startPageModel(d, { schedule, roundName: g.roundName }).sharedRound;
  assert.equal(at(detailed), 'Loppukilpailu');
  assert.equal(
    at(detailed.map((d, i) => (i ? { ...d, round: { ...d.round, Name: 'Alkuerät' } } : d))),
    null,
    'classes in different rounds name theirs each',
  );
  assert.equal(
    at(detailed.map((d) => ({ ...d, round: null }))),
    'Loppukilpailu',
    "classes with no round take the schedule group's",
  );
});

test("a round's tables: per heat, merged, or per scope", () => {
  const heats = DEMO_EVENTS.e9.Rounds.find((r) => r.Id === 'r9a');
  const shape = (tables) => tables.map((t) => [t.heading ?? null, t.allocs.length]);
  assert.deepEqual(
    roundTables(heats, {}).map((t) => t.heading),
    ['Erä 1', 'Erä 2', 'Erä 3', 'Erä 4'],
    'in heat order, whatever order Heats[] arrives in',
  );
  const merged = roundTables(heats, { combined: true });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].heading, undefined, 'the merged list has no heading');
  assert.equal(
    merged[0].allocs.length,
    heats.Heats.reduce((n, h) => n + h.Allocations.length, 0),
  );
  const final = DEMO_EVENTS.e1.Rounds[0];
  assert.deepEqual(
    shape(roundTables(final, {})),
    [[null, final.Heats[0].Allocations.length]],
    'one heat is no "Erä 1"',
  );
  const start = Object.values(schedule)[0].find((r) => r.Id === 'r1');
  const byScope = roundTables(final, { byScope: true, start, scopeChoice: scopes('demy') });
  assert.deepEqual(
    byScope.map((t) => [t.heading, t.grouping]),
    [
      ['DemY', true],
      ['Muut', true],
    ],
  );
});

test('what an undrawn round waits on', () => {
  const at = (id, roundId, field = undefined) => {
    const rounds = DEMO_EVENTS[id].Rounds;
    const round = rounds.find((r) => r.Id === roundId);
    const notice = undrawnNotice(rounds, round, field === undefined ? previousRoundField(rounds, round) : field);
    return notice && [notice.text, notice.previous?.Name ?? null];
  };
  assert.deepEqual(at('e9', 'r9f'), ['Edellinen vaihe kesken.', 'Välierät'], 'the semi-final is still running');
  assert.equal(at('e10', 'r10f'), null, 'the heats are official, so the list holds');
  assert.equal(at('e3', 'r3q'), null, 'the first round lists the entries');
  assert.deepEqual(
    at('e9', 'r9f', null),
    ['Edellinen vaihe kilpailematta.', null],
    'an earlier round that lent no field has not been run',
  );
});
