// --- Running times and the places they give ---

// Returns places across a merged field. Equal times share a place, and the
// next place skips past them (1., 1., 3.). `times` are parsed results in
// ascending order, and a null time gets a null place.
function overallPlaces(times) {
  const out = [];
  let place = 0;
  let timed = 0;
  let prev = null;
  for (const t of times) {
    if (t == null) {
      out.push(null);
      continue;
    }
    timed += 1;
    if (t !== prev) {
      place = timed;
      prev = t;
    }
    out.push(place);
  }
  return out;
}

// Parses a running result into hundredths of a second, for sorting across
// classes. "26,14" is 2614. "2.05,3" is 12530, since one decimal is tenths.
// DNS/DNF/DQ and anything else unparseable give null.
function parseResult(s) {
  const m = /^(?:(\d+)\.)?(\d{1,2}),(\d{1,2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const cs = m[3].length === 1 ? Number(m[3]) * 10 : Number(m[3]);
  return ((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])) * 100 + cs;
}

// Sorts a merged heat's rows fastest first into a new array. A row with no
// parseable time goes last, and a tie goes by lane.
function heatFinishOrder(rows) {
  return [...(rows || [])].sort(
    (a, b) =>
      (parseResult(a.alloc?.Result) ?? Infinity) - (parseResult(b.alloc?.Result) ?? Infinity) || a.lane - b.lane,
  );
}

// Places each finisher of one physical heat, keyed by allocation id. Neither
// ResultRank nor HeatRank fits a heat of several classes (docs/views.md). A
// row with no parseable time gets no place.
function heatPlaces(rows) {
  const sorted = heatFinishOrder(rows);
  const places = overallPlaces(sorted.map((r) => parseResult(r.alloc?.Result)));
  const byId = new Map();
  sorted.forEach((r, i) => {
    if (places[i] != null) byId.set(r.alloc?.Id, places[i]);
  });
  return byId;
}

// --- A round's heats ---

// Sorts Heats[] by Index, as they arrive unordered (2026-08).
function heatsInOrder(round) {
  return [...(round?.Heats || [])].sort((a, b) => (a.Index ?? 0) - (b.Index ?? 0));
}

// Says whether the field is drawn. An undrawn round can carry a heat shell with
// empty Allocations (2026-08), so Heats.length is no test.
function roundAllocated(round) {
  return (round?.Heats || []).some((h) => h.Allocations?.length);
}

// Says whether Position can be a lane in one race. A field event's restarts at
// 1 per class, so two field classes collide (2026-08).
function laneDrawn(eventType) {
  return eventType?.Category === 'Track' || eventType?.Category === 'Relay';
}

// Says whether the lanes were one draw, each lane used once. A shared track
// heat of several classes is one only about half the time (2026-08).
function lanesAreOneDraw(rows) {
  const lanes = (rows || []).map((r) => r.lane);
  return lanes.length > 0 && lanes.every((l) => l) && new Set(lanes).size === lanes.length;
}

// Merges the classes' heats into physical heats by Index. entries hold { label,
// round, data }, and data's EventType gates the wind (heatWind) and the lanes
// (laneDrawn) here, so no reader can forget. `lanes` says they are one draw.
function mergeHeats(entries) {
  const heats = new Map();
  for (const e of entries) {
    for (const h of e.round?.Heats || []) {
      if (!heats.has(h.Index)) heats.set(h.Index, { index: h.Index, wind: null, lanes: true, rows: [] });
      const mh = heats.get(h.Index);
      const wind = heatWind(h, e.data?.EventType);
      if (wind) mh.wind = wind;
      if (!laneDrawn(e.data?.EventType)) mh.lanes = false;
      for (const a of h.Allocations || []) {
        mh.rows.push({ lane: a.Position, alloc: a, label: e.label });
      }
    }
  }
  const list = [...heats.values()].sort((a, b) => a.index - b.index);
  for (const h of list) {
    h.rows.sort((a, b) => a.lane - b.lane || a.label.localeCompare(b.label, 'fi'));
    h.lanes = h.lanes && lanesAreOneDraw(h.rows);
  }
  return list;
}

// Says whether heats were drawn across classes (docs/views.md). Some heat holds
// two classes and every such heat is one draw, or a merged table spans two
// races (2026-08).
function heatsAreShared(heats) {
  const multi = (heats || []).filter((h) => new Set((h.rows || []).map((r) => r.label)).size > 1);
  return multi.length > 0 && multi.every((h) => h.lanes);
}

// Counts the entrants over every heat of a loaded round, the "3/8" denominator.
function roundFieldSize(round) {
  return (round?.Heats || []).reduce((n, h) => n + (h.Allocations?.length || 0), 0);
}

// Says whether a round is its event's final, a Final round or an only round
// whatever its flag, as an only round can be filed Qualify (2026-09).
function isFinalRound(rounds, round) {
  if (!round) return false;
  return round.RoundTypeCategory === 'Final' || (rounds || []).length === 1;
}

// --- Winds ---

// The longest race that wind governs (World Athletics). Tuloslista publishes a
// reading for every track heat anyway (2026-08).
const WIND_MAX_LENGTH_M = 200;

// Says whether wind governs an event. It reads Category too, as a relay's
// Length is one leg and a 4x100 would pass (2026-08).
function windLegalEvent(eventType) {
  if (eventType?.Category !== 'Track') return false;
  const length = Number(eventType?.Length);
  return Number.isFinite(length) && length > 0 && length <= WIND_MAX_LENGTH_M;
}

// Returns a reading, or null for 'NM' and an absent Wind alike. Both mean no
// reading, never no wind.
function windValue(wind) {
  return wind && wind !== 'NM' ? wind : null;
}

// Returns the wind beside a heat, or null where wind does not govern the event.
function heatWind(heat, eventType) {
  return windLegalEvent(eventType) ? windValue(heat?.Wind) : null;
}

// Returns a row's own reading, as a horizontal jump's is on the attempt and a
// merged row has left its heat. A track row's Wind equals its heat's (2026-08).
function resultWind(alloc, eventType) {
  const affected =
    windLegalEvent(eventType) || (eventType?.Category === 'Field' && eventType?.SubCategory === 'HorizontalJump');
  return affected ? windValue(alloc?.Wind) : null;
}

// Parses "+2,1" as 2.1, as a reading is signed with a decimal comma (2026-08).
// An unsigned calm and a typographic minus parse too.
function parseWind(wind) {
  const m = /^([+\-−]?)(\d+(?:[.,]\d+)?)$/.exec(String(wind ?? '').trim());
  if (!m) return null;
  return (m[1] === '-' || m[1] === '−' ? -1 : 1) * Number(m[2].replace(',', '.'));
}

// World Athletics' limit. A reading equal to it is legal, so the test is > and
// not >=.
const WIND_LEGAL_MAX_MPS = 2.0;

// Says whether a measured reading is over the limit. An unknown is never aided.
function windAided(wind) {
  const v = parseWind(wind);
  return v != null && v > WIND_LEGAL_MAX_MPS;
}

// --- Marks and the order of results ---

// Returns a result's sort key, best first, so a time ascends and a field mark
// is negated. The separator alone tells the two apart, as a time carries a
// comma (2026-08). "DNS" or "NH" gives null.
function resultOrderKey(result) {
  const time = parseResult(result);
  if (time != null) return time;
  const mark = fieldMark(result);
  return mark == null ? null : -mark;
}

// Returns a vertical jump's countback, fewer first, as the tries at the height
// cleared, then the failures up to and including it (WA TR 26.8). It is []
// where no pattern at the Result ends in a clearance, as in any other event.
function verticalCountback(alloc) {
  const cleared = fieldMark(alloc.Result);
  const at = (alloc.Attempts || []).find((att) => fieldMark(att.Line1) === cleared);
  if (cleared == null || !/^x*o$/.test(at?.Line2 || '')) return [];
  const failures = (alloc.Attempts || [])
    .filter((att) => fieldMark(att.Line1) <= cleared)
    .reduce((n, att) => n + ((att.Line2 || '').match(/x/g) || []).length, 0);
  return [at.Line2.length, failures];
}

// Orders a class's rows as a results list, both during the round and after it.
// Ranked rows come first. A row with a result but no rank, such as a guest's,
// follows by that result, with a vertical jump's countback deciding a tie. Rows
// still without a result keep their lane or draw order, and rows marked DNS go
// last, as they will not get one.
function sortResults(allocations) {
  return [...allocations].sort((a, b) => {
    const ra = a.ResultRank ?? Infinity;
    const rb = b.ResultRank ?? Infinity;
    if (ra !== rb) return ra - rb;
    const ka = resultOrderKey(a.Result) ?? Infinity;
    const kb = resultOrderKey(b.Result) ?? Infinity;
    if (ka !== kb) return ka - kb;
    const ca = verticalCountback(a);
    const cb = verticalCountback(b);
    if (ca.length && cb.length) {
      if (ca[0] !== cb[0]) return ca[0] - cb[0];
      if (ca[1] !== cb[1]) return ca[1] - cb[1];
    }
    const ha = markedDidNotStart(a) ? 2 : a.Result ? 0 : 1;
    const hb = markedDidNotStart(b) ? 2 : b.Result ? 0 : 1;
    if (ha !== hb) return ha - hb;
    return (a.Position ?? 0) - (b.Position ?? 0);
  });
}

// Lists a round's whole field as one ranked list of copies, as ResultRank is
// round-wide (2026-08). The app's own camelCase heatIndex says
// the heat.
function totalResults(round) {
  return sortResults(
    heatsInOrder(round).flatMap((h) => (h.Allocations || []).map((a) => ({ ...a, heatIndex: h.Index }))),
  );
}

// Writes a place as "3/8" where the field is known and "3." where it is not.
function positionText(rank, total) {
  return rank == null ? '' : `${rank}${total ? `/${total}` : '.'}`;
}

// Returns the place a row's own table can explain. That is scopeRank in a
// Mitalit table, HeatRank in a heat, and the round-wide ResultRank for a merged
// row (heatIndex). HeatRank is set wherever ResultRank is.
function displayRank(a) {
  if (a?.scopeRank !== undefined) return a.scopeRank;
  return (a?.heatIndex == null ? (a?.HeatRank ?? a?.ResultRank) : a?.ResultRank) ?? null;
}

// Returns the official place a Mitalit row names beside its own (scopeRank), or
// null where the two agree and it would repeat the Sija column. A row under no
// scope keeps it, as it has no other place.
function officialRank(a) {
  if (a?.scopeRank === undefined || a?.ResultRank == null) return null;
  return a.scopeRank === a.ResultRank ? null : a.ResultRank;
}

function allocMark(alloc, data, round) {
  if (data?.EventCategory === 'Field') {
    return fieldResultText(alloc, round, data.EventSubCategory === 'VerticalJump');
  }
  return alloc?.Result ? markFormat(data)(alloc.Result) : '';
}

// Every number a row prints goes through markFormat. A vertical jump's numbers
// arrive in mixed units and all print in metres, as its bar headings do.
const PLAIN_MARK = (v) => v || '';
function markFormat(data) {
  return data?.EventSubCategory === 'VerticalJump' ? verticalMarkText : PLAIN_MARK;
}

// Reads a field mark into millimetres, as metres with a decimal point or whole
// centimetres without, since a Result and its best can differ in unit
// (2026-08). Millimetres compare exactly.
function fieldMark(s) {
  const t = String(s || '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * (t.includes('.') ? 1000 : 10));
}

// --- Who a row is ---

// Returns a competitor's identity in one event, which is TeamId, a relay's too,
// or a sole Athletes[].Id, and never the licence (2026-08).
function allocKey(a) {
  if (a?.TeamId != null) return `t${a.TeamId}`;
  return a?.Athletes?.length === 1 ? `a${a.Athletes[0].Id}` : null;
}

// Returns the box a row files under. A person has their own and a team its
// club's, so a followed club's relays are lines of the club, as on home
// (scanDigest, lib/digest.js).
function followedKey(alloc) {
  const one = alloc?.Athletes?.length === 1 ? alloc.Athletes[0].Id : null;
  if (one != null) return `a${one}`;
  if (alloc?.Organization?.Id != null) return `o${alloc.Organization.Id}`;
  return `x${alloc?.Id}`;
}

// --- Relays ---

function athleteFullName(a) {
  return [a?.Firstname, a?.Surname].filter(Boolean).join(' ');
}

// Returns a relay's runners in leg order, from AthleteOrders once drawn and
// Athletes[] by Index before. Only the first `legs` count and the rest are a
// pool, and Enrollments carry no AthleteOrders (2026-08).
function relayLineup(alloc, legs = 0) {
  const orders = alloc?.AthleteOrders;
  const byIndex = (a, b) => (a.Index ?? 0) - (b.Index ?? 0);
  const list = orders?.length
    ? [...orders].sort(byIndex).map((o) => o.Athlete)
    : [...(alloc?.Athletes || [])].sort(byIndex);
  const named = list.filter(Boolean);
  return legs > 0 ? named.slice(0, legs) : named;
}

// Returns a relay's runners' names, or [] for an individual, who also has an
// Athletes[]. AthleteOrders or a second athlete marks a relay.
function relayLegs(alloc, legs = 0) {
  return relayLegParts(alloc, legs).map((p) => p.name);
}

// Returns relayLegs' runners as { name, followed }. `followed` marks a
// namedAthleteIds person, through whom a relay matches (allocMatches).
function relayLegParts(alloc, legs = 0, named = null) {
  if (!alloc?.AthleteOrders?.length && !(alloc?.Athletes?.length > 1)) return [];
  return relayLineup(alloc, legs)
    .map((a) => ({ name: athleteFullName(a), followed: !!named?.has(String(a.Id)) }))
    .filter((p) => p.name);
}

// Counts a relay's legs from the event's name first, since TeamSize is wrong
// where a race is filed under the wrong EventType (2026-08).
function relayLegCount(eventType, eventName = '') {
  if (!isRelayEventType(eventType)) return 1;
  const pattern = /(\d+)\s*x\s*(\d+)/i;
  const named = pattern.exec(eventName);
  if (named) return Number(named[1]);
  if ((eventType?.TeamSize || 1) > 1) return eventType.TeamSize;
  const m = pattern.exec(`${eventType?.Name || ''} ${eventType?.Code || ''}`);
  return m ? Number(m[1]) : 1;
}

function isRelayEventType(eventType) {
  return eventType?.Category === 'Relay' || (eventType?.TeamSize || 1) > 1;
}

// Says whether a /results payload's entries are teams, and how many athletes a
// team fields. A team is its club's, not its members' (2026-08).
function relayInfo(data) {
  const legCount = relayLegCount(data?.EventType, data?.Name);
  return { relay: legCount > 1 || data?.EventCategory === 'Relay' || isRelayEventType(data?.EventType), legCount };
}

// --- Field results: Attempts[] = [{Line1: mark|"x"|"-", Line2: wind|"xxo"|null}] ---

// Counts the attempt columns. A final gives everyone 3 and the top 8 a further
// 3, so rows in one heat carry different Attempts.length.
function attemptColumns(allocations) {
  return Math.max(0, ...allocations.map((a) => a.Attempts?.length || 0));
}

// Says whether any row has a bib. Some meets number no field event, and an
// all-empty column reads as broken.
function bibNumbersUsed(rows) {
  return rows.some((r) => r.Number);
}

// Returns every bar height in cm that anyone attempted, ascending. A passed
// height is absent from an athlete's Attempts[], so the grid needs the union.
function verticalJumpHeights(allocations) {
  const set = new Set();
  for (const a of allocations) {
    for (const att of a.Attempts || []) {
      const h = Number(att.Line1);
      if (Number.isFinite(h)) set.add(h);
    }
  }
  return [...set].sort((x, y) => x - y);
}

// Maps one athlete's bar heights in cm to their patterns, such as "xo", for
// looking up against verticalJumpHeights.
function verticalJumpRow(allocation) {
  const byHeight = new Map();
  for (const att of allocation.Attempts || []) {
    const h = Number(att.Line1);
    if (Number.isFinite(h)) byHeight.set(h, att.Line2 || '');
  }
  return byHeight;
}

// Says whether a field athlete did not start, in any of the ways an official
// marks it (docs/tuloslista-api.md, "Field events"). A pass ("-") is not a
// try. A row with a mark, or with no Result in an unfinished round, has
// started or may still start.
function fieldDidNotStart(alloc, round, vertical) {
  const attempts = alloc?.Attempts || [];
  if (attempts.some((att) => att.Line1 === 'DNS' || att.Line2 === 'DNS')) return true;
  if (alloc?.Result ? fieldMark(alloc.Result) != null : resultPending(round)) return false;
  return !attempts.some((att) => /[xo\d]/i.test((vertical ? att.Line2 : att.Line1) || ''));
}

// Says whether an official marked the row DNS in any of their ways
// (docs/tuloslista-api.md, "Field events").
function markedDidNotStart(a) {
  return a.Result === 'DNS' || (a.Attempts || []).some((att) => att.Line1 === 'DNS' || att.Line2 === 'DNS');
}

function fieldResultText(alloc, round, vertical) {
  if (fieldDidNotStart(alloc, round, vertical)) return 'DNS';
  return vertical ? verticalMarkText(alloc?.Result) : alloc?.Result || '';
}

// --- The order of a field heat's next attempts ---

const ATTEMPT_ORDER_COUNT = 3;
const MAX_ATTEMPTS = 6;

// Returns the next three attempts of a field heat in progress as a Map from a
// row's Id to { n, slot }. `n` is the attempt's place in the order. `slot` is
// its column: the attempt's index in a throw or a horizontal jump, and the bar
// in cm in a vertical jump. The order starts at the athlete whose turn it is,
// read from ActiveAllocationId (docs/tuloslista-api.md, "Field events"). That
// athlete is first until their attempt has a result. If the heat has no
// ActiveAllocationId and the round is `live`, the order starts after the latest
// attempt. In a multi-event `leg`, each athlete has three attempts in a throw
// or a horizontal jump, and other meets give more (2026-11).
function fieldAttemptOrder(heat, vertical, { leg = false, live = false } = {}) {
  const rows = heat?.Allocations || [];
  const active = rows.find((a) => a.AllocId != null && a.AllocId === heat?.ActiveAllocationId);
  const index = heat?.ActiveAllocationAttemptIndex ?? -1;
  let next = [];
  if (active && index >= 0) {
    next = vertical
      ? firstAttempts(verticalAttemptWalk(rows, active, index))
      : roundAttempts(rows, activeCandidates(rows, active, index), leg ? 3 : MAX_ATTEMPTS);
  } else if (live && vertical) {
    const last = lastOverBar(rows);
    if (last) next = firstAttempts(verticalAttemptWalk(rows, last.active, last.index));
  } else if (live) {
    next = roundAttempts(rows, latestCandidates(rows), leg ? 3 : MAX_ATTEMPTS);
  }
  return new Map(next.map(({ row, slot }, i) => [row.Id, { n: i + 1, slot }]));
}

function firstAttempts(walk) {
  const out = [];
  for (const step of walk) {
    if (out.length === ATTEMPT_ORDER_COUNT) break;
    out.push(step);
  }
  return out;
}

const attemptFilled = (att) => Boolean(att?.Line1);
const byDraw = (a, b) => (a.Position ?? 0) - (b.Position ?? 0);

// The two orders of the rounds after the third. Only the rows with a
// ReverseOrderRank continue, taken as the top eight. Meets use either the
// reverse order of ranking or the draw order (2026-11). No ReverseOrderRank
// has been seen during a meet (2026-11). Without one, every row continues in
// draw order, as in a meet of four attempts each.
const LATER_ORDERS = ['reversed', 'draw'];

// Returns the rows that take part in round `slot` of a throw or a horizontal
// jump, in the order that `later` names (LATER_ORDERS).
function roundOrder(rows, slot, later) {
  const ranked = rows.filter((a) => a.ReverseOrderRank != null);
  if (slot < 3 || !ranked.length) return [...rows].sort(byDraw);
  if (later === 'draw') return ranked.sort(byDraw);
  return ranked.sort((a, b) => b.ReverseOrderRank - a.ReverseOrderRank || byDraw(a, b));
}

// Says whether the row's athlete is still to have their attempt in round
// `slot`. An entered pass ("-") counts as an attempt.
const attemptDue = (row, slot) =>
  !attemptFilled(row.Attempts?.[slot]) &&
  (slot === 0 || attemptFilled(row.Attempts?.[slot - 1])) &&
  !markedDidNotStart(row);
// Says whether the row has a throw or a jump in round `slot`, a mark or a foul.
const attemptMarked = (row, slot) =>
  attemptFilled(row.Attempts?.[slot]) && !['-', 'DNS'].includes(row.Attempts[slot].Line1);

// Counts the rows that contradict `order` if it is the turn of the athlete at
// `at` in round `slot`: the rows before them that are still to have their
// attempt, and the rows after them that have had it.
function orderMisfit(order, at, slot) {
  const before = order.slice(0, at).filter((row) => attemptDue(row, slot)).length;
  return before + order.slice(at + 1).filter((row) => attemptMarked(row, slot)).length;
}

// Returns a candidate { later, active, index, misfit } for each order in
// LATER_ORDERS: the order, the athlete whose turn it is, the attempt's index,
// and the order's orderMisfit. In the first three rounds, both orders are the
// draw order, so both fit.
function activeCandidates(rows, active, index) {
  return LATER_ORDERS.map((later) => {
    const order = roundOrder(rows, index, later);
    const at = order.indexOf(active);
    const misfit = index < 3 ? 0 : at < 0 ? null : orderMisfit(order, at, index);
    return { later, active, index, misfit };
  });
}

// Returns the candidates, as activeCandidates does, for a heat with no
// ActiveAllocationId. A candidate's athlete is the one who had the latest
// attempt in that order. Of the athletes with an attempt in the latest round,
// it is the one whose place in the order contradicts the fewest rows, so that
// an athlete who is away, or one who had their attempt before their turn, does
// not move the order. Of two that fit equally well, the later one in the order
// is taken. Before the first attempt, the order starts at the top of the draw.
function latestCandidates(rows) {
  const slots = rows.flatMap((row) => (row.Attempts || []).map((_, i) => i).filter((i) => attemptMarked(row, i)));
  if (!slots.length) return LATER_ORDERS.map((later) => ({ later, active: null, index: 0, misfit: 0 }));
  const slot = Math.max(...slots);
  return LATER_ORDERS.map((later) => {
    const order = roundOrder(rows, slot, later);
    let best = null;
    order.forEach((row, at) => {
      if (!attemptMarked(row, slot)) return;
      const misfit = orderMisfit(order, at, slot);
      if (!best || misfit <= best.misfit) best = { later, active: row, index: slot, misfit };
    });
    return best || { later, active: null, index: slot, misfit: null };
  });
}

// Returns the next attempts of a throw or a horizontal jump, in the order of
// the candidates with the lowest `misfit`. Where two orders fit equally well, it
// returns only the attempts that both orders give.
function roundAttempts(rows, picks, attempts) {
  const fitting = picks.filter((p) => p.misfit != null);
  if (!fitting.length) return [];
  const best = Math.min(...fitting.map((p) => p.misfit));
  const [first, ...others] = fitting
    .filter((p) => p.misfit === best)
    .map((p) => firstAttempts(roundAttemptWalk(rows, p.active, p.index, attempts, p.later)));
  const agreed = first.findIndex((step, i) => others.some((w) => w[i]?.row !== step.row || w[i]?.slot !== step.slot));
  return agreed < 0 ? first : first.slice(0, agreed);
}

// Yields { row, slot } for each attempt still to come, round by round, from
// the athlete `active` in round `index`. It skips a row with no attempt in the
// previous round, as its athlete is away until the official calls them.
function* roundAttemptWalk(rows, active, index, attempts, later) {
  for (let slot = index; slot < attempts; slot++) {
    const order = roundOrder(rows, slot, later);
    const from = slot === index ? Math.max(0, order.indexOf(active)) : 0;
    for (const row of order.slice(from)) {
      if (attemptDue(row, slot)) yield { row, slot };
    }
  }
}

// Counts a row's failures below the bar `bar` since its last clearance. The
// failures before a pass still count.
function failuresBefore(row, bar) {
  const below = (row.Attempts || []).filter((att) => Number(att.Line1) < bar);
  let n = 0;
  for (const att of below.reverse()) {
    const p = att.Line2 || '';
    if (p.includes('o')) break;
    n += (p.match(/x/g) || []).length;
  }
  return n;
}

// Returns the bar in cm of the athlete `active` at attempt `index`. Before
// their first try at a bar, they have no entry at it. The bar is then the
// lowest one above their entries that another athlete has an entry at, or null
// if there is none.
function activeBar(rows, active, index) {
  const own = Number(active.Attempts?.[Math.floor(index / 3)]?.Line1);
  if (Number.isFinite(own)) return own;
  const top = Math.max(0, ...(active.Attempts || []).map((att) => Number(att.Line1)).filter(Number.isFinite));
  const above = verticalJumpHeights(rows).filter((h) => h > top);
  return above.length ? above[0] : null;
}

// Returns the row and the attempt index of the latest try in a vertical jump
// with no ActiveAllocationId, in the form that verticalAttemptWalk takes. The
// latest try is at the highest bar with a try. Each round of tries at a bar
// follows the draw order, so the latest try is by the last athlete in the draw
// among those with the most tries at the bar.
function lastOverBar(rows) {
  const tries = rows.flatMap((row) =>
    (row.Attempts || []).flatMap((att, entry) =>
      /[xo]/i.test(att.Line2 || '') ? [{ row, entry, bar: Number(att.Line1), length: att.Line2.length }] : [],
    ),
  );
  const bar = Math.max(...tries.map((t) => t.bar).filter(Number.isFinite));
  const atBar = tries.filter((t) => t.bar === bar);
  if (!atBar.length) return null;
  const length = Math.max(...atBar.map((t) => t.length));
  const last = atBar
    .filter((t) => t.length === length)
    .sort((a, b) => byDraw(a.row, b.row))
    .at(-1);
  return { active: last.row, index: last.entry * 3 + length - 1 };
}

// Yields { row, slot } for each try still to come at the bar of the athlete
// `active` (docs/tuloslista-api.md, "Field events"). Every athlete takes their
// first try at the bar, in draw order, before anyone takes a second. It stops
// at the end of the bar, as the grid has no column for the next one.
function* verticalAttemptWalk(rows, active, index) {
  const bar = activeBar(rows, active, index);
  if (bar == null) return;
  const pattern = (row) => (row.Attempts || []).find((att) => Number(att.Line1) === bar)?.Line2 || '';
  const ordered = [...rows].sort(byDraw);
  const tryIndex = index % 3;
  for (let t = tryIndex; t < 3; t++) {
    const from = t === tryIndex ? ordered.indexOf(active) : 0;
    for (const row of ordered.slice(from)) {
      const p = pattern(row);
      const due = p.length === t && /^x*$/.test(p) && failuresBefore(row, bar) + t < 3 && !markedDidNotStart(row);
      if (due) yield { row, slot: bar };
    }
  }
}

// Writes a mark in metres, whatever its unit (fieldMark). "NH" stays as is.
function verticalMarkText(mark) {
  if (!mark) return '';
  const mm = fieldMark(mark);
  return mm == null ? String(mark) : (mm / 1000).toFixed(2);
}

// --- Qualification and pending places ---

// Writes the advancement note for a round with a cut. A field event's QRank is
// the mark and QResult the field with fill-ins, and a track event's are per
// heat and on time (2026-08). A final gets null.
function qualificationNote(round, isField) {
  const rank = round?.QRank || '';
  const result = round?.QResult || '';
  if (!rank && !result) return null;
  const parts = [];
  if (rank) parts.push(isField ? `${rank} (Q)` : `${rank} parasta/erä (Q)`);
  if (result) parts.push(isField ? `${result} parasta (q)` : `${result} nopeinta aikaa (q)`);
  return `Jatkoonpääsy: ${parts.join(' ja ')}`;
}

// Returns "Q" for an automatic qualifier, "q" for a fill-in and '' otherwise.
// `round` adds a tied qualifier (tiedQualBadge).
function qualBadge(alloc, round) {
  const own = alloc?.QRank ? 'Q' : alloc?.QResult ? 'q' : '';
  return own || (round ? tiedQualBadge(alloc, round) : '');
}

// Returns the badge a tied row earns, as the API gives a tie equal ranks and
// qualifies one (2026-08). A "q" follows ResultRank across heats
// and a "Q" HeatRank in its heat, never the marks, which lose the thousandths.
function tiedQualBadge(alloc, round) {
  const heats = round?.Heats || [];
  const heatRank = alloc?.HeatRank;
  if (heatRank != null) {
    const own = heats.find((h) => (h.Allocations || []).some((a) => sameAlloc(a, alloc)));
    if ((own?.Allocations || []).some((a) => a.QRank && a.HeatRank === heatRank)) return 'Q';
  }
  const rank = alloc?.ResultRank;
  if (rank != null) {
    const tied = (a) => a.QResult && a.ResultRank === rank;
    if (heats.some((h) => (h.Allocations || []).some(tied))) return 'q';
  }
  return '';
}

// Says whether two rows are one by the allocation's own Id, as a caller may
// hold a copy (matchedEntries).
function sameAlloc(a, b) {
  return a === b || (a?.Id != null && a.Id === b?.Id);
}

// Says whether a "q" can still move. It is decided across every heat and stands
// once the round is Official, while a "Q" is decided in its heat.
function qualPending(round) {
  return (round?.Heats?.length || 0) > 1 && round?.Status !== 'Official';
}

// Says whether places can still move, as in any round short of Official, one
// heat or several. It reads the reconciled Status (reconcileStatuses).
function resultPending(round) {
  return round?.Status !== 'Official';
}

// Returns the place as ResultRank over the round's field ("3/28"), or before
// the row has a mark (allocMark) the drawn heat where there are several.
// resultPending mutes it, as qualPending would miss a single-heat field event.
function allocPosition(alloc, total, heatIndex, heatCount, round, mark = '') {
  if (alloc?.ResultRank != null) {
    return { text: positionText(alloc.ResultRank, total), pending: resultPending(round) };
  }
  if (!mark && heatIndex != null && heatCount > 1) return { text: `Erä ${heatIndex}/${heatCount}`, pending: false };
  return { text: '', pending: false };
}

// --- What the name cell says besides the name ---
// Earlier marks, PB and SB go muted into the name cell (athleteNameParts).

// Shortens a measured round name for the earlier mark on the name's line.
// Loppukilpailu is also a single-round event's only round.
const ROUND_ABBREVIATIONS = {
  Alkuerät: 'AE',
  Välierät: 'VE',
  Karsinta: 'K',
};

function roundAbbrev(name) {
  return ROUND_ABBREVIATIONS[name] || name || '';
}

// Maps each allocKey to its marks in earlier drawn rounds, nearest first, for
// rows with a Result. An event runs at most three rounds (2026-08), so the tail
// is one.
function earlierMarks(rounds, round) {
  const out = new Map();
  if (round?.Index == null) return out;
  const earlier = (rounds || [])
    .filter((r) => r.Index < round.Index && roundAllocated(r))
    .sort((a, b) => b.Index - a.Index);
  for (const r of earlier) {
    for (const h of r.Heats || []) {
      for (const a of h.Allocations || []) {
        const key = allocKey(a);
        if (!key || !a.Result) continue;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push({ round: r, alloc: a, label: roundAbbrev(r.Name), result: a.Result });
      }
    }
  }
  return out;
}

// Labels the bests, with "PB&SB" where the two agree, as a PB with no SB is
// common and a bare "PB" could not say which.
function bestsParts(a) {
  const pb = (a?.PB || '').trim();
  const sb = (a?.SB || '').trim();
  if (pb && sb) {
    return pb === sb
      ? [{ label: 'PB&SB', value: pb }]
      : [
          { label: 'PB', value: pb },
          { label: 'SB', value: sb },
        ];
  }
  if (pb) return [{ label: 'PB', value: pb }];
  if (sb) return [{ label: 'SB', value: sb }];
  return [];
}

// Says whether a result beat a best, in the direction the Category gives. An
// unparseable or wind-aided one (resultWind) does not. It only unmutes the name
// cell's number and claims no record, as the best can be stale.
function beatsMark(result, best, category, wind = null) {
  if (windAided(wind)) return false;
  if (category === 'Field') {
    const r = fieldMark(result);
    const b = fieldMark(best);
    return r != null && b != null && r > b;
  }
  const r = parseResult(result);
  const b = parseResult(best);
  return r != null && b != null && r < b;
}

// --- The athlete sheet ---

// Builds an individual's sheet (soleAthleteId) from the tapped row alone, with
// every earlier mark and the full round and club names (docs/views.md).
function athleteCard(alloc, marks = []) {
  const org = alloc?.Organization || null;
  return {
    name: alloc?.Name || '',
    club: org?.Name || org?.NameShort || '',
    // The bib is null where the meet numbers nobody (bibNumbersUsed).
    bib: alloc?.Number ? String(alloc.Number) : null,
    licence: alloc?.Athletes?.length === 1 ? alloc.Athletes[0].LicenseId || null : null,
    marks: marks.map((m) => ({ label: m.round?.Name || m.label, result: m.result })),
  };
}

export {
  PLAIN_MARK,
  WIND_LEGAL_MAX_MPS,
  allocKey,
  allocMark,
  allocPosition,
  athleteCard,
  athleteFullName,
  attemptColumns,
  beatsMark,
  bestsParts,
  bibNumbersUsed,
  displayRank,
  earlierMarks,
  fieldAttemptOrder,
  fieldResultText,
  followedKey,
  heatFinishOrder,
  heatPlaces,
  heatWind,
  heatsAreShared,
  heatsInOrder,
  isFinalRound,
  isRelayEventType,
  laneDrawn,
  markFormat,
  mergeHeats,
  officialRank,
  overallPlaces,
  parseResult,
  parseWind,
  positionText,
  qualBadge,
  qualPending,
  qualificationNote,
  relayInfo,
  relayLegCount,
  relayLegParts,
  relayLegs,
  relayLineup,
  resultOrderKey,
  resultPending,
  resultWind,
  roundAbbrev,
  roundAllocated,
  roundFieldSize,
  sortResults,
  totalResults,
  verticalJumpHeights,
  verticalJumpRow,
  verticalMarkText,
  windAided,
};
