import { dateSortKey, tsKey } from './dates.js';
import { totalResults } from './results.js';
import {
  STATUS_ORDER,
  combinedEventStatus,
  compareCategories,
  leastStatus,
  parseEventName,
  roundGroupKey,
} from './schedule.js';

// --- Combined events (moniottelu) ---

// Reads an EventName as a multi-event's leg { label, kind, discipline }, or
// null where it is no leg. parseEventName has collapsed the double space.
const MULTI_EVENT_RE = /^(\d+-ottelu)\s+(.+)$/;

function multiEventLeg(eventName) {
  const p = parseEventName(eventName);
  const m = MULTI_EVENT_RE.exec(p.event);
  if (!m) return null;
  return { label: [p.label, m[1]].filter(Boolean).join(' '), kind: m[1], discipline: m[2] };
}

// Says whether a multi-event has started (combinedEventStatus). A drawn leg has
// not started. Until the first leg runs, the root holds only its entry list,
// which the confirmations are counted on.
function combinedStarted(status) {
  return (STATUS_ORDER[status] ?? 0) >= STATUS_ORDER.Progress;
}

// Returns each multi-event over all days, as one can span two. Its legs keep
// schedule order, not contest order (combinedLegColumns). Its status comes from
// the legs, as the root stays Unallocated (docs/tuloslista-api.md).
function combinedEventStarts(schedule) {
  const map = new Map();
  for (const [date, rounds] of Object.entries(schedule || {})) {
    if (!Array.isArray(rounds)) continue;
    for (const r of rounds) {
      const leg = multiEventLeg(r.EventName);
      if (!leg) continue;
      if (!map.has(leg.label)) map.set(leg.label, { key: leg.label, label: leg.label, legs: [], dates: [] });
      const start = map.get(leg.label);
      start.legs.push({
        eventId: r.EventId,
        roundId: r.Id,
        discipline: leg.discipline,
        date,
        ts: r.BeginDateTimeWithTZ,
        round: r,
      });
      if (!start.dates.includes(date)) start.dates.push(date);
    }
  }
  const starts = [...map.values()];
  for (const s of starts) {
    s.dates.sort((a, b) => dateSortKey(a) - dateSortKey(b));
    s.legs.sort((a, b) => dateSortKey(a.date) - dateSortKey(b.date) || tsKey(a.ts) - tsKey(b.ts));
    s.status = combinedEventStatus(s.legs.map((l) => l.round.Status));
  }
  // Multi-events sort by class, as a start's classes do.
  starts.sort((a, b) => compareCategories(a.label, b.label));
  return starts;
}

// Returns what a championship's cover reads of a multi-event (coversStart):
// the ottelu's name and its first leg's Age. The root's own event carries
// neither.
function combinedRootStart(start) {
  return { EventName: start.label, Age: start.legs[0]?.round?.Age };
}

// Counts a multi-event from the root's entry list (docs/tuloslista-api.md). Its
// one heat is a container, so there are no erät. A root that failed to load
// gives null, as a failed fetch never says nobody entered.
function combinedCounts(root) {
  if (!root) return null;
  const list = root.Enrollments || [];
  return {
    label: null,
    relay: false,
    entered: true,
    heats: null,
    confirmed: list.filter((e) => e?.Confirmed).length,
    field: list.length,
  };
}

// Returns the key joining a multi-event's root and legs, Athletes[0].Id, the
// same in each (docs/tuloslista-api.md). The licence is the id across meets.
function combinedAthleteKey(alloc) {
  const id = alloc?.Athletes?.[0]?.Id;
  return id == null ? '' : String(id);
}

// Returns one row per athlete from the root's round, with Result the total and
// ResultRank the standing. It drops heatIndex, or the name cell prints "Erä 0".
// Before the meet the unranked Enrollments stand in (docs/tuloslista-api.md).
function combinedTotals(root) {
  const rows = totalResults((root?.Rounds || [])[0]).map(({ heatIndex, ...alloc }) => alloc);
  return rows.length ? rows : [...(root?.Enrollments || [])];
}

// Returns who is out of the multi-event, by combinedAthleteKey. A total that is
// not a number marks one, DNS and DNF alike (docs/tuloslista-api.md). The entry
// list that combinedTotals returns before the meet yields nobody.
function combinedWithdrawn(rows) {
  const out = new Set();
  for (const a of rows || []) {
    if (a?.Result && !Number.isFinite(Number(a.Result))) out.add(combinedAthleteKey(a));
  }
  return out;
}

// Returns the total of the row placed first, as a guest has no ResultRank and
// can out-score the winner (docs/tuloslista-api.md). In a Mitalit table the
// leader is the row its scope ranks first (scopeResults), and the table of the
// rest has no leader.
function combinedLeaderPoints(rows) {
  const leader = (rows || []).find((a) => ('scopeRank' in a ? a.scopeRank : a.ResultRank) === 1);
  const points = Number(leader?.Result);
  return leader?.Result && Number.isFinite(points) ? points : null;
}

// Returns a row's points from the leader, negative behind and positive for a
// guest above. It is null where nothing can be measured or the row is level.
function combinedGap(alloc, leaderPoints) {
  if (leaderPoints == null || !alloc?.Result) return null;
  const points = Number(alloc.Result);
  if (!Number.isFinite(points)) return null;
  return points === leaderPoints ? null : points - leaderPoints;
}

// Returns a column per leg in contest order, which only SubEvents[].Index gives
// (docs/tuloslista-api.md). Each holds a whole leg result, so the standings
// cost two event documents, a leg's and the root's (loadCombinedRoot). `legs` (combinedEventStarts) gives the schedule's status.
function combinedLegColumns(root, legs = []) {
  const scheduled = new Map(legs.map((l) => [String(l.eventId), l]));
  return [...(root?.SubEvents || [])]
    .sort((a, b) => (a.Index ?? 0) - (b.Index ?? 0))
    .map((sub) => {
      const rounds = sub.Rounds || [];
      const leg = scheduled.get(String(sub.Id));
      return {
        id: sub.Id,
        // The label is the discipline alone, as the page names the multi-event.
        label: leg?.discipline || multiEventLeg(sub.Name)?.discipline || sub.Name || '',
        key: leg ? roundGroupKey(leg.round) : null,
        status: leg?.round?.Status || leastStatus(rounds.map((r) => r.Status)),
        results: new Map(rounds.flatMap((r) => totalResults(r)).map((a) => [combinedAthleteKey(a), a])),
      };
    });
}

export {
  combinedAthleteKey,
  combinedCounts,
  combinedEventStarts,
  combinedGap,
  combinedLeaderPoints,
  combinedLegColumns,
  combinedRootStart,
  combinedStarted,
  combinedTotals,
  combinedWithdrawn,
  multiEventLeg,
};
