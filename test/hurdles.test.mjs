// Tests the hurdle and steeplechase setups (docs/hurdles.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageChipLabel, ageChipRows } from '../public/lib/ages.js';
import {
  hurdleDistance,
  hurdleMark,
  hurdleMarkGlyph,
  hurdleRelayLeg,
  hurdleRelaySpec,
  hurdleSheetBlocks,
  hurdleSpec,
  hurdleStartSetups,
  hurdleTapes,
  isHurdleStart,
  shuttleBandNames,
  shuttleStartRows,
  steepleDistance,
  steepleSpec,
  steepleStartRows,
} from '../public/lib/hurdles.js';
import { groupRounds } from '../public/lib/schedule.js';
import {
  hurdleTableProblems,
  hurdleTableSections,
  tableClassAges,
  tableClassName,
  tablePageSheet,
} from '../public/lib/tables.js';
import { venueTable } from '../public/lib/venues.js';
import { DEMO_EVENTS, demoSchedule } from '../public/demo.js';
import hurdles from '../public/data/hurdles.json' with { type: 'json' };

// --- Hurdle setups: hurdles.json and the lookup over it ------------------
//
// hurdleTableProblems proof-reads the hand-edited file (docs/hurdles.md).
test('Hurdle setups: hurdles.json and the lookup over it', () => {
  const problems = hurdleTableProblems(hurdles);
  assert.deepEqual(problems, [], `hurdles.json: ${problems.join('; ')}`);

  const broken = () => JSON.parse(JSON.stringify(hurdles));
  // (Break on purpose: a date typed the Finnish way round.)
  {
    const t = broken();
    t.validFrom = '1.1.2027';
    assert.deepEqual(hurdleTableProblems(t), ['validFrom: not an ISO date']);
  }
  // (Break on purpose: one interval moved.)
  {
    const t = broken();
    t.setups.find((s) => s.row === 'M' && s.distance === 110).interval = 9.15;
    assert.match(hurdleTableProblems(t)[0], /^M 110: the parts add up to 110\.09$/);
  }
  // (Break on purpose: one bar as two heights under a centimetre apart.)
  {
    const t = broken();
    t.setups.find((s) => s.row === 'M 60-69' && s.distance === 100).height = [84];
    assert.deepEqual(hurdleTableProblems(t), ['heights 83.8 and 84: less than a centimetre apart']);
  }
  // (Break on purpose: narrow a band and leave an age in none.)
  {
    const t = broken();
    t.categories.find((c) => c.row === 'M17').age = [17, 17];
    assert.deepEqual(hurdleTableProblems(t), ['M17: starts at 17, expected 16']);
  }
  // A mark is keyed on positions, and each class it lists must stand at them.
  // (Break on purpose: move a mark off its classes' positions.)
  {
    const t = broken();
    t.marks.find((m) => m.distance === 60 && m.colour === 'sininen').toFirst = 13;
    assert.deepEqual(hurdleTableProblems(t), [
      '60 sininen suorakulmio: M stands at 5|13.72|9.14, not 5|13|9.14',
      '60 sininen suorakulmio: M22 stands at 5|13.72|9.14, not 5|13|9.14',
      '60 sininen suorakulmio: M19 stands at 5|13.72|9.14, not 5|13|9.14',
      '60 sininen suorakulmio: M17 stands at 5|13.72|9.14, not 5|13|9.14',
    ]);
  }
  // (Break on purpose: a second mark on one set of positions, which the
  // lookup never reaches.)
  {
    const t = broken();
    const m = t.marks.find((x) => x.distance === 60 && x.colour === 'vihreä');
    t.marks.push({ ...m, colour: 'valkoinen' });
    assert.deepEqual(hurdleTableProblems(t), ['60 valkoinen ympyrä: a second mark at 10.5|6.5']);
  }
  // The lookup takes the first mark that covers a setting, so two unalike
  // ones may not cover it. (Break on purpose: copy a covering line in
  // another colour.)
  {
    const t = broken();
    const green = t.marks.find((m) => m.distance === 300);
    t.marks.push({ ...green, distance: 250, toFirst: 0, colour: 'keltainen', rows: [] });
    assert.deepEqual(hurdleTableProblems(t), [
      'M 80+ 200: vihreä viiva and keltainen viiva both cover it',
      'N 70+ 200: vihreä viiva and keltainen viiva both cover it',
    ]);
  }
  // A colour or symbol with no glyph would draw as nothing (markGlyph,
  // app/hurdles.js). (Break on purpose: a symbol word off no sheet.)
  {
    const t = broken();
    t.marks.find((m) => m.distance === 80).symbol = 'vinoneliö';
    assert.deepEqual(hurdleTableProblems(t), ['80 vihreä vinoneliö: no shape to draw it as']);
  }
});

// A glyph is the shape and colour slugs the stylesheet draws. The size plays
// no part.
assert.deepEqual(hurdleMarkGlyph({ colour: 'musta', symbol: 'ympyrä', size: 'halk. 5 cm' }), {
  shape: 'circle',
  colour: 'black',
});
assert.deepEqual(hurdleMarkGlyph({ colour: 'vihreä', symbol: 'viiva' }), { shape: 'line', colour: 'green' });
assert.equal(hurdleMarkGlyph({ colour: 'punainen', symbol: 'ympyrä' }), null);
assert.equal(hurdleMarkGlyph(null), null);

assert.equal(hurdleDistance('M 110m aidat'), 110);
assert.equal(hurdleDistance('N17 7-ottelu  100m aidat'), 100);
assert.equal(hurdleDistance('P13 200m aidat'), 200);
assert.equal(hurdleDistance('P11 4x60m aitaviesti'), null);
assert.equal(hurdleDistance('M17 2000m esteet'), null);
assert.equal(hurdleDistance('N 200m'), null);
// No measured meet names a relay "aidat", and such a name is still no
// individual race.
assert.equal(hurdleDistance('P11 4x60m aidat'), null);

// The (name, Gender, Age) triples measured off real meets each land on their
// row.
test('The measured triples each land on their row', () => {
  const measured = [
    ['M 110m aidat', 'Male', '0', 'M'],
    ['M14 80m aidat', 'Male', '14', 'M14'],
    ['M15 100m aidat', 'Male', '15', 'M15'],
    ['M15 5-ottelu  100m aidat', 'Male', '15', 'M15'],
    ['M16 110m aidat', 'Male', '16', 'M17'],
    ['M16 400m aidat', 'Male', '16', 'M17'],
    ['M17 10-ottelu  110m aidat', 'Male', '17', 'M17'],
    ['M17 110m aidat', 'Male', '17', 'M17'],
    ['M17 400m aidat', 'Male', '17', 'M17'],
    ['M19 10-ottelu  110m aidat', 'Male', '19', 'M19'],
    ['M19 110m aidat', 'Male', '19', 'M19'],
    ['M22 10-ottelu  110m aidat', 'Male', '22', 'M22'],
    ['M30 400m aidat', 'Male', '30', 'M'],
    ['M50 400m aidat', 'Male', '50', 'M 50-59'],
    ['N 100m aidat', 'Female', '0', 'N'],
    ['N14 80m aidat', 'Female', '14', 'N14'],
    ['N15 300m aidat', 'Female', '15', 'N15'],
    ['N15 5-ottelu  80m aidat', 'Female', '15', 'N15'],
    ['N15 80m aidat', 'Female', '15', 'N15'],
    ['N16 100m aidat', 'Female', '16', 'N17'],
    ['N16 400m aidat', 'Female', '16', 'N17'],
    ['N17 100m aidat', 'Female', '17', 'N17'],
    ['N17 400m aidat', 'Female', '17', 'N17'],
    ['N17 7-ottelu  100m aidat', 'Female', '17', 'N17'],
    ['N19 100m aidat', 'Female', '19', 'N19'],
    ['N19 7-ottelu  100m aidat', 'Female', '19', 'N19'],
    ['N22 7-ottelu  100m aidat', 'Female', '22', 'N22'],
    ['N30 400m aidat', 'Female', '30', 'N'],
    ['P11 60m aidat', 'Male', '11', 'P11'],
    ['P12 5-ottelu  60m aidat', 'Male', '12', 'P12'],
    ['P13 200m aidat', 'Male', '13', 'P13'],
    ['P13 5-ottelu  60m aidat', 'Male', '13', 'P13'],
    ['P13 60m aidat', 'Male', '13', 'P13'],
    ['P14 300m aidat', 'Male', '14', 'M14'],
    ['T11 60m aidat', 'Female', '11', 'T11'],
    ['T12 5-ottelu  60m aidat', 'Female', '12', 'T12'],
    ['T13 200m aidat', 'Female', '13', 'T13'],
    ['T13 5-ottelu  60m aidat', 'Female', '13', 'T13'],
    ['T13 60m aidat', 'Female', '13', 'T13'],
    ['T14 300m aidat', 'Female', '14', 'N14'],
    ['T14 5-ottelu  80m aidat', 'Female', '14', 'N14'],
  ];
  for (const [EventName, Gender, Age, row] of measured) {
    const spec = hurdleSpec({ EventName, Gender, Age }, hurdles);
    assert.equal(spec.row, row, EventName);
    assert.ok(spec.setup, `${EventName}: no setup`);
    // The results endpoint carries the name alone, which gives the same row.
    // (Break on purpose: drop the name's reading from hurdleKey.)
    assert.equal(hurdleSpec({ EventName }, hurdles).row, row, `${EventName}, label only`);
  }
});

test("hurdleSpec: a class's setup, off the event name and the age", () => {
  const spec = (EventName, Gender, Age) => hurdleSpec({ EventName, Gender, Age }, hurdles);
  assert.deepEqual(spec('M 110m aidat', 'Male', '0'), {
    distance: 110,
    category: 'M',
    row: 'M',
    source: 'SUL',
    setup: { count: 10, toFirst: 13.72, interval: 9.14, toFinish: 14.02, height: [106.7] },
    mark: { colour: 'sininen', symbol: 'viiva', size: '10 cm', of: null, venue: null },
  });
  // A masters class lands on its own band. Its positions find a mark whose
  // class list names no masters class.
  assert.deepEqual(spec('M50 400m aidat', 'Male', '50'), {
    distance: 400,
    category: 'M50',
    row: 'M 50-59',
    source: 'WMA',
    setup: { count: 10, toFirst: 45, interval: 35, toFinish: 40, height: [83.8] },
    mark: { colour: 'vihreä', symbol: 'viiva', size: '10 cm', of: null, venue: null },
  });
  assert.deepEqual(spec('P9 60m aidat', 'Male', '9').setup.height, [50, 40]);

  // A setting with no mark of its own can stand wholly on another race's
  // paint (docs/hurdles.md, "Every race on a track finishes on one line").
  // (Break on purpose: drop the markCovers branch and both read unmarked.)
  assert.deepEqual(spec('M85 200m aidat', 'Male', '85').mark, {
    colour: 'vihreä',
    symbol: 'viiva',
    size: '10 cm',
    of: null,
    venue: null,
  });
  assert.deepEqual(spec('N75 200m aidat', 'Female', '75').mark, {
    colour: 'vihreä',
    symbol: 'viiva',
    size: '10 cm',
    of: null,
    venue: null,
  });
  // On another race's paint `of` stays null, since those hurdles are the
  // mark's last few. (Break on purpose: carry the covering mark's count
  // through.) A mark painted for the race itself keeps its count.
  assert.equal(spec('M65 60m aidat', 'Male', '65').mark.of, 6);
  // A setting with only some hurdles on a mark is unmarked. (Break on
  // purpose: accept a `some` match.)
  assert.equal(spec('M65 100m aidat', 'Male', '65').mark, null);
  assert.equal(spec('M75 80m aidat', 'Male', '75').mark, null);
  assert.equal(spec('N55 60m aidat', 'Female', '55').mark, null);
  // 11 settings are painted nowhere, every one of them WMA's. (Break on
  // purpose: widen the tolerance to two metres and five settings find paint
  // they miss.)
  const unpainted = hurdles.setups.filter((x) => !hurdleMark(hurdles, x.distance, x));
  assert.equal(unpainted.length, 11);
  assert.ok(
    unpainted.every((x) => hurdles.categories.find((c) => c.row === x.row).source === 'WMA'),
    "every unpainted setting is WMA's",
  );
  // An unmarked setting gets a tape per hurdle with the paint under each
  // (hurdleTapes). A setting with its own mark gets none, and so does one
  // with no paint under any hurdle. (Break on purpose: return the tapes
  // whatever the paint.)
  const n70 = hurdleSpec({ EventName: 'N70 60m aidat', Gender: 'Female', Age: '70' }, hurdles);
  assert.equal(n70.mark, null);
  const tapes = hurdleTapes(60, n70.setup, null, hurdles);
  assert.deepEqual(
    tapes.map((t) => [t.at, t.gap, t.mark && `${t.mark.colour} ${t.mark.symbol}`]),
    [
      [11, 11, 'musta suorakulmio'],
      [17, 6, 'vihreä ympyrä'],
      [23, 6, null],
      [29, 6, null],
      [35, 6, null],
    ],
  );
  const m17 = hurdleSpec({ EventName: 'M17 60m aidat', Gender: 'Male', Age: '17' }, hurdles);
  assert.equal(hurdleTapes(60, m17.setup, m17.mark, hurdles), null);
  assert.equal(hurdleTapes(60, n70.setup, null, { ...hurdles, marks: [] }), null);
  const setups = (EventName, Gender, Age) =>
    hurdleStartSetups([{ label: Age, schedRound: { EventName, Gender, Age }, round: {} }], hurdles).rows[0];
  assert.equal(setups('N70 60m aidat', 'Female', '70').tapes.length, 5);
  assert.equal(setups('M17 60m aidat', 'Male', '17').tapes, null);
  // A class with no setting at the distance keeps its row and a null setup,
  // as the demo's e11 does.
  assert.deepEqual(spec('P13 400m aidat', 'Male', '13'), {
    distance: 400,
    category: 'P13',
    row: 'P13',
    source: 'SUL',
    setup: null,
    mark: null,
  });
  assert.equal(spec('N 200m', 'Female', '0'), null);
  assert.equal(spec('M/N 4x100m aitaviesti', 'Male', '0'), null);
  // A class no band covers has no row.
  assert.equal(spec('Mixed 15 60m aidat', null, null).row, null);
  assert.equal(spec('P7 60m aidat', 'Male', '7').row, null);
  // The name's class beats a group's Age (docs/tuloslista-api.md).
  // (Break on purpose: read Gender and Age first, and both land on the
  // senior rows.)
  assert.equal(spec('M65 60m aidat', 'Male', '30').row, 'M 60-69');
  assert.equal(spec('N40 60m aidat', 'Female', '30').row, 'N 40-49');
  // A name with no class falls back to Gender and Age. "Lisenssitömät  60m"
  // is such a name on a measured flat race (2026-01). An empty Age is
  // missing, not the adult class. (Break on purpose: read it with Number('').)
  assert.equal(spec('Lisenssitömät  60m aidat', 'Female', '12').row, 'T12');
  assert.equal(spec('Lisenssitömät  60m aidat', 'Female', '').row, null);
});

// Classes of one start can stand in different places, or share the positions
// at different heights.
test('Classes of one start can stand in different places, or share the positions at different heights', () => {
  const at = (EventName, Age) => hurdleSpec({ EventName, Gender: 'Male', Age }, hurdles).setup;
  assert.notEqual(at('P11 60m aidat', '11').toFirst, at('P13 60m aidat', '13').toFirst);
  assert.equal(at('M17 400m aidat', '17').toFirst, at('M 400m aidat', '0').toFirst);
  assert.notDeepEqual(at('M17 400m aidat', '17').height, at('M 400m aidat', '0').height);
});

// --- Aitaviesti: the relay table and the shuttle's tapes ------------------
//
// The relays' event names are measured against a meet (2026-02).
test("Aitaviesti: the relay table and the shuttle's tapes", () => {
  const spec = (EventName, Gender, Age) => hurdleRelaySpec({ EventName, Gender, Age }, hurdles);

  assert.equal(hurdleRelayLeg('P11 4x60m aitaviesti'), 60);
  assert.equal(hurdleRelayLeg('N15 4x80m aitaviesti'), 80);
  assert.equal(hurdleRelayLeg('M 110m aidat'), null);
  assert.equal(hurdleRelayLeg('M15 4x800m viesti'), null);

  // isHurdleStart covers all three kinds, and the day sheet's menu row asks
  // it. (Break on purpose: drop the steeple arm.)
  assert.ok(['M 110m aidat', 'P11 4x60m aitaviesti', 'N 1500m esteet'].every(isHurdleStart));
  assert.ok(!isHurdleStart('M15 4x800m viesti') && !isHurdleStart('N Keihäs'));

  // A symmetric setting stands at the same places in both directions. One
  // tape serves two hurdles, and one mark serves every leg. (Break on
  // purpose: look the mark up in the even legs' direction only.)
  const p11 = spec('P11 4x60m aitaviesti', 'Male', '11');
  assert.equal(p11.row, 'P10-11');
  assert.deepEqual(p11.rows, [
    {
      class: null,
      legs: [1, 2, 3, 4],
      pairs: null,
      count: 7,
      toFirst: 10.5,
      interval: 6.5,
      toFinish: 10.5,
      height: [60],
      markLegs: null,
      mark: { colour: 'vihreä', symbol: 'ympyrä', size: 'halk. 5 cm', of: null, venue: null },
    },
  ]);
  // A tape where two marks coincide takes its row's own mark. (Break on
  // purpose: take the first mark found in tapeMark.)
  const circle = { colour: 'vihreä', symbol: 'ympyrä' };
  assert.deepEqual(p11.tapes, [
    { at: 10.5, legs: [1, 2, 3, 4], gap: 10.5, mark: circle },
    { at: 17, legs: [1, 2, 3, 4], gap: 6.5, mark: circle },
    { at: 23.5, legs: [1, 2, 3, 4], gap: 6.5, mark: circle },
    { at: 30, legs: [1, 2, 3, 4], gap: 6.5, mark: circle },
    { at: 36.5, legs: [1, 2, 3, 4], gap: 6.5, mark: circle },
    { at: 43, legs: [1, 2, 3, 4], gap: 6.5, mark: circle },
    { at: 49.5, legs: [1, 2, 3, 4], gap: 6.5, mark: circle },
  ]);
  assert.equal(spec('T11 4x60m aitaviesti', 'Female', '11').row, 'T10-11');

  // An asymmetric setting's two directions interleave. (Break on purpose:
  // drop the mirroring and the odd legs' tapes land on the even legs'.)
  const p13 = spec('P13 4x60m aitaviesti', 'Male', '13');
  assert.equal(p13.row, 'P12-13');
  assert.deepEqual(p13.rows[0].mark, { colour: 'musta', symbol: 'suorakulmio', size: null, of: null, venue: null });
  // Its odd legs stand on no paint, so markLegs names the even legs.
  // (Break on purpose: take markLegs from r.legs.)
  assert.deepEqual(p13.rows[0].markLegs, [2, 4]);
  assert.deepEqual(
    p13.tapes.map((t) => t.at),
    [7, 11, 14, 18, 21, 25, 28, 32, 35, 39, 42, 46, 49, 53],
  );
  assert.deepEqual(
    p13.tapes.map((t) => t.gap),
    [7, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4],
  );
  assert.deepEqual(p13.tapes[0].legs, [1, 3]);
  assert.deepEqual(p13.tapes[1].legs, [2, 4]);
  // The even legs' tapes stand on their own mark. The odd legs' tapes find
  // other races' paint where it lies. (Break on purpose: measure the paint
  // from the even legs' line, not from maali.)
  assert.deepEqual(
    p13.tapes.map((t) => t.mark && `${t.mark.colour} ${t.mark.symbol}`),
    [
      'keltainen viiva',
      'musta suorakulmio',
      null,
      'musta suorakulmio',
      null,
      'musta suorakulmio',
      'musta ympyrä',
      'musta suorakulmio',
      null,
      'musta suorakulmio',
      null,
      'musta suorakulmio',
      'valkoinen suorakulmio',
      'musta suorakulmio',
    ],
  );

  // A class relay whose own paint serves every leg has no markLegs.
  const m15 = spec('M15 4x80m aitaviesti', 'Male', '15');
  assert.equal(m15.row, 'M14-15');
  assert.equal(m15.rows[0].markLegs, null);
  assert.deepEqual(m15.rows[0].mark, {
    colour: 'vihreä',
    symbol: 'suorakulmio',
    size: '5 × 3,5 cm',
    of: null,
    venue: null,
  });
  assert.deepEqual(spec('N17 4x100m aitaviesti', 'Female', '17').rows[0].mark, {
    colour: 'sininen',
    symbol: 'suorakulmio',
    size: '5 × 3,5 cm',
    of: null,
    venue: null,
  });

  // The sekaviesti's two rows are keyed off the name's M/N token in either
  // order, never the round's filing (docs/tuloslista-api.md).
  // (Break on purpose: key off hurdleKey first.)
  const seka = spec('M/N 4x100m aitaviesti', 'Male', '0');
  assert.equal(seka.row, 'M/N sekaviesti');
  assert.equal(seka.rows.length, 2);
  assert.deepEqual(seka.rows[0].legs, [1, 3]);
  assert.equal(seka.rows[0].class, 'N');
  assert.deepEqual(seka.rows[0].height, [83.8]);
  assert.deepEqual(seka.rows[0].mark, {
    colour: 'sininen',
    symbol: 'suorakulmio',
    size: '5 × 3,5 cm',
    of: null,
    venue: null,
  });
  assert.deepEqual(seka.rows[1].legs, [2, 4]);
  assert.deepEqual(seka.rows[1].height, [99.1]);
  assert.deepEqual(seka.rows[1].mark, { colour: 'keltainen', symbol: 'viiva', size: '10 cm', of: null, venue: null });
  assert.equal(spec('Mixed 4x100m aitaviesti', null, null).row, 'M/N sekaviesti');
  assert.equal(spec('N/M 4x100m aitaviesti', 'Female', '0').row, 'M/N sekaviesti');
  // A junior mixed class has no sheet row, neither the adult rows nor one
  // gender's (docs/tuloslista-api.md). (Break on purpose: treat an aged M/N
  // as one gender, or drop the adult gate.)
  assert.deepEqual(spec('M/N17 4x100m aitaviesti', 'Male', '17'), { distance: 100, row: null, rows: [], tapes: null });
  assert.equal(spec('M/N 17 4x100m aitaviesti', 'Male', '17').rows.length, 0);
  assert.equal(spec('Mixed 15 4x100m aitaviesti', null, null).rows.length, 0);
  assert.equal(seka.tapes.length, 20);
  assert.deepEqual(
    seka.tapes.slice(0, 3).map((t) => [t.at, t.gap]),
    [
      [11.75, 11.75],
      [13, 1.25],
      [20.25, 7.25],
    ],
  );
  assert.equal(seka.tapes[19].at, 89.5);

  // A class the sheet has no relay for gets no row, not a neighbour's.
  assert.deepEqual(spec('P9 4x60m aitaviesti', 'Male', '9'), { distance: 60, row: null, rows: [], tapes: null });
  assert.equal(spec('M 4x100m aitaviesti', 'Male', '0').row, null);
  assert.equal(spec('M15 4x800m viesti', 'Male', '15'), null);
});

// shuttleStartRows gives the rows that the day's lines and the aitaviesti box
// draw. Entries carry the schedule's own rows.
test("shuttleStartRows gives the rows that the day's lines and the aitaviesti box draw", () => {
  const entries = (...list) =>
    list.map(([label, EventName, Gender, Age]) => ({ label, round: { EventName, Gender, Age } }));

  // This is the sekaviesti filed under one gender (docs/tuloslista-api.md).
  const seka = shuttleStartRows(entries(['M/N', 'M/N 4x100m aitaviesti', 'Male', '0']), hurdles);
  assert.equal(seka.multiClass, false);
  assert.deepEqual(
    seka.rows.map((r) => [r.class, r.legs]),
    [
      ['N', [1, 3]],
      ['M', [2, 4]],
    ],
  );

  // Classes sharing every measurement share a row. Classes that differ in
  // height alone keep a row each. (Break on purpose: drop the height from
  // the merge key.)
  const shared = shuttleStartRows(
    entries(['P11', 'P11 4x60m aitaviesti', 'Male', '11'], ['T11', 'T11 4x60m aitaviesti', 'Female', '11']),
    hurdles,
  );
  assert.equal(shared.rows.length, 1);
  assert.deepEqual(shared.rows[0].categories, ['P11', 'T11']);
  assert.equal(shared.multiClass, true);
  assert.equal(
    shuttleStartRows(
      entries(['M17', 'M17 4x100m aitaviesti', 'Male', '17'], ['N17', 'N17 4x100m aitaviesti', 'Female', '17']),
      hurdles,
    ).rows.length,
    2,
  );

  // A class with no relay row is listed as missing, and the other classes
  // keep their rows.
  const p9 = shuttleStartRows(
    entries(['P9', 'P9 4x60m aitaviesti', 'Male', '9'], ['P11', 'P11 4x60m aitaviesti', 'Male', '11']),
    hurdles,
  );
  assert.deepEqual(p9.missing, ['P9']);
  assert.equal(p9.rows.length, 1);

  // `drawn` adds the results round's lanes, each Position widened to its
  // pair. The draw is a measured meet's (2026-08). (Break on purpose: push
  // only the drawn lane.)
  const heat = (...lanes) => ({ Heats: [{ Index: 1, Allocations: lanes.map((l) => ({ Position: l })) }] });
  const withDraw = (...list) =>
    list.map(([label, EventName, Gender, Age, drawn]) => ({ label, round: { EventName, Gender, Age }, drawn }));
  const drawn = shuttleStartRows(
    withDraw(
      ['N17', 'N17 4x100m aitaviesti', 'Female', '17', heat(3, 5)],
      ['N19', 'N19 4x100m aitaviesti', 'Female', '19', heat(7)],
    ),
    hurdles,
  );
  assert.equal(drawn.rows.length, 1);
  assert.deepEqual(drawn.rows[0].lanes, [3, 4, 5, 6, 7, 8]);

  // Settings keep their own pairs and sort by the first lane. Two settings
  // in one pair cost every row its lanes. (Break on purpose: keep the
  // clash's lanes.)
  const two = shuttleStartRows(
    withDraw(
      ['M19', 'M19 4x100m aitaviesti', 'Male', '19', heat(7)],
      ['M17', 'M17 4x100m aitaviesti', 'Male', '17', heat(3)],
    ),
    hurdles,
  );
  assert.deepEqual(
    two.rows.map((r) => [r.categories[0], r.lanes]),
    [
      ['M17', [3, 4]],
      ['M19', [7, 8]],
    ],
  );
  const clash = shuttleStartRows(
    withDraw(
      ['M19', 'M19 4x100m aitaviesti', 'Male', '19', heat(4)],
      ['M17', 'M17 4x100m aitaviesti', 'Male', '17', heat(3)],
    ),
    hurdles,
  );
  assert.deepEqual(
    clash.rows.map((r) => r.lanes),
    [[], []],
  );

  // Two teams of a heat in one pair mean the draw numbers the pairs
  // (docs/tuloslista-api.md), so the start drops its lanes.
  const indexed = shuttleStartRows(withDraw(['T11', 'T11 4x60m aitaviesti', 'Female', '11', heat(1, 2, 3)]), hurdles);
  assert.deepEqual(
    indexed.rows.map((r) => r.lanes),
    [[]],
  );
  // The pair is counted over the heat's classes, as shuttlePairDraw counts it.
  // (Break on purpose: count each class's pairs apart.)
  const across = shuttleStartRows(
    withDraw(
      ['N17', 'N17 4x100m aitaviesti', 'Female', '17', heat(3)],
      ['N19', 'N19 4x100m aitaviesti', 'Female', '19', heat(4)],
    ),
    hurdles,
  );
  assert.deepEqual(
    across.rows.map((r) => r.lanes),
    [[]],
  );

  // The sekaviesti's two directions split the pair (observed at the track,
  // docs/tuloslista-api.md). (Break on purpose: swap the parities.)
  const sekaDrawn = shuttleStartRows(withDraw(['M/N', 'M/N 4x100m aitaviesti', 'Male', '0', heat(3)]), hurdles);
  assert.deepEqual(
    sekaDrawn.rows.map((r) => [r.class, r.lanes]),
    [
      ['M', [3]],
      ['N', [4]],
    ],
  );

  assert.equal(shuttleStartRows(entries(['M', 'M 100m', 'Male', '0']), hurdles), null);

  // shuttleBandNames names a band by its drawn lanes, else by the sheet's
  // pairs, else by the parity's word. (Break on purpose: swap the parities,
  // or drop the pairs.)
  assert.deepEqual(shuttleBandNames(drawn.rows), { evenLegs: '3, 5, 7', oddLegs: '4, 6, 8' });
  assert.deepEqual(shuttleBandNames(sekaDrawn.rows), { evenLegs: '3', oddLegs: '4' });
  assert.deepEqual(shuttleBandNames(shared.rows), { evenLegs: 'pariton', oddLegs: 'parillinen' });
  assert.deepEqual(shuttleBandNames(seka.rows), { evenLegs: '1, 4, 7', oddLegs: '2, 5, 8' });
});

// The starts are a measured meet's (2026-08). hurdleSheetBlocks folds
// consecutive starts on one setting, and not two on one paint at two heights.
// (Break on purpose: key on the positions alone, or return every start alone.)
test('hurdleSheetBlocks folds consecutive starts on one setting', () => {
  const heat = (...lanes) => ({ Heats: [{ Index: 1, Allocations: lanes.map((l) => ({ Position: l })) }] });
  const entry = (label, EventName, Gender, Age, ...lanes) => ({
    label,
    schedRound: { EventName, Gender, Age },
    round: heat(...lanes),
  });
  const single = (...args) => ({ kind: 'hurdles', info: hurdleStartSetups([entry(...args)], hurdles) });
  const p13 = single('P13', 'P13 60m aidat', 'Male', '13', 2, 3, 4, 5, 6, 7);
  const t13 = single('T13', 'T13 60m aidat', 'Female', '13', 3, 4, 5, 6, 7, 8);
  const m400 = single('M', 'M 400m aidat', 'Male', '0', 4, 5, 6, 7, 8);
  const n400 = single('N', 'N 400m aidat', 'Female', '0', 3, 4, 5, 6, 7, 8);
  const blocks = hurdleSheetBlocks([p13, t13, m400, n400]);
  assert.deepEqual(
    blocks.map((b) => b.starts.length),
    [2, 1, 1],
  );
  assert.deepEqual(blocks[0].info.rows[0].lanes, [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(blocks[0].info.rows[0].categories, ['P13', 'T13']);
  assert.deepEqual(p13.info.rows[0].lanes, [2, 3, 4, 5, 6, 7], 'the start itself is left alone');
  // Several classes in one start never merge, even on one setting. Nor does
  // a class with no row.
  const multi = {
    kind: 'hurdles',
    info: hurdleStartSetups(
      [entry('P13', 'P13 60m aidat', 'Male', '13', 2, 3), entry('T13', 'T13 60m aidat', 'Female', '13', 4, 5)],
      hurdles,
    ),
  };
  assert.equal(multi.info.rows.length, 1);
  assert.equal(hurdleSheetBlocks([multi, multi]).length, 2);
  assert.equal(hurdleSheetBlocks([multi, p13]).length, 2);
  const none = single('P13', 'P13 400m aidat', 'Male', '13', 1);
  assert.equal(none.info.rows[0].setup, null);
  assert.equal(hurdleSheetBlocks([none, none]).length, 2);

  // The demo's aitaviesti pair (e13, e53) folds into one block over the
  // union of its lanes, its tapes unchanged.
  const day = demoSchedule()[Object.keys(demoSchedule())[0]];
  const relay = (g) => ({
    kind: 'relay',
    info: shuttleStartRows(
      g.entries.map((e) => ({
        label: e.label,
        round: e.round,
        drawn: DEMO_EVENTS[e.round.EventId].Rounds.find((r) => r.Id === e.round.Id),
      })),
      hurdles,
    ),
  });
  const pair = groupRounds(day)
    .filter((g) => g.event === '4x60m aitaviesti')
    .map(relay);
  assert.deepEqual(
    pair.map((r) => r.info.rows[0].lanes),
    [
      [1, 2, 3, 4, 5, 6],
      [1, 2, 3, 4],
    ],
  );
  const seka = relay(groupRounds(day).find((g) => g.event === '4x100m aitaviesti'));
  const rel = hurdleSheetBlocks([...pair, seka]);
  assert.deepEqual(
    rel.map((b) => b.starts.length),
    [2, 1],
  );
  assert.deepEqual(rel[0].info.rows[0].lanes, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rel[0].info.rows[0].categories, ['P11', 'T11']);
  assert.equal(rel[0].info.tapes.length, pair[0].info.tapes.length);
  // A steeple row has no lanes to union, and gains none.
  const st = {
    kind: 'steeple',
    info: steepleStartRows(
      [{ label: 'N', round: { EventName: 'N 1500m esteet', Gender: 'Female', Age: '0' } }],
      hurdles,
    ),
  };
  const sb = hurdleSheetBlocks([st, st]);
  assert.equal(sb.length, 1);
  assert.ok(!('lanes' in sb[0].info.rows[0]));
  assert.equal(hurdleSheetBlocks([st, p13]).length, 2);
});

// hurdleTableSections lays out the table page (docs/hurdles.md, "The table
// page"). (Break on purpose: merge on the positions alone, or name a band by
// its row.)
test('hurdleTableSections', () => {
  const all = hurdleTableSections(hurdles);
  const rows = (g) => g.distances.flatMap((d) => d.rows.map((r) => ({ ...r, distance: d.distance })));
  assert.deepEqual(
    all.hurdles.map((g) => [g.gender, rows(g).length]),
    [
      ['Female', 21],
      ['Male', 34],
    ],
  );
  assert.deepEqual(
    all.hurdles[0].distances.map((d) => d.distance),
    [60, 80, 100, 200, 300, 400],
  );
  // Each class and distance is on one row, and the row's setting is the one
  // the lookup gives.
  for (const g of all.hurdles) {
    for (const r of rows(g)) {
      for (const cls of r.categories) {
        const spec = hurdleSpec({ EventName: `${cls} ${r.distance}m aidat` }, hurdles);
        assert.deepEqual(spec.setup, r.setup, `${cls} ${r.distance}`);
        assert.deepEqual(spec.mark, r.mark, `${cls} ${r.distance}`);
        assert.equal(rows(g).filter((x) => x.categories.includes(cls) && x.distance === r.distance).length, 1);
      }
      assert.ok(!r.categories.some((c) => /[ -]/.test(c)), `no band name: ${r.categories}`);
    }
  }
  const classes = all.hurdles.flatMap((g) => rows(g).map((r) => [r.distance, r.categories]));
  for (const s of hurdles.setups) {
    const named = classes.filter(
      ([d, c]) =>
        d === s.distance && c.some((cls) => hurdleSpec({ EventName: `${cls} ${d}m aidat` }, hurdles).row === s.row),
    );
    assert.equal(named.length, 1, `${s.row} ${s.distance} on one row`);
  }
  assert.deepEqual(
    classes.find(([d, c]) => d === 60 && c[0] === 'M35')[1],
    ['M35', 'M40', 'M45'],
    'a band written out',
  );
  assert.deepEqual(
    classes.find(([d, c]) => d === 110 && c.includes('M'))[1],
    ['M22', 'M'],
    'consecutive classes merged',
  );
  assert.deepEqual(
    classes.find(([d, c]) => d === 60 && c.includes('N85'))[1],
    ['N70', 'N75', 'N80', 'N85'],
    'the open band ends at 85',
  );
  // The unpainted settings get a figure per set of positions.
  const figures = all.hurdles.flatMap((g) => g.distances.flatMap((d) => d.figures));
  assert.equal(
    rows(all.hurdles[0])
      .concat(rows(all.hurdles[1]))
      .filter((r) => !r.mark).length,
    11,
  );
  assert.ok(figures.length < 11 && figures.every((f) => f.tapes.length));
  assert.equal(
    all.hurdles[0].distances[0].figures.length,
    2,
    "the women's 60 m: N50-65 on one set of positions, N70+ on another",
  );
  // The relays merge across the sexes, and the sekaviesti keeps its two
  // lines.
  assert.deepEqual(
    all.relays.map((d) => [d.distance, d.groups.length, d.figures.length]),
    [
      [60, 2, 2],
      [80, 1, 1],
      [100, 4, 2],
    ],
  );
  assert.deepEqual(all.relays[0].groups[0].categories, ['T10', 'T11', 'P10', 'P11']);
  assert.equal(all.relays[2].groups[3].title, 'M/N sekaviesti');
  assert.deepEqual(all.relays[2].figures[0].categories, ['N17', 'N19', 'M17', 'M19']);
  assert.equal(all.steeples.length, 6);
  assert.deepEqual(all.steeples[1].categories, ['M14', 'M15']);

  // A chosen age keeps its rows in both tables, named by that class alone.
  const f40 = hurdleTableSections(hurdles, [40]);
  assert.deepEqual(
    f40.hurdles.map((g) => rows(g).map((r) => r.categories)),
    [
      [['N40'], ['N40'], ['N40']],
      [['M40'], ['M40'], ['M40']],
    ],
  );
  assert.deepEqual(f40.relays, []);
  assert.deepEqual(
    f40.steeples.map((r) => r.categories),
    [['N40'], ['M40']],
  );
  const f12 = hurdleTableSections(hurdles, [12, 13]);
  assert.deepEqual(
    rows(f12.hurdles[0]).map((r) => [r.distance, r.categories]),
    [
      [60, ['T12', 'T13']],
      [200, ['T12', 'T13']],
    ],
  );
  assert.deepEqual(f12.relays[0].groups[0].categories, ['T12', 'T13', 'P12', 'P13']);
  assert.equal(f12.steeples.length, 0);
  // An age that runs another class's row is named as itself.
  assert.deepEqual(rows(hurdleTableSections(hurdles, [16]).hurdles[1])[0].categories, ['M16']);
  assert.deepEqual(hurdleTableSections(hurdles, [0]).relays[0].groups[0].title, 'M/N sekaviesti');
  // A kenttä's board replaces the marks here as everywhere.
  const board = venueTable(hurdles, { marks: [] });
  assert.ok(hurdleTableSections(board).hurdles.every((g) => rows(g).every((r) => !r.mark)));

  // The counts are the two SUL sheets' rows (2026-08). A hall shows the
  // indoor sheet, and a 400 m track the outdoor one with the steeples.
  // (Break on purpose: mark a setting of both sheets outdoor only.)
  const sul = hurdles.setups.filter((s) => hurdles.categories.find((c) => c.row === s.row).source === 'SUL');
  assert.equal(sul.filter((s) => s.where !== 'indoor').length, 46);
  assert.equal(sul.filter((s) => s.where !== 'outdoor').length, 32);
  assert.equal(sul.filter((s) => s.where === 'both').length, 14);
  assert.ok(
    hurdles.setups.filter((s) => !sul.includes(s)).every((s) => s.where === (s.distance === 60 ? 'indoor' : 'outdoor')),
  );
  const hall = hurdleTableSections(hurdles, [], 'indoor');
  assert.deepEqual(
    hall.hurdles.map((g) => g.distances.map((d) => d.distance)),
    [
      [60, 300],
      [60, 300],
    ],
  );
  assert.deepEqual(
    rows(hall.hurdles[1])
      .filter((r) => r.distance === 300)
      .map((r) => r.categories),
    [['M17'], ['M19', 'M22', 'M']],
  );
  assert.equal(hall.steeples.length, 0);
  const field = hurdleTableSections(hurdles, [], 'outdoor');
  assert.deepEqual(
    field.hurdles.map((g) => rows(g).length),
    [14, 23],
  );
  assert.ok(
    !rows(field.hurdles[1]).some((r) => r.distance === 60 && r.categories.includes('M')),
    'no 60 m for the men outdoors',
  );
  assert.ok(rows(field.hurdles[1]).some((r) => r.distance === 60 && r.categories.includes('P8')));
  assert.equal(field.steeples.length, 6);
  // A kenttä's length drops the distances longer than its track.
  const dists = (sheet, len) =>
    hurdleTableSections(hurdles, [], sheet, len).hurdles[0].distances.map((d) => d.distance);
  assert.deepEqual(dists('indoor', 200), [60]);
  assert.deepEqual(dists('indoor', 300), [60, 300]);
  assert.deepEqual(dists('outdoor', 400), [60, 80, 100, 200, 300, 400]);
  assert.equal(dists(null, null).length, 6);
  // A kenttä's index row picks the sheet by its length, board file or not.
  // (Break on purpose: pick outdoor from 300 m up.)
  assert.equal(tablePageSheet('x', { id: 'x', length: 400 }), 'outdoor');
  assert.equal(tablePageSheet('x', { id: 'x', length: 300 }), 'indoor');
  assert.equal(tablePageSheet('ulkoradat'), 'outdoor');
  assert.equal(tablePageSheet('sisaradat'), 'indoor');
  assert.equal(tablePageSheet(''), null);
  assert.equal(tablePageSheet('constructor'), null, 'a pick is no object key');

  assert.equal(tableClassName('Male', 0), 'M');
  assert.equal(tableClassName('Female', 13), 'T13');
  assert.equal(tableClassName('Female', 14), 'N14');
  assert.deepEqual(tableClassAges(hurdles).slice(9, 13), [19, 22, 0, 35]);
  // The chips name a class as tableClassName does, and their rows split
  // where the class names and the masters do. (Break on purpose: end the
  // T/P classes at 14.)
  assert.deepEqual([0, 13, 14, 50].map(ageChipLabel), ['N/M', 'T/P 13', 'N/M 14', 'N/M 50']);
  assert.deepEqual(
    ageChipRows(tableClassAges(hurdles)).map((r) => [r.label, r.ages[0], r.ages.at(-1)]),
    [
      ['T/P', 8, 13],
      ['N/M', 14, 0],
      ['N/M', 35, 85],
    ],
  );
  assert.deepEqual(ageChipRows([0, 17, 30]), [
    { label: 'N/M', ages: [0, 17] },
    { label: 'N/M', ages: [30] },
  ]);
});

// --- Esteet: the steeple half of hurdles.json ----------------------------
//
// The rounds have the steeplechase's measured shapes (docs/tuloslista-api.md).
test('Esteet: the steeple half of hurdles.json', () => {
  assert.equal(steepleDistance('N 1500m esteet'), 1500);
  assert.equal(steepleDistance('M16 2000m esteet'), 2000);
  assert.equal(steepleDistance('M 3000m'), null);
  assert.equal(steepleDistance('M 110m aidat'), null);

  const spec = (EventName, Gender, Age) => steepleSpec({ EventName, Gender, Age }, hurdles);
  const measured = [
    ['N 1500m esteet', 'Female', '0', 'N'],
    ['M15 1500m esteet', 'Male', '15', 'M15'],
    ['T14 1500m esteet', 'Female', '14', 'N14'],
    ['N15 1500m esteet', 'Female', '15', 'N15'],
    ['M16 2000m esteet', 'Male', '16', 'M17'],
    ['N16 2000m esteet', 'Female', '16', 'N17'],
    ['M17 2000m esteet', 'Male', '17', 'M17'],
    ['N17 2000m esteet', 'Female', '17', 'N17'],
    ['M19 3000m esteet', 'Male', '19', 'M19'],
    ['N19 3000m esteet', 'Female', '19', 'N19'],
    ['M22 3000m esteet', 'Male', '22', 'M22'],
    ['N22 3000m esteet', 'Female', '22', 'N22'],
  ];
  for (const [EventName, Gender, Age, row] of measured) {
    const s = spec(EventName, Gender, Age);
    assert.equal(s.row, row, EventName);
    assert.ok(s.setup, `${EventName}: no setup`);
    assert.equal(steepleSpec({ EventName }, hurdles).row, row, `${EventName}, label only`);
  }
  assert.deepEqual(spec('M 3000m esteet', 'Male', '0'), {
    distance: 3000,
    category: 'M',
    row: 'M',
    source: 'SUL',
    setup: { height: [91.4] },
    mark: { colour: 'sininen', symbol: 'neliö', size: '12,5 cm' },
  });
  // A class's bar holds at any distance (docs/hurdles.md, "What the meets
  // do"). (Break on purpose: key the bar on the row and the distance.)
  assert.deepEqual(spec('N 1500m esteet', 'Female', '0').setup, { height: [76.2] });
  // The bands are the hurdles' own, and a bar can be a choice of two.
  assert.deepEqual(spec('M16 2000m esteet', 'Male', '16').setup.height, [83.8]);
  assert.deepEqual(spec('M50 3000m esteet', 'Male', '50').setup.height, [83.8, 91.4]);
  assert.deepEqual(spec('M65 2000m esteet', 'Male', '65').setup.height, [76.2]);
  // An unpublished bar is a null setup.
  assert.deepEqual(spec('P13 1500m esteet', 'Male', '13').setup, null);
  assert.equal(spec('P13 1500m esteet', 'Male', '13').mark, null);
  assert.equal(spec('M 3000m', 'Male', '0'), null);
  // The name beats Age here too (hurdleKey).
  assert.equal(spec('M65 2000m esteet', 'Male', '30').row, 'M 60-69');

  // Classes on one bar share a row. A class with no bar keeps a row of its
  // own, last.
  const entries = (...list) =>
    list.map(([label, EventName, Gender, Age]) => ({ label, round: { EventName, Gender, Age } }));
  const shared = steepleStartRows(
    entries(['N', 'N 1500m esteet', 'Female', '0'], ['M15', 'M15 1500m esteet', 'Male', '15']),
    hurdles,
  );
  assert.deepEqual([shared.distance, shared.multiClass, shared.rows.length], [1500, true, 1]);
  assert.deepEqual(shared.rows[0].categories, ['N', 'M15']);
  const two = steepleStartRows(
    entries(['M19', 'M19 3000m esteet', 'Male', '19'], ['N19', 'N19 3000m esteet', 'Female', '19']),
    hurdles,
  );
  assert.deepEqual(
    two.rows.map((r) => r.setup.height),
    [[91.4], [76.2]],
  );
  const p13 = steepleStartRows(
    entries(['P13', 'P13 1500m esteet', 'Male', '13'], ['N', 'N 1500m esteet', 'Female', '0']),
    hurdles,
  );
  assert.deepEqual(
    p13.rows.map((r) => [r.categories, r.setup?.height ?? null]),
    [
      [['N'], [76.2]],
      [['P13'], null],
    ],
  );
  assert.equal(steepleStartRows(entries(['M', 'M 3000m', 'Male', '0']), hurdles), null);

  // hurdleTableProblems checks the steeple half. (Break on purpose, each.)
  const broken = () => JSON.parse(JSON.stringify(hurdles));
  {
    const t = broken();
    t.steeples.heights.push({ row: 'M16', height: [83.8] });
    assert.deepEqual(hurdleTableProblems(t), ['M16 esteet: no such category']);
  }
  {
    const t = broken();
    t.steeples.mark.symbol = 'pallo';
    assert.deepEqual(hurdleTableProblems(t), ['esteet: no shape to draw the mark as']);
  }
});
