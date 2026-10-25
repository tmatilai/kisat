import { tickedScopes } from '../lib/districts.js';
import { ALONE_ID_RE, elsewhereRow, graftApplies, officialUrl, olProperties, olSchedule } from '../lib/elsewhere.js';
import { normalizeRenderLog } from '../lib/render-log.js';
import { compViewSetMode, compViewState, compViewUpdate, isDemoId } from '../lib/routes.js';
import {
  API,
  eventStore,
  groupForKey,
  groupRounds,
  reconcileStatuses,
  roundDetails,
  scheduleStatuses,
} from '../lib/schedule.js';
import { focusTargets, watchRegistryAdd, watchRegistryRemove, watchTargets } from '../lib/watch.js';
import { SITE_MODE } from './shell.js';

// --- Fetching ---

// Holds the cost record of the render in progress. fetchJson counts each
// request into it (docs/architecture.md, "What a render cost").
let renderCost = null;
function setRenderCost(cost) {
  renderCost = cost;
}

// Holds demo.js, which renderRoute loads before a demo meet's first view. No
// other page fetches it (isDemoId).
let demo = null;
async function loadDemo(compId) {
  if (isDemoId(compId)) demo ??= await import('../demo.js');
}

// Every same-origin /api/* call carries the x-kisat-client header. Without it
// the request gets a 403 (docs/backend.md).
async function fetchJson(url, opts = {}) {
  // A demo meet answers without the network (demoBody).
  const offline = demo?.demoBody(url);
  if (offline) return offline;
  const headers = { ...opts.headers };
  if (url.startsWith('/api/')) headers['x-kisat-client'] = '1';
  // The request counts toward the render that was current when it started,
  // even if a slow reply arrives after that render.
  const cost = renderCost;
  const startedAt = performance.now();
  let r;
  try {
    r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000), ...opts, headers });
  } finally {
    if (cost) {
      cost.fetches += 1;
      cost.fetchMs = Math.max(cost.fetchMs, performance.now() - startedAt);
    }
  }
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const err = new Error(body || `HTTP ${r.status} — ${url}`);
    // Callers act on the status and the URL. A 404 from tuloslista is an
    // answer, not a failure (roundDetail, meetGone, lib/schedule.js).
    err.status = r.status;
    err.url = url;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

// Swaps fetchJson for a stub. A probe in dev/ calls appJs.setFetchJson(stub)
// and puts the original back the same way, since assigning appJs.fetchJson
// changes nothing: every caller reads this module's binding.
function setFetchJson(stub) {
  fetchJson = stub;
}

// --- The browser's storage ---

// Holds the active list's record, as the view on screen fetched it. The add
// menu ticks only this list (addToWatchMenu). setActiveFollow drops it when the
// active list changes.
let activeWatchSeen = null;
async function loadActiveWatch(watchId) {
  activeWatchSeen = await fetchJson(`/api/watch/${watchId}`).catch(() => null);
  return activeWatchSeen;
}

// Gives the quick-filter's targets, or with none set the active Watch's, for
// a view that shows no filter chip (resolveFilter builds the chip's). A Watch
// or a club quick-filter matches through the roster. Without `withRoster`
// they match on the club ids and licences an entry stores.
async function followTargets(compId, state, withRoster = true) {
  const wantWatch = !state.focus && state.watchId;
  const wantRoster = withRoster && (wantWatch || state.focus?.kind === 'club');
  const [watch, roster] = await Promise.all([
    wantWatch ? loadActiveWatch(state.watchId) : null,
    wantRoster ? fetchJson(`/api/roster/${compId}`).catch(() => null) : null,
  ]);
  if (state.focus) return focusTargets(state.focus, roster);
  return watch && (roster || !withRoster) ? watchTargets(watch.entries, roster) : null;
}

function recentComps() {
  return readStore('kisatRecentComps') ?? [];
}

// The competition listing has no end date, so this keeps the days of the meets
// the device opened last. `range` is dateRange's display string, and `days` the
// schedule's day keys, ascending, which home's sort reads (docs/home.md).
function rememberComp(id, name, range, days) {
  const list = recentComps().filter((c) => c.id !== id);
  list.unshift({ id, name, range, days });
  writeStore('kisatRecentComps', list.slice(0, 5));
}

// A Watch's editToken is kept only in a browser that created the Watch or
// opened its edit link (docs/backend.md, "Watches"). Only a write can check a
// token, so a stored one may be wrong. A 403 drops it (forgetWatchEditToken).
function watchEditTokenKey(id) {
  return `kisatWatchEdit:${id}`;
}
function rememberWatchEditToken(id, editToken) {
  try {
    localStorage.setItem(watchEditTokenKey(id), editToken);
  } catch {
    /* Storage can be blocked or full. */
  }
}
function watchEditToken(id) {
  try {
    return localStorage.getItem(watchEditTokenKey(id));
  } catch {
    return null;
  }
}
function forgetWatchEditToken(id) {
  try {
    localStorage.removeItem(watchEditTokenKey(id));
  } catch {
    /* Storage can be blocked or full. */
  }
}

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be blocked or full. */
  }
}

function watchRegistry() {
  return readStore('kisatWatches') ?? [];
}
function watchLabel(watchId) {
  return watchId ? watchRegistry().find((w) => w.watchId === watchId)?.label || 'Seuranta' : null;
}
function registerWatch(watchId, label) {
  writeStore('kisatWatches', watchRegistryAdd(watchRegistry(), { watchId, label }));
}
// Keeps the editToken in its own key, so opening the list's link again
// restores editing.
function forgetWatch(watchId) {
  writeStore('kisatWatches', watchRegistryRemove(watchRegistry(), watchId));
  if (activeFollow() === watchId) setActiveFollow(null);
}

// The active Watch is the same on every view, home included, and is not kept
// per competition (docs/architecture.md, "View state").
function activeFollow() {
  const id = readStore('kisatFollow');
  return typeof id === 'string' && id ? id : null;
}
function setActiveFollow(watchId) {
  writeStore('kisatFollow', watchId);
  activeWatchSeen = null;
}
// Home, /mestaruudet and /seuracup keep their view state under this key.
const HOME_VIEW_KEY = '#home';

// The mode, focus and cats come from the meet's stored row, and the watchId
// always from activeFollow() (docs/architecture.md, "View state"). In Juoksut
// mode this is the one gate that turns follow-lists off (docs/juoksut.md).
function viewStateFor(compId) {
  const state = compViewState(readStore('kisatCompView'), compId, activeFollow());
  if (SITE_MODE === 'juoksut') return { ...state, watchId: null, focus: null };
  return { ...state, watchId: activeFollow() };
}
function updateViewState(compId, patch) {
  writeStore('kisatCompView', compViewUpdate(readStore('kisatCompView') ?? [], compId, patch, activeFollow()));
}
function setViewMode(compId, mode) {
  writeStore('kisatCompView', compViewSetMode(readStore('kisatCompView') ?? [], compId, mode, activeFollow()));
}
// Juoksut mode puts its category toggle where Kisat mode has the mode toggle
// (filterBar, docs/architecture.md, "The filter bar").
function setViewCats(compId, cats) {
  updateViewState(compId, { cats });
}

// Sweeps the lap logs and the meet's track, kenttä and flip choices a week
// after their last write (docs/lap-counter.md, "Storage"). Every writer stamps
// `t`, so an entry without one is swept too.
const LAPS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function pruneLapsStore() {
  const cutoff = Date.now() - LAPS_TTL_MS;
  let keys;
  try {
    keys = Object.keys(localStorage);
  } catch {
    // Blocked storage throws on access, and app.js sweeps before the first
    // render (test-render.mjs).
    return;
  }
  for (const key of keys) {
    if (!key.startsWith('laps:') && !key.startsWith('track:') && !key.startsWith('venue:') && !key.startsWith('flip:'))
      continue;
    let state = null;
    try {
      state = JSON.parse(localStorage.getItem(key));
    } catch {
      /* An unreadable entry is swept. */
    }
    if (!state?.t || state.t < cutoff) localStorage.removeItem(key);
  }
}

function renderLog() {
  return normalizeRenderLog(readStore('kisatRenderLog'));
}

// --- A meet's documents ---

// Holds the id of the meet in view when its meet body says cup, and null
// otherwise. The club sheet reads it here, as a name cell knows no meet.
let cupMeetSeen = null;
function setCupMeetSeen(compId) {
  cupMeetSeen = compId;
}

// Finds the start for one key on any day of a fetched schedule.
function findGroupInSchedule(schedule, groupKey) {
  for (const rounds of Object.values(schedule)) {
    const group = groupForKey(groupRounds(rounds), groupKey);
    if (group) return group;
  }
  return null;
}

// Returns elsewhere.json's row for a listed meet, and null for any other.
async function listedRow(compId) {
  return elsewhereRow(await loadElsewhere(), compId);
}

// Returns the same row for a meet that stands alone (ALONE_ID_RE). Only an id
// of that shape reads the file, so no other meet's schedule waits on it.
async function aloneRow(compId) {
  if (!ALONE_ID_RE.test(compId)) return null;
  return (await listedRow(compId)) ?? null;
}

// Returns a title menu row that links to where the meet's results are
// published. A demo has none (officialUrl).
function officialMenuRows(row, compId) {
  const href = officialUrl(row, compId);
  return href ? [{ label: 'Viralliset tulokset', href, external: true }] : [];
}

// Fetches the meet body. A meet that stands alone has none, because it is no
// cup meet and runs no varmistus, and the call would answer 400. The Juoksut
// host answers it with 404 (docs/backend.md). Both are skipped.
function fetchMeetBody(compId) {
  if (SITE_MODE === 'juoksut' || ALONE_ID_RE.test(compId)) return null;
  return fetchJson(`/api/meet/${compId}`).catch(() => null);
}

// Fetches a meet's schedule. A meet that stands alone reads it from its row of
// elsewhere.json or from the Worker. Any other reads tuloslista's, and reads
// the grafted copy instead once the graft applies (resultsBase) and answers
// (docs/views.md, "Results on another site").
async function fetchSchedule(compId) {
  const row = await aloneRow(compId);
  if (row) return row.ol ? olSchedule(row) : fetchJson(`/api/results/${compId}`);
  const file = loadElsewhere();
  const own = await fetchJson(`${API}/competition/${compId}`);
  const base = await resultsBase(compId, own, file);
  const grafted = base ? await fetchJson(base).catch(() => null) : null;
  return grafted || own;
}

async function fetchCompProps(compId) {
  const row = await aloneRow(compId);
  return row ? olProperties(row) : fetchJson(`${API}/competition/${compId}/properties`);
}

// Loads elsewhere.json, the same file the Worker reads. The promise is cached,
// because one render asks for several events at once. A failure clears it.
let elsewhereFile = null;
function loadElsewhere() {
  if (!elsewhereFile) {
    elsewhereFile = fetchJson('/data/elsewhere.json').catch(() => {
      elsewhereFile = null;
      return null;
    });
  }
  return elsewhereFile;
}

// Returns the route a meet's grafted results are read from (graftApplies,
// lib/elsewhere.js). It is null for a meet that reads tuloslista, and on the
// Juoksut host, where the route answers 404.
async function resultsBase(compId, schedule, file = loadElsewhere()) {
  if (SITE_MODE === 'juoksut') return null;
  const today = new Date().toISOString().slice(0, 10);
  return graftApplies(await file, compId, schedule, today) ? `/api/results/${compId}` : null;
}

// Fetches one event's document, from the Worker for a grafted meet and from
// tuloslista otherwise. An empty graft falls back to tuloslista, as the graft
// lands hours after the last day. A meet that stands alone has no fallback.
async function fetchEventDoc(compId, schedule, eventId) {
  if (ALONE_ID_RE.test(compId)) return fetchJson(`/api/results/${compId}/${eventId}`);
  const base = await resultsBase(compId, schedule);
  const grafted = base ? await fetchJson(`${base}/${eventId}`).catch(() => null) : null;
  return grafted || fetchJson(`${API}/results/${compId}/${eventId}`);
}

// Holds one render's event documents (eventStore, lib/schedule.js). Each one is
// reconciled as it is fetched (reconcileStatuses).
function eventStoreFor(compId, schedule) {
  const statusById = scheduleStatuses(schedule);
  return eventStore(async (eventId) => reconcileStatuses(await fetchEventDoc(compId, schedule, eventId), statusById));
}

// Loads one start's categories through a store of its own. renderComp, which
// loads a day's starts, shares one store across them.
async function loadGroupDetail(compId, group, schedule) {
  return roundDetails(group.entries, eventStoreFor(compId, schedule));
}

// Loads a start off a fresh schedule fetch, for renderGroup.
async function loadGroup(compId, groupKey) {
  const schedule = await fetchSchedule(compId);
  const group = findGroupInSchedule(schedule, groupKey);
  if (!group) return null;
  // The schedule is returned too, because a leg's start needs its
  // multi-event's schedule rows (renderGroup).
  return { group, schedule, detailed: await loadGroupDetail(compId, group, schedule) };
}

// Fetches the multi-event's root document. Only a leg carries its id (`RootId`),
// so the legs are tried in turn. A leg nobody entered has no document
// (docs/tuloslista-api.md), so a leg that fails is skipped.
async function loadCombinedRoot(compId, legs, schedule) {
  for (const leg of legs) {
    let data;
    try {
      data = await fetchEventDoc(compId, schedule, leg.eventId);
    } catch {
      continue;
    }
    if (!data?.RootId) continue;
    return fetchEventDoc(compId, schedule, data.RootId);
  }
  return null;
}

// Loads districts.json. A demo meet gets DEMO_DISTRICTS, since the demo's
// medal tables are computed over those piiris (meetMedalsBody).
let districtTable = null;
async function loadDistricts(compId) {
  if (isDemoId(compId)) return demo.DEMO_DISTRICTS;
  if (!districtTable) districtTable = await fetchJson('/data/districts.json').catch(() => null);
  return districtTable;
}

// Loads the meet's default scopes (`defaults`, docs/backend.md). They stand
// until a choice is stored (openPiiriSheet). Every event page reads them, so
// they are fetched once a session and not on each refresh.
const piiriDefaults = new Map();
async function loadPiiriDefaults(compId) {
  if (!piiriDefaults.has(compId)) {
    const body = await fetchJson(`/api/medals/${compId}`).catch(() => null);
    piiriDefaults.set(compId, body?.defaults || []);
  }
  return piiriDefaults.get(compId);
}

// Returns the scopes in force (tickedScopes) with districts.json. The result
// is null when no scope is in force or the file did not load.
async function loadScopeChoice(compId) {
  const scopes = tickedScopes(viewStateFor(compId).scopes, await loadPiiriDefaults(compId));
  if (!scopes.length) return null;
  const districts = await loadDistricts(compId);
  return districts ? { districts, scopes } : null;
}

export {
  HOME_VIEW_KEY,
  activeFollow,
  activeWatchSeen,
  cupMeetSeen,
  eventStoreFor,
  fetchCompProps,
  fetchEventDoc,
  fetchJson,
  fetchMeetBody,
  fetchSchedule,
  followTargets,
  forgetWatch,
  forgetWatchEditToken,
  listedRow,
  loadActiveWatch,
  loadCombinedRoot,
  loadDemo,
  loadDistricts,
  loadElsewhere,
  loadGroup,
  loadScopeChoice,
  officialMenuRows,
  piiriDefaults,
  pruneLapsStore,
  readStore,
  recentComps,
  registerWatch,
  rememberComp,
  rememberWatchEditToken,
  renderLog,
  setActiveFollow,
  setCupMeetSeen,
  setFetchJson,
  setRenderCost,
  setViewCats,
  setViewMode,
  updateViewState,
  viewStateFor,
  watchEditToken,
  watchLabel,
  watchRegistry,
  writeStore,
};
