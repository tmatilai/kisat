import { ageOrder } from './ages.js';
import { combinedEventStarts, combinedRootStart, combinedTotals } from './combined.js';
import { cupSeasonMeets } from './cup.js';
import { dateSortKey, dayDiff, tsKey } from './dates.js';
import {
  NATIONAL_SCOPE_ID,
  closedPair,
  coversStart,
  defaultScopes,
  inScope,
  medalScope,
  meetScopes,
  piiriEntries,
  scopeFor,
  startLine,
} from './districts.js';
import { elsewhereRow } from './elsewhere.js';
import { isFollowableOrgId } from './indexes.js';
import {
  followedKey,
  heatsInOrder,
  isFinalRound,
  officialRank,
  positionText,
  relayInfo,
  resultPending,
  roundAllocated,
  roundFieldSize,
  sortResults,
} from './results.js';
import {
  filedStart,
  previousRoundField,
  reconcileStatuses,
  roundGroupKey,
  rowClassAge,
  scheduleStatuses,
} from './schedule.js';
import { allocMatches, matchedEntries } from './watch.js';

// --- A meet's medals ---
// They read the same [{eventId, data}] fan-out as buildRoster, plus the roots
// of the followed multi-events.

// Returns a medal, 1 to 3 by ResultRank in the event's final, or null, and a
// guest takes none. Under a scope (medalScope) a row outside gets none and a
// shared rank shares one.
function medalFor(alloc, round, rounds, ranking = null) {
  if (alloc?.NotInCompetition || !isFinalRound(rounds, round)) return null;
  const rank = ranking ? scopeRank(alloc, ranking) : alloc?.ResultRank;
  return rank >= 1 && rank <= 3 ? rank : null;
}

// Returns one more than the scope's rows placed ahead, or null outside it.
function scopeRank(alloc, { scopeOf, field, start }) {
  const scope = scopeOf(alloc?.Organization, start);
  if (!scope || !(alloc?.ResultRank >= 1)) return null;
  return (
    1 +
    (field || []).filter(
      (a) =>
        a !== alloc &&
        !a?.NotInCompetition &&
        a?.ResultRank >= 1 &&
        a.ResultRank < alloc.ResultRank &&
        inScope(scope, a.Organization),
    ).length
  );
}

// Splits a round's rows, merged over the heats as in totalResults, into a
// table per ticked scope in meetScopes' order. A row goes in its own (scopeFor)
// and is ranked within it, and the rest go last under a null scope.
function scopeResults(round, start, districts, ticked) {
  const field = heatsInOrder(round).flatMap((h) => h.Allocations || []);
  const scopeOf = medalScope(districts, ticked);
  const rows = sortResults(field).map((a) => ({
    of: scopeOf(a.Organization, start),
    alloc: { ...a, scopeRank: scopeRank(a, { scopeOf, field, start }) },
  }));
  const tables = meetScopes(districts)
    .map((scope) => ({ scope, allocs: rows.filter((r) => r.of === scope).map((r) => r.alloc) }))
    .filter((t) => t.allocs.length);
  const rest = rows.filter((r) => !r.of).map((r) => r.alloc);
  return rest.length ? [...tables, { scope: null, allocs: rest }] : tables;
}

// Says whether scopeResults' tables add nothing to the merged list. That is no
// table, or one with every row at its official place (officialRank).
function scopeTablesAddNothing(tables) {
  return tables.length === 0 || (tables.length === 1 && tables[0].allocs.every((a) => officialRank(a) === null));
}

// Builds a followed row. Its `place` is the one its medal comes from, the
// official place or the scope's own (scopeRank), so a line's disc and place
// agree.
// `start` is what a cover reads (coversStart).
function followedRow(
  m,
  { event, roundName, link, date, ts, round, rounds, pending, data, legCount, points, ranking, start },
) {
  const alloc = m.alloc;
  const athleteId = alloc?.Athletes?.length === 1 ? String(alloc.Athletes[0].Id) : null;
  return {
    key: followedKey(alloc),
    athleteId,
    name: alloc?.Name || '',
    org: alloc?.Organization || null,
    event,
    roundName,
    link,
    date,
    ts,
    start,
    alloc,
    total: m.total,
    heatIndex: m.heatIndex,
    heatCount: m.heatCount,
    pending,
    medal: medalFor(alloc, round, rounds, ranking),
    place: ranking ? positionText(scopeRank(alloc, ranking), null) : positionText(alloc?.ResultRank ?? null, m.total),
    subCategory: data?.EventSubCategory || null,
    legCount,
    points,
  };
}

// Returns a meet's followed rows, one per round matched as the day list does
// (matchedEntries). A multi-event is its root's line alone, and `link` names
// the row's start. `scopeOf` (medalScope) ranks the medals within a scope.
function followedRows(schedule, eventResults, targets, scopeOf = null) {
  return meetRows(
    schedule,
    eventResults,
    (round, enrollments, team, borrowed) => matchedEntries(round, enrollments, targets, team, borrowed),
    (alloc) => allocMatches(alloc, targets, null),
    scopeOf,
  );
}

// Returns every row of a drawn round in matchedEntries' shape. An undrawn
// round gives none, since it has no placing to count.
function roundEntries(round) {
  if (!roundAllocated(round)) return [];
  const total = roundFieldSize(round);
  const heatCount = round.Heats.length;
  return heatsInOrder(round).flatMap((h) =>
    (h.Allocations || []).map((alloc) => ({ alloc, total, heatIndex: h.Index, heatCount })),
  );
}

// Returns the meet's medals per club over every row, and drops clubs with none.
// It is the Worker's table (docs/backend.md). The statuses are reconciled
// first, since the results' own round status lags the schedule's.
function meetMedals(schedule, eventResults, scopeOf = null) {
  return medalTable(meetMedalRows(schedule, eventResults, scopeOf));
}

function meetMedalRows(schedule, eventResults, scopeOf = null) {
  const byId = scheduleStatuses(schedule);
  const reconciled = (eventResults || []).map(({ eventId, data }) => ({
    eventId,
    data: data ? reconcileStatuses(data, byId) : null,
  }));
  return meetRows(
    schedule,
    reconciled,
    (round) => roundEntries(round),
    () => true,
    scopeOf,
  );
}

// Builds GET /api/medals' body. `table` is the meet's table, and `scopes` has a
// table per present scope over what the defaults leave it. `starts` holds each
// class's [clubId, medal, followedKey] and each scope's own under `scoped`.
function meetMedalsBody(schedule, eventResults, districts, meet = null) {
  const official = meetMedalRows(schedule, eventResults);
  const all = allocRows(schedule, eventResults);
  const shortOf = new Map(all.map((r) => [r.org?.Name, r.org?.NameShort]));
  let closed = null;
  const named = defaultScopes(
    meet?.name,
    meet?.organiser,
    districts,
    (club) => shortOf.get(club) || null,
    (cover) => (closed = closedPair(piiriEntries(schedule, eventResults, districts, cover))),
    Boolean(meet?.listed),
  );
  // The country is present on an SM meet alone, or it doubles every record.
  const present = meetScopes(districts).filter(
    (s) => all.some((r) => inScope(s, r.org)) && (s.kind !== 'maa' || named.some((d) => d.id === s.id)),
  );
  const defaults = named.filter((d) => present.some((s) => s.id === d.id));
  const scopes = present.map((scope) => {
    const ticked = defaults.some((d) => d.id === scope.id) ? defaults : [...defaults, { id: scope.id, cover: null }];
    const own = (org, start) => (scopeFor(districts, ticked, org, start) === scope ? scope : null);
    return {
      id: scope.id,
      kind: scope.kind,
      name: scope.name,
      short: scope.short,
      table: meetMedals(schedule, eventResults, own),
    };
  });
  const starts = new Map();
  const athletes = new Map();
  const medalsOf = (rows, add) => {
    for (const r of rows) {
      if (!r.medal || r.pending || r.org?.Id == null) continue;
      const key = `${r.link.kind}:${r.link.key}:${r.event}`;
      if (!starts.has(key)) starts.set(key, { start: r.start, medals: [], scoped: [] });
      if (r.athleteId) athletes.set(r.key, [r.name, r.alloc?.Athletes?.[0]?.LicenseId || null]);
      add(starts.get(key), [String(r.org.Id), r.medal, r.key]);
    }
  };
  medalsOf(official, (s, pair) => s.medals.push(pair));
  for (const scope of present) {
    medalsOf(
      meetMedalRows(schedule, eventResults, medalScope(districts, [{ id: scope.id, cover: null }])),
      (s, pair) => {
        if (s.scoped[s.scoped.length - 1]?.[0] !== scope.id) s.scoped.push([scope.id, []]);
        s.scoped[s.scoped.length - 1][1].push(pair);
      },
    );
  }
  const names = new Map();
  const unknown = new Map();
  for (const r of all) {
    if (r.org?.Id != null && !names.has(String(r.org.Id)))
      names.set(String(r.org.Id), r.org.Name || r.org.NameShort || '');
    if (
      !r.org ||
      !isFollowableOrgId(r.org.Id) ||
      r.alloc?.NotInCompetition ||
      (districts?.piirit || []).some((p) => inScope(p, r.org)) ||
      inScope(districts?.outside, r.org)
    )
      continue;
    unknown.set(String(r.org.Id), r.org.Name || r.org.NameShort);
  }
  return {
    table: medalTable(official),
    scopes,
    defaults,
    closed,
    starts: [...starts.values()],
    names: [...names],
    athletes: [...athletes].map(([key, [name, licence]]) => [key, name, licence]),
    unknown: [...unknown.values()].sort((a, b) => a.localeCompare(b, 'fi')),
  };
}

// Returns every drawn row of the meet, as meetMedals sees them.
function allocRows(schedule, eventResults) {
  return meetRows(
    schedule,
    eventResults,
    (round) => roundEntries(round),
    () => true,
  );
}

// Returns a meet's rows. `pickRound` picks a round's entries from its field,
// or from the enrollments or an earlier round's (previousRoundField) where
// undrawn.
// `pickRoot` picks a root's, and `scopeOf` (medalScope) ranks within either.
function meetRows(schedule, eventResults, pickRound, pickRoot, scopeOf = null) {
  const byEvent = new Map((eventResults || []).map(({ eventId, data }) => [String(eventId), data]));
  const rows = [];
  for (const [date, list] of Object.entries(schedule || {})) {
    for (const sr of list || []) {
      const data = byEvent.get(String(sr.EventId));
      if (!data || data.RootId) continue;
      const rounds = data.Rounds || [];
      const round = rounds.find((r) => r.Id === sr.Id) || null;
      const team = relayInfo(data);
      const prevField = !roundAllocated(round) ? previousRoundField(rounds, round) : null;
      const enrollments = prevField || data.Enrollments;
      const filed = filedStart(sr, schedule);
      const ranking = scopeOf ? { scopeOf, field: roundEntries(round).map((e) => e.alloc), start: filed } : null;
      const start = { EventName: sr.EventName, Age: filed.Age };
      for (const m of pickRound(round, enrollments, team, prevField != null)) {
        rows.push(
          followedRow(m, {
            event: sr.EventName,
            roundName: rounds.length > 1 ? sr.Name : null,
            link: { kind: 'group', key: roundGroupKey(sr) },
            date,
            ts: sr.BeginDateTimeWithTZ,
            round,
            rounds,
            pending: resultPending(round),
            data,
            legCount: team.legCount,
            points: false,
            ranking,
            start,
          }),
        );
      }
    }
  }
  const starts = combinedEventStarts(schedule);
  for (const { eventId, data } of eventResults || []) {
    if (!data?.IsCombinedEvent || data.RootId) continue;
    const isLeg = (l) => String(byEvent.get(String(l.eventId))?.RootId) === String(eventId);
    const start = starts.find((s) => s.legs.some(isLeg));
    if (!start) continue;
    const round = (data.Rounds || [])[0] || null;
    const total = combinedTotals(data);
    const status = { Status: start.status };
    const root = combinedRootStart(start);
    const ranking = scopeOf ? { scopeOf, field: total, start: root } : null;
    for (const alloc of total) {
      if (!pickRoot(alloc)) continue;
      const scored = Number(alloc.Result) > 0;
      rows.push(
        followedRow(
          {
            alloc: scored ? alloc : { ...alloc, Result: null, ResultRank: null },
            total: total.length,
            heatIndex: null,
            heatCount: null,
          },
          {
            event: start.label,
            roundName: null,
            link: { kind: 'combined', key: start.key },
            date: start.dates[0],
            ts: start.legs[0]?.ts,
            round,
            rounds: [round],
            pending: resultPending(status),
            data,
            legCount: 0,
            points: true,
            ranking,
            start: root,
          },
        ),
      );
    }
  }
  return rows;
}

// Returns a box per key over the rows, by medals that stand, best placing, then
// name. A box's lines go by medal, placing, then programme order.
function medalistBoxes(rows) {
  const boxes = new Map();
  for (const r of rows || []) {
    if (!boxes.has(r.key)) {
      boxes.set(r.key, {
        key: r.key,
        name: r.athleteId ? r.name : r.org?.Name || r.name,
        athleteId: r.athleteId,
        org: r.org,
        alloc: r.alloc,
        lines: [],
        medals: [0, 0, 0],
        best: null,
      });
    }
    const b = boxes.get(r.key);
    b.lines.push(r);
    if (r.medal && !r.pending) b.medals[r.medal - 1]++;
    const rank = r.alloc?.ResultRank;
    if (rank != null && (b.best == null || rank < b.best)) b.best = rank;
  }
  for (const b of boxes.values()) {
    b.lines.sort(
      (x, y) =>
        (x.medal || 4) - (y.medal || 4) ||
        (x.alloc?.ResultRank ?? Infinity) - (y.alloc?.ResultRank ?? Infinity) ||
        dateSortKey(x.date) - dateSortKey(y.date) ||
        tsKey(x.ts) - tsKey(y.ts),
    );
  }
  return [...boxes.values()].sort(
    (x, y) =>
      compareMedals(x.medals, y.medals) ||
      (x.best ?? Infinity) - (y.best ?? Infinity) ||
      x.name.localeCompare(y.name, 'fi'),
  );
}

// Sorts more gold first, then more silver, then more bronze.
function compareMedals(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

// Counts the medals that stand per club and drops clubs with none. The clubs
// sort by gold, silver, bronze, then name.
function medalTable(rows) {
  const clubs = new Map();
  for (const r of rows || []) {
    const id = r.org?.Id;
    if (id == null) continue;
    if (!clubs.has(String(id))) {
      clubs.set(String(id), { id: String(id), name: r.org.Name || r.org.NameShort || '', medals: [0, 0, 0] });
    }
    if (r.medal && !r.pending) clubs.get(String(id)).medals[r.medal - 1]++;
  }
  return [...clubs.values()]
    .map((c) => ({ ...c, total: c.medals[0] + c.medals[1] + c.medals[2] }))
    .filter((c) => c.total > 0)
    .sort((a, b) => compareMedals(a.medals, b.medals) || a.name.localeCompare(b.name, 'fi'));
}

// Returns a medal table's places in order, and clubs level on medals share one.
function medalPlaces(clubs) {
  const places = [];
  (clubs || []).forEach((c, i) => {
    places.push(i > 0 && !compareMedals(clubs[i - 1].medals, c.medals) ? places[i - 1] : i + 1);
  });
  return places;
}

// --- The medal page, from a meet's body ---

// Makes medalTable's rows of a start's [clubId, medal] pairs, named by `names`.
function medalRowsOf(medals, names) {
  return (medals || []).map(([id, medal]) => ({ org: { Id: id, Name: names.get(id) }, medal, pending: false }));
}

// Returns `Muut lajit` in medalTable's shape, the meet's own medals over the
// starts no ticked cover holds. It is [] where every medal is a scope's.
function restMedals(body, ticked) {
  const names = new Map(body?.names || []);
  return medalTable(
    (body?.starts || [])
      .filter((s) => !(ticked || []).some((t) => coversStart(t.cover, s.start)))
      .flatMap((s) => medalRowsOf(s.medals, names)),
  );
}

// Files each class of a body as {id, start, medals} under each ticked scope
// that holds it. The country takes it before an alue or a piiri, and an alue
// before its piiri, as in scopeFor. A class no scope holds goes under null.
function medalStarts(body, ticked, districts) {
  const alueOf = new Map((districts?.piirit || []).map((p) => [p.id, p.alue]));
  const covers = new Map((ticked || []).map((t) => [t.id, t.cover ?? null]));
  const holds = (id, start) => covers.has(id) && coversStart(covers.get(id), start);
  const above = (p, start) => (p.kind !== 'maa' && holds(NATIONAL_SCOPE_ID, start)) || holds(alueOf.get(p.id), start);
  return (body?.starts || []).flatMap((s) => {
    const own = (body.scopes || [])
      .filter((p) => holds(p.id, s.start) && !above(p, s.start))
      .map((p) => ({ id: p.id, start: s.start, medals: s.scoped.find(([id]) => id === p.id)?.[1] || [] }));
    return own.length ? own : [{ id: null, start: s.start, medals: s.medals }];
  });
}

// Returns the medal page's tables over the classes the age chips' `cover`
// holds (medalStarts). Each ticked scope gets its own, and `rest` is the
// meet's own, which is `Muut lajit` or the whole table with nothing ticked.
function medalTables(body, ticked, districts, cover = null) {
  const names = new Map(body?.names || []);
  const starts = medalStarts(body, ticked, districts).filter((s) => coversStart(cover, s.start));
  const tableOf = (id) => medalTable(starts.filter((s) => s.id === id).flatMap((s) => medalRowsOf(s.medals, names)));
  return {
    scopes: (body?.scopes || [])
      .filter((p) => (ticked || []).some((t) => t.id === p.id))
      .map((p) => ({ ...p, table: tableOf(p.id) })),
    rest: tableOf(null),
  };
}

// Returns where a class name has its medal as {date, ts, link}. A body names a
// start by its class alone, so it finds the multi-event or else the last round.
const medalOrder = (a, b) =>
  (a.date ? dateSortKey(a.date) : 0) - (b.date ? dateSortKey(b.date) : 0) || tsKey(a.ts) - tsKey(b.ts);
function medalStartAt(schedule) {
  const combined = new Map(combinedEventStarts(schedule).map((s) => [s.label, s.legs[0]]));
  const rounds = Object.entries(schedule || {}).flatMap(([date, list]) =>
    (list || []).map((r) => ({ date, ts: r.BeginDateTimeWithTZ, r })),
  );
  return (name) => {
    const leg = combined.get(name);
    const last = leg
      ? null
      : rounds
          .filter((x) => x.r.EventName === name)
          .sort(medalOrder)
          .pop();
    const at = leg || last;
    return {
      date: at?.date || null,
      ts: at?.ts || null,
      link: leg ? { kind: 'combined', key: name } : last ? { kind: 'group', key: roundGroupKey(last.r) } : null,
    };
  };
}

// Returns a club's medals per class under the chips' `cover` in programme
// order, as [{event, medals, names, date, link, counted, only}] (startLine).
// `names` lists its medalists by medal, and a relay names none.
function clubMedalStarts(body, ticked, districts, cover, clubId, schedule) {
  const at = medalStartAt(schedule);
  const athletes = new Map(body?.athletes || []);
  const lines = new Map();
  const all = medalStarts(body, ticked, districts);
  for (const s of all) {
    const line = startLine(
      cover,
      s.start,
      all.map((x) => x.start),
    );
    const won = s.medals.filter(([id]) => id === String(clubId));
    const name = s.start.EventName;
    if (!line || !won.length) continue;
    if (!lines.has(name)) lines.set(name, { event: name, medals: [0, 0, 0], won: [], ...line, ...at(name) });
    for (const [, medal, key] of won) {
      lines.get(name).medals[medal - 1]++;
      lines.get(name).won.push([medal, athletes.get(key)]);
    }
  }
  return [...lines.values()].sort(medalOrder).map(({ ts, won, ...l }) => ({
    ...l,
    names: [
      ...new Set(
        won
          .sort((a, b) => a[0] - b[0])
          .map(([, n]) => n)
          .filter(Boolean),
      ),
    ],
  }));
}

// Returns a club's medalists over the same starts, by medals then name, as
// [{key, name, athleteId, medals, lines}]. Its relays are one box under its
// name, and `medals` sums the counted lines. Lines go by medal, then time.
function clubMedalists(body, ticked, districts, cover, clubId, schedule) {
  const at = medalStartAt(schedule);
  const athletes = new Map(body?.athletes || []);
  const names = new Map(body?.names || []);
  const boxes = new Map();
  const all = medalStarts(body, ticked, districts);
  for (const s of all) {
    const line = startLine(
      cover,
      s.start,
      all.map((x) => x.start),
    );
    if (!line) continue;
    for (const [id, medal, key = `o${id}`] of s.medals) {
      if (id !== String(clubId)) continue;
      if (!boxes.has(key)) {
        boxes.set(key, {
          key,
          name: athletes.get(key) || names.get(id) || '',
          athleteId: athletes.has(key) ? key.slice(1) : null,
          medals: [0, 0, 0],
          lines: [],
        });
      }
      if (line.counted) boxes.get(key).medals[medal - 1]++;
      boxes.get(key).lines.push({ event: s.start.EventName, medal, ...line, ...at(s.start.EventName) });
    }
  }
  return [...boxes.values()]
    .map((b) => ({
      ...b,
      lines: b.lines.sort((x, y) => x.medal - y.medal || medalOrder(x, y)).map(({ ts, ...l }) => l),
    }))
    .sort((x, y) => compareMedals(x.medals, y.medals) || x.name.localeCompare(y.name, 'fi'));
}

// Says whether a picked club's medalist rows start open. A longer list reads as
// counts first, and a row opens its own medals.
const MEDALIST_ROWS_OPEN_MAX = 12;
function medalistsOpenAll(boxes) {
  return (boxes || []).length <= MEDALIST_ROWS_OPEN_MAX;
}

// Returns the medal page's chips in class order, the classes with a medal.
function medalAges(body, ticked, districts) {
  const ages = medalStarts(body, ticked, districts)
    .filter((s) => s.medals.length)
    .map((s) => rowClassAge(s.start))
    .filter((a) => a != null);
  return [...new Set(ages)].sort((a, b) => ageOrder(a) - ageOrder(b));
}

// --- When the Worker builds and keeps a record ---

// Returns how long a built body is kept. A meet still to come or under way
// takes `live`, and one past its last day takes `past` (docs/backend.md).
function cacheTtlFor(lastDay, todayIso, { live, past }) {
  return lastDay && lastDay < todayIso ? past : live;
}

// A month after a meet's last day nothing moves its results again, so a
// record of it never goes stale (docs/backend.md).
const SETTLED_AFTER_DAYS = 30;
function recordSettled(lastDay, todayIso) {
  const days = lastDay ? dayDiff(todayIso, lastDay) : null;
  return days != null && days > SETTLED_AFTER_DAYS;
}

// Returns the meets the cron warms (warmSeason, worker.js), which a scope's
// year or the cup's year would show. Each comes once and oldest first, none is
// later than today, and a cup meet's row carries its `kind`.
function warmSeasonMeets(meets, year, districts, todayIso, elsewhere = null) {
  const byId = new Map();
  for (const scope of meetScopes(districts)) {
    for (const m of medalSeasonMeets(meets, scope.id, year, districts, elsewhere)) {
      if (m.date <= todayIso && !byId.has(m.id)) byId.set(m.id, m);
    }
  }
  const cup = cupSeasonMeets(meets, year, districts).filter((m) => m.date <= todayIso);
  return [...byId.values(), ...cup].sort((a, b) => a.date.localeCompare(b.date));
}

// Says whether a build round goes on (docs/backend.md). It stays under both its
// count cap and its wall-clock budget, and it always takes its first build.
function buildRoundGoesOn(built, elapsedMs, { limit, budgetMs }) {
  return built === 0 || (built < limit && elapsedMs < budgetMs);
}

// --- A championship's year ---

// Returns a meet's medal season record, stamped for the freshness rule. It
// keeps each start's `scoped` medals, `names`, `athletes`, `closed` and
// `unknown`.
function medalSeasonRecord(body, builtAt, lastDay) {
  return {
    builtAt,
    lastDay,
    closed: body?.closed ?? null,
    starts: (body?.starts || []).map(({ start, scoped }) => ({ start, scoped })),
    names: body?.names || [],
    athletes: body?.athletes || [],
    unknown: body?.unknown || [],
  };
}

// Returns one scope's [{start, medals}] from a medal season record, over the
// classes `cover` holds where the scope took a medal.
function scopeMedalStarts(record, scopeId, cover = null) {
  return (record?.starts || [])
    .filter((s) => coversStart(cover, s.start))
    .map((s) => ({ start: s.start, medals: s.scoped.find(([id]) => id === scopeId)?.[1] || [] }))
    .filter((s) => s.medals.length);
}

// Says whether a year leaves the meet out. A meet built after its last day with
// no medal anywhere has its results elsewhere.
function medalSeasonMeetEmpty(record) {
  if (!record?.lastDay || !Number.isFinite(record.builtAt)) return false;
  return new Date(record.builtAt).toISOString().slice(0, 10) > record.lastDay && !(record.starts || []).length;
}

// Returns a club's medalists over a year under the chips' `cover`, as
// clubMedalists' boxes whose lines name their meet. A person is a LicenseId, or
// the club's licensed row of that name (docs/tuloslista-api.md).
function medalSeasonMedalists(meets, clubId, cover = null) {
  return medalSeasonBoxes(meets, cover, (id) => id === String(clubId));
}

// Returns a follow-list's medals over a year (watchTargets' shape) as
// medalSeasonMedalists' boxes, with `club` the first club named. A person
// followed by name keeps every line, and the rest only a followed club's.
function medalSeasonFollowedMedalists(meets, { licences = new Set(), clubIds = new Set() } = {}, cover = null) {
  if (!licences.size && !clubIds.size) return [];
  return medalSeasonBoxes(meets, cover, () => true)
    .map((b) => {
      const lines = b.athlete && licences.has(b.key) ? b.lines : b.lines.filter((l) => clubIds.has(l.club));
      const medals = [0, 0, 0];
      for (const l of lines) if (l.counted) medals[l.medal - 1]++;
      return { ...b, lines, medals };
    })
    .filter((b) => b.lines.length)
    .sort((x, y) => compareMedals(x.medals, y.medals) || x.name.localeCompare(y.name, 'fi'));
}

function medalSeasonBoxes(meets, cover, clubOk) {
  const fold = (name) =>
    String(name ?? '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
  const rows = [];
  for (const meet of meets || []) {
    const athletes = new Map((meet.athletes || []).map(([key, name, licence]) => [key, { name, licence }]));
    const names = new Map(meet.names || []);
    const starts = medalSeasonStarts(meet);
    for (const s of starts) {
      const line = startLine(
        cover,
        s.start,
        starts.map((x) => x.start),
      );
      if (!line) continue;
      for (const [id, medal, key] of s.medals) {
        if (!clubOk(id)) continue;
        const a = athletes.get(key);
        rows.push({
          club: id,
          clubName: names.get(id) || '',
          a,
          name: a?.name || names.get(id) || '',
          line: { event: s.start.EventName, medal, meet: meet.id, date: meet.date, club: id, ...line },
        });
      }
    }
  }
  const licenceOf = new Map(rows.filter((r) => r.a?.licence).map((r) => [`${r.club}|${fold(r.name)}`, r.a.licence]));
  const boxes = new Map();
  for (const r of rows) {
    const key = !r.a
      ? `o${r.club}`
      : r.a.licence || licenceOf.get(`${r.club}|${fold(r.name)}`) || `n${r.club}|${fold(r.name)}`;
    if (!boxes.has(key))
      boxes.set(key, { key, name: r.name, club: r.clubName, athlete: !!r.a, medals: [0, 0, 0], lines: [] });
    if (r.line.counted) boxes.get(key).medals[r.line.medal - 1]++;
    boxes.get(key).lines.push(r.line);
  }
  return [...boxes.values()]
    .map((b) => ({
      ...b,
      lines: b.lines.sort((x, y) => x.medal - y.medal || String(x.date).localeCompare(String(y.date))),
    }))
    .sort((x, y) => compareMedals(x.medals, y.medals) || x.name.localeCompare(y.name, 'fi'));
}

// Returns the meets a club took a medal in under the chips' `cover`, as
// [{key, medals, lines}] with `key` the meet's id and `medals` the counted. A
// line is a class, in the record's order.
function medalSeasonClubMeets(meets, clubId, cover = null) {
  const out = [];
  for (const meet of meets || []) {
    const athletes = new Map((meet.athletes || []).map(([key, name]) => [key, name]));
    const starts = medalSeasonStarts(meet);
    const box = { key: meet.id, medals: [0, 0, 0], lines: [] };
    for (const s of starts) {
      const line = startLine(
        cover,
        s.start,
        starts.map((x) => x.start),
      );
      const won = s.medals.filter(([id]) => id === String(clubId)).sort((a, b) => a[1] - b[1]);
      if (!line || !won.length) continue;
      const medals = [0, 0, 0];
      for (const [, medal] of won) medals[medal - 1]++;
      if (line.counted)
        medals.forEach((n, i) => {
          box.medals[i] += n;
        });
      box.lines.push({
        event: s.start.EventName,
        medals,
        names: [...new Set(won.map(([, , key]) => athletes.get(key)).filter(Boolean))],
        ...line,
      });
    }
    if (box.lines.length) out.push(box);
  }
  return out;
}

// Sums a year per club over `meets`, each {id, cover, starts, names} with null
// starts until built. It counts the starts medalSeasonStarts keeps and `cover`
// holds, in medalTable's shape keyed by club id, which holds across meets.
function medalSeasonTable(meets, cover = null) {
  const clubs = new Map();
  for (const meet of meets || []) {
    const names = new Map(meet.names || []);
    const rows = medalSeasonStarts(meet)
      .filter((s) => coversStart(cover, s.start))
      .flatMap((s) => medalRowsOf(s.medals, names));
    for (const c of medalTable(rows)) {
      if (!clubs.has(c.id)) clubs.set(c.id, { id: c.id, name: c.name, medals: [0, 0, 0], meets: [] });
      const club = clubs.get(c.id);
      club.name = c.name || club.name;
      c.medals.forEach((n, i) => {
        club.medals[i] += n;
      });
      club.meets.push({ id: meet.id, medals: c.medals, total: c.total });
    }
  }
  return [...clubs.values()]
    .map((c) => ({ ...c, total: c.medals[0] + c.medals[1] + c.medals[2] }))
    .sort((a, b) => compareMedals(a.medals, b.medals) || a.name.localeCompare(b.name, 'fi'));
}

// Returns the starts a medal season meet's own cover holds and its alue's
// cover (`above`) does not, where the meet is the alue's too. The Worker sends
// the starts with no cover applied.
function medalSeasonStarts(meet) {
  return (meet?.starts || []).filter(
    (s) => coversStart(meet.cover ?? null, s.start) && !(meet.above !== undefined && coversStart(meet.above, s.start)),
  );
}

// Returns the ages a year's chips offer in class order, over the starts
// medalSeasonStarts keeps.
function medalSeasonAges(meets) {
  const ages = (meets || [])
    .flatMap(medalSeasonStarts)
    .map((s) => rowClassAge(s.start))
    .filter((a) => a != null);
  return [...new Set(ages)].sort((a, b) => ageOrder(a) - ageOrder(b));
}

// Returns the ages a year's row opens a meet under while no chip is ticked. It
// is `chipAges` where the meet took a medal they leave out, or where it is
// unbuilt with a cover or an alue's. Else the medal page opens with none.
function medalSeasonMeetAges(meet, chipAges) {
  const narrows =
    meet?.starts == null
      ? !!meet?.cover || meet?.above !== undefined
      : meet.starts.some((s) => rowClassAge(s.start) != null && !chipAges.includes(rowClassAge(s.start)));
  return narrows ? chipAges : [];
}

// Says whether a medal season meet counts under the chips' `cover`. A built one
// needs a medal there, and an unbuilt one a chosen age its own cover holds and
// its alue's (`above`) does not take whole.
function medalSeasonMeetHolds(meet, cover = null) {
  if (!cover?.ages) return true;
  if (meet?.starts != null) return medalSeasonStarts(meet).some((s) => coversStart(cover, s.start));
  const taken = meet?.above !== undefined && meet.above?.ages && !meet.above.events ? meet.above.ages : [];
  return cover.ages.some((a) => (!meet?.cover?.ages || meet.cover.ages.includes(a)) && !taken.includes(a));
}

// Returns the meets defaultScopes gives a scope in a year by date, with `above`
// a piiri's alue's cover. An index row has no abbreviations, so an organiser
// matches by name alone. A row of `elsewhere` that stands alone counts too.
function medalSeasonMeets(meets, scopeId, year, districts, elsewhere = null) {
  const alue = (districts?.piirit || []).find((p) => p.id === scopeId)?.alue;
  const alone = (elsewhere?.meets || [])
    .filter((m) => m.id != null)
    .map((m) => ({ id: m.id, name: m.name, date: m.date }));
  return [...(meets || []), ...alone]
    .filter((m) => String(m?.date || '').startsWith(`${year}-`))
    .map((m) => ({
      m,
      defaults: defaultScopes(
        m.name,
        m.organizationName,
        districts,
        () => null,
        () => m.closed ?? null,
        Boolean(elsewhereRow(elsewhere, m.id)),
      ),
    }))
    .map(({ m, defaults }) => ({
      m,
      scope: defaults.find((s) => s.id === scopeId),
      over: defaults.find((s) => s.id === alue),
    }))
    .filter(({ scope }) => scope)
    .map(({ m, scope, over }) => ({
      id: String(m.id),
      name: m.name,
      date: m.date,
      cover: scope.cover,
      ...(over ? { above: over.cover } : {}),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

export {
  buildRoundGoesOn,
  cacheTtlFor,
  clubMedalStarts,
  clubMedalists,
  followedRows,
  medalAges,
  medalFor,
  medalPlaces,
  medalRowsOf,
  medalSeasonAges,
  medalSeasonClubMeets,
  medalSeasonFollowedMedalists,
  medalSeasonMedalists,
  medalSeasonMeetAges,
  medalSeasonMeetEmpty,
  medalSeasonMeetHolds,
  medalSeasonMeets,
  medalSeasonRecord,
  medalSeasonStarts,
  medalSeasonTable,
  medalTable,
  medalTables,
  medalistBoxes,
  medalistsOpenAll,
  meetMedals,
  meetMedalsBody,
  recordSettled,
  restMedals,
  scopeMedalStarts,
  scopeResults,
  scopeTablesAddNothing,
  warmSeasonMeets,
};
