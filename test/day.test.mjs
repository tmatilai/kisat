// Tests how a meet's day list lays out (meetDay) over the demo's schedule:
// the day, Ratalajit, the class and discipline filter, and a follow-list.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoEventResults } from './fixtures.mjs';
import { demoSchedule } from '../public/demo.js';
import { meetDay } from '../public/lib/day.js';
import { buildRoster } from '../public/lib/roster.js';
import { compViewState } from '../public/lib/routes.js';
import { watchTargets } from '../public/lib/watch.js';

const schedule = demoSchedule();
const [demoDay] = Object.keys(schedule);
const state = compViewState([], 'demo', null);
const day = (extra = {}, s = schedule) => meetDay(s, { state, today: demoDay, ...extra });

test('the day: the wanted one, or the first from today on', () => {
  const rows = schedule[demoDay];
  const three = { '1.10.2026': rows, '29.9.2026': rows, '30.9.2026': [], '2.10.2026': rows };
  assert.deepEqual(
    day({}, three).dates,
    ['29.9.2026', '1.10.2026', '2.10.2026'],
    'in date order, the empty day left out',
  );
  assert.equal(day({ today: '30.9.2026' }, three).date, '1.10.2026');
  assert.equal(day({ today: '3.10.2026' }, three).date, '2.10.2026', 'after the meet, its last day');
  assert.equal(day({ today: '30.9.2026', wantedDate: '29.9.2026' }, three).date, '29.9.2026');
  assert.equal(day({ today: '30.9.2026', wantedDate: '30.9.2026' }, three).date, '1.10.2026', 'a day with no start');
  assert.equal(meetDay({ [demoDay]: [] }, { state, today: demoDay }), null, 'a meet with no start');
});

test('Ratalajit and the class filter narrow the list, never the days', () => {
  const plain = day();
  assert.equal(plain.narrowed, false);
  assert.equal(plain.groups, plain.dayGroups, 'the whole day, as grouped');
  assert.deepEqual(
    plain.multiEvents.map((m) => m.label),
    ['P9 3-ottelu', 'T9 3-ottelu', 'T11 3-ottelu'],
  );
  const run = day({ runOnly: true });
  assert.deepEqual([...new Set(run.groups.map((g) => g.category))], ['Track', 'Relay']);
  assert.deepEqual(run.multiEvents, [], 'a multi-event is no run');
  assert.deepEqual(run.dayGroups, plain.dayGroups, 'the confirmations still count the whole day');
  const rows = schedule[demoDay];
  const fieldDay = { '29.9.2026': rows, '30.9.2026': rows.filter((r) => r.Category === 'Field') };
  assert.deepEqual(day({ runOnly: true }, fieldDay).dates, ['29.9.2026', '30.9.2026'], 'a day of field events');
  const nines = day({ state: { ...state, ages: [9] } });
  assert.equal(nines.narrowed, true);
  assert.deepEqual(
    nines.multiEvents.map((m) => m.label),
    ['P9 3-ottelu', 'T9 3-ottelu'],
    'a class keeps its own multi-events',
  );
  const kuula = day({ state: { ...state, events: ['Kuula'] } });
  assert.deepEqual([...new Set(kuula.groups.map((g) => g.event))], ['Kuula', '3-ottelu Kuula']);
  assert.deepEqual(kuula.multiEvents, [], 'a discipline chip drops the multi-events');
});

test('a follow-list narrows the list where somebody it follows is entered', () => {
  const roster = buildRoster(demoEventResults());
  const watch = (entries) => ({ kind: 'watch', entries, roster, targets: watchTargets(entries, roster) });
  const demu = day({ filter: watch([{ type: 'club', id: '1', name: 'Demon Urheilijat', enabled: true }]) });
  assert.equal(demu.listFiltered, true);
  assert.equal(demu.emptyHere, false);
  assert.ok(demu.eventIds.size > 0);
  // A club with nobody here shows the whole day and a notice.
  const absent = day({ filter: watch([{ type: 'club', id: '999999', name: 'Poissaolijat', enabled: true }]) });
  assert.equal(absent.emptyHere, true);
  assert.equal(absent.listFiltered, false);
  // Entries all switched off filter nothing.
  const off = day({ filter: watch([{ type: 'club', id: '1', name: 'Demon Urheilijat', enabled: false }]) });
  assert.equal(off.listFiltered, false);
  assert.equal(off.emptyHere, false);
  // A filter whose roster failed shows the plain day.
  assert.equal(day({ filter: { kind: 'watch', entries: [], roster: null, targets: null } }).listFiltered, false);
});
