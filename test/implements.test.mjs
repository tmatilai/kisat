// Tests the implement table (docs/implements.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shuttleLaneText, shuttlePairDraw, tableCategory } from '../public/lib/hurdles.js';
import {
  hurdleTableProblems,
  implementDimText,
  implementSpec,
  implementTableProblems,
  implementTableSections,
  implementWeightRows,
  implementWeightText,
  tableClassAges,
} from '../public/lib/tables.js';
import hurdles from '../public/data/hurdles.json' with { type: 'json' };
import implementTable from '../public/data/implements.json' with { type: 'json' };

// --- The implement table (docs/implements.md) ---
test('implementTableSections', () => {
  const problems = implementTableProblems(implementTable);
  assert.deepEqual(problems, [], `implements.json: ${problems.join('; ')}`);
  const broken = () => JSON.parse(JSON.stringify(implementTable));
  // (Break on purpose: a weight typed in kilograms.)
  {
    const t = broken();
    t.weights.find((w) => w.row === 'M').kuula = 7.26;
    assert.deepEqual(implementTableProblems(t), ['M kuula: no dimensions for 7.26 g']);
  }
  // (Break on purpose: a range the wrong way round, and a spec nobody throws.)
  {
    const t = broken();
    t.specs.find((s) => s.implement === 'kuula' && s.weight === 7260 && s.source === 'SUL').diameter = [130, 110];
    t.specs.push({
      implement: 'kiekko',
      weight: 1250,
      source: 'SUL',
      diameter: [1, 2],
      thickness: [1, 2],
      plate: [1, 2],
    });
    assert.deepEqual(implementTableProblems(t), [
      'kuula 7260 SUL: diameter is [130,110]',
      'kiekko 1250 SUL: no row throws it',
    ]);
  }
  // (Break on purpose: leave a gap after a masters band.)
  {
    const t = broken();
    t.categories.find((c) => c.row === 'N 60-74').age = [60, 69];
    assert.deepEqual(implementTableProblems(t), ['N 75+: starts at 75, expected 70']);
  }

  assert.equal(implementWeightText(7260), '7,26 kg');
  assert.equal(implementWeightText(1000), '1 kg');
  assert.equal(implementWeightText(600), '600 g');
  assert.equal(implementDimText([110, 130]), '110–130');
  assert.equal(implementDimText([null, 270]), 'enint. 270');
  assert.equal(implementDimText(1195), '1195');
  assert.equal(implementDimText('kädensijalla'), 'kädensijalla');
  assert.equal(implementDimText(undefined), '–');

  // A row's dimensions are its own source's, else any source's
  // (docs/implements.md).
  assert.deepEqual(implementSpec(implementTable, 'kiekko', 750, 'WMA').diameter, [166, 182]);
  assert.deepEqual(implementSpec(implementTable, 'kiekko', 750, 'SUL').diameter, [165, 172]);
  assert.deepEqual(implementSpec(implementTable, 'kiekko', 2000, 'WMA').diameter, [219, 221]);
  assert.equal(implementSpec(implementTable, 'kiekko', 1250), null);

  const all = implementTableSections(implementTable);
  assert.deepEqual(
    all.map((g) => [g.gender, g.implements.map((i) => `${i.name} ${i.rows.length}`)]),
    [
      ['Female', ['Keihäs 5', 'Kiekko 4', 'Kuula 7', 'Moukari 5', 'Painonheitto 4']],
      ['Male', ['Keihäs 8', 'Kiekko 8', 'Kuula 11', 'Moukari 10', 'Painonheitto 5']],
    ],
  );
  // Every class is on one row per implement, the row the lookup gives, and
  // no band name appears.
  for (const g of all) {
    for (const i of g.implements) {
      const seen = new Set();
      for (const r of i.rows) {
        for (const cls of r.categories) {
          assert.ok(!seen.has(cls), `${cls} ${i.name} twice`);
          seen.add(cls);
          assert.ok(!/[ -]/.test(cls), `no band name: ${cls}`);
          const age = cls.length <= 1 ? 0 : Number(cls.slice(1));
          const cat = tableCategory(implementTable, { gender: g.gender, age });
          assert.equal(implementTable.weights.find((w) => w.row === cat.row)[i.id], r.weight, `${cls} ${i.name}`);
        }
      }
      assert.equal(seen.size, i.id === 'painonheitto' ? 11 : 23, `${g.gender} ${i.name} names every class`);
    }
  }
  const men = (name) => all[1].implements.find((i) => i.name === name).rows;
  assert.deepEqual(
    men('Kuula')[6].categories,
    ['M22', 'M', 'M35', 'M40', 'M45'],
    'one weight across the sources merges',
  );
  assert.deepEqual(
    men('Kuula')[7],
    { categories: ['M50', 'M55'], weight: 6000, spec: { diameter: [105, 130] } },
    "a band written out, on WMA's own dimensions",
  );
  const women = (name) => all[0].implements.find((i) => i.name === name).rows;
  assert.deepEqual(
    women('Kiekko')
      .slice(2)
      .map((r) => [r.categories.length, r.weight, r.spec.diameter]),
    [
      [12, 1000, [180, 182]],
      [3, 750, [166, 182]],
    ],
    'the same weight on other dimensions is another row',
  );
  assert.deepEqual(women('Painonheitto')[0].categories, ['N35', 'N40', 'N45'], 'masters only');
  // implementWeightRows has a column per implement and a row per set of
  // weights. A column that no row throws is left out.
  const bare = implementWeightRows(implementTable);
  assert.deepEqual(
    bare.map((g) => [g.columns.map((c) => c.name).join(), g.rows.length]),
    [
      ['Keihäs,Kiekko,Kuula,Moukari,Painonheitto', 9],
      ['Keihäs,Kiekko,Kuula,Moukari,Painonheitto', 12],
    ],
  );
  assert.deepEqual(bare[0].rows[4], {
    categories: ['N19', 'N22', 'N'],
    weights: { kuula: 4000, kiekko: 1000, moukari: 4000, keihas: 600, painonheitto: null },
  });
  assert.deepEqual(
    bare[0].rows[5].categories,
    ['N35', 'N40', 'N45'],
    'the painonheitto parts the masters from the seniors',
  );
  assert.deepEqual(bare[1].rows[6], {
    categories: ['M22', 'M'],
    weights: { kuula: 7260, kiekko: 2000, moukari: 7260, keihas: 800, painonheitto: null },
  });
  const youth = implementWeightRows(implementTable, [13]);
  assert.deepEqual(
    youth.map((g) => [g.columns.length, g.rows.map((r) => r.categories)]),
    [
      [4, [['T13']]],
      [4, [['P13']]],
    ],
  );
  assert.deepEqual(
    bare.map((g) => g.rows[0].categories.slice(0, 2)),
    [
      ['T8', 'T9'],
      ['P8', 'P9'],
    ],
    "the eight-year-olds throw the nines' implements",
  );
  assert.deepEqual(
    implementWeightRows(implementTable, [7]).map((g) => [g.columns.length, g.rows.length]),
    [
      [0, 0],
      [0, 0],
    ],
  );

  // The filter names the chosen classes alone, as on the hurdle table.
  const f = implementTableSections(implementTable, [13, 40]);
  assert.deepEqual(
    f.map((g) => g.implements.map((i) => i.rows.map((r) => r.categories))),
    [
      [[['T13'], ['N40']], [['T13'], ['N40']], [['T13'], ['N40']], [['T13'], ['N40']], [['N40']]],
      [[['P13'], ['M40']], [['P13'], ['M40']], [['P13'], ['M40']], [['P13'], ['M40']], [['M40']]],
    ],
  );
  assert.deepEqual(implementTableSections(implementTable, [16])[1].implements[2].rows, [
    { categories: ['M16'], weight: 5000, spec: { diameter: [100, 120] } },
  ]);
  assert.deepEqual(
    implementTableSections(implementTable, [7]).map((g) => g.implements),
    [[], []],
    'no seven-year-olds in the table',
  );
  assert.deepEqual(tableClassAges(implementTable).slice(0, 3), [8, 9, 10]);
  assert.deepEqual(
    tableClassAges(hurdles, implementTable),
    tableClassAges(hurdles),
    'one row of chips: the throws add no age',
  );
});

// An aitaviesti start's lane cell names the pair, but only where the draw
// gives each team a pair of its own (shuttleLaneText, shuttlePairDraw).
test('shuttleLaneText and shuttlePairDraw', () => {
  const heat = (...lanes) => ({ Heats: [{ Index: 1, Allocations: lanes.map((l) => ({ Position: l })) }] });

  // Either lane of a pair names the pair, since meets draw either
  // (docs/tuloslista-api.md).
  assert.equal(shuttleLaneText(3), '3–4');
  assert.equal(shuttleLaneText(4), '3–4');
  assert.equal(shuttleLaneText(null), '');

  // A draw that numbers the pairs puts two teams in one pair
  // (docs/tuloslista-api.md), so the cell keeps the drawn number. (Break on
  // purpose: return true regardless.)
  assert.equal(shuttlePairDraw([heat(1, 2, 3)]), false);
  assert.equal(shuttlePairDraw([heat(3, 5, 7)]), true);
  // Adjacent numbers are two pairs named by opposite lanes
  // (docs/tuloslista-api.md).
  assert.equal(shuttlePairDraw([heat(4, 5)]), true);

  // Pairs are counted per physical heat over every category of the start.
  // (Break on purpose: key the pairs by round, not by Heats[].Index.)
  assert.equal(shuttlePairDraw([heat(3), heat(4)]), false);
  assert.equal(shuttlePairDraw([heat(3), heat(5)]), true);
  assert.equal(
    shuttlePairDraw([
      { Heats: [{ Index: 1, Allocations: [{ Position: 3 }] }] },
      { Heats: [{ Index: 2, Allocations: [{ Position: 3 }] }] },
    ]),
    true,
  );

  // An undrawn round's heat shell (roundAllocated's trap) names no pair.
  assert.equal(shuttlePairDraw([{ Heats: [{ Index: 1, Allocations: [] }] }]), false);
  assert.equal(shuttlePairDraw([]), false);
});

// hurdleTableProblems proof-reads the relay rows too.
test('hurdleTableProblems proof-reads the relay rows too', () => {
  const broken = () => JSON.parse(JSON.stringify(hurdles));
  // (Break on purpose: one interval moved.)
  {
    const t = broken();
    t.relays.find((r) => r.row === 'P10-11').interval = 6.6;
    assert.deepEqual(hurdleTableProblems(t), [
      'P10-11 60: the parts add up to 60.6',
      '60 vihreä ympyrä: P10-11 stands at 7|10.5|6.6, not 7|10.5|6.5',
    ]);
  }
  // (Break on purpose: move a row off the mark that lists it.)
  {
    const t = broken();
    const r = t.relays.find((x) => x.row === 'P12-13');
    r.toFirst = 11.5;
    r.toFinish = 6.5;
    assert.deepEqual(hurdleTableProblems(t), ['60 musta suorakulmio: P12-13 stands at 7|11.5|7, not 7|11|7']);
  }
  // (Break on purpose: the sekaviesti's rows miss a leg.)
  {
    const t = broken();
    t.relays.find((r) => r.gender === 'Mixed').legs = [1];
    assert.deepEqual(hurdleTableProblems(t), ["M/N sekaviesti: the rows' legs are 1, 2, 4"]);
  }
  // (Break on purpose: two bands over one age.)
  {
    const t = broken();
    t.relays.find((r) => r.row === 'P12-13').age = [11, 13];
    assert.deepEqual(hurdleTableProblems(t), ['P12-13 and P10-11: both cover an age at 60 m']);
  }
  // (Break on purpose: paint another mark under a row's odd legs. The render
  // has one mark cell.)
  {
    const t = broken();
    t.marks.push({ distance: 60, count: 7, toFirst: 7, interval: 7, colour: 'valkoinen', symbol: 'kolmio' });
    assert.deepEqual(hurdleTableProblems(t), [
      'P12-13 60: the two directions stand on different marks',
      'T12-13 60: the two directions stand on different marks',
    ]);
  }
});
