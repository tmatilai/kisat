import { heatsInOrder } from './results.js';
import { categoryParts, parseEventName } from './schedule.js';

// --- Hurdle setups (Juoksut mode) ----------------------------------------
// hurdles.json holds the federations' tables (docs/hurdles.md, "The sources").

// Reads 110 from "M 110m aidat" and 100 from "N17 7-ottelu  100m aidat". Neither
// a relay nor the steeplechase is in these tables, and the leading `[^x\d]`
// keeps out a relay spelled "4x60m aidat".
const HURDLE_RACE_RE = /(?:^|[^x\d])(\d+)\s*m\s+aidat\b/i;

function hurdleDistance(eventName) {
  const m = HURDLE_RACE_RE.exec(String(eventName || ''));
  return m ? Number(m[1]) : null;
}

// Keys on the class in the event name, and on Gender and Age only where the
// name carries none. Age can be the group's (docs/tuloslista-api.md), and the
// results endpoint carries neither field.
function hurdleKey(round) {
  const parts = categoryParts(parseEventName(round?.EventName || '').sex);
  // sex 2 is Mixed and 3 is unrecognized, and neither names a class.
  if (parts.sex <= 1) return { gender: parts.sex === 0 ? 'Male' : 'Female', age: parts.age };
  const gender = round?.Gender;
  // Age must be digits, as an empty one would read as 0, the adult class.
  const age = String(round?.Age ?? '');
  if ((gender === 'Male' || gender === 'Female') && /^\d+$/.test(age)) {
    return { gender, age: Number(age) };
  }
  return null;
}

// Finds the age band a key falls in. Age 0 is the adult class, as both
// `Age: "0"` and a bare "M" say.
function tableCategory(table, key) {
  if (!key) return null;
  return (
    (table?.categories || []).find(
      (c) =>
        c.gender === key.gender &&
        (key.age === 0 ? c.adult === true : key.age >= c.age[0] && (c.age[1] == null || key.age <= c.age[1])),
    ) || null
  );
}

// Returns where a setting's hurdles stand, measured back from the finish line,
// so one race's paint serves another (docs/hurdles.md, "Every race on a track
// finishes on one line").
function hurdlePositions(distance, setup) {
  return Array.from({ length: setup.count }, (_, k) => distance - setup.toFirst - k * setup.interval);
}

// Positions this close match. The table gives positions to the centimetre, so
// the tolerance absorbs floating-point error and still parts two positions.
const MARK_TOLERANCE_M = 0.005;
function markCovers(mark, distance, setup) {
  const theirs = hurdlePositions(mark.distance, mark);
  return hurdlePositions(distance, setup).every((p) => theirs.some((q) => Math.abs(p - q) < MARK_TOLERANCE_M));
}

function sameRaceMark(marks, distance, setup) {
  return (
    marks.find(
      (m) =>
        m.distance === distance &&
        m.toFirst === setup.toFirst &&
        m.interval === setup.interval &&
        m.count >= setup.count,
    ) || null
  );
}

// Returns the painted mark a setup stands on, or null. It keys on positions,
// and hurdleTableProblems re-checks the class list (docs/hurdles.md). A setup
// takes a longer mark's first few (`of`), or else another race's paint.
function hurdleMark(table, distance, setup) {
  if (!setup) return null;
  const marks = table?.marks || [];
  const mark = sameRaceMark(marks, distance, setup);
  // A board gives colours and symbols, never sizes.
  if (mark) {
    return {
      colour: mark.colour,
      symbol: mark.symbol,
      size: mark.size ?? null,
      of: mark.count > setup.count ? mark.count : null,
      venue: mark.venue || null,
    };
  }
  const other = marks.find((m) => markCovers(m, distance, setup));
  if (!other) return null;
  // `of` stays null, since these are the hurdles nearest the finish.
  return { colour: other.colour, symbol: other.symbol, size: other.size ?? null, of: null, venue: other.venue || null };
}

// Maps a word to a slug that markGlyph (app/hurdles.js) draws, and
// hurdleTableProblems reports an unknown one. The size is not drawn, as to
// scale it is a dot.
const HURDLE_SYMBOLS = {
  ympyrä: 'circle',
  suorakulmio: 'rectangle',
  kolmio: 'triangle',
  // Boards use this word, and at 14 px a square and a rectangle are told apart.
  neliö: 'square',
  // The sheet's own phrase for it is a sentence (docs/hurdles.md).
  viiva: 'line',
};
const HURDLE_COLOURS = {
  sininen: 'blue',
  keltainen: 'yellow',
  vihreä: 'green',
  musta: 'black',
  valkoinen: 'white',
};

function hurdleMarkGlyph(mark) {
  const shape = HURDLE_SYMBOLS[mark?.symbol];
  const colour = HURDLE_COLOURS[mark?.colour];
  return shape && colour ? { shape, colour } : null;
}

// `category` and `row` differ where a class runs another's measurements.
// `setup` is null where the pair has no row, never a neighbouring class's.
function hurdleSpec(round, table) {
  const name = round?.EventName || '';
  const distance = hurdleDistance(name);
  if (distance == null) return null;
  const category = tableCategory(table, hurdleKey(round));
  const found = category ? (table?.setups || []).find((s) => s.row === category.row && s.distance === distance) : null;
  const setup = found ? setupFields(found) : null;
  return {
    distance,
    category: parseEventName(name).sex,
    row: category?.row || null,
    source: category?.source || null,
    setup,
    mark: hurdleMark(table, distance, setup),
  };
}

// Copies the setting field by field, so its JSON is a stable key.
function setupFields(s) {
  return { count: s.count, toFirst: s.toFirst, interval: s.interval, toFinish: s.toFinish, height: s.height };
}

// Reads 2000 from "M16 2000m esteet". The API files the steeplechase as
// Steeples or Run (docs/tuloslista-api.md), so the name gates it.
const STEEPLE_RACE_RE = /(?:^|[^x\d])(\d+)\s*m\s+esteet\b/i;

function steepleDistance(eventName) {
  const m = STEEPLE_RACE_RE.exec(String(eventName || ''));
  return m ? Number(m[1]) : null;
}

// Keys the bar on the class alone, as a class can run another distance, and
// the mark is the track's at every one (docs/hurdles.md). No board is asked.
function steepleSpec(round, table) {
  const name = round?.EventName || '';
  const distance = steepleDistance(name);
  if (distance == null) return null;
  const category = tableCategory(table, hurdleKey(round));
  const steeples = table?.steeples || {};
  const bar = category ? (steeples.heights || []).find((h) => h.row === category.row) : null;
  const setup = bar ? { height: bar.height } : null;
  return {
    distance,
    category: parseEventName(name).sex,
    row: category?.row || null,
    source: category?.source || null,
    setup,
    mark: setup && steeples.mark ? { ...steeples.mark } : null,
  };
}

// Returns a steeple start's rows from the schedule rows alone, as a group start
// over one set of barriers has no draw to read. Classes on one bar share a row,
// and a class with no published bar sorts last.
function steepleStartRows(entries, table) {
  const specs = [];
  for (const e of entries || []) {
    const spec = steepleSpec(e.round, table);
    if (spec) specs.push({ label: e.label, spec });
  }
  if (!specs.length) return null;
  const rows = new Map();
  for (const { label, spec } of specs) {
    const key = JSON.stringify(spec.setup);
    if (!rows.has(key)) rows.set(key, { setup: spec.setup, mark: spec.mark, categories: [] });
    if (!rows.get(key).categories.includes(label)) rows.get(key).categories.push(label);
  }
  return {
    distance: specs[0].spec.distance,
    rows: [...rows.values()].sort((a, b) => (a.setup ? 0 : 1) - (b.setup ? 0 : 1)),
    multiClass: new Set(specs.map((s) => s.label)).size > 1,
  };
}

// Reads one leg's 60 from "P11 4x60m aitaviesti". hurdleDistance skips it, as
// a shuttle's geometry comes from the `relays` table and mirrors per leg.
const HURDLE_RELAY_RE = /\d+\s*x\s*(\d+)\s*m\s+aitaviesti\b/i;

function hurdleRelayLeg(eventName) {
  const m = HURDLE_RELAY_RE.exec(String(eventName || ''));
  return m ? Number(m[1]) : null;
}

// Says whether the setup lines and the day sheet cover this start's name. The
// three kinds are told apart by name alone and pay no fetch, so a menu can
// ask before anything is loaded.
function isHurdleStart(eventName) {
  return hurdleDistance(eventName) != null || hurdleRelayLeg(eventName) != null || steepleDistance(eventName) != null;
}

// Returns the paint under a tape, which makes the tape a check point. Marks key
// on positions, so a hurdle can stand on another race's paint (hurdleMark).
// Where two marks share a spot, the one the rows carry wins. `at` counts from
// the even legs' start, and a mark's positions from maali, the finish.
function tapeMark(table, distance, at, rows) {
  const from = distance - at;
  const found = (table?.marks || []).filter((m) =>
    hurdlePositions(m.distance, m).some((q) => Math.abs(from - q) < MARK_TOLERANCE_M),
  );
  const own = rows.map((r) => r.mark).filter(Boolean);
  const pick = found.find((m) => own.some((o) => o.colour === m.colour && o.symbol === m.symbol)) || found[0];
  return pick ? { colour: pick.colour, symbol: pick.symbol } : null;
}

// Returns a tape per hurdle, with the gap walked and the paint under it, for a
// setting with no mark of its own. It is null where no hurdle stands on paint.
function hurdleTapes(distance, setup, mark, table) {
  if (!setup || mark) return null;
  const cm = (x) => Math.round(x * 100) / 100;
  const tapes = [];
  for (let k = 0; k < setup.count; k++) {
    const at = cm(setup.toFirst + k * setup.interval);
    tapes.push({ at, gap: cm(at - (k ? tapes[k - 1].at : 0)), mark: tapeMark(table, distance, at, []) });
  }
  return tapes.some((t) => t.mark) ? tapes : null;
}

// Puts both directions' hurdles on one taping line, and coincident ones share a
// tape. `at` counts from the even legs' start, and `gap` from the last tape.
function shuttleTapes(distance, rows, table) {
  const cm = (x) => Math.round(x * 100) / 100;
  const pts = [];
  for (const r of rows) {
    for (const leg of r.legs || [1, 2, 3, 4]) {
      for (let k = 0; k < r.count; k++) {
        const from = r.toFirst + k * r.interval;
        pts.push({ at: cm(leg % 2 === 0 ? from : distance - from), leg });
      }
    }
  }
  pts.sort((a, b) => a.at - b.at || a.leg - b.leg);
  const tapes = [];
  for (const p of pts) {
    const last = tapes[tapes.length - 1];
    if (last && p.at - last.at < MARK_TOLERANCE_M) {
      if (!last.legs.includes(p.leg)) last.legs.push(p.leg);
    } else tapes.push({ at: p.at, legs: [p.leg] });
  }
  return tapes.map((t, i) => ({
    ...t,
    gap: cm(t.at - (i ? tapes[i - 1].at : 0)),
    mark: tapeMark(table, distance, t.at, rows),
  }));
}

// Returns the relay rows for one start, keyed like hurdleSpec. Mixed takes the
// sekaviesti's two rows, and `rows` is empty where the pair has no row.
function hurdleRelaySpec(round, table) {
  const name = round?.EventName || '';
  const distance = hurdleRelayLeg(name);
  if (distance == null) return null;
  const relays = table?.relays || [];
  // The sekaviesti's token spells either order, "M/N" or "N/M", and the round
  // is filed under one gender (docs/tuloslista-api.md). Only adults match, as
  // a mixed class with an age has no sheet row.
  const p = parseEventName(name);
  const mn = /^[MN]\/[NM](\d*)$/.exec(p.sex);
  const parts = categoryParts(p.sex);
  const mixed = !!mn || parts.sex === 2;
  const adult = mn ? !mn[1] && !/^\d+\s/.test(p.event) : parts.age === 0;
  const key = mixed ? null : hurdleKey(round);
  const found = key
    ? relays.filter(
        (r) =>
          r.gender === key.gender && r.distance === distance && r.age && key.age >= r.age[0] && key.age <= r.age[1],
      )
    : mixed && adult
      ? relays.filter((r) => r.gender === 'Mixed' && r.distance === distance)
      : [];
  const rows = found.map((r) => relayTableRow(r, table));
  return {
    distance,
    row: found[0]?.row || null,
    rows,
    tapes: rows.length ? shuttleTapes(distance, rows, table) : null,
  };
}

// Returns one relay sheet row with its marks. Even legs run to the finish and
// odd legs mirror. Where the two disagree, markLegs names the painted legs and
// the rest are taped.
function relayTableRow(r, table) {
  const legs = r.legs || [1, 2, 3, 4];
  const even = legs.some((l) => l % 2 === 0) ? hurdleMark(table, r.distance, r) : null;
  const odd = legs.some((l) => l % 2)
    ? hurdleMark(table, r.distance, { ...r, toFirst: r.toFinish, toFinish: r.toFirst })
    : null;
  const painted = legs.filter((l) => (l % 2 ? odd : even));
  return {
    class: r.class || null,
    legs,
    // pairs holds the sheet's own lane pairs, where its entry names them.
    pairs: r.pairs || null,
    count: r.count,
    toFirst: r.toFirst,
    interval: r.interval,
    toFinish: r.toFinish,
    height: r.height,
    markLegs: painted.length < legs.length && painted.length ? painted : null,
    mark: even || odd,
  };
}

// Returns a shuttle team's lane pair. The draw names one lane and nothing says
// which (docs/tuloslista-api.md), so the parity picks (1,2), (3,4) and so on.
function shuttleLanePair(position) {
  const lo = position % 2 ? position : position - 1;
  return [lo, lo + 1];
}

// Returns a drawn aitaviesti row's lane cell as the pair, since the team's
// hurdles fill both lanes and the drawn number is half the answer.
function shuttleLaneText(position) {
  return position ? laneRange(shuttleLanePair(position)) : '';
}

// Says whether the draw reads as a pair per team. A meet that numbers the pairs
// puts two teams in one (docs/tuloslista-api.md). shuttleStartRows agrees.
function shuttlePairDraw(rounds) {
  const heats = new Map();
  let drawn = false;
  for (const round of rounds || []) {
    for (const h of heatsInOrder(round)) {
      if (!heats.has(h.Index)) heats.set(h.Index, new Set());
      const pairs = heats.get(h.Index);
      for (const a of h.Allocations || []) {
        if (!a.Position) continue;
        const [lo] = shuttleLanePair(a.Position);
        if (pairs.has(lo)) return false;
        pairs.add(lo);
        drawn = true;
      }
    }
  }
  return drawn;
}

// Returns an aitaviesti start's rows, one per setting. `drawn` widens each
// Position to its pair, legs 2 and 4 in the odd lane (docs/tuloslista-api.md,
// observed). Two teams in a pair or two settings in a lane drop the lanes.
function shuttleStartRows(entries, table) {
  const specs = [];
  for (const e of entries || []) {
    const spec = hurdleRelaySpec(e.round, table);
    if (spec) specs.push({ label: e.label, spec, drawn: e.drawn });
  }
  if (!specs.length) return null;
  const rows = new Map();
  const missing = [];
  let notLanes = false;
  // A heat's pairs are counted over every class, as in shuttlePairDraw.
  const heatPairs = new Map();
  for (const { label, spec, drawn } of specs) {
    if (!spec.rows.length) {
      missing.push(label);
      continue;
    }
    const los = [];
    for (const heat of heatsInOrder(drawn)) {
      if (!heatPairs.has(heat.Index)) heatPairs.set(heat.Index, new Set());
      const pairs = heatPairs.get(heat.Index);
      for (const a of heat.Allocations || []) {
        if (!a.Position) continue;
        const [lo] = shuttleLanePair(a.Position);
        if (pairs.has(lo)) notLanes = true;
        pairs.add(lo);
        los.push(lo);
      }
    }
    for (const r of spec.rows) {
      const key = JSON.stringify([r.legs, r.count, r.toFirst, r.interval, r.toFinish, r.height]);
      if (!rows.has(key)) rows.set(key, { ...r, categories: [], lanes: [] });
      const row = rows.get(key);
      if (!row.categories.includes(label)) row.categories.push(label);
      const evenLegs = r.legs.some((l) => l % 2 === 0);
      const oddLegs = r.legs.some((l) => l % 2);
      for (const lo of los) {
        if (evenLegs && !row.lanes.includes(lo)) row.lanes.push(lo);
        if (oddLegs && !row.lanes.includes(lo + 1)) row.lanes.push(lo + 1);
      }
    }
  }
  const merged = [...rows.values()]
    .map((r) => ({ ...r, lanes: r.lanes.sort((a, b) => a - b) }))
    .sort((a, b) => (a.lanes[0] ?? Infinity) - (b.lanes[0] ?? Infinity));
  const clash =
    notLanes || merged.some((a, i) => merged.slice(i + 1).some((b) => a.lanes.some((lane) => b.lanes.includes(lane))));
  if (clash) for (const r of merged) r.lanes = [];
  const distance = specs[0].spec.distance;
  return {
    distance,
    rows: merged,
    tapes: merged.length ? shuttleTapes(distance, merged, table) : null,
    missing,
    multiClass: new Set(specs.map((s) => s.label)).size > 1,
  };
}

// Names the taping figure's two bands by the drawn lanes, the sheet's pairs or
// the parity's word, in that order, and never by a lane count.
function shuttleBandNames(rows) {
  const lanes = [...new Set(rows.flatMap((r) => r.lanes))].sort((a, b) => a - b);
  const pairs = rows.find((r) => r.pairs)?.pairs;
  const name = (parity, side, word) => {
    const own = lanes.filter((l) => l % 2 === parity);
    if (own.length) return laneRange(own);
    return pairs ? laneRange(pairs.map((p) => p[side])) : word;
  };
  return { evenLegs: name(1, 0, 'pariton'), oddLegs: name(0, 1, 'parillinen') };
}

// Writes ascending lanes with each run as a range, so [1,3,4] reads "1, 3–4".
function laneRange(lanes) {
  const parts = [];
  for (let i = 0; i < lanes.length;) {
    let j = i;
    while (j + 1 < lanes.length && lanes[j + 1] === lanes[j] + 1) j++;
    parts.push(i === j ? `${lanes[i]}` : `${lanes[i]}–${lanes[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

// Returns one start's setups down the track: a table per heat, since the
// classes in a heat can change from heat to heat (docs/tuloslista-api.md,
// "Heats and allocations"), and a row per setting with its lanes. The lanes
// say whether settings stand side by side or in turn (docs/hurdles.md, "What
// the meets do"), and an undrawn class trails.
function hurdleStartSetups(detailed, table) {
  const specs = [];
  for (const e of detailed || []) {
    const spec = hurdleSpec(e.schedRound, table);
    if (spec) specs.push({ label: e.label, spec, round: e.round });
  }
  if (!specs.length) return null;

  // `setup`'s JSON is a stable key (setupFields).
  const add = (rows, { spec }, label, lanes) => {
    const key = JSON.stringify(spec.setup);
    if (!rows.has(key)) {
      rows.set(key, {
        setup: spec.setup,
        mark: spec.mark,
        tapes: hurdleTapes(spec.distance, spec.setup, spec.mark, table),
        categories: [],
        lanes: [],
      });
    }
    const row = rows.get(key);
    if (!row.categories.includes(label)) row.categories.push(label);
    for (const lane of lanes) if (!row.lanes.includes(lane)) row.lanes.push(lane);
  };
  const finish = (rows) =>
    [...rows.values()]
      .map((r) => ({ ...r, lanes: r.lanes.sort((a, b) => a - b) }))
      .sort((a, b) => (a.lanes[0] ?? Infinity) - (b.lanes[0] ?? Infinity));

  const byHeat = new Map();
  const drawn = new Set();
  for (const entry of specs) {
    for (const heat of heatsInOrder(entry.round)) {
      const lanes = (heat.Allocations || []).map((a) => a.Position).filter(Boolean);
      if (!lanes.length) continue;
      drawn.add(entry.label);
      const index = heat.Index ?? 0;
      if (!byHeat.has(index)) byHeat.set(index, new Map());
      add(byHeat.get(index), entry, entry.label, lanes);
    }
  }
  const undrawn = new Map();
  for (const entry of specs) if (!drawn.has(entry.label)) add(undrawn, entry, entry.label, []);

  const tables = [...byHeat].sort((a, b) => a[0] - b[0]).map(([heat, rows]) => ({ heat, rows: finish(rows) }));
  if (undrawn.size) tables.push({ heat: null, rows: finish(undrawn) });

  // `rows` has one row per setting over every heat, as hurdles stand for the
  // whole start. `perHeat` says one lane holds different settings in different
  // heats, and then the render keeps the heats apart (hurdleSetupBlocks).
  const merged = new Map();
  for (const entry of specs) {
    const lanes = heatsInOrder(entry.round).flatMap((h) =>
      (h.Allocations || []).map((a) => a.Position).filter(Boolean),
    );
    add(merged, entry, entry.label, lanes);
  }
  const rows = finish(merged);
  const perHeat = rows.some((a, i) => rows.slice(i + 1).some((b) => a.lanes.some((lane) => b.lanes.includes(lane))));
  const multiClass = new Set(specs.map((s) => s.label)).size > 1;
  return { distance: specs[0].spec.distance, tables, rows, perHeat, multiClass };
}

// Splits a start's setups into the blocks the box and the day sheet draw, each
// under its own header row. A perHeat start is its drawn heats, then its
// undrawn classes. Any other start is one block over `rows`.
function hurdleSetupBlocks(info) {
  if (!info.perHeat) {
    return [{ drawn: info.rows.some((r) => r.lanes.length), sections: [{ heat: null, rows: info.rows }] }];
  }
  return [
    { drawn: true, sections: info.tables.filter((t) => t.heat != null) },
    { drawn: false, sections: info.tables.filter((t) => t.heat == null) },
  ].filter((b) => b.sections.length);
}

// Returns the day sheet's blocks (renderHurdleSheet, app/hurdles.js).
// Consecutive starts on one setting make one block over the union of their
// lanes.
function hurdleSheetBlocks(starts) {
  const settingKey = ({ kind, info }) => {
    if (info.multiClass || info.rows.length !== 1) return null;
    const r = info.rows[0];
    if (kind === 'relay') {
      return info.missing.length
        ? null
        : JSON.stringify([r.class, r.legs, r.count, r.toFirst, r.interval, r.toFinish, r.height]);
    }
    return r.setup ? JSON.stringify(r.setup) : null;
  };
  const blocks = [];
  for (const s of starts) {
    const key = settingKey(s);
    const last = blocks[blocks.length - 1];
    if (key && last && last.key === key && last.kind === s.kind) {
      const row = last.info.rows[0];
      const next = s.info.rows[0];
      const merged = { ...row, categories: [...new Set([...row.categories, ...next.categories])] };
      if (row.lanes) merged.lanes = [...new Set([...row.lanes, ...next.lanes])].sort((a, b) => a - b);
      last.info = { ...last.info, rows: [merged] };
      last.starts.push(s);
    } else {
      blocks.push({ key, kind: s.kind, info: s.info, starts: [s] });
    }
  }
  return blocks.map(({ key, ...b }) => b);
}

export {
  hurdleDistance,
  hurdleMark,
  hurdleMarkGlyph,
  hurdleRelayLeg,
  hurdleRelaySpec,
  hurdleSetupBlocks,
  hurdleSheetBlocks,
  hurdleSpec,
  hurdleStartSetups,
  hurdleTapes,
  isHurdleStart,
  laneRange,
  markCovers,
  relayTableRow,
  sameRaceMark,
  setupFields,
  shuttleBandNames,
  shuttleLaneText,
  shuttlePairDraw,
  shuttleStartRows,
  shuttleTapes,
  steepleDistance,
  steepleSpec,
  steepleStartRows,
  tableCategory,
};
