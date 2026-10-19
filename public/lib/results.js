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

// Sorts Heats[] by Index, as they arrive unordered (docs/tuloslista-api.md).
function heatsInOrder(round) {
  return [...(round?.Heats || [])].sort((a, b) => (a.Index ?? 0) - (b.Index ?? 0));
}

// Says whether the field is drawn. An undrawn round can carry a heat shell with
// empty Allocations (docs/tuloslista-api.md), so Heats.length is no test.
function roundAllocated(round) {
  return (round?.Heats || []).some((h) => h.Allocations?.length);
}

// Says whether Position can be a lane in one race. A field event's restarts at
// 1 per class, so two field classes collide (docs/tuloslista-api.md).
function laneDrawn(eventType) {
  return eventType?.Category === 'Track' || eventType?.Category === 'Relay';
}

// Says whether the lanes were one draw, each lane used once. A shared track
// heat of several classes is one only about half the time
// (docs/tuloslista-api.md).
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
// races (docs/tuloslista-api.md).
function heatsAreShared(heats) {
  const multi = (heats || []).filter((h) => new Set((h.rows || []).map((r) => r.label)).size > 1);
  return multi.length > 0 && multi.every((h) => h.lanes);
}

// Counts the entrants over every heat of a loaded round, the "3/8" denominator.
function roundFieldSize(round) {
  return (round?.Heats || []).reduce((n, h) => n + (h.Allocations?.length || 0), 0);
}

// Says whether a round is its event's final, a Final round or an only round
// whatever its flag, as an only round can be filed Qualify
// (docs/tuloslista-api.md).
function isFinalRound(rounds, round) {
  if (!round) return false;
  return round.RoundTypeCategory === 'Final' || (rounds || []).length === 1;
}

// --- Winds ---

// The longest race that wind governs (World Athletics). Tuloslista publishes a
// reading for every track heat anyway (docs/tuloslista-api.md).
const WIND_MAX_LENGTH_M = 200;

// Says whether wind governs an event. It reads Category too, as a relay's
// Length is one leg and a 4x100 would pass (docs/tuloslista-api.md).
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
// merged row has left its heat. A track row's Wind equals its heat's
// (docs/tuloslista-api.md).
function resultWind(alloc, eventType) {
  const affected =
    windLegalEvent(eventType) || (eventType?.Category === 'Field' && eventType?.SubCategory === 'HorizontalJump');
  return affected ? windValue(alloc?.Wind) : null;
}

// Parses "+2,1" as 2.1, as a reading is signed with a decimal comma
// (docs/tuloslista-api.md). An unsigned calm and a typographic minus parse too.
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
// comma (docs/tuloslista-api.md). "DNS" or "NH" gives null.
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

// Sorts a class's results with ranked athletes first, then unranked ones with a
// result, such as guests, by that result and a vertical jump's countback. The
// rest go in lane or draw order.
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
    const ha = a.Result ? 0 : 1;
    const hb = b.Result ? 0 : 1;
    if (ha !== hb) return ha - hb;
    return (a.Position ?? 0) - (b.Position ?? 0);
  });
}

// Lists a round's whole field as one ranked list of copies, as ResultRank is
// round-wide (docs/tuloslista-api.md). The app's own camelCase heatIndex says
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

function allocMark(alloc, data) {
  if (!alloc?.Result) return '';
  return markFormat(data)(alloc.Result);
}

// Every number a row prints goes through markFormat. A vertical jump's numbers
// arrive in mixed units and all print in metres, as its bar headings do.
const PLAIN_MARK = (v) => v || '';
function markFormat(data) {
  return data?.EventSubCategory === 'VerticalJump' ? verticalMarkText : PLAIN_MARK;
}

// Reads a field mark into millimetres, as metres with a decimal point or whole
// centimetres without, since a Result and its best can differ in unit
// (docs/tuloslista-api.md). Millimetres compare exactly.
function fieldMark(s) {
  const t = String(s || '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * (t.includes('.') ? 1000 : 10));
}

// --- Who a row is ---

// Returns a competitor's identity in one event, which is TeamId, a relay's too,
// or a sole Athletes[].Id, and never the licence (docs/tuloslista-api.md,
// "Categories, names and identity").
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

// Returns a relay's runners in leg order, from AthleteOrders once drawn and
// Athletes[] by Index before. Only the first `legs` count and the rest are a
// pool, and Enrollments carry no AthleteOrders (docs/tuloslista-api.md).
function relayLineup(alloc, legs = 0) {
  const orders = alloc?.AthleteOrders;
  const byIndex = (a, b) => (a.Index ?? 0) - (b.Index ?? 0);
  const list = orders?.length
    ? [...orders].sort(byIndex).map((o) => o.Athlete)
    : [...(alloc?.Athletes || [])].sort(byIndex);
  const named = list.filter(Boolean);
  return legs > 0 ? named.slice(0, legs) : named;
}

// Returns a relay's runners' surnames, or [] for an individual, who also has an
// Athletes[]. AthleteOrders or a second athlete marks a relay.
function relayLegs(alloc, legs = 0) {
  return relayLegParts(alloc, legs).map((p) => p.name);
}

// Returns relayLegs' runners as { name, followed }. `followed` marks a
// namedAthleteIds person, through whom a relay matches (allocMatches).
function relayLegParts(alloc, legs = 0, named = null) {
  if (!alloc?.AthleteOrders?.length && !(alloc?.Athletes?.length > 1)) return [];
  return relayLineup(alloc, legs)
    .map((a) => ({ name: a.Surname || a.Firstname || '', followed: !!named?.has(String(a.Id)) }))
    .filter((p) => p.name);
}

// Counts a relay's legs from the event's name first, since TeamSize is wrong
// where a race is filed under the wrong EventType (docs/tuloslista-api.md).
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
// team fields. A team is its club's, not its members' (docs/tuloslista-api.md).
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

// Writes a mark in metres, whatever its unit (fieldMark). "NH" stays as is.
function verticalMarkText(mark) {
  if (!mark) return '';
  const mm = fieldMark(mark);
  return mm == null ? String(mark) : (mm / 1000).toFixed(2);
}

// --- Qualification and pending places ---

// Writes the advancement note for a round with a cut (docs/tuloslista-api.md).
// A field event's QRank is the mark and QResult the field with fill-ins, and a
// track event's are per heat and on time. A final gets null.
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
// qualifies one (docs/tuloslista-api.md). A "q" follows ResultRank across heats
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

// Returns the place as ResultRank over the round's field ("3/28"), or before a
// result the drawn heat where there are several (docs/views.md). resultPending
// mutes it, as qualPending would miss a single-heat field event.
function allocPosition(alloc, total, heatIndex, heatCount, round) {
  if (alloc?.ResultRank != null) {
    return { text: positionText(alloc.ResultRank, total), pending: resultPending(round) };
  }
  if (heatIndex != null && heatCount > 1) return { text: `Erä ${heatIndex}/${heatCount}`, pending: false };
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
// rows with a Result. An event runs at most three rounds
// (docs/tuloslista-api.md, "Schedule and rounds"), so the tail is one.
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
  attemptColumns,
  beatsMark,
  bestsParts,
  bibNumbersUsed,
  displayRank,
  earlierMarks,
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
