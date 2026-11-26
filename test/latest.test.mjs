// Tests Uusimmat's snapshot and its order (docs/views.md, "Uusimmat").
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_EVENTS } from '../public/demo.js';
import {
  LATEST_FRESH_MS,
  LATEST_TTL_MS,
  latestAge,
  latestFingerprint,
  latestFresh,
  latestLineKey,
  latestStarts,
  latestUnseen,
  markLatestSeen,
  putLatest,
  updateLatest,
} from '../public/lib/latest.js';
import { allocMark } from '../public/lib/results.js';

// e60 is a throw in progress, with rows of different attempt counts.
const data = DEMO_EVENTS.e60;
const round = data.Rounds[0];
const rows = round.Heats[0].Allocations;
const fp = (a) => latestFingerprint(a, allocMark(a, data, round));
const MIN = 60_000;

test('latestFingerprint: the own mark and attempts, never the place', () => {
  const thrown = rows.find((a) => a.Attempts?.length);
  const next = { ...thrown, Attempts: [...thrown.Attempts, { Line1: 'x', Line2: null }] };
  assert.notEqual(fp(next), fp(thrown), 'a foul is a change, though the mark stays');
  assert.equal(fp({ ...thrown, ResultRank: thrown.ResultRank + 1 }), fp(thrown), 'another athlete passed');
  assert.notEqual(fp({ ...thrown, QResult: true }), fp(thrown), 'a qualification is a change');
  assert.equal(latestFingerprint({ Attempts: [] }, ''), '', 'nothing yet');
  assert.equal(latestLineKey(round, thrown), `${round.Id}:a${thrown.Athletes[0].Id}`);
});

test('updateLatest: when a line changed', () => {
  const t0 = 1_000 * MIN;
  const first = updateLatest(
    null,
    [
      { key: 'r:a1', fp: '12.00||', modifiedAt: t0 - 30 * MIN },
      { key: 'r:a2', fp: '', modifiedAt: t0 - 30 * MIN },
      { key: 's:a1', fp: '8,1||', modifiedAt: null },
    ],
    t0,
  );
  assert.deepEqual(
    first.lines,
    {
      'r:a1': { fp: '12.00||', at: t0 - 30 * MIN, approx: true },
      's:a1': { fp: '8,1||', at: null, approx: true },
    },
    "the first render guesses from the event's last write, and skips a line with nothing",
  );
  assert.equal(latestUnseen(first), false, 'a guess is never unseen');

  const t1 = t0 + MIN;
  const second = updateLatest(
    first,
    [
      { key: 'r:a1', fp: '12.40||', modifiedAt: t1 - 20_000 },
      { key: 'r:a2', fp: '9.10||', modifiedAt: t1 - 20_000 },
      { key: 'r:a3', fp: '7.00||', modifiedAt: t0 - 40 * MIN },
    ],
    t1,
  );
  assert.deepEqual(second.lines['r:a1'], { fp: '12.40||', at: t1 - 20_000 }, 'no later than the last write');
  assert.deepEqual(second.lines['r:a2'], { fp: '9.10||', at: t1 - 20_000 }, 'a first mark is a change');
  assert.deepEqual(
    second.lines['r:a3'],
    { fp: '7.00||', at: t0 - 40 * MIN, approx: true },
    'a line new to the snapshot in an event not written since is a guess, as for an athlete just followed',
  );
  assert.deepEqual(second.lines['s:a1'], first.lines['s:a1'], 'a line this render missed keeps its entry');
  // (Break on purpose: skip every unchanged line in updateLatest.)
  const later = updateLatest(
    second,
    [
      { key: 's:a1', fp: '8,1||', modifiedAt: t0 - 5 * MIN },
      { key: 'r:a3', fp: '7.00||', modifiedAt: t1 - 10_000 },
    ],
    t1 + MIN,
  );
  assert.deepEqual(
    later.lines['s:a1'],
    { fp: '8,1||', at: t0 - 5 * MIN, approx: true },
    'a guess without a time takes the first last write that arrives',
  );
  assert.equal(later.lines['r:a3'], second.lines['r:a3'], 'a guess with a time keeps it');
  assert.equal(second.savedAt, t1);

  const third = updateLatest(second, [{ key: 'r:a2', fp: '9.20||', modifiedAt: null }], t1 + MIN);
  assert.equal(third.lines['r:a2'].at, t1 + MIN, 'with no last write, the time of the render');
  assert.equal(third.lines['r:a1'], second.lines['r:a1'], 'unchanged');
  assert.deepEqual(
    updateLatest(second, [{ key: 'r:a1', fp: '12.50||', modifiedAt: t0 }], t1 + MIN).lines['r:a1'],
    { fp: '12.50||', at: t0 },
    'a changed line is a change even if the copy is older than the previous render',
  );

  assert.equal(latestUnseen(third), true);
  assert.equal(latestUnseen({ ...third, seenAt: t1 + MIN }), false);
  assert.equal(latestFresh(third.lines['r:a2'], t1 + MIN + LATEST_FRESH_MS - 1), true);
  assert.equal(latestFresh(third.lines['r:a2'], t1 + MIN + LATEST_FRESH_MS), false);
  assert.equal(latestFresh(third.lines['r:a3'], t0), false, 'a guess is never fresh');
});

test('markLatestSeen: a line is new since the previous visit', () => {
  const t0 = 1_000 * MIN;
  const snapshot = { savedAt: t0, seenAt: null, lines: { a: { fp: 'x', at: t0 - 20 * MIN } } };
  const first = markLatestSeen(snapshot, t0);
  assert.equal(first.visit.since, null, 'the first visit has no previous one');
  const left = markLatestSeen(first, t0 + 30_000);
  assert.deepEqual([left.seenAt, left.visit], [t0 + 30_000, first.visit], 'a refresh continues the visit');
  // A change after the reader left lights the dot, and the next visit marks it
  // though it is older than LATEST_FRESH_MS. (Break on purpose: leave `visit`
  // out of latestFresh.)
  const change = { fp: 'y', at: t0 + 5 * MIN };
  assert.equal(latestUnseen({ ...left, lines: { a: change } }), true);
  const back = markLatestSeen(left, t0 + 30 * MIN);
  assert.deepEqual(back.visit, { since: t0 + 30_000, at: t0 + 30 * MIN });
  assert.equal(latestFresh(change, back.seenAt, back.visit), true, 'a change since the previous visit');
  assert.equal(latestFresh(snapshot.lines.a, back.seenAt, back.visit), false, 'a change before it');
  let later = back;
  for (let t = back.seenAt + 30_000; t <= t0 + 60 * MIN; t += 30_000) later = markLatestSeen(later, t);
  assert.equal(later.visit, back.visit, 'the visit goes on');
  assert.equal(latestFresh(change, later.seenAt, later.visit), true, 'its marks stay through the visit');
  // (Break on purpose: drop the `entry.at <= visit.at` test.)
  const during = { fp: 'z', at: t0 + 40 * MIN };
  assert.equal(latestFresh(during, later.seenAt, later.visit), false, 'a change during the visit has the plain window');
  assert.equal(latestFresh({ ...change, approx: true }, back.seenAt, back.visit), false, 'a guess is never new');
  assert.equal(updateLatest(later, [], t0 + 61 * MIN).visit, later.visit, 'updateLatest keeps the visit');
});

test('latestAge', () => {
  const now = 1_000 * MIN;
  assert.deepEqual(
    [now + MIN, now - 59_999, now - MIN, now - 59 * MIN, now - 60 * MIN, now - 179 * MIN].map((at) =>
      latestAge(at, now),
    ),
    ['juuri nyt', 'juuri nyt', '1 min sitten', '59 min sitten', '1 t sitten', '2 t sitten'],
    "a time ahead of the device's clock is now",
  );
});

test('latestStarts: the start with the newest change first, the unknown last', () => {
  const snapshot = {
    lines: {
      a1: { fp: 'x', at: 5 },
      a2: { fp: 'x', at: 1 },
      b1: { fp: 'x', at: 9 },
      c1: { fp: 'x', at: null, approx: true },
      d1: { fp: 'x', at: 5 },
      e1: { fp: 'x', at: null, approx: true },
    },
  };
  const start = (id, ...keys) => ({ id, items: keys.map((key) => ({ key })) });
  const starts = [
    start('a', 'a2', 'a1', 'a3'),
    start('b', 'b1'),
    start('c', 'c1'),
    start('d', 'd1'),
    start('e', 'e1'),
    start('f', 'f1'),
  ];
  const sorted = latestStarts(starts, snapshot);
  assert.deepEqual(
    sorted.map((x) => [x.id, x.at]),
    [
      ['b', 9],
      ['a', 5],
      ['d', 5],
      ['e', null],
      ['c', null],
    ],
    "a start's newest line counts, a tie keeps the day's order, the unknown run latest first, and f has no entry",
  );
  assert.deepEqual(
    sorted[1].items.map((x) => x.key),
    ['a2', 'a1', 'a3'],
    'the lines keep their order, the one with no entry too',
  );
});

test('putLatest: one snapshot per meet day, old days dropped', () => {
  const now = 10 * LATEST_TTL_MS;
  const store = { 'c1:1.11.2026': { savedAt: now - LATEST_TTL_MS }, 'c2:22.11.2026': { savedAt: now - MIN } };
  assert.deepEqual(Object.keys(putLatest(store, 'c3:23.11.2026', { savedAt: now }, now)), [
    'c2:22.11.2026',
    'c3:23.11.2026',
  ]);
  assert.deepEqual(putLatest('broken', 'c1:x', { savedAt: now }, now), { 'c1:x': { savedAt: now } });
});
