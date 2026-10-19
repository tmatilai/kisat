import { athleteIndexOf } from './indexes.js';

// --- The picker's search (GET /api/search, worker.js) -------------------

// A query needs two characters, so that a one-letter query does not list
// everybody.
const SEARCH_MIN_CHARS = 2;
const SEARCH_CLUB_LIMIT = 15;
const SEARCH_ATHLETE_LIMIT = 25;

// Returns the query lowercased, or '' where it is too short.
function searchQuery(query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  return q.length >= SEARCH_MIN_CHARS ? q : '';
}

// Ranks where a query lands in a name: 1 where a word starts with it, 2 where
// it is only inside a word, and 0 where it is not in the name
// (docs/backend.md).
function searchRank(text, q) {
  let rank = 0;
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1])) return 1;
    rank = 2;
  }
  return rank;
}

// Returns the rows a query names, word-prefix matches first and each kind in
// the caller's order. Both indexes sort by name, so one pass over either is in
// order. `text` gives a row's searched text.
function searchRows(rows, q, limit, text) {
  const first = [];
  const rest = [];
  for (const row of rows || []) {
    const rank = searchRank(text(row), q);
    if (rank === 1) first.push(row);
    else if (rank === 2 && rest.length < limit) rest.push(row);
    if (first.length >= limit) break;
  }
  return [...first, ...rest].slice(0, limit);
}

// Finds clubs by name or short name, over orgIndexClubs' rows or a demo
// roster's organizations.
function searchClubs(clubs, query, limit = SEARCH_CLUB_LIMIT) {
  const q = searchQuery(query);
  if (!q) return [];
  return searchRows(clubs, q, limit, (c) => `${c.name} ${c.nameShort || ''}`.toLowerCase());
}

// Finds people by name, over rosterPeople's or digestPeople's rows.
function searchPeople(people, query, limit = SEARCH_ATHLETE_LIMIT) {
  const q = searchQuery(query);
  if (!q) return [];
  return searchRows(people, q, limit, (p) => String(p.name || '').toLowerCase());
}

// Finds people in the index itself, which stores rows and not objects.
function searchAthleteIndex(index, query, limit = SEARCH_ATHLETE_LIMIT) {
  const q = searchQuery(query);
  if (!q) return [];
  return searchRows(athleteIndexOf(index).athletes, q, limit, (r) => String(r[2]).toLowerCase()).map(
    ([licenseId, organizationId, name]) => ({ licenseId, organizationId, name }),
  );
}

// Puts the open meet's own rows ahead of the index's, one row per id.
function mergeSearchRows(scoped, indexed, idOf, limit) {
  const seen = new Set();
  const out = [];
  for (const row of [...scoped, ...indexed]) {
    const id = String(idOf(row));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

// Builds GET /api/search's body, the open meet's own `scoped` {clubs, people}
// ahead of the indexes'. A person's row names the club, since the picker has
// no club list of its own.
function searchBody(scoped, indexClubs, athleteIndex, query) {
  const clubs = mergeSearchRows(
    searchClubs(scoped.clubs, query),
    searchClubs(indexClubs, query),
    (c) => c.id,
    SEARCH_CLUB_LIMIT,
  );
  const clubNames = new Map([...indexClubs, ...scoped.clubs].map((c) => [String(c.id), c.name]));
  const athletes = mergeSearchRows(
    searchPeople(scoped.people, query),
    searchAthleteIndex(athleteIndex, query),
    (p) => p.licenseId,
    SEARCH_ATHLETE_LIMIT,
  ).map((p) => ({ ...p, club: clubNames.get(String(p.organizationId)) || '' }));
  return { clubs, athletes };
}

export {
  SEARCH_ATHLETE_LIMIT,
  SEARCH_CLUB_LIMIT,
  SEARCH_MIN_CHARS,
  mergeSearchRows,
  searchAthleteIndex,
  searchBody,
  searchClubs,
  searchPeople,
  searchQuery,
};
