import { MASTERS_MIN_AGE, startAge } from './ages.js';
import { tsKey } from './dates.js';
import { heatsAreShared, mergeHeats, qualBadge, relayInfo, roundAllocated, roundFieldSize } from './results.js';

// --- Event names and classes ---

// Matches a classification token that ends an event name, such as T54 or Avoin.
const CLS_RE = /^([TF]\d+(?:-\d+)?|Avoin|E)$/;
const RELAY_FORMULA_RE = /^\d+\s*[x×*]\s*\d/i;
// Matches a name that opens on a relay word, as a shuttle relay's can.
const RELAY_WORD_RE = /^\p{L}*(?:viesti|stafett)/iu;
const classlessName = (name) => RELAY_FORMULA_RE.test(name) || RELAY_WORD_RE.test(name);

// Says whether a start's name names no class. Its Age is then the filing's,
// and a relay of several youth classes is filed as the adult men
// (docs/tuloslista-api.md).
const classlessStart = (start) => Boolean(start?.EventName) && !parseEventName(start.EventName).sex;

// Files a classless start under the meet's oldest named youth class, so a chip
// and a cover count its medals once. Any other start comes back as it is.
const youthTops = new WeakMap();
function filedStart(start, schedule) {
  if (!classlessStart(start) || !schedule || typeof schedule !== 'object') return start;
  if (!youthTops.has(schedule)) {
    const ages = Object.values(schedule)
      .flat()
      .filter((r) => !classlessStart(r))
      .map(startAge)
      .filter((a) => a > 0 && a < MASTERS_MIN_AGE);
    youthTops.set(schedule, ages.length ? Math.max(...ages) : null);
  }
  const top = youthTops.get(schedule);
  return top == null ? start : { ...start, Age: String(top) };
}

// Splits "M19 200m kelaus T54" into sex "M19", event "200m kelaus" and cls
// "T54", and label joins sex and cls. "M16 Moukari" has no cls.
function parseEventName(name) {
  const tokens = String(name || '')
    .trim()
    .split(/\s+/);
  // A name opening on a relay formula or word names no class ("6x200m viesti").
  let sex = classlessName(tokens.join(' ')) ? '' : tokens.shift() || '';
  // "Mixed 15" and "Mixed15" both occur in one competition.
  const mixed = /^Mixed(\d+)$/i.exec(sex);
  if (mixed) sex = `Mixed ${mixed[1]}`;
  else if (/^Mixed$/i.test(sex) && /^\d+$/.test(tokens[0] || '')) sex = `Mixed ${tokens.shift()}`;
  const clsTokens = [];
  while (tokens.length > 1 && CLS_RE.test(tokens[tokens.length - 1])) {
    clsTokens.unshift(tokens.pop());
  }
  const event = tokens.join(' ');
  const cls = clsTokens.join(' ');
  return { sex, event, cls, label: [sex, cls].filter(Boolean).join(' ') };
}

// Matches a class label's sex and age.
const CATEGORY_RE = /^(Mixed|[MNPT])\s*(\d+)?(?:\s|$)/;

// Returns a label's place in class order: youth by age, adults, masters by age,
// then the unrecognized. At one age M and P lead N and T, then Mixed.
function categoryParts(label) {
  const m = CATEGORY_RE.exec(String(label || '').trim());
  if (!m) return { bucket: 4, age: 0, sex: 3 };
  const age = m[2] ? Number(m[2]) : null;
  const sex = m[1] === 'Mixed' ? 2 : 'MP'.includes(m[1]) ? 0 : 1;
  if (age == null) return { bucket: 2, age: 0, sex };
  return { bucket: age < MASTERS_MIN_AGE ? 1 : 3, age, sex };
}

function compareCategories(a, b) {
  const pa = categoryParts(a);
  const pb = categoryParts(b);
  return pa.bucket - pb.bucket || pa.age - pb.age || pa.sex - pb.sex || String(a).localeCompare(String(b), 'fi');
}

// Returns a row's class age, 0 for yleinen, from a name that names a class, as
// Age can be the group's (docs/tuloslista-api.md). Otherwise it is the filed
// Age (filedStart).
function rowClassAge(row, schedule = null) {
  const parts = categoryParts(parseEventName(row?.EventName).sex);
  return parts.bucket !== 4 ? parts.age : startAge(filedStart(row, schedule));
}

// --- A round's status ---

const STATUS_ORDER = { Unallocated: 0, Allocated: 1, Progress: 2, Official: 3 };
const STATUS_BY_ORDER = ['Unallocated', 'Allocated', 'Progress', 'Official'];
const STATUS_FI = {
  Unallocated: 'Eräjaot puuttuvat',
  Allocated: 'Eräjaot tehty',
  Progress: 'Käynnissä',
  Official: 'Tulokset valmiit',
};

// A heat has two states, worded apart from STATUS_FI (heatChip, app/event.js),
// since a round's four statuses say nothing about one heat.
const HEAT_STATUS_FI = {
  done: 'Tulokset',
  pending: 'Ei vielä tuloksia',
};

// Returns the further along of two statuses. An unknown string never wins.
function betterStatus(a, b) {
  return (STATUS_ORDER[b] ?? -1) > (STATUS_ORDER[a] ?? -1) ? b : a;
}

// Returns the least advanced status, and unknown counts as Unallocated. A start
// is unfinished while a class is unrun. groupStatuses splits the chips.
function leastStatus(statuses) {
  const list = [...(statuses || [])];
  if (!list.length) return 'Unallocated';
  return STATUS_BY_ORDER[list.reduce((s, st) => Math.min(s, STATUS_ORDER[st] ?? 0), 3)];
}

// Takes the further along of the schedule's and the results copy of each
// round's Status, as the results copy goes stale (docs/tuloslista-api.md). It
// runs at the fetch (eventStoreFor, app/data.js), so every reader of Status
// gets it.
function reconcileStatuses(data, statusById) {
  const rounds = (data?.Rounds || []).map((r) => {
    const best = betterStatus(r.Status, statusById?.get(r.Id));
    return best === r.Status ? r : { ...r, Status: best };
  });
  return { ...data, Rounds: rounds };
}

// Maps each round id to the schedule's status over every day, since an event's
// rounds can sit on different days.
function scheduleStatuses(schedule) {
  const byId = new Map();
  for (const rounds of Object.values(schedule || {})) {
    if (!Array.isArray(rounds)) continue;
    for (const r of rounds) byId.set(r.Id, r.Status);
  }
  return byId;
}

// Returns Official once every leg is and Progress once any has begun, and the
// least advanced before. leastStatus alone reads a live contest as unallocated.
function combinedEventStatus(statuses) {
  const list = [...(statuses || [])];
  if (list.length && list.every((s) => s === 'Official')) return 'Official';
  if (list.some((s) => (STATUS_ORDER[s] ?? 0) >= STATUS_ORDER.Progress)) return 'Progress';
  return leastStatus(list);
}

// Returns a meet's phase over the rows somebody entered, as an empty class sits
// at Unallocated for good. CountEnrolled reads 0 on entered rows, so the
// results fan-out decides, and a 404 counts as none (docs/tuloslista-api.md).
function meetPhase(schedule, eventResults) {
  const byEvent = new Map((eventResults || []).map(({ eventId, data }) => [String(eventId), data]));
  const entered = [];
  for (const rows of Object.values(schedule || {})) {
    for (const row of rows || []) {
      const data = byEvent.get(String(row.EventId));
      const round = (data?.Rounds || []).find((r) => r.Id === row.Id) || null;
      if (hasEntrants(round, data?.Enrollments)) entered.push(row.Status);
    }
  }
  return combinedEventStatus(entered);
}

// --- Starts: the rounds that share a time and an event name ---

// Juoksut mode's schedule shows the track by default (docs/juoksut.md).
const RUN_CATEGORIES = ['Track', 'Relay'];

// Writes a start's time in UTC in the API's form, so that every row of one
// start gives one key: one start's rows can write its instant under two
// offsets (docs/tuloslista-api.md). A time with no offset stays as it is, as
// its instant would depend on the reader's zone.
function startTs(ts) {
  const t = /(?:[+-]\d\d:\d\d|Z)$/.test(String(ts)) ? tsKey(ts) : Infinity;
  return Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 19)}.0000000+00:00` : ts;
}

// Temporary: rewrites a start's key written under its row's own offset into
// groupRounds' form (docs/shims.md).
function startKeyOf(key) {
  const bar = String(key).indexOf('|');
  return bar > 0 ? `${startTs(key.slice(0, bar))}${key.slice(bar)}` : key;
}

// Returns the start a /g/ key names (groupRounds). The second find is a
// temporary shim for a key written under its row's own offset, and the third
// for a relay link whose key leaves out the relay's formula or word
// (docs/shims.md).
function groupForKey(groups, key) {
  return (
    (groups || []).find((g) => g.key === key) ||
    (groups || []).find((g) => g.key === startKeyOf(key)) ||
    (groups || []).find((g) => classlessName(g.event) && `${g.ts}|${g.event.split(' ').slice(1).join(' ')}` === key) ||
    null
  );
}

// Groups rounds sharing a start time and event name into one start, over Track,
// Field and Relay. `category` narrows to one or more API Categories.
function groupRounds(rounds, category = null) {
  const wanted = category == null ? null : Array.isArray(category) ? category : [category];
  const map = new Map();
  for (const r of rounds) {
    if (wanted && !wanted.includes(r.Category)) continue;
    const p = parseEventName(r.EventName);
    const key = `${startTs(r.BeginDateTimeWithTZ)}|${p.event}`;
    if (!map.has(key)) {
      map.set(key, { key, ts: r.BeginDateTimeWithTZ, event: p.event, category: r.Category, entries: [] });
    }
    map.get(key).entries.push({ round: r, ...p });
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.entries.sort((a, b) => compareCategories(a.label, b.label));
    // The round's name, such as Alkuerät, holds only where the classes agree.
    const names = [...new Set(g.entries.map((e) => e.round.Name).filter(Boolean))];
    g.roundName = names.length === 1 ? names[0] : null;
    g.status = leastStatus(g.entries.map((e) => e.round.Status));
  }
  // Starts sort by the instant (tsKey), as a meet's rows can mix UTC offsets.
  groups.sort((a, b) => tsKey(a.ts) - tsKey(b.ts) || a.event.localeCompare(b.event, 'fi'));
  return groups;
}

// Groups one start's classes by status, one chip each, in the entries' order. A
// single least status would let an empty class hide a finished one's phase.
function groupStatuses(entries) {
  const byStatus = new Map();
  for (const e of entries || []) {
    const status = e.round?.Status || 'Unallocated';
    if (!byStatus.has(status)) byStatus.set(status, { status, labels: [] });
    byStatus.get(status).labels.push(e.label);
  }
  return [...byStatus.values()];
}

// Says whether a start has been run, which one Official class settles. A class
// nobody entered rests at Allocated beside the ones that ran, so a start
// waiting on every class never ends (docs/tuloslista-api.md).
function startFinished(entries) {
  return (entries || []).some((e) => e.round?.Status === 'Official');
}

// Builds groupRounds' key for one schedule round, which must match groupRounds'
// own exactly.
function roundGroupKey(round) {
  return `${startTs(round.BeginDateTimeWithTZ)}|${parseEventName(round.EventName).event}`;
}

// --- A class's field and counts ---

// Counts a start's size per class (docs/views.md). Enrollments is event-wide,
// so it is the field only where no round precedes. Shared heats count over the
// merge, so one race is not two erät, and an undrawn class keeps its row.
function startCounts(detailed) {
  const rows = (detailed || []).map((d) => {
    const relay = relayInfo(d.data).relay;
    if (d.missing) return { label: d.label, relay, entered: false, missing: true, heats: null, field: null };
    if (roundAllocated(d.round)) {
      return {
        label: d.label,
        relay,
        entered: false,
        heats: (d.round.Heats || []).filter((h) => h.Allocations?.length).length,
        field: roundFieldSize(d.round),
      };
    }
    const earlier = previousRoundField(d.data?.Rounds, d.round);
    const entries = d.data && !hasEarlierRound(d.data.Rounds, d.round) ? d.data.Enrollments : null;
    const field = earlier || entries;
    const entered = !!entries && !earlier;
    return {
      label: d.label,
      relay,
      entered,
      confirmed: entered ? entries.filter((e) => e?.Confirmed).length : 0,
      heats: null,
      field: field ? field.length : null,
    };
  });
  const merged = mergeHeats(detailed || []);
  if (!heatsAreShared(merged)) return rows;
  const heats = merged.filter((h) => h.rows.length);
  return [
    {
      label: null,
      relay: rows.some((r) => r.relay),
      entered: false,
      heats: heats.length,
      field: heats.reduce((n, h) => n + h.rows.length, 0),
    },
    ...rows.filter((r) => r.heats == null),
  ];
}

// Writes a count as a .row-sub line. An empty field gets words, since nothing
// else tells a class nobody entered from one to come (docs/tuloslista-api.md).
// A class whose document answers 404 claims no field. With nobody confirmed
// the entry count stands, as in most meets (confirmNote).
function countLine(c) {
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  if (c?.missing) return 'Ei tietoja';
  if (c?.field === 0) return 'Ei ilmoittautuneita';
  return [
    c?.heats ? n(c.heats, 'erä', 'erää') : null,
    c?.field == null
      ? null
      : c.relay
        ? n(c.field, 'joukkue', 'joukkuetta')
        : c.entered
          ? c.confirmed
            ? `${c.confirmed}/${c.field} varmistanutta`
            : n(c.field, 'ilmoittautunut', 'ilmoittautunutta')
          : n(c.field, 'osallistuja', 'osallistujaa'),
  ]
    .filter(Boolean)
    .join(' · ');
}

// Says whether anybody is in a class, from its heats once drawn and from
// Enrollments before. An empty class keeps its heading and chip.
function hasEntrants(round, enrollments) {
  if (roundAllocated(round)) return true;
  return (enrollments || []).length > 0;
}

// Picks the ranked list once every drawn round is Official, and the heats
// before. Only drawn rounds count, as an empty class stays Unallocated
// (docs/tuloslista-api.md). With medals on offer (renderGroup) they come first.
function defaultResultView(rounds, medals = false) {
  const withHeats = (rounds || []).filter(roundAllocated);
  if (!withHeats.length || !withHeats.every((r) => r.Status === 'Official')) return 'heats';
  return medals ? 'medals' : 'total';
}

// Returns the nearest earlier round with a drawn field, skipping an undrawn
// stage between. A heat shell is not a field (roundAllocated).
function previousRound(rounds, round) {
  if (round?.Index == null) return null;
  return (
    (rounds || []).filter((r) => r.Index < round.Index && roundAllocated(r)).sort((a, b) => b.Index - a.Index)[0] ||
    null
  );
}

// Returns an undrawn round's field from the nearest drawn round, its qualifiers
// once Official, or null. Enrollments overstates it (docs/views.md).
function previousRoundField(rounds, round) {
  const prev = previousRound(rounds, round);
  if (!prev) return null;
  const allocs = prev.Heats.flatMap((h) => h.Allocations || []);
  if (prev.Status === 'Official') {
    // qualBadge decides, so a tied qualifier the API left out is in the field.
    const qualifiers = allocs.filter((a) => qualBadge(a, prev));
    if (qualifiers.length) return qualifiers;
  }
  return allocs;
}

// Says whether an undrawn round's field can still change. It can where an
// earlier round exists and none is drawn, where the source round is short of
// Official or made no cut, or where an earlier stage is unrun (docs/views.md).
// With nothing earlier it cannot.
function fieldMayChange(rounds, round) {
  const prev = previousRound(rounds, round);
  if (!prev) return hasEarlierRound(rounds, round);
  const cutMade =
    prev.Status === 'Official' && prev.Heats.flatMap((h) => h.Allocations || []).some((a) => a.QRank || a.QResult);
  if (!cutMade) return true;
  return (rounds || []).some((r) => r.Index < round.Index && r.Status !== 'Official');
}

// Says whether any round precedes this one, drawn or not, so app/event.js's
// notice tells no earlier round from one not yet drawn.
function hasEarlierRound(rounds, round) {
  if (round?.Index == null) return false;
  return (rounds || []).some((r) => r.Index < round.Index);
}

// --- Loading a start's events ---

const API = 'https://cached-public-api.tuloslista.com/live/v1';

// Holds one document per EventId, as /results/{comp}/{eventId} carries every
// round of an event (docs/tuloslista-api.md). It caches the promise, or a
// concurrent caller fetches again. get() never rejects.
function eventStore(load) {
  const docs = new Map();
  return {
    get(eventId) {
      if (!docs.has(eventId)) {
        docs.set(
          eventId,
          load(eventId).then(
            (data) => ({ data, error: null }),
            (error) => ({ data: null, error }),
          ),
        );
      }
      return docs.get(eventId);
    },
  };
}

// Returns one scheduled round's detail out of its event's document, picking the
// round by Id and never by name (docs/tuloslista-api.md). `missing` is
// Tuloslista's 404 for a class nobody entered. Any other error means this fetch
// got no answer, and the two read differently.
function roundDetail(entry, doc) {
  const round = doc?.data ? (doc.data.Rounds || []).find((r) => r.Id === entry.round.Id) || null : null;
  return { ...entry, schedRound: entry.round, data: doc?.data || null, round, missing: doc?.error?.status === 404 };
}

// Returns a start's class entries, each read from the store's copy of its event.
function roundDetails(entries, store) {
  return Promise.all(entries.map(async (e) => roundDetail(e, await store.get(e.round.EventId))));
}

export {
  API,
  HEAT_STATUS_FI,
  RUN_CATEGORIES,
  STATUS_FI,
  STATUS_ORDER,
  betterStatus,
  categoryParts,
  classlessStart,
  combinedEventStatus,
  compareCategories,
  countLine,
  defaultResultView,
  eventStore,
  fieldMayChange,
  filedStart,
  groupForKey,
  groupRounds,
  groupStatuses,
  hasEarlierRound,
  hasEntrants,
  leastStatus,
  meetPhase,
  parseEventName,
  previousRound,
  previousRoundField,
  reconcileStatuses,
  roundDetail,
  roundDetails,
  roundGroupKey,
  rowClassAge,
  scheduleStatuses,
  startCounts,
  startFinished,
  startKeyOf,
};
