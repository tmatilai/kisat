import { isoDay } from './dates.js';
import { digestPeople } from './digest.js';

// --- Club index ---------------------------------------------------------

// Every club a roster build has seen stays with no TTL, so a follow-list can
// be made with no meet open (docs/backend.md, "The club index").
const ORG_INDEX_VERSION = 1;

// Organization.Id 0 is "no club" for every unaffiliated entry
// (docs/tuloslista-api.md). It is never a follow target, but it can show.
const isFollowableOrgId = (id) => id != null && String(id) !== '' && String(id) !== '0';

// Returns {index, changed}. changed is false if nothing differs, and then
// worker.js skips the write (docs/backend.md). A later name wins.
function mergeOrgIndex(index, organizations) {
  const rows = new Map(
    (index?.v === ORG_INDEX_VERSION ? index.orgs || [] : []).map((o) => [
      String(o[0]),
      [String(o[0]), o[1] || '', o[2] || ''],
    ]),
  );
  let changed = false;
  for (const o of organizations || []) {
    if (!isFollowableOrgId(o?.id)) continue;
    const id = String(o.id);
    // A club with neither name is not indexed. The picker titles rows with
    // the full name, so nameShort stands in only where it is missing.
    const name = o.name || o.nameShort || '';
    if (!name) continue;
    const nameShort = o.nameShort || '';
    const prev = rows.get(id);
    if (prev && prev[1] === name && prev[2] === nameShort) continue;
    rows.set(id, [id, name, nameShort]);
    changed = true;
  }
  return {
    index: { v: ORG_INDEX_VERSION, orgs: [...rows.values()].sort((a, b) => a[1].localeCompare(b[1], 'fi')) },
    changed,
  };
}

// Returns the index as the picker's rows {id, name, nameShort}. Another
// version reads as empty, and the next roster build starts it afresh.
function orgIndexClubs(index) {
  if (index?.v !== ORG_INDEX_VERSION) return [];
  return (index.orgs || []).map(([id, name, nameShort]) => ({ id, name, nameShort }));
}

// --- Meet index ---------------------------------------------------------

// The meet index holds every meet the listing or the crawler found, so home's
// search reaches past the listing's month (docs/backend.md). Rows are [id,
// name, date, location, organizationName], with a sixth field where the meet's
// entries are closed (meetIndexClosed), newest first. Another version reads as
// empty.
const MEET_INDEX_VERSION = 1;

// No id below this answers (docs/tuloslista-api.md, "The listing").
const MEET_CRAWL_FLOOR = 16460;
// The meet at the floor is in this year, so no season before it is indexed.
const SEASON_FIRST_YEAR = 2025;

// Returns this year and last, the years a season is read for and the meet and
// athlete indexes keep. Neither is before SEASON_FIRST_YEAR.
function seasonYears(todayIso) {
  const year = Number(String(todayIso).slice(0, 4));
  return [year, year - 1].filter((y) => y >= SEASON_FIRST_YEAR);
}
function seasonYearOk(year, todayIso) {
  return /^\d{4}$/.test(String(year)) && seasonYears(todayIso).includes(Number(year));
}

function meetIndexOf(index) {
  return index?.v === MEET_INDEX_VERSION ? index : { v: MEET_INDEX_VERSION, meets: [] };
}

function sortMeetRows(rows) {
  return rows.sort((a, b) => (b[2] || '').localeCompare(a[2] || '') || Number(b[0]) - Number(a[0]));
}

// /properties has no venue and no last day (docs/tuloslista-api.md).
function propertiesMeetRow(props) {
  const c = props?.Competition;
  if (!c?.Name) return null;
  return { name: c.Name, location: '', organizationName: c.Organization || '', date: isoDay(c.BeginDate), days: [] };
}

// Returns {index, changed} over meets {id, name, date, location,
// organizationName}. A later value wins, and a nameless meet is skipped. The
// index keeps only seasonYears' two seasons, old rows and new alike.
function mergeMeetIndex(index, meets, { todayIso }) {
  const keep = seasonYears(todayIso);
  const inSeason = (date) => keep.includes(Number(String(date).slice(0, 4)));
  const base = meetIndexOf(index);
  const rows = new Map();
  let changed = index?.v !== MEET_INDEX_VERSION;
  for (const r of base.meets || []) {
    if (!inSeason(r[2])) {
      changed = true;
      continue;
    }
    rows.set(String(r[0]), r);
  }
  for (const m of meets || []) {
    if (m?.id == null || !m.name || !inSeason(m.date)) continue;
    const row = [String(m.id), m.name, m.date || '', m.location || '', m.organizationName || ''];
    const prev = rows.get(row[0]);
    if (prev && row.every((v, i) => v === prev[i])) continue;
    rows.set(row[0], prev?.[5] ? [...row, prev[5]] : row);
    changed = true;
  }
  return { index: { ...base, meets: sortMeetRows([...rows.values()]) }, changed };
}

// Returns {index, changed} with a row's sixth field set to the pair its meet's
// entries are closed to (closedPair). `pairs` holds [id, pair | null] from the
// medal season records, and null takes the field off.
function meetIndexClosed(index, pairs) {
  const base = meetIndexOf(index);
  const byId = new Map((pairs || []).map(([id, pair]) => [String(id), pair]));
  let changed = false;
  const meets = base.meets.map((row) => {
    if (!byId.has(row[0])) return row;
    const pair = byId.get(row[0]);
    if (JSON.stringify(pair ?? null) === JSON.stringify(row[5] ?? null)) return row;
    changed = true;
    return pair ? [...row.slice(0, 5), pair] : row.slice(0, 5);
  });
  return { index: { ...base, meets }, changed };
}

// Returns the listing's rows as mergeMeetIndex takes them.
function listingMeets(listing) {
  return (listing || []).map((c) => ({
    id: c.Id,
    name: c.Name || '',
    date: isoDay(c.Date),
    location: c.Location || '',
    organizationName: c.OrganizationName || '',
  }));
}

// Returns the index as objects, in the shape /api/meets serves.
function meetIndexMeets(index) {
  return meetIndexOf(index).meets.map(([id, name, date, location, organizationName, closed]) => ({
    id,
    name,
    date,
    location,
    organizationName,
    ...(closed ? { closed } : {}),
  }));
}

// Plans the ids the next run asks /properties about, from the last stop or
// `top` down to the floor past indexed ids, and none once the backfill is done.
function meetCrawlPlan(index, { top, budget, floor = MEET_CRAWL_FLOOR }) {
  const base = meetIndexOf(index);
  let next = base.crawl?.next ?? top;
  if (base.crawl?.done || next == null) return { ids: [], next: null };
  const known = new Set(base.meets.map((r) => r[0]));
  const ids = [];
  for (; next >= floor && ids.length < budget; next--) {
    if (!known.has(String(next))) ids.push(next);
  }
  return { ids, next };
}

// Says whether a run stops at an answer other than a meet or a 404, so a
// throttled id is asked again next run. `status` 0 is a network error.
function meetCrawlStops(status) {
  return status !== 404 && !(status >= 200 && status < 300);
}

// Returns the index after a run. `answers` are {id, status, props} in the
// order asked, up to the one that stopped it. A meet is kept only once it is
// over, as one ahead of the listing may be unpublished.
function meetCrawlApply(index, plan, answers, { todayIso, floor = MEET_CRAWL_FLOOR }) {
  let base = meetIndexOf(index);
  if (plan.next == null) return { index: base, changed: false };
  const failed = answers.find((a) => meetCrawlStops(a.status));
  const found = answers
    .filter((a) => a.status >= 200 && a.status < 300)
    .map((a) => {
      const row = propertiesMeetRow(a.props);
      return row && row.date && row.date < todayIso ? { ...row, id: a.id } : null;
    })
    .filter(Boolean);
  base = mergeMeetIndex(base, found, { todayIso }).index;
  const next = failed ? failed.id : plan.next;
  return { index: { ...base, crawl: next < floor ? { done: true } : { next } }, changed: true };
}

// Returns listing-shaped rows for home's search of the meets the listing lacks.
function archivedListingRows(listing, meets) {
  const listed = new Set((listing || []).map((c) => String(c.Id)));
  return (meets || [])
    .filter((m) => !listed.has(String(m.id)))
    .map((m) => ({
      Id: m.id,
      Name: m.name,
      Date: m.date,
      Location: m.location,
      OrganizationName: m.organizationName,
    }));
}

// --- Athlete index ------------------------------------------------------

// Every licensed athlete a roster build has seen is indexed, so a person can
// be followed with no meet open. A row [licenseId, organizationId, name, year]
// sorts by name and lives while seasonYears names its year (docs/backend.md).
const ATHLETE_INDEX_VERSION = 1;

// Tens of thousands of names are ordered on one merge, where localeCompare
// rebuilds its collator per comparison.
const FI_NAMES = new Intl.Collator('fi');

function athleteIndexOf(index) {
  return index?.v === ATHLETE_INDEX_VERSION ? index : { v: ATHLETE_INDEX_VERSION, athletes: [] };
}

// Returns {index, changed}. changed is false if nothing differs, and then
// worker.js skips the write. A licence has one row, from its latest season's
// meet. `year` is the meet's own, and a meet outside seasonYears adds nobody.
function mergeAthleteIndex(index, people, { year, todayIso }) {
  const keep = seasonYears(todayIso);
  const base = athleteIndexOf(index);
  const rows = new Map();
  let changed = index?.v !== ATHLETE_INDEX_VERSION;
  for (const row of base.athletes || []) {
    if (!keep.includes(Number(row[3]))) {
      changed = true;
      continue;
    }
    rows.set(String(row[0]), row);
  }
  if (keep.includes(Number(year))) {
    for (const p of people || []) {
      if (!p?.licenseId || !p.name) continue;
      const row = [String(p.licenseId), String(p.organizationId ?? ''), p.name, Number(year)];
      const prev = rows.get(row[0]);
      if (prev && (Number(prev[3]) > row[3] || row.every((v, i) => v === prev[i]))) continue;
      rows.set(row[0], row);
      changed = true;
    }
  }
  if (!changed) return { index: base, changed };
  // The spread keeps the backfill's cursor, so a merge never restarts the
  // walk.
  return {
    index: {
      ...base,
      athletes: [...rows.values()].sort((a, b) => FI_NAMES.compare(a[2], b[2]) || a[0].localeCompare(b[0])),
    },
    changed,
  };
}

// Returns the KV cursor of the backfill, which fills the index from the stored
// digests of every meet a roster build reached (docs/backend.md). It is '' at
// the start and null once the KV listing of the digests is done, and it is kept
// on the index.
function athleteBackfillCursor(index) {
  const base = athleteIndexOf(index);
  return base.backfill?.done ? null : (base.backfill?.cursor ?? '');
}

// Returns the index with the cursor moved, where null marks the backfill done.
// Another version reads as a fresh index here too, so a version bump refills
// itself (docs/backend.md).
function athleteBackfillAt(index, cursor) {
  const base = athleteIndexOf(index);
  return { ...base, backfill: cursor == null ? { done: true } : { cursor } };
}

// Returns one digest's people under the meet's year, read from its last day
// (buildDigest). It returns none outside seasonYears, which the merge drops.
function digestSeasonPeople(digest, todayIso) {
  const year = Number(
    String((digest?.days || []).at(-1) || '')
      .split('.')
      .pop(),
  );
  return { year, people: seasonYears(todayIso).includes(year) ? digestPeople(digest) : [] };
}

export {
  ATHLETE_INDEX_VERSION,
  MEET_CRAWL_FLOOR,
  MEET_INDEX_VERSION,
  ORG_INDEX_VERSION,
  SEASON_FIRST_YEAR,
  archivedListingRows,
  athleteBackfillAt,
  athleteBackfillCursor,
  athleteIndexOf,
  digestSeasonPeople,
  isFollowableOrgId,
  listingMeets,
  meetCrawlApply,
  meetCrawlPlan,
  meetCrawlStops,
  meetIndexClosed,
  meetIndexMeets,
  mergeAthleteIndex,
  mergeMeetIndex,
  mergeOrgIndex,
  orgIndexClubs,
  propertiesMeetRow,
  seasonYearOk,
  seasonYears,
};
