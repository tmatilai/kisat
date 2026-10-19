// Tests the kentät and their files (docs/venues.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { hurdleRelaySpec, hurdleSetupBlocks, hurdleSpec, hurdleStartSetups, laneRange } from '../public/lib/hurdles.js';
import { groupRounds } from '../public/lib/schedule.js';
import { venueFullName, venueGroups, venueProblems, venueTable } from '../public/lib/venues.js';
import { DEMO_EVENTS, demoSchedule } from '../public/demo.js';
import hurdles from '../public/data/hurdles.json' with { type: 'json' };

// --- Kentät: venues/ ------------------------------------------------------
//
// venueProblems proof-reads the hand-written files (docs/venues.md).
test('kentät', () => {
  const dir = new URL('../public/data/venues/', import.meta.url);
  const readJson = (name) => JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'));
  const index = readJson('index.json').venues;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f !== 'index.json')
    .map((f) => f.replace(/\.json$/, ''));
  // The select reads only the index, so no file may be missing from it. An
  // index row with no file is a board not read yet.
  assert.deepEqual(
    files.filter((f) => !index.some((v) => v.id === f)),
    [],
  );

  const venues = new Map(
    index.map((e) => [e.id, { entry: e, file: files.includes(e.id) ? readJson(`${e.id}.json`) : null }]),
  );
  for (const { entry, file } of venues.values()) {
    const problems = venueProblems(entry, file, hurdles);
    assert.deepEqual(problems, [], `venues/${entry.id}.json: ${problems.join('; ')}`);
  }

  // This is an invented kenttä. Its outdoor board paints no 60 m for the
  // classes that run it only indoors.
  const kentta = {
    entry: { id: 'demola-mallikentta', locality: 'Demola', name: 'Mallikenttä', length: 400 },
    file: {
      checked: '2026-08-16',
      marks: [
        { distance: 110, count: 10, toFirst: 13.72, interval: 9.14, colour: 'sininen', symbol: 'viiva' },
        { distance: 100, count: 10, toFirst: 13, interval: 8.5, colour: 'keltainen', symbol: 'viiva' },
        { distance: 80, count: 8, toFirst: 12, interval: 8, colour: 'vihreä', symbol: 'suorakulmio' },
        { distance: 60, count: 6, toFirst: 11.5, interval: 7.5, colour: 'valkoinen', symbol: 'suorakulmio' },
        { distance: 60, count: 7, toFirst: 10.5, interval: 6.5, colour: 'vihreä', symbol: 'ympyrä' },
        { distance: 200, count: 10, toFirst: 18.29, interval: 18.29, colour: 'valkoinen', symbol: 'ympyrä' },
        { distance: 200, count: 10, toFirst: 16, interval: 19, colour: 'musta', symbol: 'kolmio' },
        { distance: 300, count: 7, toFirst: 50, interval: 35, colour: 'vihreä', symbol: 'viiva' },
        { distance: 400, count: 10, toFirst: 45, interval: 35, colour: 'vihreä', symbol: 'viiva' },
      ],
    },
  };
  assert.deepEqual(venueProblems(kentta.entry, kentta.file, hurdles), []);
  const broken = (patch) => venueProblems(kentta.entry, { ...kentta.file, ...patch }, hurdles);
  // (Break on purpose: a mark on positions no setup stands at, which the
  // lookup never finds.)
  assert.deepEqual(
    broken({
      marks: [
        { distance: 60, count: 7, toFirst: 10.5, interval: 6.4, colour: 'valkoinen', symbol: 'kolmio', size: '5 cm' },
      ],
    }),
    ['demola-mallikentta: 60 10.5|6.4: no setup stands there'],
  );
  // (Break on purpose: a checked date typed the Finnish way round.)
  assert.deepEqual(broken({ checked: '16.8.2026' }), ['demola-mallikentta: no checked date']);
  // (Break on purpose: a length the lap counter cannot count in.)
  assert.deepEqual(venueProblems({ ...kentta.entry, length: 60 }, kentta.file, hurdles), [
    'demola-mallikentta: 60 m track',
  ]);
  // The locality and the name are separate fields. (Break on purpose: join the
  // two into the name.)
  assert.deepEqual(venueProblems({ ...kentta.entry, name: 'Demola, Mallikenttä' }, kentta.file, hurdles), [
    'demola-mallikentta: name: "Demola, Mallikenttä"',
    'demola-mallikentta: id is not demola-demola-mallikentta',
  ]);
  // (Break on purpose: a row copied off another kenttä's and left with its
  // id, which would load that board.)
  assert.deepEqual(venueProblems({ ...kentta.entry, name: 'Näytekenttä' }, kentta.file, hurdles), [
    'demola-mallikentta: id is not demola-naytekentta',
  ]);
  assert.deepEqual(venueProblems({ ...kentta.entry, locality: '' }, kentta.file, hurdles), [
    'demola-mallikentta: no locality',
  ]);

  // An index row with no file is sound, and its own fields are still checked.
  const unread = { id: 'paikka-halli', locality: 'Paikka', name: 'Halli', length: 170 };
  assert.deepEqual(venueProblems(unread, null, hurdles), []);
  // (Break on purpose: a mistyped id or length on a row with no file.)
  assert.deepEqual(venueProblems({ ...unread, id: 'paikka-hall' }, null, hurdles), [
    'paikka-hall: id is not paikka-halli',
  ]);
  assert.deepEqual(venueProblems({ ...unread, length: 60 }, null, hurdles), ['paikka-halli: 60 m track']);

  // The select has a group per locality, whatever the index's order.
  // venueFullName joins the pair where there is room for both.
  assert.deepEqual(
    venueGroups([
      { id: 'testila-halli', locality: 'Testilä', name: 'Halli', length: 200 },
      kentta.entry,
      { id: 'mallikyla-kentta', locality: 'Mallikylä', name: 'Kenttä', length: 400 },
      { id: 'demola-harjoitushalli', locality: 'Demola', name: 'Harjoitushalli', length: 200 },
    ]).map((g) => `${g.locality}:${g.venues.map((v) => v.name).join(',')}`),
    ['Demola:Harjoitushalli,Mallikenttä', 'Mallikylä:Kenttä', 'Testilä:Halli'],
  );
  assert.equal(venueFullName(kentta.entry), 'Demola, Mallikenttä');

  // A board replaces the sheet's marks, so a setting it does not paint has no
  // mark (docs/venues.md). (Break on purpose: fall through to the sheet's
  // marks for a position the board does not list.)
  const at = (name, age, t) => hurdleSpec({ EventName: name, Gender: 'Male', Age: age }, t).mark;
  const board = venueTable(hurdles, kentta.file);
  assert.equal(at('M50 60m aidat', '50', hurdles).colour, 'keltainen');
  assert.equal(at('M50 60m aidat', '50', board), null);
  // A board mark that agrees with the sheet carries no venue flag. The box
  // names the kenttä off that flag (app/hurdles.js).
  assert.deepEqual(at('P11 60m aidat', '11', board), {
    colour: 'vihreä',
    symbol: 'ympyrä',
    size: null,
    of: null,
    venue: null,
  });
  // hurdleRelaySpec reads the board too, so a leg on positions the board
  // does not paint has no mark. (Break on purpose: hand hurdleRelaySpec the
  // sheet.)
  const rel = (EventName, Gender, Age, t) => hurdleRelaySpec({ EventName, Gender, Age }, t);
  // A setting the board leaves unpainted still finds other races' paint
  // under its tapes. (Break on purpose: require the direction's own mark in
  // tapeMark.)
  assert.deepEqual(
    rel('P13 4x60m aitaviesti', 'Male', '13', board).tapes.map((t) => t.mark && `${t.mark.colour} ${t.mark.symbol}`),
    [
      'keltainen viiva',
      null,
      null,
      null,
      null,
      null,
      'musta kolmio',
      'vihreä suorakulmio',
      null,
      null,
      null,
      null,
      'valkoinen suorakulmio',
      null,
    ],
  );
  assert.equal(rel('M15 4x80m aitaviesti', 'Male', '15', board).rows[0].mark.colour, 'vihreä');
  assert.deepEqual(
    rel('M/N 4x100m aitaviesti', 'Male', '0', board).rows.map((r) => [r.class, r.mark?.colour ?? null]),
    [
      ['N', null],
      ['M', 'keltainen'],
    ],
  );
  // (Break on purpose: flag every row of a kenttä's board, or none.)
  const drifted = {
    ...kentta.file,
    marks: kentta.file.marks.map((m) => (m.distance === 400 ? { ...m, colour: 'keltainen' } : m)),
  };
  const after = venueTable(hurdles, drifted);
  assert.equal(at('M 400m aidat', '0', after).venue, true);
  assert.equal(at('M 110m aidat', '0', after).venue, null);
  // With no board marks, venueTable returns the table itself.
  assert.equal(venueTable(hurdles, { checked: '2026-08-16' }), hurdles);
  assert.equal(venueTable(hurdles, null), hurdles);
});

// hurdleStartSetups gives the box a row per setting, not per class, with the
// lanes it stands in. `detailed` is renderGroup's shape, the schedule row
// with the drawn round.
test('hurdle setups', () => {
  const day = demoSchedule()[Object.keys(demoSchedule())[0]];
  const detail = (entries) =>
    entries.map((e) => ({
      ...e,
      schedRound: e.round,
      round: (DEMO_EVENTS[e.round.EventId].Rounds || []).find((r) => r.Id === e.round.Id) || null,
    }));
  const start = (event) => detail(groupRounds(day, 'Track').find((g) => g.event === event).entries);
  const setups = (entries) => hurdleStartSetups(entries, hurdles);

  // The demo's 60 m start has three settings, and e49 carries a group's Age
  // that the box must not read (docs/tuloslista-api.md).
  const short = setups(start('60m aidat'));
  assert.equal(short.distance, 60);
  assert.deepEqual(
    short.tables.map((t) => t.heat),
    [1],
  );
  // Only the lanes say the settings stand side by side (docs/hurdles.md,
  // "What the meets do"). Rows sort by the lowest lane, the order an official
  // walks. (Break on purpose: sort them by anything else.)
  assert.deepEqual(
    short.tables[0].rows.map((r) => [r.lanes, r.categories]),
    [
      [[1], ['M65']],
      [[3], ['M50']],
      [[5, 6], ['M17']],
    ],
  );
  assert.deepEqual(short.tables[0].rows[0].setup, { count: 5, toFirst: 12, interval: 8, toFinish: 16, height: [83.8] });
  // A setting with fewer hurdles than a mark stands on its first few, and
  // `of` gives the mark's count.
  assert.deepEqual(
    short.tables[0].rows.map((r) => r.mark?.colour ?? null),
    ['musta', 'keltainen', 'sininen'],
  );
  assert.deepEqual(
    short.tables[0].rows.map((r) => r.mark?.of ?? null),
    [6, null, null],
  );

  // A class with no setting keeps a row with none (e11), and an undrawn class
  // goes in a table after the heats.
  const long = setups(start('400m aidat'));
  assert.deepEqual(
    long.tables.map((t) => t.heat),
    [1, null],
  );
  assert.deepEqual(
    long.tables[0].rows.map((r) => [r.lanes, r.categories]),
    [[[1, 2], ['M']]],
  );
  assert.deepEqual(
    long.tables[1].rows.map((r) => [r.categories, r.setup?.height ?? null]),
    [
      [['P13'], null],
      [['N'], [76.2]],
    ],
  );
  // Two settings on the same positions stand on the same mark.
  assert.equal(long.tables[0].rows[0].mark.colour, 'vihreä');
  assert.equal(long.tables[1].rows[1].mark.colour, 'vihreä');

  // Classes that agree on every measurement share one row, off a measured
  // start (2026-01). (Break on purpose: group on the class, not the setup.)
  const shared = setups(
    groupRounds(
      [
        {
          EventName: 'M15 60m aidat',
          Gender: 'Male',
          Age: '15',
          Category: 'Track',
          BeginDateTimeWithTZ: '2026-01-18T16:00:00.0000000+00:00',
        },
        {
          EventName: 'M19 60m aidat',
          Gender: 'Male',
          Age: '19',
          Category: 'Track',
          BeginDateTimeWithTZ: '2026-01-18T16:00:00.0000000+00:00',
        },
        {
          EventName: 'N19 60m aidat',
          Gender: 'Female',
          Age: '19',
          Category: 'Track',
          BeginDateTimeWithTZ: '2026-01-18T16:00:00.0000000+00:00',
        },
      ],
      'Track',
    )[0].entries.map((e) => ({ ...e, schedRound: e.round, round: null })),
  );
  assert.deepEqual(
    shared.tables.map((t) => t.heat),
    [null],
  );
  assert.deepEqual(
    shared.tables[0].rows.map((r) => [r.categories, r.lanes]),
    [
      [['M15', 'N19'], []],
      [['M19'], []],
    ],
  );

  // A lane number means something only inside a heat. A measured 200 m
  // (2026-08) puts a second class in one of its five heats, so one lane holds
  // each class in turn. (Break on purpose: key the tables on the setting
  // alone.)
  const heatedStart = [
    [
      'T13 200m aidat',
      'Female',
      '13',
      [
        [1, [2, 3, 4, 5]],
        [4, [2, 3]],
      ],
    ],
    ['N15 200m aidat', 'Female', '15', [[4, [4, 5]]]],
  ].map(([EventName, Gender, Age, heats]) => ({
    label: EventName.split(' ')[0],
    schedRound: { EventName, Gender, Age },
    round: { Heats: heats.map(([Index, lanes]) => ({ Index, Allocations: lanes.map((Position) => ({ Position })) })) },
  }));
  const heated = setups(heatedStart);
  assert.deepEqual(
    heated.tables.map((t) => t.heat),
    [1, 4],
  );
  assert.deepEqual(
    heated.tables[0].rows.map((r) => [r.lanes, r.categories]),
    [[[2, 3, 4, 5], ['T13']]],
  );
  // One heat can hold a class with a setting beside a class with none.
  assert.deepEqual(
    heated.tables[1].rows.map((r) => [r.lanes, r.categories, r.setup?.count ?? null]),
    [
      [[2, 3], ['T13'], 10],
      [[4, 5], ['N15'], null],
    ],
  );

  // The union rows keep heats apart (perHeat) only where one lane holds two
  // settings. (Break on purpose: let the overlap test compare a row against
  // itself.)
  assert.equal(short.perHeat, false);
  assert.equal(short.multiClass, true);
  assert.deepEqual(
    short.rows.map((r) => [r.lanes, r.categories]),
    [
      [[1], ['M65']],
      [[3], ['M50']],
      [[5, 6], ['M17']],
    ],
  );
  assert.equal(heated.perHeat, true);
  // One class over two heats is one row over the union, off a measured 60 m
  // aidat (2026-08).
  const union = setups([
    {
      label: 'N',
      schedRound: { EventName: 'N 60m aidat' },
      round: {
        Heats: [
          { Index: 1, Allocations: [2, 3, 4, 5, 6, 7].map((Position) => ({ Position })) },
          { Index: 2, Allocations: [2, 3, 4, 5, 6, 7, 8].map((Position) => ({ Position })) },
        ],
      },
    },
  ]);
  assert.equal(union.perHeat, false);
  assert.equal(union.multiClass, false);
  assert.deepEqual(
    union.rows.map((r) => [r.lanes, r.categories]),
    [[[2, 3, 4, 5, 6, 7, 8], ['N']]],
  );
  // The demo's 400 m puts the drawn setting first. (Break on purpose: sort a
  // row with no lanes as lane 0.)
  assert.equal(long.perHeat, false);
  assert.deepEqual(
    long.rows.map((r) => [r.categories, r.lanes]),
    [
      [['M'], [1, 2]],
      [['P13'], []],
      [['N'], []],
    ],
  );

  // hurdleSetupBlocks gives one block over the union rows, or a perHeat
  // start's drawn heats and then its undrawn classes. (Break on purpose:
  // split every start by `tables`.)
  const blocks = (info) => hurdleSetupBlocks(info).map((b) => [b.drawn, b.sections.map((s) => s.heat)]);
  assert.deepEqual(blocks(long), [[true, [null]]]);
  assert.equal(hurdleSetupBlocks(long)[0].sections[0].rows, long.rows);
  assert.deepEqual(blocks(shared), [[false, [null]]]);
  assert.deepEqual(blocks(heated), [[true, [1, 4]]]);
  const pending = setups([
    ...heatedStart,
    { label: 'T12', schedRound: { EventName: 'T12 200m aidat', Gender: 'Female', Age: '12' }, round: null },
  ]);
  assert.equal(pending.perHeat, true);
  assert.deepEqual(blocks(pending), [
    [true, [1, 4]],
    [false, [null]],
  ]);

  assert.equal(setups(start('100m')), null);

  assert.equal(laneRange([2, 3, 4, 5, 6, 7]), '2–7');
  assert.equal(laneRange([1]), '1');
  assert.equal(laneRange([5, 6]), '5–6');
  assert.equal(laneRange([1, 3, 4, 8]), '1, 3–4, 8');
  assert.equal(laneRange([]), '');
});
