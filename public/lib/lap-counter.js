import { isRelayEventType, parseResult } from './results.js';

// --- The lap counter (Juoksut mode) --------------------------------------
// docs/lap-counter.md is the specification, and its numbers are measured in
// real races. Only a press re-renders, and the tick rewrites text in place.

// Returns the distance covered. A relay's Length is one leg, and a race can
// be filed under the wrong EventType (docs/tuloslista-api.md). The name's
// `NxM` wins, as trusting the type there rings the bell a lap late.
function raceDistance(eventType, roundName = '') {
  const len = eventType?.Length || 0;
  const size = eventType?.TeamSize || 1;
  const legs = /(\d+)\s*x\s*(\d+)/i;
  const named = isRelayEventType(eventType) ? legs.exec(roundName) : null;
  if (named) return Number(named[1]) * Number(named[2]);
  if (size > 1) return size * len;
  // The name and code spell the legs out if TeamSize goes missing.
  const m = legs.exec(`${eventType?.Name || ''} ${eventType?.Code || ''}`);
  return m && isRelayEventType(eventType) ? Number(m[1]) * Number(m[2]) : len;
}

// A shuttle relay passes the line once whatever the arithmetic says (a 4x60 m
// in a hall computes to two). A hurdle relay is one, and so is a sukkulaviesti.
function isShuttleRelay(eventType, roundName = '') {
  if (!isRelayEventType(eventType)) return false;
  return (
    eventType?.SubCategory === 'Hurdles' || /aitaviesti|sukkulaviesti/i.test(`${roundName} ${eventType?.Name || ''}`)
  );
}

// Returns the number that names a tile. It is the bib over several laps and
// the lane in a race decided on one crossing, where bibs tend to be missing.
function tileAnchor(row, total) {
  const bib = row?.bib == null || row.bib === '' ? null : `#${row.bib}`;
  const lane = row?.lane == null ? null : `R${row.lane}`;
  return (total > 1 ? bib || lane : lane || bib) || '?';
}

// Tiles scan in the anchor's order. A mixed field puts the bibs first and
// the rest in lane order, or the comparator turns intransitive.
function sortTiles(rows, total) {
  const byBib = total > 1;
  return [...rows].sort((a, b) => {
    if (byBib) {
      const ab = a.bib != null;
      const bb = b.bib != null;
      if (ab && bb) return String(a.bib).localeCompare(String(b.bib), 'fi', { numeric: true });
      if (ab !== bb) return ab ? -1 : 1;
    }
    return (a.lane ?? 0) - (b.lane ?? 0);
  });
}

// Returns the tile grid's density, which is its column count on a phone. It
// follows the number of tiles and never the viewport's height
// (docs/lap-counter.md, "Reading the screen").
function tileDensity(tiles) {
  return tiles <= 8 ? 2 : tiles <= 15 ? 3 : 4;
}

// Counts the finish-line crossings, the finish included. A 1500 m makes 4 on
// a 400 m track and 8 on 200 m. A shuttle relay makes one (isShuttleRelay).
function crossingsFor(length, track = 400, shuttle = false) {
  if (shuttle) return 1;
  return Math.max(1, Math.ceil(length / track));
}

// Guesses the track from the date until the select overrides it. October to
// April is the hall's 200 m, and May to September or a bad date is 400 m.
function defaultTrack(date) {
  const month = date?.getMonth?.() + 1;
  if (Number.isNaN(month)) return 400;
  return month >= 5 && month <= 9 ? 400 : 200;
}

// Checks a lap from storage or an index line before the counter divides by
// it. Under 100 is a straight, and over 400 is no track.
function isTrackLength(n) {
  return Number.isFinite(n) && n >= 100 && n <= 400;
}

// Says whether a fetch replaces the counter's stored roster. Over a stored
// one it takes every category and a heat with someone in it, or competitors
// leave the grid mid-race (docs/lap-counter.md, "Storage").
function refreshesSnapshot(detailed, heats, stored) {
  if (!detailed?.some((d) => d.data)) return false;
  if (!stored?.heats?.length) return true;
  return detailed.every((d) => d.data) && heats.length > 0;
}

// A tap log holds crossings `{ id, t }`, reorders `{ order, n, t }` and packs
// `{ pack: [{ id, t, est }, …], t }` (docs/lap-counter.md, "Storage").
// Anything with an id is a crossing.
function isCrossing(ev) {
  return ev?.id != null;
}

// Returns the crossings in one log entry. Every reader of times goes through
// this, or a pack's crossings escape checks such as the correction's floor.
function crossingsOf(ev) {
  if (isCrossing(ev)) return [ev];
  return Array.isArray(ev?.pack) ? ev.pack : [];
}

// Hands the nth crossing's times round the named competitors as a set, and
// each goes to whoever is now that far up. It mutates byId, and it refuses
// where a competitor's crossings would go out of order.
function reorderCrossing(byId, ids, n) {
  const sts = (ids || []).map((id) => byId.get(id));
  if (!(n > 0) || sts.length < 2) return false;
  if (sts.some((st) => !st || st.times.length < n)) return false;
  // The estimate flag belongs to the time and travels with it.
  const marks = sts.map((st) => ({ t: st.times[n - 1], est: st.ests[n - 1] })).sort((a, b) => a.t - b.t);
  const fits = sts.every(
    (st, i) => (st.times[n - 2] ?? -Infinity) < marks[i].t && marks[i].t < (st.times[n] ?? Infinity),
  );
  if (!fits) return false;
  sts.forEach((st, i) => {
    st.times[n - 1] = marks[i].t;
    st.ests[n - 1] = marks[i].est;
  });
  return true;
}

// Derives the counter's state from the append-only tap log that undo pops.
// events is the log in entry order, and total is the crossings to the finish.
// It returns byId of { count, times, ests, pos?, finishT? } and finished.
function deriveLaps(events, total) {
  const byId = new Map();
  // Crossings apply in time order and not entry order, since a repaired
  // crossing is recorded at the moment it took place.
  for (const ev of events.flatMap(crossingsOf).sort((a, b) => a.t - b.t)) {
    let st = byId.get(ev.id);
    if (!st) {
      st = { count: 0, times: [], ests: [] };
      byId.set(ev.id, st);
    }
    if (st.count >= total) continue;
    st.count += 1;
    st.times.push(ev.t);
    st.ests.push(!!ev.est);
  }
  // The reorders apply next, in the order made, and one whose crossings are
  // gone does nothing. A pack must never be read as a reorder here.
  for (const ev of events) {
    if (ev?.order) reorderCrossing(byId, ev.order, ev.n);
  }
  const finished = [];
  for (const [id, st] of byId) {
    // Any estimated crossing makes this competitor's times estimates too.
    if (st.ests.some(Boolean)) st.est = true;
    if (st.count >= total) {
      st.finishT = st.times[total - 1];
      finished.push(id);
    }
  }
  // Places go by finish time, which after a reorder is not the tap order.
  finished.sort((a, b) => byId.get(a).finishT - byId.get(b).finishT);
  finished.forEach((id, i) => {
    byId.get(id).pos = i + 1;
  });
  return { byId, finished };
}

// Returns the [start, end) spans a drag may reorder. A span is a run on one
// crossing count, as only those competitors' times are interchangeable.
function reorderSpans(rows, byId, done = {}) {
  const spans = [];
  const countAt = (i) => byId.get(rows[i].id)?.count ?? 0;
  let i = 0;
  while (i < rows.length) {
    const count = countAt(i);
    let j = i + 1;
    if (count > 0 && !done[rows[i].id]) {
      while (j < rows.length && !done[rows[j].id] && countAt(j) === count) j += 1;
      if (j - i > 1) spans.push([i, j]);
    }
    i = j;
  }
  return spans;
}

// A dragged row reaches a slot once it passes the slot's midpoint. Heights
// are measured, since a wrapped name makes a taller row.
function dropIndex(from, heights, dy) {
  let to = from;
  let acc = 0;
  if (dy > 0) {
    for (let i = from + 1; i < heights.length; i += 1) {
      acc += heights[i];
      if (dy < acc - heights[i] / 2) break;
      to = i;
    }
  } else if (dy < 0) {
    for (let i = from - 1; i >= 0; i -= 1) {
      acc += heights[i];
      if (-dy < acc - heights[i] / 2) break;
      to = i;
    }
  }
  return to;
}

// Returns one span's ids in the order a drag has just left them in.
function movedOrder(rows, from, to) {
  const ids = rows.map((r) => r.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  return ids;
}

// Formats elapsed ms with tenths, so 125300 reads "2.05,3". Hand times round
// up to the next tenth (World Athletics), so 12.399 s reads 12,4.
function fmtElapsed(ms) {
  const tenths = Math.ceil(ms / 100);
  const s = Math.floor(tenths / 10);
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(m ? 2 : 1, '0');
  return `${m ? `${m}.` : ''}${sec},${tenths % 10}`;
}

// Returns a competitor's finish time, or null where the clock does not cover
// it, so a start after the finish prints no negative time. ~ marks a repair.
function finishText(startTs, st) {
  if (startTs == null || st?.finishT == null || st.finishT < startTs) return null;
  return `${st.est ? '~' : ''}${fmtElapsed(st.finishT - startTs)}`;
}

// Race order puts more crossings first, then whoever got there first, and the
// untapped in lane order. rows holds { id, lane }, and byId is deriveLaps'.
function raceOrder(rows, byId) {
  return [...rows].sort((a, b) => {
    const sa = byId.get(a.id);
    const sb = byId.get(b.id);
    const ca = sa?.count ?? 0;
    const cb = sb?.count ?? 0;
    if (ca !== cb) return cb - ca;
    // A missing lane must not turn the comparison into NaN.
    if (ca === 0) return (a.lane ?? 0) - (b.lane ?? 0);
    return sa.times[ca - 1] - sb.times[cb - 1];
  });
}

// --- Lap prompting -------------------------------------------------------
// Every competitor is timed against themselves, so no race clock is needed.

// The prompt lights up this far out, in time to say it aloud to the crew.
const LEAD_METRES = 50;
// From this far out, the lap board stresses the number it is about to show.
const BOARD_SWAP_METRES = 100;
// The last lap is normally the fastest, so expect the finish a little early.
const LAST_LAP_FACTOR = 0.97;
// The estimate is taken over this many of the most recent laps.
const LAP_WINDOW = 3;

// The opening stretch is not a full lap. A 1500 m on a 400 m track reaches
// the line first after 300 m, and a 3000 m after 200 m.
function firstSegment(distance, track) {
  const rest = distance % track;
  return rest === 0 ? track : rest;
}

function medianOf(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Returns the crossings per relay leg, or 0 unless each leg is whole laps
// and hands over at the line. A half-right prompt is worse than none.
function legCrossings(distance, track, legs) {
  if (!(legs > 1) || !(distance > 0) || !(track > 0)) return 0;
  const legLength = distance / legs;
  return Number.isInteger(legLength / track) ? legLength / track : 0;
}

// Returns the call for the coming crossing. It counts the laps left after it,
// with 1 the bell and 0 the finish. A handover outranks the number, and at
// the bell `exchange` rides along, since the last lap can start a leg.
function nextCall(count, total, perLeg = 0) {
  const after = total - count - 1;
  if (after < 0) return null;
  if (after === 0) return { kind: 'finish' };
  // Legs are 1-based and the coming crossing ends this one, so `next` is the
  // leg about to start, whose runner goes to the zone.
  const handover = perLeg > 0 && (count + 1) % perLeg === 0;
  const leg = handover ? (count + 1) / perLeg : 0;
  // The bell outranks the handover, as the bell is a duty. The two coincide
  // only where a leg is a single lap.
  if (after === 1) return handover ? { kind: 'bell', exchange: true, next: leg + 1 } : { kind: 'bell' };
  if (handover) return { kind: 'exchange', leg, next: leg + 1 };
  return { kind: 'laps', laps: after };
}

// Estimates a lap as the median of the last few laps. Before any lap it
// scales the opening segment to a lap, and before that it takes the seed time.
function lapTimeMs(times, { startTs, distance, track, seedMs, fieldMs = null, perLeg = 0 } = {}) {
  const laps = [];
  for (let i = 1; i < times.length; i += 1) laps.push(times[i] - times[i - 1]);
  if (laps.length) {
    // Only laps by the runner now on the track count, or a teammate's laps
    // set the pace (docs/lap-counter.md, "The lap window never crosses a
    // handover"). Before the runner's first lap, the team's history counts.
    const own = perLeg > 0 ? laps.slice(Math.max(0, Math.floor(times.length / perLeg) * perLeg - 1)) : laps;
    return medianOf((own.length ? own : laps).slice(-LAP_WINDOW));
  }
  if (times.length === 1 && startTs != null) {
    return ((times[0] - startTs) * track) / firstSegment(distance, track);
  }
  if (seedMs && distance) return (seedMs * track) / distance;
  // The heat's own pace comes last. It is there exactly when a competitor's
  // own history is not.
  return fieldMs || null;
}

// The heat's pace is the median lap of everyone with laps to measure. It is
// other people's data, so it stands last in the chain (lapTimeMs).
function heatLapMs(rows, byId, { perLeg = 0, done = {} } = {}) {
  const laps = [];
  for (const row of rows) {
    if (done[row.id]) continue;
    const times = byId.get(row.id)?.times;
    if (!times || times.length < 2) continue;
    const lap = lapTimeMs(times, { perLeg });
    if (lap) laps.push(lap);
  }
  return medianOf(laps);
}

// Maps each row { id, sbMs?, pbMs? } of a heat to what the tiles and board
// need now, which is { count, call, lapMs, eta, msAway, state }. byId is
// deriveLaps'. A state is finished, out, unknown, waiting, due or overdue.
function lapPrompts(rows, byId, opts = {}) {
  const {
    total,
    distance,
    track = 400,
    startTs = null,
    perLeg = 0,
    now = Date.now(),
    leadMetres = LEAD_METRES,
    done = {},
  } = opts;
  const out = new Map();
  // One estimate covers the whole heat and stands in for a competitor with
  // neither laps nor a seed.
  const fieldMs = heatLapMs(rows, byId, { perLeg, done });
  for (const row of rows) {
    const st = byId.get(row.id);
    const count = st?.count ?? 0;
    if (done[row.id]) {
      out.set(row.id, { count, call: null, state: 'out', reason: done[row.id] });
      continue;
    }
    if (count >= total) {
      out.set(row.id, { count, call: null, state: 'finished', pos: st?.pos });
      continue;
    }
    const times = st?.times ?? [];
    // The season's best comes first. A first race of the year has no SB, and
    // the PB beats the heat's pace.
    const lapMs = lapTimeMs(times, {
      startTs,
      distance,
      track,
      seedMs: row.sbMs ?? row.pbMs,
      fieldMs,
      perLeg,
    });
    const call = nextCall(count, total, perLeg);
    let eta = null;
    if (lapMs && times.length) {
      // The coming crossing is the finish when only one lap is left.
      eta = times[times.length - 1] + lapMs * (count === total - 1 ? LAST_LAP_FACTOR : 1);
    } else if (lapMs && startTs != null && !times.length) {
      // With nothing tapped, the seed says when to expect the opening crossing.
      eta = startTs + (lapMs * firstSegment(distance, track)) / track;
    }
    if (eta == null) {
      out.set(row.id, { count, call, lapMs, eta: null, msAway: null, state: 'unknown' });
      continue;
    }
    const window = (lapMs * leadMetres) / track;
    const msAway = eta - now;
    // This is metres from the line at their own pace, negative once overdue.
    const metresAway = (msAway / lapMs) * track;
    const state = now >= eta + window ? 'overdue' : now >= eta - window ? 'due' : 'waiting';
    out.set(row.id, { count, call, lapMs, eta, msAway, metresAway, window, state });
  }
  return out;
}

// A press this soon after a crossing is a double press. Three seconds catch
// a fumble, and half a lap at the competitor's own pace catches the rest.
const TAP_GUARD_MS = 3000;
const IMPLAUSIBLE_LAP_FRACTION = 0.5;

function tapGuardMs(times) {
  // Only measured laps are firm enough to refuse a press on.
  if (!times || times.length < 2) return TAP_GUARD_MS;
  const lap = lapTimeMs(times);
  return lap ? Math.max(TAP_GUARD_MS, lap * IMPLAUSIBLE_LAP_FRACTION) : TAP_GUARD_MS;
}

// Space, enter and `Unidentified` start the clock. The last is an Android
// tablet's side key, measured arriving with no `code` (docs/lap-counter.md,
// "Clock, keys and the screen staying on"). No keyboard reports a key as
// `Unidentified`, so matching it starts nothing by accident.
// A focused control keeps the named keys, as the side key activates nothing.
const CLOCK_KEYS = [' ', 'Spacebar', 'Enter'];
const DEVICE_KEY = 'Unidentified';
const KEY_ANSWERS_ITSELF = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'];

function startsClock({
  key,
  repeat = false,
  meta = false,
  ctrl = false,
  alt = false,
  sheetOpen = false,
  targetTag = '',
} = {}) {
  if (repeat || meta || ctrl || alt) return false;
  // A sheet over the counter is not part of it.
  if (sheetOpen) return false;
  const named = CLOCK_KEYS.includes(key);
  if (!named && key !== DEVICE_KEY) return false;
  if (named && KEY_ANSWERS_ITSELF.includes(String(targetTag).toUpperCase())) return false;
  return true;
}

// --- Correcting the clock ---
// The zero is one scalar over absolute timestamps, so moving it changes no
// order, place or gap. A nudge says how late. An anchor says what a time was.

// Reads a hand time as the app writes it, "2.05,3", into ms by parseResult.
function handTimeMs(s) {
  const cs = parseResult(s);
  return cs == null ? null : cs * 10;
}

// Returns where the zero must have been if this crossing came at this time.
function anchorStart(crossingT, time) {
  const ms = handTimeMs(time);
  return ms == null || crossingT == null ? null : crossingT - ms;
}

// The zero cannot sit in the future, nor after a logged crossing, as
// finishText drops a negative time. `limited` names the ceiling that bit, and
// the crossing is the tighter where both apply.
const START_MIN_GAP_MS = 1;

function correctedStart(proposed, { firstCrossing = null, now = null } = {}) {
  let ts = Math.round(Number(proposed));
  if (!Number.isFinite(ts)) return null;
  let limited = null;
  for (const [reason, ceiling] of [
    ['now', now],
    ['crossing', firstCrossing == null ? null : firstCrossing - START_MIN_GAP_MS],
  ]) {
    if (ceiling != null && ts > ceiling) {
      ts = ceiling;
      limited = reason;
    }
  }
  return { ts, limited };
}

// Formats how far a correction moved the zero and which way, for the operator
// to read back before committing. Positive means the start moved earlier, so
// every time in the heat grew by this much.
function fmtShift(ms) {
  const tenths = Math.round(Math.abs(ms) / 100);
  return `${ms < 0 ? '−' : ''}${Math.floor(tenths / 10)},${tenths % 10} s`;
}

// Returns the export's note that the zero was moved or fitted afterwards.
// startTs0 is where the clock was first started by hand, or null if never.
function startNote({ startTs = null, startTs0 = null } = {}) {
  if (startTs == null) return null;
  if (startTs0 == null) return 'lähtöaika asetettu jälkikäteen';
  const shift = startTs0 - startTs;
  if (!shift) return null;
  return `lähtöaikaa korjattu ${fmtShift(shift)}`;
}

// Returns the time for a missed crossing where the pace puts it, strictly
// between the previous crossing and now. With no pace it is just before `now`.
function repairTime({ lastT = null, eta = null, startTs = null, now }) {
  const after = lastT ?? startTs;
  const floor = after == null ? now - 1 : after + 1;
  return Math.round(Math.min(now - 1, Math.max(floor, eta ?? now)));
}

// Returns the crossings to append for the confirmed ids of a pack too close
// to tap one by one. The finish is never in it, as a time nobody took is not
// a result. Rows keep their order, and times stay inside the pack's window.
function packCrossings(rows, byId, opts = {}) {
  const { ids = [], total, startTs = null, perLeg = 0, done = {}, now = Date.now() } = opts;
  const want = new Set(ids);
  const prompts = lapPrompts(rows, byId, { ...opts, now });
  const taking = raceOrder(rows, byId).filter((row) => {
    const p = prompts.get(row.id);
    // This skips anyone out of the race, home, or one crossing from home.
    return want.has(row.id) && p && p.state !== 'out' && p.count < total - 1;
  });
  if (!taking.length) return [];
  // Every crossing logged within the last lap bounds the moment.
  const lap = heatLapMs(rows, byId, { perLeg, done });
  const seen = [];
  if (lap) {
    for (const row of rows) {
      for (const t of byId.get(row.id)?.times ?? []) if (t > now - lap) seen.push(t);
    }
  }
  const lo = seen.length ? Math.min(...seen) : null;
  const hi = seen.length ? Math.max(...seen) : null;
  const out = [];
  let prev = -Infinity;
  taking.forEach((row, i) => {
    const st = byId.get(row.id);
    const eta = prompts.get(row.id)?.eta ?? null;
    let t = repairTime({ lastT: st?.times.at(-1) ?? null, eta, startTs, now });
    // The estimate is trusted only inside the window. Outside it, the pack
    // spreads them across the window in the order they stand.
    if (lo != null && !(eta >= lo && eta <= hi)) {
      t = lo + (hi - lo) * (taking.length > 1 ? i / (taking.length - 1) : 0);
    }
    // Times strictly increase and never fall before the crossing they follow.
    t = Math.max(Math.round(t), prev + 1, (st?.times.at(-1) ?? -Infinity) + 1);
    prev = t;
    out.push({ id: row.id, t, est: true });
  });
  // Nothing lands in the future, and trimming from the back keeps the order.
  for (let i = out.length - 1, ceiling = now - 1; i >= 0; i -= 1, ceiling -= 1) {
    if (out[i].t > ceiling) out[i].t = ceiling;
  }
  return out;
}

// Returns whole laps behind the leader per competitor. Progress adds the pace
// estimate's fraction of a lap to the crossing count, which alone flickers
// all the way round. A competitor out of the race is not measured.
function lapsBehind(rows, prompts, track) {
  const progress = new Map();
  let lead = null;
  for (const row of rows) {
    const p = prompts.get(row.id);
    if (!p || p.state === 'out' || p.count == null) continue;
    // The fraction stays inside the lap, or an untapped competitor drifting
    // past the line would read as the leader.
    const run = p.metresAway == null ? 0 : Math.min(1, Math.max(0, 1 - p.metresAway / track));
    const at = p.count + run;
    progress.set(row.id, at);
    if (lead == null || at > lead) lead = at;
  }
  const out = new Map();
  if (lead == null) return out;
  for (const [id, at] of progress) out.set(id, Math.max(0, Math.floor(lead - at)));
  return out;
}

// --- The next-up band ----------------------------------------------------
// Tiles never reorder, since a moved tile puts a lap on the wrong runner. The
// band carries the order without sorting, and a slot is held until recorded.

// The band reaches past LEAD_METRES, to about 30 s out at an 80 s lap.
const BAND_METRES = 150;
const BAND_SLOTS = 3;
// The band is drawn from this many competitors, which is where the grid stops
// being two columns (tileDensity).
const BAND_MIN_FIELD = 9;
// A slot stays empty this long after a press. The tap guard cannot catch a
// second press that lands on whoever filled the slot.
const BAND_HOLD_MS = 700;

// Returns who is in the band, nearest first, which puts the overdue first.
function bandQueue(rows, prompts, { metres = BAND_METRES } = {}) {
  const near = [];
  for (const row of rows) {
    const p = prompts.get(row.id);
    if (!p || p.state === 'out' || p.state === 'finished') continue;
    if (p.metresAway == null || p.metresAway > metres) continue;
    near.push({ id: row.id, away: p.metresAway });
  }
  return near.sort((a, b) => a.away - b.away).map((n) => n.id);
}

// A competitor keeps their slot, and one who is gone empties it for
// BAND_HOLD_MS. Free slots fill leftmost first with the nearest competitors.
function bandSlots(prev, approaching, { slots = BAND_SLOTS, now = Date.now(), holdMs = BAND_HOLD_MS } = {}) {
  const want = new Set(approaching);
  const next = [];
  for (let i = 0; i < slots; i += 1) {
    const was = prev?.[i] ?? null;
    if (was?.id != null) next.push(want.has(was.id) ? was : { freeAt: now + holdMs });
    else if (was?.freeAt != null && now < was.freeAt) next.push(was);
    else next.push(null);
  }
  const held = new Set(next.filter((s) => s?.id != null).map((s) => s.id));
  const queue = approaching.filter((id) => !held.has(id));
  for (let i = 0; i < slots && queue.length; i += 1) {
    if (next[i] == null) next[i] = { id: queue.shift() };
  }
  return next;
}

// Returns the competitors this phone counts where helpers split a big field.
// An empty selection means everyone, as does one that matches nobody on a
// re-fetched roster, so the grid is never empty.
function myRows(rows, mine) {
  if (!mine?.length) return rows;
  const want = new Set(mine);
  const picked = rows.filter((r) => want.has(r.id));
  return picked.length ? picked : rows;
}

// A heat is offered the split from this many competitors (docs/lap-counter.md,
// "Splitting the field").
const SPLIT_MIN_FIELD = 6;

// Returns what the counter's ? explains, as [term, meaning] in reading order.
// It explains the band and the split where the start's biggest heat draws them.
function lapsHelp({ total, perLeg = 0, biggestHeat = 0 }) {
  const laps = total > 1;
  const items = [
    ['Kello', 'Napauta = käynnistä. Pidä pohjassa = säädä kelloa tai nollaa erän kirjaukset ja kello.'],
    [
      'Ruutu',
      laps
        ? 'Napauta jokaisella ylityksellä. Pidä pohjassa = keskeytys tai ohitetun ylityksen kirjaus.'
        : 'Napauta maaliintulojärjestyksessä. Pidä pohjassa = keskeytys.',
    ],
    ['Alarivi', 'Sija ja arvio, milloin ylittää maalilinjan seuraavan kerran: "12 s", "nyt" tai "myöhässä".'],
  ];
  if (laps) {
    items.push(['Iso numero', 'Kierroksia jäljellä seuraavan maalilinjan ylityksen jälkeen.']);
    if (perLeg > 0) {
      items.push(['🤝', 'Vaihto tulossa. Numero on alkava osuus.']);
    }
    items.push(['🔔', 'Viimeinen kierros alkamassa — soita kelloa!']);
    items.push(['🏁', 'Tulossa maaliin.']);
    items.push([
      'Kierrostaulu',
      'Kellon vieressä: mitä kierrostaulu näyttää nyt → mihin vaihtuu kun kärki etusuoralla, ja oletettu kärki.',
    ]);
    if (biggestHeat >= BAND_MIN_FIELD) {
      items.push(['Ylärivi', 'Seuraavaksi maalilinjalle tulevat.']);
    }
    if (biggestHeat >= SPLIT_MIN_FIELD) {
      items.push(['👥 Omat', 'Jaa erä useamman laskijan kesken: tämä laite näyttää vain valitut.']);
    }
    items.push([
      '⏱ kirjaamatta',
      'Koko ryhmän ylitykset yhdellä painalluksella. Maaliintulo on aina napautettava yksitellen.',
    ]);
  }
  items.push(['Lista', 'Napauta riviä = keskeytys tai paluu kilpailuun. Vedä sijaluvusta = korjaa järjestys.']);
  return items;
}

// The board counts down the laps of whoever is furthest along and not out of
// the race. A finisher counts, so the board reaches zero and stays.
function boardLeader(rows, byId, prompts) {
  for (const row of raceOrder(rows, byId)) {
    const p = prompts.get(row.id);
    if (p && p.state !== 'out') return { row, prompt: p };
  }
  return null;
}

export {
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
  isCrossing,
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
};
