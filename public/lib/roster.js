import { relayInfo, relayLineup, roundAllocated } from './results.js';

// --- Roster aggregation: every event's own /results, fetched by worker.js ---

// Returns the distinct EventIds over every day. A qualifying round and its
// final share one (docs/tuloslista-api.md).
function scheduleEventIds(schedule) {
  const ids = new Set();
  for (const rounds of Object.values(schedule)) {
    for (const r of rounds) ids.add(r.EventId);
  }
  return [...ids];
}

// Lists every entered athlete and club from [{eventId, data}], as Enrollments
// is complete before the draw (docs/tuloslista-api.md). Only a relay's first
// legCount names count, and each event records the enrolling club.
function buildRoster(eventResults) {
  const athletesById = new Map();
  const organizationsById = new Map();

  for (const { eventId, data } of eventResults) {
    const eventName = data?.Name || '';
    const { relay, legCount } = relayInfo(data);
    for (const enr of data?.Enrollments || []) {
      const org = enr.Organization;
      if (org?.Id != null && !organizationsById.has(org.Id)) {
        organizationsById.set(org.Id, { id: org.Id, name: org.Name || '', nameShort: org.NameShort || '' });
      }
      for (const ath of relay ? relayLineup(enr, legCount) : enr.Athletes || []) {
        if (ath?.Id == null) continue;
        let entry = athletesById.get(ath.Id);
        if (!entry) {
          entry = {
            id: ath.Id,
            licenseId: ath.LicenseId || '',
            name: [ath.Firstname, ath.Surname].filter(Boolean).join(' '),
            organizationId: (ath.Organization || org)?.Id ?? null,
            events: [],
          };
          athletesById.set(ath.Id, entry);
        }
        entry.events.push({ eventId, eventName, organizationId: org?.Id ?? null, relay });
      }
    }
  }

  return {
    athletes: [...athletesById.values()].sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    organizations: [...organizationsById.values()].sort((a, b) => a.name.localeCompare(b.name, 'fi')),
  };
}

// Lists each relay entry under its club's name, as a team's own Name can carry
// a number (docs/tuloslista-api.md). Only buildDigest reads it, since the
// browser gets the roster whole.
function relayTeams(eventResults) {
  const teams = [];
  for (const { eventId, data } of eventResults || []) {
    if (!relayInfo(data).relay) continue;
    for (const enr of data?.Enrollments || []) {
      const org = enr.Organization;
      teams.push({
        eventId,
        eventName: data?.Name || '',
        organizationId: org?.Id ?? null,
        name: org?.Name || enr.Name || '',
      });
    }
  }
  return teams;
}

// Keeps an event's entries that are in a heat of its first round, once that
// round is drawn, as the meet page matches off the heats (matchedEntries).
// An entry left out of the draw would otherwise show on the front page alone.
function drawnEntries(eventResults) {
  return (eventResults || []).map((ev) => {
    const rounds = ev.data?.Rounds || [];
    const first = rounds.reduce((a, r) => ((a?.Index ?? 0) <= (r.Index ?? 0) ? a : r), rounds[0]);
    if (!roundAllocated(first)) return ev;
    const ids = new Set(first.Heats.flatMap((h) => (h.Allocations || []).map((a) => a.Id)));
    return { ...ev, data: { ...ev.data, Enrollments: (ev.data.Enrollments || []).filter((e) => ids.has(e.Id)) } };
  });
}

// Maps each multi-event leg's eventId to its root { id, name }. A non-zero
// RootId marks a leg, as the root's own resource carries 0
// (docs/tuloslista-api.md). A leg with no RootName is left out.
function combinedEventRoots(eventResults) {
  const roots = new Map();
  for (const { eventId, data } of eventResults || []) {
    if (!data?.IsCombinedEvent || !data.RootId || !data.RootName) continue;
    roots.set(String(eventId), { id: String(data.RootId), name: String(data.RootName) });
  }
  return roots;
}

// Lists the picker's people, one per licence and club (buildDigest's key). A
// person with no LicenseId is left out, as a Watch keys on it.
function rosterPeople(roster) {
  const people = new Map();
  for (const a of roster?.athletes || []) {
    if (!a.licenseId) continue;
    const key = `${a.licenseId}|${a.organizationId ?? ''}`;
    if (people.has(key)) continue;
    people.set(key, { licenseId: String(a.licenseId), name: a.name || '', organizationId: a.organizationId ?? null });
  }
  return [...people.values()];
}

export { buildRoster, combinedEventRoots, drawnEntries, relayTeams, rosterPeople, scheduleEventIds };
