import { confirmSetting } from './confirmation.js';
import { parseTs } from './dates.js';
import { clubNameKey, namedPiirit, organiserPiiri, scopeTree } from './districts.js';
import { isFollowableOrgId } from './indexes.js';
import { beatsMark, roundFieldSize } from './results.js';
import { CUP_SEASON_PAGE_PATH, CUP_TAB_FINALS, CUP_TAB_ROUNDS, seasonHash } from './routes.js';
import { meetPhase, roundGroupKey } from './schedule.js';

// --- Club-cup points (Seuracup) -----------------------------
// The API serves no club table, so this sums one as the official reader's page
// does, rule by measured rule (docs/tuloslista-api.md).

// The Settings[].Type of /properties that marks a club cup. The flag decides,
// as every meet carries SeuraCUPPoints, and a final named for the cup carries
// Type 0.
const CUP_SETTING_TYPE = 3;

function isCupMeet(properties) {
  return (properties?.Settings || []).some((s) => s?.Type === CUP_SETTING_TYPE && Number(s?.IntValue) !== 0);
}

// Returns the cup event a payload scores in, its own except that both genders'
// walks of one age merge on the group's digits. No start lines up with a cup
// event, so the standings name the rows that counted (docs/tuloslista-api.md).
function cupEventKey(eventId, data) {
  const group = String(data?.Group || '');
  return data?.EventType?.SubCategory === 'Walk' && group.length > 1 ? `walk:${group.slice(1)}` : `event:${eventId}`;
}

// Names a scoring row, the same call on both sides. A page asks with the event
// id it fetched the rows under.
function cupScoringKey(eventId, alloc) {
  return `${eventId}:${alloc?.Id}`;
}

// Says whether row `a` beats `b` as its club's scorer. More points win, then
// the better result, even across the walks' two races, then the better place,
// or `b` stays (docs/tuloslista-api.md, "One scorer per club per event").
function cupRowBeats(a, b, category) {
  const pa = Number(a.SeuraCUPPoints);
  const pb = Number(b.SeuraCUPPoints);
  if (pa !== pb) return pa > pb;
  if (beatsMark(a.Result, b.Result, category)) return true;
  if (beatsMark(b.Result, a.Result, category)) return false;
  return (a.ResultRank ?? Infinity) < (b.ResultRank ?? Infinity);
}

// Sums the club table by the measured rules (docs/tuloslista-api.md). Only a
// Final scores, and a club's best row per event counts, with the walks merged
// and guests out. `scoring` keys each row that counted with points.
function cupStandings(eventResults) {
  // Maps each cup event to each club's best-scoring { alloc, eventId }.
  const events = new Map();
  for (const { eventId, data } of eventResults || []) {
    const key = cupEventKey(eventId, data);
    let best = events.get(key);
    if (!best) events.set(key, (best = new Map()));
    for (const round of data?.Rounds || []) {
      if (round?.RoundTypeCategory !== 'Final') continue;
      for (const h of round.Heats || []) {
        for (const a of h.Allocations || []) {
          if (a?.NotInCompetition || !isFollowableOrgId(a?.Organization?.Id)) continue;
          const id = String(a.Organization.Id);
          const prev = best.get(id);
          if (!prev || cupRowBeats(a, prev.alloc, data?.EventType?.Category)) {
            best.set(id, { alloc: a, eventId });
          }
        }
      }
    }
  }

  const clubs = new Map();
  const scoring = [];
  for (const best of events.values()) {
    for (const [id, { alloc, eventId }] of best) {
      let club = clubs.get(id);
      if (!club) {
        clubs.set(
          id,
          (club = {
            id,
            name: alloc.Organization.Name || '',
            nameShort: alloc.Organization.NameShort || '',
            points: 0,
          }),
        );
      }
      const points = Number(alloc.SeuraCUPPoints) || 0;
      club.points += points;
      if (points > 0 && alloc.Id != null) scoring.push(cupScoringKey(eventId, alloc));
    }
  }

  // Clubs sort by points, then by name where the official page keeps fetch
  // order. A tie shares its place.
  const ranked = [...clubs.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'fi'));
  ranked.forEach((c, i) => {
    c.rank = i > 0 && ranked[i - 1].points === c.points ? ranked[i - 1].rank : i + 1;
  });
  return { clubs: ranked, scoring };
}

// --- The finals, which score by place ------------------------------

// A final scores by place, from a Type 0 setting whose IntValue is the winner's
// points, as the official reader's /points page does (docs/tuloslista-api.md).
const CUP_FINAL_SETTING_TYPE = 0;

function cupFinalMax(properties) {
  const set = (properties?.Settings || []).find((s) => s?.Type === CUP_FINAL_SETTING_TYPE);
  const max = Math.trunc(Number(set?.IntValue));
  return max > 0 ? max : 0;
}

// The winner takes `max`, the second `max - 2` and each place after one less,
// down to 0, so 17 gives [17, 15, 14, … 1, 0]. A place past the end scores 0.
function cupFinalLadder(max) {
  const ladder = max > 0 ? [max] : [];
  for (let p = max - 2; p >= 0; p--) ladder.push(p);
  return ladder;
}

// The reader scores two rows a club per round, a cap no measured final reached.
const CUP_FINAL_SCORERS = 2;

// Walks a final round as the official reader does, giving each placed row its
// score and whether the club's cap kept it. A shared place shares the score, a
// row with no ResultRank has none, and guests and club 0 are skipped.
function cupFinalRoundRows(round, max) {
  const rows = [];
  if (!(max > 0) || round?.RoundTypeCategory !== 'Final') return rows;
  const ladder = cupFinalLadder(max);
  const allocs = (round.Heats || []).flatMap((h) => h?.Allocations || []);
  const seen = new Map();
  for (let place = 1; place <= allocs.length; place++) {
    const tied = allocs.filter((a) => a?.ResultRank === place);
    if (!tied.length) continue;
    const points = tied.reduce((sum, _, i) => sum + (ladder[place - 1 + i] || 0), 0) / tied.length;
    for (const alloc of tied) {
      if (alloc.NotInCompetition || !isFollowableOrgId(alloc?.Organization?.Id)) continue;
      const id = String(alloc.Organization.Id);
      const nth = (seen.get(id) || 0) + 1;
      seen.set(id, nth);
      rows.push({ alloc, points, counts: nth <= CUP_FINAL_SCORERS });
    }
  }
  return rows;
}

// Maps a final round's allocation Ids to their scores for the rail. A row the
// cap dropped is absent, and a last place scoring 0 is present.
function cupFinalRoundScores(round, max) {
  return new Map(
    cupFinalRoundRows(round, max)
      .filter((r) => r.counts && r.alloc?.Id != null)
      .map((r) => [r.alloc.Id, r.points]),
  );
}

// Sums a final's club table like cupStandings, less `scoring`, and breaks a tie
// on the relay place. JSON would turn an Infinity here into null.
const CUP_FINAL_NO_RELAY = 999999;

function cupFinalStandings(eventResults, max) {
  const clubs = new Map();
  for (const { data } of eventResults || []) {
    const relay = data?.EventCategory === 'Relay';
    for (const round of data?.Rounds || []) {
      for (const { alloc, points, counts } of cupFinalRoundRows(round, max)) {
        const id = String(alloc.Organization.Id);
        let club = clubs.get(id);
        if (!club) {
          clubs.set(
            id,
            (club = {
              id,
              name: alloc.Organization.Name || '',
              nameShort: alloc.Organization.NameShort || '',
              points: 0,
              relayRank: CUP_FINAL_NO_RELAY,
            }),
          );
        }
        if (counts) club.points += points;
        if (relay) club.relayRank = Math.min(club.relayRank, alloc.ResultRank);
      }
    }
  }

  const ranked = [...clubs.values()].sort(
    (a, b) => b.points - a.points || a.relayRank - b.relayRank || a.name.localeCompare(b.name, 'fi'),
  );
  ranked.forEach((c, i) => {
    const prev = ranked[i - 1];
    c.rank = i > 0 && prev.points === c.points && prev.relayRank === c.relayRank ? prev.rank : i + 1;
  });
  return { clubs: ranked };
}

// Says what a meet scores from /properties, as null, { final: false } or
// { final: true, max }. The name never decides (docs/tuloslista-api.md).
function cupMode(properties) {
  if (isCupMeet(properties)) return { final: false };
  const max = cupFinalMax(properties);
  return max ? { final: true, max } : null;
}

// Builds the meet body's cup half in one place for every caller. `events` is
// read only where there is a cup.
function cupBody(properties, schedule, events) {
  const confirm = confirmSetting(properties);
  const mode = cupMode(properties);
  if (!mode) return { cup: false, confirm };
  // `phase` rides here, as only the fan-out can answer it (meetPhase).
  const phase = meetPhase(schedule, events);
  return mode.final
    ? { cup: true, final: true, max: mode.max, confirm, phase, ...cupFinalStandings(events, mode.max) }
    : { cup: true, confirm, phase, ...cupStandings(events) };
}

// --- Where a club's points came from --------------------------

// Returns each club's boxes, one per event, of the rows that scored, on a route
// of its own for its size (docs/backend.md). cupStandings or cupFinalRoundRows
// decides the rows, and the group key is the schedule's.
function cupBreakdown(eventResults, mode, schedule) {
  const clubs = {};
  if (!mode) return { clubs };

  const starts = new Map();
  for (const day of Object.values(schedule || {})) {
    for (const row of day || []) {
      if (row?.Id == null) continue;
      starts.set(row.Id, { group: roundGroupKey(row), ts: parseTs(row.BeginDateTimeWithTZ) });
    }
  }

  const scored = mode.final ? null : new Set(cupStandings(eventResults).scoring);
  const boxes = [];
  const byClubEvent = new Map();
  for (const { eventId, data } of eventResults || []) {
    for (const round of data?.Rounds || []) {
      if (!mode.final && round?.RoundTypeCategory !== 'Final') continue;
      const start = starts.get(round?.Id);
      // A final's rows come from cupFinalRoundRows' walk by place. Heats are
      // unordered (docs/tuloslista-api.md).
      const rows = mode.final
        ? cupFinalRoundRows(round, mode.max).filter((r) => r.counts)
        : (round.Heats || [])
            .flatMap((h) => h?.Allocations || [])
            .filter((a) => scored.has(cupScoringKey(eventId, a)))
            .map((alloc) => ({ alloc, points: Number(alloc.SeuraCUPPoints) }));
      for (const { alloc, points } of rows) {
        const club = String(alloc.Organization?.Id ?? '');
        const key = `${club}:${eventId}`;
        let box = byClubEvent.get(key);
        if (!box) {
          byClubEvent.set(
            key,
            (box = {
              group: start ? start.group : null,
              event: data?.Name || '',
              field: roundFieldSize(round),
              entries: [],
            }),
          );
          boxes.push({ club, ts: start ? start.ts : 0, box });
        }
        box.entries.push({
          name: alloc.Name || '',
          licence: alloc.Athletes?.length === 1 ? alloc.Athletes[0].LicenseId || null : null,
          result: alloc.Result || '',
          place: alloc.ResultRank ?? null,
          points,
        });
      }
    }
  }

  // Boxes go in programme order, and a tie on the instant goes by event name.
  boxes.sort((a, b) => a.ts - b.ts || a.box.event.localeCompare(b.box.event, 'fi'));
  for (const { club, box } of boxes) {
    box.entries.sort(
      (x, y) => y.points - x.points || (x.place || 0) - (y.place || 0) || x.name.localeCompare(y.name, 'fi'),
    );
    if (!clubs[club]) clubs[club] = [];
    clubs[club].push(box);
  }
  return { clubs };
}

// Builds cupBody's other half, on every path that builds a meet.
function cupDetail(properties, schedule, events) {
  return cupBreakdown(events, cupMode(properties), schedule);
}

// Returns a cup meet's record for its year, its clubs each with the boxes
// flattened to rows. A meet that scores none has no clubs (docs/backend.md).
function cupSeasonRecord(body, detail, builtAt, lastDay) {
  const boxes = detail?.clubs || {};
  const clubs = (body?.cup ? body.clubs || [] : []).map((c) => ({
    id: c.id,
    name: c.name,
    rank: c.rank,
    points: c.points,
    rows: (boxes[c.id] || []).flatMap((b) =>
      b.entries.map((e) => ({
        club: c.id,
        licence: e.licence ?? null,
        name: e.name,
        event: b.event,
        group: b.group,
        place: e.place,
        field: b.field,
        result: e.result,
        points: e.points,
      })),
    ),
  }));
  return { builtAt, lastDay, final: !!body?.final, clubs };
}

// Returns a record's rows for the clubs and licences asked for (watchTargets').
function cupSeasonRows(record, { clubIds = new Set(), licences = new Set() } = {}) {
  return (record?.clubs || [])
    .flatMap((c) => c.rows)
    .filter((r) => clubIds.has(r.club) || (r.licence && licences.has(r.licence)));
}

// --- The cup's year ---

// A cup meet is found by its name, and its kind by the 9-year-olds' spellings
// and "finaali" (docs/tuloslista-api.md, "A cup meet's name finds it").
const CUP_MEET_RE = /seuracup|föreningscup/iu;
// Returns seriesOf(name), which gives seuracup.json's 'A', 'B', 'C' or null. A
// name compares by clubNameKey, as the site's case and punctuation differ from
// Organization.Name (docs/seuracup.md). A name in two lists keeps the last.
function cupSeries(file) {
  const series = new Map(
    ['A', 'B', 'C'].flatMap((s) => (file?.series?.[s] || []).map((name) => [clubNameKey(name), s])),
  );
  return (name) => series.get(clubNameKey(name)) ?? null;
}

const CUP_NINES_RE = /(?<![\p{N}])9(?: ?v|-sarja|-vuotiai)/iu;
const CUP_FINAL_RE = /finaali/iu;

// Returns a year's cup meets from the meet index, by date. A final has no piiri
// and names its `organiser`. Another meet's `piirit` are its organiser's and
// those its name carries (docs/tuloslista-api.md, "A cup meet's piiri is its
// organiser's").
function cupSeasonMeets(meets, year, districts) {
  const piirit = districts?.piirit || [];
  return (meets || [])
    .filter((m) => String(m?.date || '').startsWith(`${year}-`) && CUP_MEET_RE.test(m.name || ''))
    .map((m) => {
      const kind = CUP_NINES_RE.test(m.name) ? 'nines' : CUP_FINAL_RE.test(m.name) ? 'final' : 'osa';
      const home = organiserPiiri(m.organizationName, piirit, () => null)?.id;
      const ids = kind === 'final' ? [] : [...new Set([...(home ? [home] : []), ...namedPiirit(m.name, piirit)])];
      return {
        id: String(m.id),
        name: m.name,
        date: m.date,
        kind,
        piirit: piirit.map((p) => p.id).filter((id) => ids.includes(id)),
        ...(kind === 'final' ? { organiser: m.organizationName || null } : {}),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id));
}

// Returns a cup meet's link up to its year from its row (propertiesMeetRow). A
// final links the finals' tab, and another meet its organiser's piiri, else the
// first it names, else CUP_TAB_ROUNDS. A row whose name is no cup meet's gives
// null.
function cupSeasonHref(row, districts) {
  const year = String(row?.date || '').slice(0, 4);
  const meet = row ? cupSeasonMeets([{ id: 0, ...row }], year, districts)[0] : null;
  if (!meet) return null;
  const home = organiserPiiri(row.organizationName, districts?.piirit || [], () => null)?.id;
  const tab =
    meet.kind === 'final' ? CUP_TAB_FINALS : meet.piirit.includes(home) ? home : meet.piirit[0] || CUP_TAB_ROUNDS;
  return `${CUP_SEASON_PAGE_PATH}${seasonHash(tab, Number(year))}`;
}

// Returns the piiris with a cup meet in cupSeasonMeets' `meets`, under their
// alueet as scopeTree gives them.
function cupSeasonPiirit(meets, districts) {
  return scopeTree(districts, [...new Set((meets || []).flatMap((m) => m.piirit || []))]);
}

// Reads a cup final's series from its name, such as "Superfinaali", "A-sarjan
// finaali" or "A-finaali" (docs/tuloslista-api.md, "/finals/ is the
// qualification"). Else it is null.
const CUP_FINAL_SERIES_RE = /(?<![\p{L}\p{N}])([ABC])-(?:sarjan\s+)?finaali/iu;
function cupFinalSeries(name) {
  if (/superfinaali/iu.test(name || '')) return 'super';
  return CUP_FINAL_SERIES_RE.exec(name || '')?.[1].toUpperCase() ?? null;
}

// Finals fill in order to these sizes (docs/tuloslista-api.md, "/finals/ is
// the qualification").
const CUP_FINAL_FIELDS = [
  ['super', 8],
  ['A', 16],
  ['B', 16],
  ['C', 16],
];

// Ranks the clubs with points by their osakilpailu sum, a tie sharing `rank`.
// Each final takes its organiser, then by rank the clubs of its series, or of
// any for the Superfinaali (docs/tuloslista-api.md, "/finals/ is the
// qualification"). `finalPlace` counts down the Superfinaali's list, or else
// the club's series.
function cupSeasonTable(meets, seriesOf = () => null, organisers = {}) {
  const clubs = new Map();
  for (const meet of meets || []) {
    if (meet?.kind !== 'osa') continue;
    for (const c of meet.clubs || []) {
      if (!clubs.has(c.id)) clubs.set(c.id, { id: c.id, name: c.name, meets: 0, points: 0 });
      const club = clubs.get(c.id);
      club.name = c.name || club.name;
      club.meets += 1;
      club.points += c.points;
    }
  }
  const rows = [];
  [...clubs.values()]
    .filter((c) => c.points > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'fi'))
    .forEach((c, i) =>
      rows.push({
        id: c.id,
        name: c.name,
        rank: i > 0 && rows[i - 1].points === c.points ? rows[i - 1].rank : i + 1,
        series: seriesOf(c.name),
        points: c.points,
        meets: c.meets,
        final: null,
        organiser: false,
        finalPlace: null,
      }),
    );
  for (const [final, size] of CUP_FINAL_FIELDS) {
    const host = organisers?.[final]
      ? rows.find((r) => r.final == null && clubNameKey(r.name) === clubNameKey(organisers[final]))
      : null;
    const field = [
      ...(host ? [host] : []),
      ...rows.filter((r) => r !== host && r.final == null && r.series && (final === 'super' || r.series === final)),
    ].slice(0, size);
    for (const r of field) {
      r.final = final;
      r.organiser = r === host;
    }
  }
  const places = new Map();
  for (const r of rows) {
    const list = r.final === 'super' ? 'super' : r.series;
    if (!list) continue;
    places.set(list, (places.get(list) || 0) + 1);
    r.finalPlace = places.get(list);
  }
  return rows;
}

// Maps each final's series to its organiser for cupSeasonTable. A final not yet
// in the index, or one whose name reads no series, gives none.
function cupFinalOrganisers(meets) {
  return Object.fromEntries(
    (meets || [])
      .filter((m) => m?.kind === 'final' && m.organiser && cupFinalSeries(m.name))
      .map((m) => [cupFinalSeries(m.name), m.organiser]),
  );
}

// Returns the year's finals in the order A, B, C, then the Superfinaali, and
// last a final whose name reads no series.
const CUP_FINAL_ORDER = ['A', 'B', 'C', 'super', null];
function cupFinals(meets) {
  const order = (m) => CUP_FINAL_ORDER.indexOf(cupFinalSeries(m.name));
  return (meets || []).filter((m) => m?.kind === 'final').sort((a, b) => order(a) - order(b));
}

// Returns a section per final as [{final, meet, clubs}] in cupFinals' order,
// with no `meet` for a series the index lacks. `clubs` is the standings once a
// club scores, and else the field from cupSeasonTable's `rows` with no points.
function cupFinalTables(meets, rows) {
  const held = cupFinals(meets).map((m) => ({ final: cupFinalSeries(m.name), meet: m }));
  const missing = CUP_FINAL_FIELDS.map(([final]) => final)
    .filter((final) => !held.some((t) => t.final === final))
    .map((final) => ({ final, meet: null }));
  return [...held, ...missing]
    .sort((a, b) => CUP_FINAL_ORDER.indexOf(a.final) - CUP_FINAL_ORDER.indexOf(b.final))
    .map(({ final, meet }) => ({
      final,
      meet,
      clubs: (meet?.clubs || []).some((c) => c.points > 0)
        ? meet.clubs
        : (rows || [])
            .filter((r) => final && r.final === final)
            .map((r) => ({ id: r.id, name: r.name, rank: null, points: null })),
    }));
}

// Says whether a final's day is past, which settles its places.
function cupFinalOver(meet, todayIso) {
  return !!meet?.date && meet.date < todayIso;
}

// Returns the tab a year opens on. It is the finals' once a final's day has
// come, and the osakilpailut's before.
function cupDefaultTab(meets, todayIso) {
  return (meets || []).some((m) => m?.kind === 'final' && m.date && m.date <= todayIso)
    ? CUP_TAB_FINALS
    : CUP_TAB_ROUNDS;
}

// Gives round 1 before July and 2 after (docs/tuloslista-api.md, "The two
// rounds are June and August").
function cupMeetRound(date) {
  return String(date || '').slice(5, 7) < '07' ? 1 : 2;
}

// Narrows a year's body and its `pending` to a piiri's meets and the finals.
function cupSeasonScope(season, piiriId) {
  if (!piiriId || !season) return season;
  const ours = (m) => m.kind === 'final' || (m.piirit || []).includes(piiriId);
  const ids = new Set(season.meets.filter(ours).map((m) => m.id));
  return { ...season, meets: season.meets.filter(ours), pending: season.pending.filter((id) => ids.has(id)) };
}

// Returns cupSeasonTable's rows for the clubs in `meets`' osakilpailut, and in
// `series` when any is chosen. A row keeps its national rank.
function cupTableShown(rows, meets, series = []) {
  const ids = new Set(
    (meets || []).filter((m) => m?.kind === 'osa').flatMap((m) => (m.clubs || []).map((c) => String(c.id))),
  );
  return (rows || []).filter((r) => ids.has(String(r.id)) && (!series.length || series.includes(r.series)));
}

// Cuts a long table to its first `limit` rows and the rest's rows in `keep`, a
// set of club ids. `more` counts the rows left out.
function cupTableHead(rows, limit, keep = new Set()) {
  const shown = (rows || []).filter((r, i) => i < limit || keep.has(String(r.id)));
  return { rows: shown, more: (rows || []).length - shown.length };
}

// Returns the cup meets of every kind whose standings carry a club, in the
// meets' order. `clubs` is the standings' length, and `boxes` groups the club's
// rows back into cupBreakdown's boxes, as the record keeps their order.
function cupSeasonClub(meets, clubId) {
  const id = String(clubId);
  return (meets || []).flatMap((m) => {
    const c = (m?.clubs || []).find((x) => String(x.id) === id);
    if (!c) return [];
    const boxes = [];
    for (const r of (m.rows || []).filter((x) => String(x.club) === id)) {
      const last = boxes[boxes.length - 1];
      const box =
        last && last.event === r.event && last.group === r.group
          ? last
          : boxes[boxes.push({ group: r.group, event: r.event, field: r.field, entries: [] }) - 1];
      box.entries.push({ name: r.name, licence: r.licence, result: r.result, place: r.place, points: r.points });
    }
    return [
      {
        id: m.id,
        name: m.name,
        date: m.date,
        kind: m.kind,
        rank: c.rank,
        clubs: m.clubs.length,
        points: c.points,
        boxes,
      },
    ];
  });
}

// Returns the followed scorers of one `kind` of meet, 'osa' or 'final', by
// points then name. A box is a licence, or a club and name for a row with none.
// A row counts under a followed licence or a followed club (watchTargets).
function cupSeasonAthletes(meets, { licences = new Set(), clubIds = new Set() } = {}, kind) {
  const boxes = new Map();
  for (const meet of meets || []) {
    if (meet?.kind !== kind) continue;
    const clubNames = new Map((meet.clubs || []).map((c) => [String(c.id), c.name]));
    for (const r of meet.rows || []) {
      if (!(r.licence && licences.has(r.licence)) && !clubIds.has(r.club)) continue;
      const key = r.licence || `${r.club}|${r.name}`;
      if (!boxes.has(key))
        boxes.set(key, { key, name: r.name, club: clubNames.get(String(r.club)) || '', points: 0, lines: [] });
      const box = boxes.get(key);
      box.points += r.points;
      box.lines.push({
        id: meet.id,
        name: meet.name,
        date: meet.date,
        event: r.event,
        group: r.group,
        place: r.place,
        field: r.field,
        result: r.result,
        points: r.points,
      });
    }
  }
  return [...boxes.values()]
    .map((b) => ({
      ...b,
      lines: b.lines.sort((x, y) => String(x.date).localeCompare(String(y.date)) || y.points - x.points),
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'fi'));
}

// Returns the clubs a cup table tints, the followed ones and those a followed
// licence scored for in `meets`' rows (watchTargets' shape).
function cupFollowedClubs(meets, { licences = new Set(), clubIds = new Set() } = {}) {
  const rows = (meets || []).flatMap((m) => m?.rows || []);
  return new Set([...clubIds, ...rows.filter((r) => r.licence && licences.has(r.licence)).map((r) => String(r.club))]);
}

export {
  cupBody,
  cupBreakdown,
  cupDefaultTab,
  cupDetail,
  cupFinalLadder,
  cupFinalMax,
  cupFinalOrganisers,
  cupFinalOver,
  cupFinalRoundRows,
  cupFinalRoundScores,
  cupFinalSeries,
  cupFinalStandings,
  cupFinalTables,
  cupFinals,
  cupFollowedClubs,
  cupMeetRound,
  cupMode,
  cupScoringKey,
  cupSeasonAthletes,
  cupSeasonClub,
  cupSeasonHref,
  cupSeasonMeets,
  cupSeasonPiirit,
  cupSeasonRecord,
  cupSeasonRows,
  cupSeasonScope,
  cupSeasonTable,
  cupSeries,
  cupStandings,
  cupTableHead,
  cupTableShown,
  isCupMeet,
};
