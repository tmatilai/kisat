import { ageOrder, girlsBoysAge } from './ages.js';
import {
  hurdleMark,
  hurdleMarkGlyph,
  hurdleTapes,
  markCovers,
  relayTableRow,
  sameRaceMark,
  setupFields,
  shuttleTapes,
  tableCategory,
} from './hurdles.js';

// --- The table page's classes and chips (/mitat) ---

// Names the class a meet files an age under, such as "M40", "T12" or "N". Age
// 0 is the adult class, as in hurdleKey.
function tableClassName(gender, age) {
  const senior = gender === 'Male' ? 'M' : 'N';
  if (age === 0) return senior;
  if (girlsBoysAge(age)) return `${gender === 'Male' ? 'P' : 'T'}${age}`;
  return `${senior}${age}`;
}

// SAUL's table names no older class, so the open bands end here.
const OLDEST_MASTERS_AGE = 85;

// Returns the classes a band stands for. A SUL band is one class, its top age,
// even where a meet runs a younger class on it (docs/hurdles.md, "The lookup's
// rules"). WMA's are 5-year classes.
function bandAges(category) {
  if (category.adult) return [0];
  if (category.source !== 'WMA') return [category.age[1]];
  const ages = [];
  for (let a = category.age[0]; a <= (category.age[1] ?? OLDEST_MASTERS_AGE); a += 5) ages.push(a);
  return ages;
}

// Returns a sex's bands youngest first, as a page names them. A band holds its
// classes (bandAges), or only the chosen ages the lookup puts on it.
function tableClassRows(table, chosen, gender) {
  const classesOf = (c) =>
    (chosen.length ? chosen.filter((a) => tableCategory(table, { gender: c.gender, age: a }) === c) : bandAges(c))
      .sort((a, b) => ageOrder(a) - ageOrder(b))
      .map((a) => tableClassName(c.gender, a));
  return (table?.categories || [])
    .filter((c) => c.gender === gender)
    .sort((a, b) => a.age[0] - b.age[0])
    .map((c) => ({ ...c, classes: classesOf(c) }))
    .filter((c) => c.classes.length);
}

// Returns every class age the tables know, one chip each over both files.
function tableClassAges(...tables) {
  return [...new Set(tables.flatMap((t) => (t?.categories || []).flatMap(bandAges)))].sort(
    (a, b) => ageOrder(a) - ageOrder(b),
  );
}

// The table page's kenttä select offers these two sheets by name.
const TABLE_SHEETS = { ulkoradat: 'outdoor', sisaradat: 'indoor' };

// Returns the sheet the table page shows as `where`, or null for both. A kenttä
// picks it by its index row's length, 400 m outdoor and any other indoor, with
// or without a board file. Otherwise the pick names a sheet.
function tablePageSheet(pick, entry = null) {
  if (entry) return entry.length === 400 ? 'outdoor' : 'indoor';
  return Object.hasOwn(TABLE_SHEETS, pick) ? TABLE_SHEETS[pick] : null;
}

// --- The hurdle table (/mitat#/aidat) ---

// Lays out the table per sex and distance, merging consecutive classes on one
// setting. A setting has its mark (venueTable) or else a taping figure. `sheet`
// is a `where`, and `length` drops a distance longer than the track.
function hurdleTableSections(table, ages = [], sheet = null, length = null) {
  const chosen = ages.filter((a) => Number.isInteger(a));
  const indoor = sheet === 'indoor';
  const onTrack = (s) => !sheet || !s.where || s.where === 'both' || s.where === sheet;
  const inBand = (a, band) => a >= band[0] && a <= band[1];
  const byGender = (gender) => tableClassRows(table, chosen, gender);
  const setups = table?.setups || [];
  const distances = [...new Set(setups.map((s) => s.distance))]
    .filter((d) => length == null || d <= length)
    .sort((a, b) => a - b);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const hurdles = ['Female', 'Male'].map((gender) => ({
    gender,
    distances: distances
      .map((distance) => {
        const rows = [];
        for (const c of byGender(gender)) {
          const found = setups.find((s) => s.row === c.row && s.distance === distance);
          if (!found || !onTrack(found)) continue;
          const setup = setupFields(found);
          const last = rows[rows.length - 1];
          if (last && same(last.setup, setup)) last.categories.push(...c.classes);
          else rows.push({ categories: [...c.classes], setup, mark: hurdleMark(table, distance, setup), lanes: [] });
        }
        const figures = [];
        for (const r of rows) {
          const tapes = hurdleTapes(distance, r.setup, r.mark, table);
          if (!tapes) continue;
          const key = [r.setup.count, r.setup.toFirst, r.setup.interval].join('|');
          const f = figures.find((x) => x.key === key);
          if (f) f.categories.push(...r.categories);
          else figures.push({ key, categories: [...r.categories], tapes });
        }
        return { distance, rows, figures: figures.map(({ key, ...f }) => f) };
      })
      .filter((d) => d.rows.length),
  }));

  // Relays merge across the sexes, and the sekaviesti (the mixed relay) is a
  // group of its two lines. A figure goes to each set of positions.
  const classAges = tableClassAges(table);
  const order = { Female: 0, Male: 1, Mixed: 2 };
  const groups = [];
  const sorted = (table?.relays || [])
    .slice()
    .sort((a, b) => order[a.gender] - order[b.gender] || (a.age?.[0] ?? 0) - (b.age?.[0] ?? 0));
  for (const r of sorted) {
    const mixed = r.gender === 'Mixed';
    const own = mixed ? [0] : classAges.filter((a) => inBand(a, r.age));
    const kept = chosen.length ? chosen.filter((a) => inBand(a, mixed ? [0, 0] : r.age)) : own;
    if (!kept.length) continue;
    const row = relayTableRow(r, table);
    const key = mixed
      ? r.row
      : JSON.stringify([row.legs, row.count, row.toFirst, row.interval, row.toFinish, row.height]);
    const names = mixed ? [] : kept.map((a) => tableClassName(r.gender, a));
    const g = groups.find((x) => x.key === key);
    if (g) {
      g.categories.push(...names);
      if (mixed) g.rows.push(row);
    } else
      groups.push({
        key,
        distance: r.distance,
        title: mixed ? r.row : null,
        minAge: own[0],
        categories: names,
        rows: [row],
      });
  }
  groups.sort((a, b) => a.distance - b.distance || (a.title ? 1 : 0) - (b.title ? 1 : 0) || a.minAge - b.minAge);
  const relays = [...new Set(groups.map((g) => g.distance))].map((distance) => {
    const own = groups.filter((g) => g.distance === distance);
    const figures = [];
    for (const g of own) {
      const key = JSON.stringify(g.rows.map((r) => [r.legs, r.count, r.toFirst, r.interval, r.toFinish]));
      const f = figures.find((x) => x.key === key);
      if (f) {
        f.categories.push(...(g.title ? [g.title] : g.categories));
        f.rows.push(...g.rows);
      } else figures.push({ key, categories: g.title ? [g.title] : [...g.categories], rows: [...g.rows] });
    }
    return {
      distance,
      groups: own.map(({ key, minAge, ...g }) => g),
      figures: figures.map(({ key, ...f }) => ({ ...f, tapes: shuttleTapes(distance, f.rows, table) })),
    };
  });

  const bars = table?.steeples?.heights || [];
  const mark = table?.steeples?.mark ? { ...table.steeples.mark } : null;
  const steeples = [];
  for (const gender of indoor ? [] : ['Female', 'Male']) {
    for (const c of byGender(gender)) {
      const bar = bars.find((h) => h.row === c.row);
      if (!bar) continue;
      const setup = { height: bar.height };
      const last = steeples[steeples.length - 1];
      if (last && last.gender === gender && same(last.setup, setup)) last.categories.push(...c.classes);
      else steeples.push({ gender, categories: [...c.classes], setup, mark });
    }
  }
  return { hurdles, relays, steeples };
}

// --- The implement table (/mitat#/valineet, docs/implements.md) ---

// Writes a weight as a meet does, such as 7,26 kg, 4 kg or 600 g.
function implementWeightText(grams) {
  return grams < 1000 ? `${grams} g` : `${String(grams / 1000).replace('.', ',')} kg`;
}

// Writes a column's value, which is a range, a maximum alone, one figure or the
// sheet's own words.
function implementDimText(v) {
  if (v == null) return '–';
  if (Array.isArray(v)) return v[0] == null ? `enint. ${v[1]}` : `${v[0]}–${v[1]}`;
  return String(v);
}

// Returns the dimensions of a row's weight: its own source's, or else any
// source's (docs/implements.md).
function implementSpec(table, implement, weight, source = null) {
  const own = (table?.specs || []).filter((s) => s.implement === implement && s.weight === weight);
  const found = own.find((s) => s.source === source) || own[0];
  if (!found) return null;
  const { implement: _i, weight: _w, source: _s, ...dims } = found;
  return dims;
}

// Lays out the weights alone, a table per sex and a column per implement, with
// consecutive classes on the same set merged. A column goes where no class the
// filter keeps throws it.
function implementWeightRows(table, ages = []) {
  const chosen = ages.filter((a) => Number.isInteger(a));
  const weights = table?.weights || [];
  const impls = table?.implements || [];
  return ['Female', 'Male'].map((gender) => {
    const rows = [];
    for (const c of tableClassRows(table, chosen, gender)) {
      const w = weights.find((x) => x.row === c.row);
      if (!w) continue;
      const set = Object.fromEntries(impls.map((i) => [i.id, w[i.id] ?? null]));
      const last = rows[rows.length - 1];
      if (last && JSON.stringify(last.weights) === JSON.stringify(set)) last.categories.push(...c.classes);
      else rows.push({ categories: [...c.classes], weights: set });
    }
    const columns = impls
      .filter((i) => rows.some((r) => r.weights[i.id] != null))
      .map((i) => ({ id: i.id, name: i.name }));
    return { gender, columns, rows };
  });
}

// Lays out every dimension, a table per sex and a section per implement.
// Consecutive classes on one weight and one set of dimensions merge into one
// row, as in hurdleTableSections.
function implementTableSections(table, ages = []) {
  const chosen = ages.filter((a) => Number.isInteger(a));
  const weights = table?.weights || [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return ['Female', 'Male'].map((gender) => ({
    gender,
    implements: (table?.implements || [])
      .map((impl) => {
        const rows = [];
        for (const c of tableClassRows(table, chosen, gender)) {
          const weight = weights.find((w) => w.row === c.row)?.[impl.id];
          if (weight == null) continue;
          const spec = implementSpec(table, impl.id, weight, c.source);
          const last = rows[rows.length - 1];
          if (last && last.weight === weight && same(last.spec, spec)) last.categories.push(...c.classes);
          else rows.push({ categories: [...c.classes], weight, spec });
        }
        return { id: impl.id, name: impl.name, columns: impl.columns, rows };
      })
      .filter((i) => i.rows.length),
  }));
}

function implementTableProblems(table) {
  const problems = tableHeadProblems(table);
  const rows = new Set((table?.categories || []).map((c) => c.row));
  const impls = table?.implements || [];
  const weights = table?.weights || [];
  const seen = new Set();
  for (const w of weights) {
    if (seen.has(w.row)) problems.push(`${w.row}: two weight rows`);
    seen.add(w.row);
    if (!rows.has(w.row)) problems.push(`${w.row}: no such category`);
    for (const [id, grams] of Object.entries(w)) {
      if (id === 'row') continue;
      if (!impls.some((i) => i.id === id)) problems.push(`${w.row}: no such implement ${id}`);
      else if (!(grams > 0)) problems.push(`${w.row} ${id}: weight ${grams}`);
      else if (!implementSpec(table, id, grams)) problems.push(`${w.row} ${id}: no dimensions for ${grams} g`);
    }
  }
  for (const r of rows) if (!seen.has(r)) problems.push(`${r}: no weights`);
  const specSeen = new Set();
  for (const s of table?.specs || []) {
    const key = `${s.implement} ${s.weight} ${s.source}`;
    if (specSeen.has(key)) problems.push(`${key}: two specs`);
    specSeen.add(key);
    const impl = impls.find((i) => i.id === s.implement);
    if (!impl) {
      problems.push(`${key}: no such implement`);
      continue;
    }
    if (!weights.some((w) => w[s.implement] === s.weight)) problems.push(`${key}: no row throws it`);
    for (const c of impl.columns) {
      const v = s[c.key];
      const range = Array.isArray(v) && v.length === 2 && v[1] > 0 && (v[0] == null || (v[0] > 0 && v[0] <= v[1]));
      if (!(typeof v === 'string' || v > 0 || range)) problems.push(`${key}: ${c.key} is ${JSON.stringify(v)}`);
    }
  }
  return problems;
}

// Reports a setting that two different-looking marks cover, as the reader
// would get either one. Both hand-edited files get the check.
function markCoverProblems(marks, setups) {
  const problems = [];
  for (const s of setups) {
    if (sameRaceMark(marks, s.distance, s)) continue;
    const looks = [...new Set(marks.filter((m) => markCovers(m, s.distance, s)).map((m) => `${m.colour} ${m.symbol}`))];
    if (looks.length > 1) problems.push(`${s.row} ${s.distance}: ${looks.join(' and ')} both cover it`);
  }
  return problems;
}

// Checks what hurdles.json and implements.json share, ISO dates and bands
// covering every age once up to an open-ended oldest. A gap leaves a class no
// row, and an overlap puts it on a neighbour's in silence.
function tableHeadProblems(table) {
  const problems = [];
  const categories = table?.categories || [];
  const rows = new Set(categories.map((c) => c.row));
  if (rows.size !== categories.length) problems.push('two categories share a row name');
  // The dates are ISO, like every date of the data files and unlike the API's
  // day keys.
  for (const k of ['validFrom', 'checked']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(table?.[k] || '')) problems.push(`${k}: not an ISO date`);
  }

  for (const gender of ['Male', 'Female']) {
    const bands = categories.filter((c) => c.gender === gender);
    if (!bands.length) {
      problems.push(`${gender}: no categories`);
      continue;
    }
    if (bands.filter((c) => c.adult).length !== 1) problems.push(`${gender}: not exactly one adult category`);
    let next = bands[0].age[0];
    for (const c of bands) {
      if (c.age[0] !== next) problems.push(`${c.row}: starts at ${c.age[0]}, expected ${next}`);
      if (c.age[1] == null) next = null;
      else if (c.age[1] < c.age[0]) problems.push(`${c.row}: age range runs backwards`);
      else next = c.age[1] + 1;
    }
    if (next != null) problems.push(`${gender}: the oldest band is not open-ended`);
  }
  return problems;
}

// Returns no problems when the file is sound. Every published row's parts add
// up to its distance exactly, and two heights within a centimetre are one bar
// (docs/hurdles.md).
function hurdleTableProblems(table) {
  const problems = tableHeadProblems(table);
  const categories = table?.categories || [];
  const setups = table?.setups || [];
  const rows = new Set(categories.map((c) => c.row));
  const seen = new Set();
  for (const s of setups) {
    const key = `${s.row} ${s.distance}`;
    if (seen.has(key)) problems.push(`${key}: two setups`);
    seen.add(key);
    if (!rows.has(s.row)) problems.push(`${key}: no such category`);
    if (!(s.count >= 1)) problems.push(`${key}: ${s.count} hurdles`);
    const sum = s.toFirst + (s.count - 1) * s.interval + s.toFinish;
    if (Math.abs(sum - s.distance) > 0.0001)
      problems.push(`${key}: the parts add up to ${Math.round(sum * 100) / 100}`);
    if (!s.height?.length) problems.push(`${key}: no height`);
    if (!['indoor', 'outdoor', 'both'].includes(s.where)) problems.push(`${key}: where is ${s.where}`);
  }
  for (const c of categories) {
    if (!setups.some((s) => s.row === c.row)) problems.push(`${c.row}: no setups`);
  }

  // Relay bands may gap but not overlap. Rows sharing a name are the
  // sekaviesti's, and they split the four legs between them.
  const relays = table?.relays || [];
  const relKey = (r) => `${r.row} ${r.distance}${r.legs ? ` (${r.legs.join(', ')})` : ''}`;
  const relSeen = new Set();
  for (const r of relays) {
    const key = relKey(r);
    if (relSeen.has(key)) problems.push(`${key}: two relay rows`);
    relSeen.add(key);
    if (!(r.count >= 1)) problems.push(`${key}: ${r.count} hurdles`);
    const sum = r.toFirst + (r.count - 1) * r.interval + r.toFinish;
    if (Math.abs(sum - r.distance) > 0.0001)
      problems.push(`${key}: the parts add up to ${Math.round(sum * 100) / 100}`);
    if (!r.height?.length) problems.push(`${key}: no height`);
    for (const l of r.legs || []) {
      if (![1, 2, 3, 4].includes(l)) problems.push(`${key}: leg ${l}`);
    }
    if (r.gender === 'Mixed' ? r.age : !(r.age?.[0] <= r.age?.[1])) problems.push(`${key}: age band`);
    // One mark is rendered, so the row's two directions must not find two.
    const even = hurdleMark(table, r.distance, r);
    const odd = hurdleMark(table, r.distance, { ...r, toFirst: r.toFinish, toFinish: r.toFirst });
    if (even && odd && JSON.stringify(even) !== JSON.stringify(odd)) {
      problems.push(`${key}: the two directions stand on different marks`);
    }
  }
  relays.forEach((a, i) => {
    for (const b of relays.slice(i + 1)) {
      if (a.gender !== b.gender || a.distance !== b.distance) continue;
      if (a.age && b.age && a.age[0] <= b.age[1] && b.age[0] <= a.age[1]) {
        problems.push(`${a.row} and ${b.row}: both cover an age at ${a.distance} m`);
      }
      if (a.row === b.row) {
        const legs = [...(a.legs || []), ...(b.legs || [])].sort();
        if (legs.join(',') !== '1,2,3,4')
          problems.push(`${a.row}: the rows' legs are ${legs.join(', ') || 'unstated'}`);
      }
    }
  });

  // The steeple has a bar per category row.
  const steeples = table?.steeples || {};
  const barred = new Set();
  for (const h of steeples.heights || []) {
    const key = `${h.row} esteet`;
    if (barred.has(h.row)) problems.push(`${key}: two bars`);
    barred.add(h.row);
    if (!rows.has(h.row)) problems.push(`${key}: no such category`);
    if (!h.height?.length) problems.push(`${key}: no height`);
  }
  if (steeples.mark && !hurdleMarkGlyph(steeples.mark)) problems.push('esteet: no shape to draw the mark as');

  const heights = [...new Set([...setups, ...relays, ...(steeples.heights || [])].flatMap((s) => s.height || []))].sort(
    (a, b) => a - b,
  );
  heights.forEach((h, i) => {
    if (!(h >= 40 && h <= 110)) problems.push(`height ${h}: not a hurdle height in cm`);
    if (i && h - heights[i - 1] < 1) problems.push(`heights ${heights[i - 1]} and ${h}: less than a centimetre apart`);
  });

  // A mark is looked up by position, and `rows` is the sheet's own class list,
  // which is re-checked against the setups.
  const marked = new Set();
  for (const m of table?.marks || []) {
    const key = `${m.distance} ${m.colour} ${m.symbol}`;
    const at = `${m.count}|${m.toFirst}|${m.interval}`;
    // The lookup matches on the alkusileä and the väli alone (hurdleMark).
    const spacing = `${m.distance} ${m.toFirst}|${m.interval}`;
    if (marked.has(spacing)) problems.push(`${key}: a second mark at ${m.toFirst}|${m.interval}`);
    marked.add(spacing);
    if (!hurdleMarkGlyph(m)) problems.push(`${key}: no shape to draw it as`);
    for (const row of m.rows || []) {
      const s = setups.find((x) => x.row === row && x.distance === m.distance);
      if (!s) problems.push(`${key}: ${row} runs no ${m.distance} m`);
      else if (`${s.count}|${s.toFirst}|${s.interval}` !== at)
        problems.push(`${key}: ${row} stands at ${s.count}|${s.toFirst}|${s.interval}, not ${at}`);
    }
    // `relays` lists the sheet's relay classes, checked on the even legs.
    for (const row of m.relays || []) {
      const r = relays.find((x) => x.row === row && x.distance === m.distance);
      if (!r) problems.push(`${key}: ${row} runs no ${m.distance} m relay`);
      else if (`${r.count}|${r.toFirst}|${r.interval}` !== at)
        problems.push(`${key}: ${row} stands at ${r.count}|${r.toFirst}|${r.interval}, not ${at}`);
    }
  }
  problems.push(
    ...markCoverProblems(table?.marks || [], [
      ...setups,
      ...relays.filter((r) => (r.legs || [2]).some((l) => l % 2 === 0)),
    ]),
  );
  return problems;
}

export {
  hurdleTableProblems,
  hurdleTableSections,
  implementDimText,
  implementSpec,
  implementTableProblems,
  implementTableSections,
  implementWeightRows,
  implementWeightText,
  markCoverProblems,
  tableClassAges,
  tableClassName,
  tableClassRows,
  tablePageSheet,
};
