import { tsKey } from './dates.js';

// --- A meet's digest: who is in it ---
// Nothing upstream is keyed on a person, so a meet's roster finds who is in it.

// Returns the EventIds in running order by first start, as a qualifying round
// and its final share one EventId (docs/tuloslista-api.md).
function scheduleEventOrder(schedule) {
  const firstStart = new Map();
  for (const rounds of Object.values(schedule || {})) {
    for (const r of rounds || []) {
      const key = String(r.EventId);
      // Starts compare as instants and not as strings (tsKey).
      const ts = tsKey(r.BeginDateTimeWithTZ);
      if (!firstStart.has(key) || ts < firstStart.get(key)) firstStart.set(key, ts);
    }
  }
  return [...firstStart.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

// worker.js rebuilds a digest of another version (docs/backend.md, "KV").
// buildDigest writes the positional rows, and scanDigest and digestPeople read
// them. A relay in an athlete's events is [event name, team's org id].
const DIGEST_VERSION = 5;
const D_LICENSE = 0;
const D_ORG = 1;
const D_NAME = 2;
const D_EVENTS = 3;
const T_ORG = 0;
const T_NAME = 1;
const T_EVENTS = 2;

const digestEventName = (ev) => String(Array.isArray(ev) ? ev[0] : (ev ?? ''));
const digestEventTeamOrg = (ev) => (Array.isArray(ev) ? String(ev[1] ?? '') : '');

// Returns a scan line's event name. A trailing " viesti" goes, as "4x" says it,
// and "aitaviesti" stays. Nothing else is abbreviated.
const scanEventLabel = (name) => String(name ?? '').replace(/\s+viesti$/, '') || String(name ?? '');

// Builds a digest from buildRoster, scheduleDays, scheduleEventOrder and
// relayTeams. A row is a licence and club, as Athletes[].Id is per enrollment,
// and a team row is a club. An event with no schedule sorts last.
function buildDigest(roster, days, eventOrder = [], combinedRoots = new Map(), teams = []) {
  const rank = new Map(eventOrder.map((id, i) => [String(id), i]));
  const at = (ev) => (rank.has(String(ev.eventId)) ? rank.get(String(ev.eventId)) : Number.MAX_SAFE_INTEGER);
  const rows = new Map();
  for (const a of roster?.athletes || []) {
    const key = `${a.licenseId || `#${a.id}`}|${a.organizationId ?? ''}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        licenseId: a.licenseId || '',
        organizationId: a.organizationId ?? '',
        name: a.name || '',
        events: new Map(),
      };
      rows.set(key, row);
    }
    for (const ev of a.events || []) {
      // A person has one line per event. A multi-event's legs share the
      // root's line, which keeps the leg that runs first.
      const root = combinedRoots.get(String(ev.eventId));
      const entry = root ? { ...ev, eventName: root.name } : ev;
      const evKey = `${root ? `root:${root.id}` : ev.eventId}|${ev.organizationId ?? ''}`;
      const kept = row.events.get(evKey);
      if (!kept || at(entry) < at(kept)) row.events.set(evKey, entry);
    }
  }

  // Team rows merge by the club alone, with one entry per event.
  const teamRows = new Map();
  for (const t of teams || []) {
    const key = String(t.organizationId ?? '');
    let row = teamRows.get(key);
    if (!row) {
      row = { organizationId: t.organizationId ?? '', name: t.name || '', events: new Map() };
      teamRows.set(key, row);
    }
    if (!row.events.has(String(t.eventId))) row.events.set(String(t.eventId), t);
  }

  return {
    v: DIGEST_VERSION,
    days: [...(days || [])],
    // The club's NameShort, which the day list's athlete lines also show.
    orgs: (roster?.organizations || []).map((o) => [o.id, o.nameShort || o.name || '']),
    teams: [...teamRows.values()].map((r) => [
      r.organizationId,
      r.name,
      [...r.events.values()].sort((x, y) => at(x) - at(y)).map((t) => t.eventName),
    ]),
    athletes: [...rows.values()].map((r) => [
      r.licenseId,
      r.organizationId,
      r.name,
      [...r.events.values()]
        .sort((x, y) => at(x) - at(y))
        .map((ev) => (ev.relay ? [ev.eventName, ev.organizationId ?? ''] : ev.eventName)),
    ]),
  };
}

// Returns a digest's entrants as searchPeople takes them, and the picker offers
// them above the athlete index's rows. A row with no licence is left out, as it
// has no id an entry could store (rosterPeople).
function digestPeople(digest) {
  const people = new Map();
  for (const a of digest?.athletes || []) {
    const licenseId = String(a[D_LICENSE] ?? '');
    if (!licenseId || people.has(licenseId)) continue;
    people.set(licenseId, { licenseId, organizationId: String(a[D_ORG] ?? ''), name: a[D_NAME] || '' });
  }
  return [...people.values()];
}

// Returns a follow-list's front page lines {name, club, events, via}. A person
// followed by name sorts above a club's relay line and entrants, as the row
// shows only its first lines. A followed club's relays go on the club's line.
function scanDigest(digest, entries) {
  const licences = new Map();
  const clubs = new Map();
  for (const e of entries || []) {
    if (!e || e.enabled === false) continue;
    if (e.type === 'athlete') licences.set(String(e.id), e);
    else if (e.type === 'club') clubs.set(String(e.id), e);
  }
  if (!licences.size && !clubs.size) return [];

  const orgNames = new Map((digest?.orgs || []).map(([id, name]) => [String(id), name]));
  const byName = (x, y) => x.name.localeCompare(y.name, 'fi');

  const teamLines = [];
  for (const t of digest?.teams || []) {
    const org = String(t[T_ORG] ?? '');
    if (!org || !clubs.has(org)) continue;
    teamLines.push({
      name: t[T_NAME] || orgNames.get(org) || '',
      club: orgNames.get(org) || '',
      events: (t[T_EVENTS] || []).map(scanEventLabel),
      via: 'club',
    });
  }

  const lines = [];
  for (const a of digest?.athletes || []) {
    const licence = String(a[D_LICENSE] ?? '');
    const org = String(a[D_ORG] ?? '');
    const named = !!licence && licences.has(licence);
    const clubbed = !!org && clubs.has(org);
    const events = (a[D_EVENTS] || [])
      .filter((ev) => {
        const teamOrg = digestEventTeamOrg(ev);
        if (teamOrg) return clubs.has(teamOrg) ? false : named;
        return named || clubbed;
      })
      .map((ev) => scanEventLabel(digestEventName(ev)));
    if (!events.length) continue;
    lines.push({
      name: a[D_NAME] || '',
      club: orgNames.get(org) || '',
      events,
      via: named ? 'athlete' : 'club',
    });
  }
  return [
    ...lines.filter((l) => l.via === 'athlete').sort(byName),
    ...teamLines.sort(byName),
    ...lines.filter((l) => l.via === 'club').sort(byName),
  ];
}

export { DIGEST_VERSION, buildDigest, digestPeople, scanDigest, scanEventLabel, scheduleEventOrder };
