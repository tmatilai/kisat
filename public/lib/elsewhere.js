import { fiToIsoDay, isoToFiDay, parseTs, scheduleDays, shiftIsoDay, tsKey } from './dates.js';
import { NATIONAL_SCOPE_ID, NO_SM_RE, SAUL_RE, SM_WORD_RE, clubNameKey, meetScopes } from './districts.js';
import { athleteIndexOf, isFollowableOrgId } from './indexes.js';
import { isFinalRound, isRelayEventType, resultOrderKey } from './results.js';
import { STATUS_ORDER, parseEventName } from './schedule.js';

// --- Results published elsewhere (docs/elsewhere.md) ---
// An adults' SM meet has only entries in Tuloslista and its results on
// another site. These functions attach those results to the entries, so
// the club ids, licences and event ids stay Tuloslista's.

// These keys compare names between the two sites without case, spaces or
// punctuation. The event key reads "aj" as "aidat", "ej" as "esteet" and a
// class's leading P and T as M and N, and it drops a closing "viesti".
const looseKey = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const eventNameKey = (name) =>
  looseKey(name)
    .replace(/^p(?=\d)/u, 'm')
    .replace(/^t(?=\d)/u, 'n')
    .replace(/aj$/u, 'aidat')
    .replace(/ej$/u, 'esteet')
    .replace(/viesti$/u, '');
// A person's key drops an accent, but not å, ä or ö (docs/elsewhere.md).
const personNameKey = (s) =>
  looseKey(
    String(s ?? '')
      .normalize('NFD')
      .replace(/([ao]\u0308|a\u030a)|\p{M}/giu, (m, kept) => kept || ''),
  );
const T4R_FINAL_RE = /^(?:loppukilpailu)?$/iu;
// A wheelchair race is in the meet but is not a championship event
// (docs/elsewhere.md), so it gets no results and no medals.
const T4R_NOT_SM_RE = /kelaus/iu;

// Maps a name and club to a licence from the athlete index, as no result page
// gives one and a followed person is a licence (watchTargets). A name two of a
// club's licences share maps to nothing (docs/elsewhere.md, "The licence a
// made person gets").
function athleteLicences(index) {
  const found = new Map();
  for (const [licence, org, name] of athleteIndexOf(index).athletes || []) {
    const key = `${personNameKey(name)}|${org}`;
    const at = found.get(key);
    found.set(key, at === undefined || at === licence ? licence : null);
  }
  return found;
}
const madeLicence = (licences, name, org) =>
  org?.Id == null ? null : licences?.get(`${personNameKey(name)}|${org.Id}`) || null;
// Splits a made name into an entry's two name fields, the first word the given
// name. buildRoster reads them, also from a meet with no entries (aloneEntries).
const madeName = (name) => ({
  Firstname: String(name).split(' ')[0],
  Surname: String(name).split(' ').slice(1).join(' '),
});

// Makes an entry under `org`, the row's club, for a page row nobody entered
// (docs/elsewhere.md, "Matching a row to an entry"). The id keys the club and
// the compared name, so two spellings are one person. A relay's row is a team,
// so it is nobody's medal.
function t4rMadeEntry(row, org, relay, licences) {
  if (!org) return null;
  const made = (name) => `t4r-${org.Id}-${personNameKey(name)}`;
  const name = String(row.name).trim();
  if (!relay)
    return {
      Id: made(name),
      Name: name,
      Organization: org,
      Athletes: [{ Id: made(name), LicenseId: madeLicence(licences, name, org), ...madeName(name) }],
    };
  const legs = (row.runners || []).map((runner, i) => ({
    Index: i + 1,
    Athlete: {
      Id: made(runner),
      LicenseId: madeLicence(licences, runner, org),
      ...madeName(runner),
      Organization: org,
    },
  }));
  return { Id: made(name), Name: name, TeamName: name, Athletes: [], AthleteOrders: legs, Organization: org };
}

// Turns a page's attempts into the API's shape (docs/elsewhere.md). A throw
// or a horizontal jump has a column an attempt, with a jump's wind on line two.
// A vertical jump's cell has a line per header bar, and a pass is left out.
function t4rAttempts(cells, heads, subCategory) {
  if (subCategory !== 'VerticalJump') {
    return cells.flatMap((lines) =>
      lines[0] ? [{ Line1: t4rMark(lines[0]), Line2: subCategory === 'HorizontalJump' ? lines[1] || null : null }] : [],
    );
  }
  const attempts = [];
  for (let line = 0; line < Math.max(0, ...heads.map((h) => h.length)); line += 1) {
    for (const [i, head] of heads.entries()) {
      const mark = cells[i]?.[line];
      if (head[line] && mark && mark !== '-') attempts.push({ Line1: head[line], Line2: t4rMark(mark) });
    }
  }
  return attempts;
}

// Reads one result page as the round's heats. A row finds its entry by name, or
// by its club and first name where a surname changed (docs/elsewhere.md). A
// page numbers places within a heat, so a round of several is ranked by result.
function t4rHeats(page, data, clubOf, licences) {
  const entries = new Map((data.Enrollments || []).map((e) => [personNameKey(e.Name), e]));
  const field = data.EventType?.Category === 'Field';
  const heats = page.heats || [];
  const rows = heats.flatMap((heat) =>
    (heat.rows || []).map((row) => ({
      ...row,
      heads: heat.heads || [],
      wind: row.wind || heat.wind,
      result: field ? String(row.result ?? '').replace(',', '.') : row.result,
    })),
  );
  const keys = rows.map((row) => resultOrderKey(row.result));
  const onPage = new Set(rows.map((row) => personNameKey(row.name)));
  const first = (name) =>
    personNameKey(
      String(name ?? '')
        .trim()
        .split(/\s+/)[0],
    );
  const renamed = (row) => {
    const found = [...entries].filter(
      ([key, e]) =>
        !onPage.has(key) &&
        e.Athletes?.length === 1 &&
        first(e.Name) === first(row.name) &&
        clubNameKey(e.Organization?.Name) === clubNameKey(row.club),
    );
    return found.length === 1 ? found[0][1] : null;
  };
  const made = rows.map((row, i) => {
    const entry =
      entries.get(personNameKey(row.name)) ||
      renamed(row) ||
      t4rMadeEntry(row, clubOf(row), isRelayEventType(data.EventType), licences);
    if (!entry) return null;
    const place =
      heats.length > 1 ? keys[i] != null && 1 + keys.filter((k) => k != null && k < keys[i]).length : Number(row.place);
    return {
      ...entry,
      Result: row.result || null,
      ResultRank: place || null,
      HeatRank: Number(row.place) || null,
      Wind: row.wind || null,
      QRank: row.qual === 'Q',
      QResult: row.qual === 'q',
      ...(row.points == null ? {} : { CEPoints: row.points }),
      ...(field ? { Attempts: t4rAttempts(row.attempts || [], row.heads || [], data.EventType?.SubCategory) } : {}),
    };
  });
  let at = 0;
  return heats.flatMap((heat, i) => {
    const allocations = made.slice(at, at + (heat.rows || []).length).filter(Boolean);
    at += (heat.rows || []).length;
    return allocations.length ? [{ Index: i + 1, Wind: heat.wind ?? null, Allocations: allocations }] : [];
  });
}

// Maps each page directory to the day it stands for. A directory names its
// weekday in two letters, and the front page is the last day none names
// (docs/elsewhere.md). A page of any other day gets no start of its own.
const T4R_WEEKDAYS = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
function t4rDays(schedule, pages) {
  const dirs = new Set((pages || []).map((p) => p.dir).filter(Boolean));
  const days = new Map();
  const rest = [];
  for (const day of scheduleDays(schedule)) {
    const dir = `${T4R_WEEKDAYS[new Date(`${fiToIsoDay(day)}T12:00:00Z`).getUTCDay()]}/`;
    if (dirs.has(dir)) days.set(dir, day);
    else rest.push(day);
  }
  return days.set('', rest[rest.length - 1] ?? '');
}

// Reads a page's start with its clock taken as UTC. A made round is the meet's
// own row moved by the time between two such starts, so it needs no offset.
const t4rClock = (page) => Date.parse(`${fiToIsoDay(page?.day)}T${String(page?.time ?? '').padStart(5, '0')}:00Z`);
const t4rStamp = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, '+00:00');

// Orders an event's pages as its rounds. Of the final's pages only the last
// counts, as a multi-event's standings are written again as the meet runs.
// Where the clock cannot place a page, the event keeps its final alone.
function t4rRoundPages(pages) {
  const finals = (pages || []).filter((p) => T4R_FINAL_RE.test(String(p?.round ?? '').trim()));
  const final = finals[finals.length - 1];
  if (!final) return [];
  const rounds = pages.filter((p) => p === final || !finals.includes(p));
  if (rounds.length < 2 || !rounds.every((p) => Number.isFinite(t4rClock(p)))) return [final];
  return [...rounds].sort((a, b) => t4rClock(a) - t4rClock(b));
}

// Makes one event's rounds, one a page, and the schedule rows the made ones
// need. A page names its round, as the meet's one round has the first
// session's clock whatever its name says (docs/tuloslista-api.md, "An adults'
// SM whose results are on another site"). That round takes the first page.
function t4rEventGraft(data, round, row, pages, clubOf, licences) {
  const filled = pages
    .map((page) => ({ page, heats: t4rHeats(page, data, clubOf, licences) }))
    .filter((r) => r.heats.length);
  const base = parseTs(round.BeginDateTimeWithTZ).getTime();
  const own = row && Number.isFinite(base) ? filled : filled.slice(-1);
  if (!own.length) return null;
  const rounds = own.map(({ page, heats }, i) => {
    const named = {
      Name: page.round || round.Name,
      RoundTypeCategory: T4R_FINAL_RE.test(page.round) ? 'Final' : 'Qualify',
      ...t4rRoundQualRule(page.qualRule, data.EventType?.SubCategory),
    };
    if (!i) return { ...round, ...named, Index: 0, Status: 'Official', Heats: heats };
    return {
      QRank: '',
      QResult: '',
      ...named,
      Id: `${round.Id}-t4r-${i}`,
      EventId: round.EventId,
      Index: i,
      BeginDateTimeWithTZ: t4rStamp(base + t4rClock(page) - t4rClock(own[0].page)),
      Status: 'Official',
      Heats: heats,
    };
  });
  const rows = own.flatMap(({ page }, i) =>
    i
      ? [
          {
            day: page.day,
            row: {
              ...row,
              Id: rounds[i].Id,
              Name: rounds[i].Name,
              Status: 'Official',
              BeginDateTimeWithTZ: rounds[i].BeginDateTimeWithTZ,
            },
          },
        ]
      : [],
  );
  return { rounds, rows };
}

// Returns {schedule, events} with each event's rounds filled from its pages on
// the other site (docs/elsewhere.md). A filled round is marked Official twice,
// as a medal reads the event's copy and a multi-event's status the schedule's.
function t4rGraft(schedule, eventResults, pages, licences) {
  const days = t4rDays(schedule, pages);
  const byEvent = new Map();
  for (const p of pages || []) {
    const key = eventNameKey(p?.event);
    byEvent.set(key, [...(byEvent.get(key) || []), { ...p, day: days.get(p.dir) ?? '' }]);
  }
  const entered = (eventResults || [])
    .flatMap(({ data }) => data?.Enrollments || [])
    .filter((e) => isFollowableOrgId(e.Organization?.Id));
  const clubs = new Map(
    entered
      .filter((e) => clubNameKey(e.Organization.Name))
      .map((e) => [clubNameKey(e.Organization.Name), e.Organization]),
  );
  const people = new Map(entered.map((e) => [personNameKey(e.Name), e.Organization]));
  const clubOf = (row) =>
    clubs.get(clubNameKey(row.club)) ||
    [row.name, ...(row.runners || [])].map((n) => people.get(personNameKey(n))).find(Boolean) ||
    null;
  const rowById = new Map(
    Object.values(schedule || {})
      .flat()
      .map((r) => [r.Id, r]),
  );
  const done = new Map();
  const added = new Map();
  const events = (eventResults || []).map(({ eventId, data }) => {
    const rounds = data?.Rounds || [];
    const round = rounds.find((r) => isFinalRound(rounds, r));
    const own = round && !T4R_NOT_SM_RE.test(data.Name) ? t4rRoundPages(byEvent.get(eventNameKey(data.Name))) : [];
    const graft = own.length ? t4rEventGraft(data, round, rowById.get(round.Id), own, clubOf, licences) : null;
    if (!graft) return { eventId, data };
    done.set(round.Id, graft.rounds[0].Name);
    for (const made of graft.rows) added.set(made.day, [...(added.get(made.day) || []), made.row]);
    return { eventId, data: { ...data, Rounds: rounds.flatMap((r) => (r === round ? graft.rounds : [r])) } };
  });
  const grafted = Object.fromEntries(
    Object.entries(schedule || {}).map(([day, rows]) => {
      const kept = (rows || []).map((r) => (done.has(r.Id) ? { ...r, Name: done.get(r.Id), Status: 'Official' } : r));
      const more = added.get(day) || [];
      return [
        day,
        more.length
          ? [...kept, ...more].sort((a, b) => tsKey(a.BeginDateTimeWithTZ) - tsKey(b.BeginDateTimeWithTZ))
          : kept,
      ];
    }),
  );
  const legs = new Map(events.filter(({ data }) => data?.RootId).map(({ data }) => [String(data.Id), data]));
  return {
    schedule: grafted,
    events: events.map(({ eventId, data }) =>
      data?.SubEvents?.length
        ? { eventId, data: { ...data, SubEvents: data.SubEvents.map((sub) => legs.get(String(sub.Id)) || sub) } }
        : { eventId, data },
    ),
  };
}

// Maps each page directory of a championship with no meet here to its day. A
// weekday's directory stands for its day in the week up to `lastDay`, and the
// front page or any other directory for `lastDay` (docs/elsewhere.md).
function t4rAloneDays(lastDay, pages) {
  const last = Date.parse(`${lastDay}T12:00:00Z`);
  const days = new Map([['', isoToFiDay(lastDay)]]);
  for (const dir of new Set((pages || []).map((p) => p.dir).filter(Boolean))) {
    const weekday = T4R_WEEKDAYS.indexOf(dir.slice(0, 2));
    if (weekday < 0) continue;
    const back = (7 + new Date(last).getUTCDay() - weekday) % 7;
    days.set(dir, isoToFiDay(new Date(last - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)));
  }
  return days;
}

// Such a meet has no event document to say it is a relay, so the name's leg
// count does (docs/elsewhere.md).
const T4R_ALONE_RELAY_RE = /(\d)\s*x\s*\d/iu;

// Returns {schedule, events} for meetMedalsBody from a row that stands alone
// with a `t4r`. Each start is an index row, each result row is made, and the
// row's `start` offsets the clock. `orgs` is the club index (elsewhereClubOf).
function t4rAloneMeet(row, pages, orgs, file, districts, licences) {
  const days = t4rAloneDays(elsewhereLastDay(row), pages);
  const club = elsewhereClubOf(orgs, file, districts);
  const clubOf = (r) => club(r.club);
  const offset = /([+-]\d\d:\d\d)$/.exec(row?.start ?? '')?.[1] ?? '+00:00';
  const byEvent = new Map();
  for (const p of pages || []) {
    const key = eventNameKey(p?.event);
    byEvent.set(key, [...(byEvent.get(key) || []), { ...p, day: days.get(p.dir) ?? days.get('') }]);
  }
  const schedule = {};
  const events = [...byEvent].flatMap(([key, own]) => {
    const ordered = t4rRoundPages(own);
    const name = ordered[0]?.event ?? '';
    const eventId = `t4r-${key}`;
    const legs = Number(T4R_ALONE_RELAY_RE.exec(name)?.[1]);
    const type = legs ? { Category: 'Relay', TeamSize: legs } : { Category: 'Track', TeamSize: 1 };
    const data = {
      Id: eventId,
      Name: name,
      EventCategory: type.Category,
      EventType: type,
      Enrollments: [],
      Rounds: [],
    };
    const rounds = ordered
      .map((page, i) => {
        const ts = `${fiToIsoDay(page.day)}T${String(page.time ?? '').padStart(5, '0')}:00${offset}`;
        return {
          day: page.day,
          round: {
            Id: `${eventId}-${i}`,
            EventId: eventId,
            Index: i,
            Name: page.round || 'Loppukilpailu',
            Status: 'Official',
            RoundTypeCategory: T4R_FINAL_RE.test(page.round) ? 'Final' : 'Qualify',
            QRank: '',
            QResult: '',
            ...page.qualRule,
            BeginDateTimeWithTZ: ts,
            Heats: t4rHeats(page, data, clubOf, licences),
          },
        };
      })
      .filter((r) => r.round.Heats.length);
    if (!rounds.length) return [];
    for (const { day, round } of rounds) {
      schedule[day] = [
        ...(schedule[day] || []),
        {
          Id: round.Id,
          EventId: eventId,
          EventName: name,
          Name: round.Name,
          Status: 'Official',
          RoundTypeCategory: round.RoundTypeCategory,
          BeginDateTimeWithTZ: round.BeginDateTimeWithTZ,
          Category: type.Category,
          Age: /\d+/.exec(parseEventName(name).sex)?.[0] ?? '0',
        },
      ];
    }
    return [{ eventId, data: { ...data, Rounds: rounds.map((r) => r.round) } }];
  });
  return {
    schedule: Object.fromEntries(
      Object.entries(schedule).map(([day, rows]) => [
        day,
        rows.sort((a, b) => tsKey(a.BeginDateTimeWithTZ) - tsKey(b.BeginDateTimeWithTZ)),
      ]),
    ),
    events,
  };
}

// Writes a page's mark as the API does (docs/tuloslista-api.md, "Field
// events"), with a dot for the page's comma (docs/elsewhere.md) and lower case
// for a foul and a jump's pattern.
const t4rMark = (mark) =>
  String(mark ?? '')
    .replace(',', '.')
    .toLowerCase();

// Picks the index rows whose pages t4rGraft uses. For each event of
// `eventResults` it is the last final row and every earlier round's row, and
// with `eventResults` null, as for a meet not here, it is every event's.
function t4rWanted(rows, eventResults) {
  const own =
    eventResults &&
    new Set(
      eventResults
        .filter(({ data }) => data && !T4R_NOT_SM_RE.test(data.Name))
        .map(({ data }) => eventNameKey(data.Name)),
    );
  const wanted = (key) => !own || own.has(key);
  const last = new Map();
  for (const row of rows || [])
    if (T4R_FINAL_RE.test(row.round) && wanted(eventNameKey(row.event))) last.set(eventNameKey(row.event), row);
  return (rows || []).filter(
    (row) =>
      last.get(eventNameKey(row.event)) === row || (last.has(eventNameKey(row.event)) && !T4R_FINAL_RE.test(row.round)),
  );
}

// Converts a start list's rule (t4rQualRule) to the round's. The site writes a
// bar in centimetres (docs/elsewhere.md), and the event's kind says which mark
// is a bar. Deciding by the number alone would shrink a throw's mark of metres.
const t4rRoundQualRule = (qualRule, subCategory) =>
  subCategory === 'VerticalJump' && /^\d+$/.test(qualRule?.QRank ?? '')
    ? { ...qualRule, QRank: (Number(qualRule.QRank) / 100).toFixed(2) }
    : qualRule;

// --- A road championship in a mass race's files (docs/elsewhere.md, "A championship in a race's files") ---

// The event file names the fields of the other files' arrays.
const olRows = (format, rows) => (rows || []).map((r) => Object.fromEntries((format || []).map((k, i) => [k, r[i]])));
const OL_FINISH_POINT = 0;
const olFinish = (row) => (row.Results || []).find((p) => p[0] === OL_FINISH_POINT)?.[1] ?? null;
const OL_PAGE_BASE = 'https://online.tulospalvelu.fi/tulokset-new/fi';

// Formats a finish in tenths as this app writes a long run. Over the hour it
// reads "2.30.14" with the tenths cut, and under it "48.05,7".
function olTime(tenths) {
  const s = Math.floor(tenths / 10);
  const two = (n) => String(n).padStart(2, '0');
  if (s >= 3600) return `${Math.floor(s / 3600)}.${two(Math.floor(s / 60) % 60)}.${two(s % 60)}`;
  return `${Math.floor(s / 60)}.${two(s % 60)},${tenths % 10}`;
}

// Returns a club as an Organization, found by the abbreviation `short` and
// then by name. A club the index lacks gets an id made of the name.
function elsewhereClub(name, short, index) {
  const key = clubNameKey(name);
  const org = (short && index.byShort.get(short)) || index.byName.get(key);
  if (org) return { Id: org.id, Name: org.name, NameShort: org.nameShort || short || null };
  return key ? { Id: `ol-${key}`, Name: String(name).trim(), NameShort: short || null } : null;
}

// Indexes the clubs by name and by abbreviation. Of records with one name, the
// one whose abbreviation `districts` lists wins, and then the lowest id.
function elsewhereClubIndex(orgs, districts) {
  const known = new Set(meetScopes(districts).find((s) => s.id === NATIONAL_SCOPE_ID)?.clubs);
  const ranked = [...(orgs || [])].sort(
    (a, b) => known.has(a.nameShort) - known.has(b.nameShort) || Number(b.id) - Number(a.id),
  );
  return {
    byName: new Map(ranked.map((o) => [clubNameKey(o.name), o])),
    byShort: new Map(ranked.filter((o) => o.nameShort).map((o) => [o.nameShort, o])),
  };
}

// Returns a lookup of a name's club (elsewhereClub) through `file`'s spellings.
// A caller builds it once, as the index sorts every club there is.
function elsewhereClubOf(orgs, file, districts) {
  const index = elsewhereClubIndex(orgs, districts);
  const spellings = new Map(Object.entries(file?.clubs || {}).map(([name, short]) => [clubNameKey(name), short]));
  return (name) => elsewhereClub(name, spellings.get(clubNameKey(name)), index);
}

// Returns a class's round, which the schedule row and the event both carry.
const olRound = (classId) => ({
  Id: `ol-${classId}`,
  Name: 'Loppukilpailu',
  Status: 'Official',
  RoundTypeCategory: 'Final',
});

// Returns the schedule of a row that stands alone, a row per class on its day.
// The classes share the mass start, so they group into one start (groupRounds).
// A class's name gives its age, and every round is official.
function olSchedule(row) {
  return {
    [isoToFiDay(row?.date)]: Object.entries(row?.classes || {}).map(([name, classId]) => ({
      ...olRound(classId),
      EventId: `ol-${classId}`,
      EventName: name,
      Age: /\d+/.exec(parseEventName(name).sex)?.[0] ?? '0',
      BeginDateTimeWithTZ: `${row?.date}T${row?.start}`,
    })),
  };
}

// Returns such a row's /properties, which carry its name and no organiser.
const olProperties = (row) => ({
  Competition: { Name: row?.name || '', Organization: '', BeginDate: row?.date || '' },
});

// Reads the race's files once, for olAloneMeet and olGraft alike. `finishers`
// lists a class's finishers in no order. `made` builds the entry a finisher
// gets where the meet has none.
function olRace(files, orgs, file, districts, licences) {
  const formats = files?.event?.JsonFileFormats || {};
  const clubNames = new Map(olRows(formats.OLClub, files?.competitors?.Clubs).map((c) => [c.ID, c.ClubNameLong]));
  const people = new Map(
    olRows(formats.OLIndividualCompetitor, files?.competitors?.Competitors).map((p) => [p.CompetitorID, p]),
  );
  const clubOf = elsewhereClubOf(orgs, file, districts);
  return {
    name: (person) => `${person.NameFirst} ${person.NameLast}`.trim(),
    finishers: (classId) =>
      olRows(formats.OLIndividualCompetitorRace, files?.results?.[classId]?.Results)
        .map((r) => ({ person: people.get(r.CompetitorID), time: olFinish(r) }))
        .filter((r) => r.person && r.time != null),
    made: (person, athlete) => {
      const org = clubOf(clubNames.get(person.ClubID));
      const id = `ol-${org?.Id ?? ''}-${personNameKey(athlete)}`;
      return {
        Id: id,
        Name: athlete,
        Organization: org,
        Athletes: [{ Id: id, LicenseId: madeLicence(licences, athlete, org), ...madeName(athlete) }],
      };
    },
  };
}

// Returns a finisher's place, which the race's files do not give. It counts the
// faster finishes, as no two in a class share a time (docs/elsewhere.md).
const olRank = (finished, time) => 1 + finished.filter((o) => o.time < time).length;

// Returns {schedule, events} for meetMedalsBody from a row that stands alone
// and its files {event, competitors, results: {classId: file}}. A class is one
// official final ranked by finish time. `file` is elsewhere.json.
function olAloneMeet(row, files, orgs, file, districts, licences) {
  const race = olRace(files, orgs, file, districts, licences);
  const events = Object.entries(row?.classes || {}).map(([name, classId]) => {
    const finished = race.finishers(classId);
    const allocations = finished.map(({ person, time }) => ({
      ...race.made(person, race.name(person)),
      Result: olTime(time),
      ResultRank: olRank(finished, time),
    }));
    return {
      eventId: `ol-${classId}`,
      data: {
        Id: `ol-${classId}`,
        Name: name,
        Enrollments: [],
        Rounds: [{ ...olRound(classId), Heats: [{ Index: 0, Allocations: allocations }] }],
      },
    };
  });
  return { schedule: olSchedule(row), events };
}

// Grafts the same files onto a meet that has its entries here. `row.classes`
// gives each event's class in the race, matched by eventNameKey, since the
// row's names are written by hand and a meet can name an event two ways
// (docs/tuloslista-api.md, "A meet can name an event one way"). A finisher is the event's entry of that name, or else a
// made one.
function olGraft(schedule, eventResults, row, files, orgs, file, districts, licences) {
  const race = olRace(files, orgs, file, districts, licences);
  const classes = new Map(Object.entries(row?.classes || {}).map(([name, classId]) => [eventNameKey(name), classId]));
  const done = new Set();
  const events = (eventResults || []).map(({ eventId, data }) => {
    const rounds = data?.Rounds || [];
    const round = rounds.find((r) => isFinalRound(rounds, r));
    const classId = round ? classes.get(eventNameKey(data.Name)) : undefined;
    const finished = classId == null ? [] : race.finishers(classId);
    if (!finished.length) return { eventId, data };
    const entered = new Map((data.Enrollments || []).map((e) => [personNameKey(e.Name), e]));
    const heat = {
      Index: 0,
      Allocations: finished.map(({ person, time }) => {
        const athlete = race.name(person);
        return {
          ...(entered.get(personNameKey(athlete)) || race.made(person, athlete)),
          Result: olTime(time),
          ResultRank: olRank(finished, time),
        };
      }),
    };
    done.add(round.Id);
    return {
      eventId,
      data: { ...data, Rounds: rounds.map((r) => (r === round ? { ...r, Status: 'Official', Heats: [heat] } : r)) },
    };
  });
  return {
    schedule: Object.fromEntries(
      Object.entries(schedule || {}).map(([day, rows]) => [
        day,
        (rows || []).map((r) => (done.has(r.Id) ? { ...r, Status: 'Official' } : r)),
      ]),
    ),
    events,
  };
}

// --- elsewhere.json: a meet's row, and the meets due one ---

// Returns the field of a meet with no entries here, one row a person over every
// round and keyed by id. buildRoster takes it for the entries, and a followed
// person is matched through that roster (watchTargets).
function aloneEntries(data) {
  const seen = new Map();
  for (const round of data?.Rounds || []) {
    for (const heat of round.Heats || []) {
      for (const alloc of heat.Allocations || [])
        if (alloc?.Id != null && !seen.has(alloc.Id)) seen.set(alloc.Id, alloc);
    }
  }
  return [...seen.values()];
}

// A row that stands alone is keyed "<word>-<year>", and no Tuloslista meet or
// demo is. app/data.js reads the file only for an id of that shape (aloneRow).
const ALONE_ID_RE = /^[a-z]+-\d{4}$/;

// Returns a meet's results page for its title menu, or null for a demo.
const T4R_BASE = 'https://live.time4results.com/yu';
const TULOSLISTA_BASE = 'https://live.tuloslista.com';
function officialUrl(row, compId) {
  if (row?.ol) return `${OL_PAGE_BASE}/${row.ol}/`;
  if (row?.t4r) return `${T4R_BASE}/${row.t4r}/`;
  return /^\d+$/.test(String(compId ?? '')) ? `${TULOSLISTA_BASE}/${compId}` : null;
}

// Returns elsewhere.json's row for a meet. A {comp, t4r} row names the meet's
// directory on the other site, and a {comp, ol, classes} row names its race
// (olGraft). A row with an `id` stands alone (olAloneMeet, t4rAloneMeet).
function elsewhereRow(file, compId) {
  return (file?.meets || []).find((m) => String(m.comp ?? m.id) === String(compId)) || null;
}

// Returns a row's last day. A one-day row has `date` and no `last`.
const elsewhereLastDay = (row) => row?.last || row?.date || '';

// The graft's version is raised by hand when it reads more from the same pages,
// since a settled record is never rebuilt (recordSettled).
const ELSEWHERE_GRAFT_VERSION = 10;

// Returns what a listed meet's keys carry after the id. A {comp, t4r} row gives
// the version alone, and any other row hashes itself and `clubs` over it.
function elsewhereTag(file, compId) {
  const row = elsewhereRow(file, compId);
  if (!row) return '';
  if (!row.ol && row.id == null) return `:elsewhere:${ELSEWHERE_GRAFT_VERSION}`;
  const text = JSON.stringify([row, file.clubs ?? null]);
  return `:elsewhere:${[...text].reduce((h, c) => (Math.imul(h, 31) + c.codePointAt(0)) >>> 0, ELSEWHERE_GRAFT_VERSION).toString(36)}`;
}

// Says whether a view reads a meet's results from the graft (resultsBase,
// app/data.js). It does once the file lists the meet and its last day is before
// `todayIso`, which is the Worker's own UTC day (docs/backend.md).
function graftApplies(file, compId, schedule, todayIso) {
  const days = scheduleDays(schedule);
  const last = days.length ? fiToIsoDay(days[days.length - 1]) : '';
  return Boolean(last && last < todayIso && elsewhereRow(file, compId));
}

// Proof-reads the file, and returns one line a problem or [] when it is sound.
function elsewhereProblems(file, districts) {
  if (!Array.isArray(file?.meets)) return ['meets: not a list'];
  const seen = new Set();
  const known = meetScopes(districts).find((s) => s.id === NATIONAL_SCOPE_ID)?.clubs;
  const spelled = new Set();
  const clubs = Object.entries(file.clubs ?? {}).flatMap(([name, short]) => {
    const key = clubNameKey(name);
    const twice = spelled.has(key);
    spelled.add(key);
    if (!key || twice) return [`clubs: "${name}" is ${key ? 'spelled twice' : 'no name'}`];
    return known && !known.includes(short) ? [`clubs: "${short}" is no club of districts.json`] : [];
  });
  return [
    ...clubs,
    ...file.meets.flatMap((m, i) => {
      const problems = [];
      const key = m?.id ?? m?.comp;
      if (m?.id != null ? !ALONE_ID_RE.test(m.id) : !Number.isInteger(key) || key <= 0)
        problems.push(`row ${i + 1}: ${m?.id != null ? 'id is not "<word>-<year>"' : 'comp is not a meet id'}`);
      else if (seen.has(key)) problems.push(`row ${i + 1}: ${key} is listed twice`);
      seen.add(key);
      if (m?.id != null) {
        if (!String(m.name ?? '').trim()) problems.push(`row ${i + 1}: no name`);
        if (!/^\d{4}-\d\d-\d\d$/.test(m.date ?? '') || !String(m.id).endsWith(m.date.slice(0, 4)))
          problems.push(`row ${i + 1}: date is not a day of the id's year`);
        if (!/^\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(m.start ?? ''))
          problems.push(`row ${i + 1}: start is not a time of day and its offset`);
        if (
          m.last !== undefined &&
          (!/^\d{4}-\d\d-\d\d$/.test(m.last) ||
            m.last <= String(m.date) ||
            m.last.slice(0, 4) !== String(m.date).slice(0, 4))
        )
          problems.push(`row ${i + 1}: last is not a later day of date's year`);
      }
      if (m?.ol == null)
        return /^\d{4}\/[a-z\d]+$/.test(m?.t4r ?? '')
          ? problems
          : [...problems, `row ${i + 1}: t4r is not "<year>/<directory>"`];
      const classes = Object.entries(m.classes && typeof m.classes === 'object' ? m.classes : {});
      if (!/^\w+$/.test(m.ol)) problems.push(`row ${i + 1}: ol is not an event id`);
      if (
        !classes.length ||
        classes.some(([name, id]) => !/^[MNPT]\d* \S/u.test(name) || !Number.isInteger(id) || id < 0)
      )
        problems.push(`row ${i + 1}: classes is not {"<class> <event>": <class id>}`);
      return problems;
    }),
  ];
}

// An SM meet whose rounds stop at the start lists has its results elsewhere
// (docs/tuloslista-api.md, "An SM meet whose rounds never get past the start
// lists"). It is due a row 2 to 60 days after it runs.
const KALEVAN_KISAT_RE = /kalevan\s+kisat/iu;
const ELSEWHERE_GRACE_DAYS = 2;
const ELSEWHERE_WINDOW_DAYS = 60;

// Returns the meets of `/api/meets` that may be due a row (elsewhereIsDue).
function elsewhereCandidates(meets, file, todayIso) {
  const rowed = new Set((file?.meets || []).map((m) => String(m.comp ?? '')));
  const from = shiftIsoDay(todayIso, -ELSEWHERE_WINDOW_DAYS);
  const to = shiftIsoDay(todayIso, -ELSEWHERE_GRACE_DAYS);
  return (meets || []).filter(
    (m) =>
      m.date >= from &&
      m.date <= to &&
      !rowed.has(String(m.id)) &&
      (SM_WORD_RE.test(m.name) || KALEVAN_KISAT_RE.test(m.name)) &&
      !NO_SM_RE.test(m.name),
  );
}

// Says whether a candidate's schedule puts its results elsewhere. Its last day
// is past the grace, and no round got past the start lists.
function elsewhereIsDue(schedule, todayIso) {
  const days = scheduleDays(schedule);
  if (!days.length || fiToIsoDay(days[days.length - 1]) > shiftIsoDay(todayIso, -ELSEWHERE_GRACE_DAYS)) return false;
  return Object.values(schedule)
    .flat()
    .every((r) => (STATUS_ORDER[r?.Status] ?? 0) <= STATUS_ORDER.Allocated);
}

// These championships some years have no Tuloslista meet, and each has run by
// its day (docs/elsewhere.md).
const ELSEWHERE_YEARLY = [
  { word: 'viestit', name: 'SM-viestit', by: '10-01' },
  { word: 'maraton', name: 'SM-maraton', by: '11-01' },
];

// Returns the yearly championships past their day that have no row this year
// and no meet of their name in the index that elsewhereCandidates reads.
function elsewhereYearlyDue(meets, file, todayIso) {
  const year = todayIso.slice(0, 4);
  return ELSEWHERE_YEARLY.filter((c) => {
    if (todayIso < `${year}-${c.by}` || (file?.meets || []).some((m) => m.id === `${c.word}-${year}`)) return false;
    const named = new RegExp(`(?<!\\p{L})${c.name}`, 'iu');
    return !(meets || []).some((m) => m.date?.startsWith(year) && named.test(m.name) && !SAUL_RE.test(m.name));
  }).map((c) => ({ ...c, year }));
}

export {
  ALONE_ID_RE,
  T4R_BASE,
  T4R_FINAL_RE,
  aloneEntries,
  athleteLicences,
  elsewhereCandidates,
  elsewhereIsDue,
  elsewhereLastDay,
  elsewhereProblems,
  elsewhereRow,
  elsewhereTag,
  elsewhereYearlyDue,
  graftApplies,
  officialUrl,
  olAloneMeet,
  olGraft,
  olProperties,
  olSchedule,
  olTime,
  t4rAloneMeet,
  t4rGraft,
  t4rMark,
  t4rWanted,
};
