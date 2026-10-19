import { heatsInOrder, relayLineup, roundAllocated, roundFieldSize } from './results.js';
import { groupRounds } from './schedule.js';

// --- Watches ---
// A Watch is a shareable follow-list of entries {type, id, name, enabled}. The
// id is a LicenseId or an Organization.Id (docs/backend.md).

const WATCH_ENTRY_TYPES = new Set(['athlete', 'club']);
// These bound a KV write and are not measured limits.
const WATCH_MAX_ENTRIES = 100;
const WATCH_MAX_LABEL_LEN = 80;
const WATCH_MAX_NAME_LEN = 120;
// Caps a write's body well above the largest body the limits above allow.
const WATCH_MAX_BODY_BYTES = 64 * 1024;

function normalizeWatchLabel(label) {
  return String(label ?? '')
    .trim()
    .slice(0, WATCH_MAX_LABEL_LEN);
}

// Validates and trims a request's entries, or returns null for a 400
// (worker.js). A duplicate type and id collapses, as an edit resends them all.
function normalizeWatchEntries(rawEntries) {
  if (!Array.isArray(rawEntries) || rawEntries.length > WATCH_MAX_ENTRIES) return null;
  const entries = [];
  const seen = new Set();
  for (const e of rawEntries) {
    if (!e || typeof e !== 'object' || !WATCH_ENTRY_TYPES.has(e.type)) return null;
    const id = String(e.id ?? '').trim();
    if (!id) return null;
    const key = `${e.type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      type: e.type,
      id,
      name: String(e.name ?? '')
        .trim()
        .slice(0, WATCH_MAX_NAME_LEN),
      enabled: e.enabled !== false,
    });
  }
  return entries;
}

// POST /api/watch and PUT /api/watch/:id share { label, entries }. It returns
// null on an unusable shape.
function normalizeWatchInput(body) {
  if (!body || typeof body !== 'object') return null;
  const entries = normalizeWatchEntries(body.entries);
  if (entries == null) return null;
  return { label: normalizeWatchLabel(body.label), entries };
}

// Returns the Watch entry for one roster athlete in normalizeWatchEntries'
// shape, or null without a LicenseId, as in rosterPeople.
function watchEntryForAthlete(roster, athleteId) {
  const found = (roster?.athletes || []).find((a) => String(a.id) === String(athleteId));
  if (!found?.licenseId) return null;
  return { type: 'athlete', id: String(found.licenseId), name: found.name || '', enabled: true };
}

// Adds one entry and says whether anything changed, so the menu's tick and the
// write agree. A disabled entry is switched back on.
function watchEntriesWith(entries, entry) {
  const list = Array.isArray(entries) ? entries : [];
  const at = list.findIndex((e) => e.type === entry.type && String(e.id) === String(entry.id));
  if (at < 0) return { entries: [...list, entry], changed: true };
  if (list[at].enabled !== false) return { entries: list, changed: false };
  return { entries: list.map((e, i) => (i === at ? { ...e, enabled: true } : e)), changed: true };
}

// Returns what the edit sheet holds after a 409. An entry is added only where
// neither `base` nor the sheet has it, so a removal stays. A label the reader
// changed stays.
function watchConflictMerge(base, fresh, label, entries) {
  const has = (list, e) => (list || []).some((x) => x.type === e.type && x.id === e.id);
  const added = (fresh?.entries || []).filter((e) => !has(base?.entries, e) && !has(entries, e));
  return { label: label === base?.label ? fresh?.label : label, entries: [...entries, ...added], added };
}

// --- What a filter matches ---

// Returns the roster athlete ids one entry covers. A club expands to every
// athlete the roster holds for it. The roster is only as complete as the
// events' Enrollments (docs/tuloslista-api.md, "Nothing is keyed on a person").
function watchEntryAthleteIds(entry, roster) {
  const key = entry.type === 'athlete' ? 'licenseId' : 'organizationId';
  const ids = new Set();
  for (const a of roster?.athletes || []) {
    if (a[key] && String(a[key]) === String(entry.id)) ids.add(String(a.id));
  }
  return ids;
}

// Returns what a filter matches. An individual row matches on athleteIds, every
// athlete an entry covers. A relay matches on namedAthleteIds, the athletes
// followed by name, or on clubIds, as a followed club reaches a relay only
// through the team's club (docs/tuloslista-api.md). licences need no roster.
function watchTargets(entries, roster) {
  const athleteIds = new Set();
  const namedAthleteIds = new Set();
  const clubIds = new Set();
  const licences = new Set();
  for (const e of entries || []) {
    if (!e || e.enabled === false) continue;
    if (e.type === 'club') clubIds.add(String(e.id));
    if (e.type === 'athlete') licences.add(String(e.id));
    for (const id of watchEntryAthleteIds(e, roster)) {
      athleteIds.add(id);
      if (e.type === 'athlete') namedAthleteIds.add(id);
    }
  }
  return { athleteIds, namedAthleteIds, clubIds, licences };
}

// Returns every EventId a filter touches, per the roster. A relay counts
// through the team's club or a person followed by name in its lineup.
function filterEventIds(targets, roster) {
  const ids = new Set();
  for (const a of roster?.athletes || []) {
    const id = String(a.id);
    const covered = targets?.athleteIds?.has(id);
    const named = targets?.namedAthleteIds?.has(id);
    for (const ev of a.events || []) {
      if (ev.relay ? named || targets?.clubIds?.has(String(ev.organizationId)) : covered) ids.add(ev.eventId);
    }
  }
  return ids;
}

// Trims a day's groupRounds to the entries a filter touches, and drops a group
// left empty.
function watchGroups(rounds, eventIds) {
  return groupRounds(rounds)
    .map((g) => ({ ...g, entries: g.entries.filter((e) => eventIds.has(e.round.EventId)) }))
    .filter((g) => g.entries.length > 0);
}

// Says whether an allocation or enrollment belongs to a filter (watchTargets).
// An individual matches on the person, and a relay on its club or a person
// followed by name in relayLineup's legs. `team` is relayInfo's.
function allocMatches(alloc, targets, team) {
  if (!targets) return false;
  if (team?.relay) {
    const legCount = team.legCount || 0;
    if (targets.clubIds?.size && targets.clubIds.has(String(alloc?.Organization?.Id))) return true;
    if (!targets.namedAthleteIds?.size) return false;
    return relayLineup(alloc, legCount).some((a) => targets.namedAthleteIds.has(String(a?.Id)));
  }
  if (!targets.athleteIds?.size) return false;
  return (
    (alloc?.Athletes || []).some((x) => targets.athleteIds.has(String(x.Id))) ||
    (alloc?.AthleteOrders || []).some((o) => targets.athleteIds.has(String(o.Athlete?.Id)))
  );
}

// Returns a filter's allocations in one loaded round with each one's heat, or
// [] where none match.
function findAthleteAllocations(round, targets, team) {
  const found = [];
  // They go in heat order (heatsInOrder), as they become the day list's lines.
  for (const h of heatsInOrder(round)) {
    for (const a of h.Allocations || []) {
      if (allocMatches(a, targets, team)) found.push({ heatIndex: h.Index, alloc: a });
    }
  }
  return found;
}

// Returns every match in one class's round: from its heats once drawn
// (roundAllocated), and before that from `enrollments`, with no field size or
// heat. `stripResults` clears the results of an earlier round's rows that stand
// in for an undrawn round's field.
function matchedEntries(round, enrollments, targets, team, stripResults = false) {
  if (roundAllocated(round)) {
    const total = roundFieldSize(round);
    const heatCount = round.Heats.length;
    return findAthleteAllocations(round, targets, team).map(({ alloc, heatIndex }) => ({
      alloc,
      total,
      heatIndex,
      heatCount,
    }));
  }
  return (enrollments || [])
    .filter((a) => allocMatches(a, targets, team))
    .map((alloc) => ({
      alloc: stripResults
        ? { ...alloc, Result: null, ResultRank: null, HeatRank: null, Wind: null, QRank: false, QResult: false }
        : alloc,
      total: null,
      heatIndex: null,
      heatCount: null,
    }));
}

// Returns the quick-filter in watchTargets' shape. A club goes through it as a
// list of one. An athlete's roster id counts as named, so their relay matches.
function focusTargets(focus, roster) {
  if (focus?.kind === 'club') {
    return watchTargets([{ type: 'club', id: focus.id, name: focus.name, enabled: true }], roster);
  }
  const id = String(focus?.id ?? '');
  return { athleteIds: new Set([id]), namedAthleteIds: new Set([id]), clubIds: new Set() };
}

// --- This device's Watches ---
// These functions take plain arrays, and app/data.js owns the localStorage I/O. A
// Watch's editToken stays in its own key, so a forgotten list stays editable.

// The registry is one list of every Watch this device knows, {watchId, label}
// each and the last used first. The cap is a bound, not a measured limit.
const WATCH_REGISTRY_MAX = 30;

function watchRegistryAdd(list, { watchId, label }) {
  const rest = (Array.isArray(list) ? list : []).filter((w) => w && w.watchId !== watchId);
  return [{ watchId, label }, ...rest].slice(0, WATCH_REGISTRY_MAX);
}

function watchRegistryRemove(list, watchId) {
  return (Array.isArray(list) ? list : []).filter((w) => w && w.watchId !== watchId);
}

// Names a copy "Kisat (kopio)", then "Kisat (kopio 2)", unless `taken` has it.
// The base is cut so the suffix survives normalizeWatchLabel's cap.
function copyWatchLabel(label, taken) {
  const base = String(label ?? '').trim() || 'Seuranta';
  // The loop ends within `taken`'s size, as each n makes a different name.
  const names = new Set((Array.isArray(taken) ? taken : []).map((t) => String(t ?? '').trim()));
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? ' (kopio)' : ` (kopio ${n})`;
    const name = base.slice(0, WATCH_MAX_LABEL_LEN - suffix.length) + suffix;
    if (!names.has(name)) return name;
  }
}

export {
  WATCH_MAX_BODY_BYTES,
  WATCH_REGISTRY_MAX,
  allocMatches,
  copyWatchLabel,
  filterEventIds,
  findAthleteAllocations,
  focusTargets,
  matchedEntries,
  normalizeWatchEntries,
  normalizeWatchInput,
  watchConflictMerge,
  watchEntriesWith,
  watchEntryAthleteIds,
  watchEntryForAthlete,
  watchGroups,
  watchRegistryAdd,
  watchRegistryRemove,
  watchTargets,
};
