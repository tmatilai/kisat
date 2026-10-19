import { loadDemo, pruneLapsStore, renderLog, setRenderCost, writeStore } from './app/data.js';
import {
  JUOKSUT_ORIGIN,
  KISAT_ORIGIN,
  SITE_MODE,
  anySheetOpen,
  appEl,
  currentRoute,
  el,
  flashMessage,
  helpEl,
  helpTopics,
  navigate,
  nextRenderSeq,
  render,
  renderSeq,
  runLeaves,
  scrollKey,
  scrollPositions,
  setFlash,
  setHelp,
  setRouter,
  setScrollKey,
  setUpdated,
  showError,
  wantedScroll,
} from './app/shell.js';
import { logRender } from './lib/render-log.js';
import { MAIN_MODULES, VIEW_MODULES, isDevHost, legacyRoutePath, reloadDue, routeMode } from './lib/routes.js';

// --- Routing ---
// parseRoute (lib/routes.js) is the route table (docs/architecture.md,
// "The route table"). Every route change goes through navigate or
// replaceAddress (app/shell.js), or arrives as a popstate.

const SCHEDULE_REFRESH_MS = 60_000;
const GROUP_REFRESH_MS = 25_000;

let refreshTimer = null;

// Loads each module of app/ that a view renders from (VIEW_MODULES,
// lib/routes.js). A module loads the first time one of its views renders.
const LOADERS = {
  cup: () => import('./app/cup.js'),
  event: () => import('./app/event.js'),
  follow: () => import('./app/follow.js'),
  home: () => import('./app/home.js'),
  hurdles: () => import('./app/hurdles.js'),
  laps: () => import('./app/laps.js'),
  measure: () => import('./app/measure.js'),
  medals: () => import('./app/medals.js'),
  meet: () => import('./app/meet.js'),
  tables: () => import('./app/tables.js'),
};

// Renders each view from its module. A view may return a status line that
// replaces the update time, as the counter does while it runs from a stored
// snapshot (renderLaps).
const RENDERS = {
  athleteLink: (m, r) => m.activateFocusLink(r.compId, 'athlete', r.athleteId),
  clubLink: (m, r) => m.activateFocusLink(r.compId, 'club', r.orgId),
  combined: (m, r) => m.renderCombined(r.compId, r.key),
  comp: (m, r) => m.renderComp(r.compId, r.date),
  cup: (m, r, isRefresh) => m.renderCup(r.compId, r.club, isRefresh),
  cupSeason: (m, r) => m.renderCupSeason(r),
  group: (m, r) => m.renderGroup(r.compId, r.key),
  home: (m) => m.renderHome(),
  hurdleSheet: (m, r) => m.renderHurdleSheet(r.compId, r.date),
  hurdleTable: (m, r) => m.renderHurdleTable(r),
  implementTable: (m, r) => m.renderImplementTable(r),
  laps: (m, r) => m.renderLaps(r.compId, r.key),
  measure: (m) => m.renderMeasure(),
  medalSeason: (m, r) => m.renderMedalSeason(r),
  medals: (m, r) => m.renderMedals(r.compId, r.ages, r.club),
  pairLink: (m, r) => m.activatePairLink(r.pairs),
  venueLink: (m, r) => m.activateVenueLink(r.compId, r.venueId),
  watchLink: (m, r) => m.activateWatchLink(r.watchId, r.compId, r.editToken),
};

async function renderRoute(isRefresh = false) {
  const route = currentRoute();
  // A route of the other mode leaves for that mode's host. location.replace
  // keeps this page out of history, so back does not bounce again. A dev host
  // serves both modes, so there the route falls to home and ?mode= picks one.
  const mode = routeMode(route);
  if (mode && mode !== SITE_MODE) {
    if (!isDevHost(location.hostname)) {
      const origin = mode === 'kisat' ? KISAT_ORIGIN : JUOKSUT_ORIGIN;
      location.replace(`${origin}${location.pathname}${location.hash}`);
      return;
    }
    navigate('/', { replace: true });
    return;
  }
  const seq = nextRenderSeq();
  const cost = { view: route.view, refresh: isRefresh, at: Date.now(), fetches: 0, fetchMs: 0 };
  const startedAt = performance.now();
  setRenderCost(cost);
  // Each view drops the state that the next route does not keep.
  runLeaves(route);
  // The flash is taken before the view runs, so a flash that an activation link
  // sets survives into the render of the route the link redirects to.
  const flash = flashMessage;
  setFlash(null);
  setHelp(null);
  helpEl.hidden = true;
  // The position is read through wantedScroll before any node is replaced. A
  // refresh over a collapsed page then keeps the position the page cannot show.
  // The map holds it too, in case the reader leaves before the data arrives.
  const keepY = isRefresh ? wantedScroll() : null;
  if (isRefresh && scrollKey) scrollPositions.set(scrollKey, keepY);
  // Each view sets scrollKey once it renders, so an error page or an
  // activation link keeps no position. A refresh keeps the on-screen view's key.
  if (!isRefresh) setScrollKey(null);
  // renderGroup and renderCombined set `wide` themselves when a table needs it.
  if (route.view !== 'group' && route.view !== 'combined') appEl.classList.remove('wide');
  // The row-list views are narrower (main.list, docs/style.md, "Width"). The
  // class is set here, so a route that renders nothing still sets the width.
  appEl.classList.toggle(
    'list',
    route.view === 'home' ||
      route.view === 'comp' ||
      route.view === 'cup' ||
      route.view === 'medals' ||
      route.view === 'medalSeason' ||
      route.view === 'cupSeason',
  );
  if (!isRefresh) appEl.replaceChildren(el('div', { class: 'notice' }, 'Ladataan…'));
  try {
    const view = RENDERS[route.view] ? route.view : 'home';
    const [module] = await Promise.all([
      loadFresh(LOADERS[VIEW_MODULES[view]]),
      loadFresh(() => loadDemo(route.compId)),
    ]);
    if (seq !== renderSeq) return;
    const note = await RENDERS[view](module, route, isRefresh);
    if (seq !== renderSeq) return;
    keepRenderCost(cost, startedAt);
    // The position is restored once the content is in, as the placeholder would
    // clamp it. A view not seen this session opens at the top. A refresh scrolls
    // only if the page moved, and a short page leaves the offset in the map.
    if (isRefresh) {
      if (keepY != null && keepY !== window.scrollY) window.scrollTo(0, keepY);
    } else window.scrollTo(0, (scrollKey && scrollPositions.get(scrollKey)) || 0);
    setUpdated(true, note ?? flash);
    (window.requestIdleCallback ?? setTimeout)(prefetchModules);
    helpEl.hidden = !helpTopics;
    if (helpTopics) helpEl.setAttribute('aria-label', helpTopics.aria || 'Ohje');
  } catch (err) {
    if (seq !== renderSeq) return;
    keepRenderCost(cost, startedAt);
    if (!isRefresh) showError(err);
    setUpdated(false);
  }
}

// Loads a module with load(). One that fails while the site still answers is
// from a deploy newer than the page, so the page reloads into it. It reloads
// at most once a minute (reloadDue), and an offline page shows the error.
async function loadFresh(load) {
  try {
    return await load();
  } catch (err) {
    let last = null;
    try {
      last = sessionStorage.getItem('kisatReloadAt');
    } catch {
      /* A blocked storage reads as no reload yet. */
    }
    const answers = await fetch('/robots.txt', { method: 'HEAD', cache: 'no-store' }).then(
      (r) => r.ok,
      () => false,
    );
    if (!answers || !reloadDue(last, Date.now())) throw err;
    try {
      sessionStorage.setItem('kisatReloadAt', String(Date.now()));
    } catch {
      // A reload that leaves no time could repeat forever.
      throw err;
    }
    location.reload();
    return new Promise(() => {});
  }
}

// Loads the modules of the views a reader moves between (MAIN_MODULES), once
// and in idle time after the first view. A reader who asked the browser to
// save data loads each module only when its view opens.
let prefetched = false;
function prefetchModules() {
  if (prefetched || navigator.connection?.saveData) return;
  prefetched = true;
  for (const name of MAIN_MODULES[SITE_MODE]) LOADERS[name]().catch(() => {});
}

// Logs a render once it is on screen.
function keepRenderCost(cost, startedAt) {
  setRenderCost(null);
  if (cost.view === 'measure') return;
  writeStore('kisatRenderLog', logRender(renderLog(), { ...cost, ms: performance.now() - startedAt }));
}

// The refresh skips a tick while a sheet is open, since the sheet may hold
// unsaved edits (docs/architecture.md, "Layers").
function refreshTick() {
  if (anySheetOpen()) return;
  render(true);
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = null;
  const route = currentRoute();
  // The lap counter must get no timer, since no tile may move mid-race
  // (docs/juoksut.md). dev/probe-laps.js asserts it.
  const ms =
    route.view === 'group' || route.view === 'combined'
      ? GROUP_REFRESH_MS
      : route.view === 'comp' || route.view === 'medals' || route.view === 'cup'
        ? SCHEDULE_REFRESH_MS
        : null;
  // A hidden tab gets no timer until the visibilitychange listener arms it.
  if (ms && !document.hidden) refreshTimer = setInterval(refreshTick, ms);
}

// A same-origin link navigates in place, as a path is otherwise a full page
// load. A modifier click and a click a handler already claimed are left alone.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  navigate(url.href);
});
document.addEventListener('visibilitychange', () => {
  // A hidden tab stops refreshing (docs/architecture.md, "Layers").
  if (document.hidden) {
    clearInterval(refreshTimer);
    refreshTimer = null;
    return;
  }
  scheduleRefresh();
  if (currentRoute().view !== 'laps') render(true);
});

// Drops the counter's stored state a week after its last write (LAPS_TTL_MS).
pruneLapsStore();
// Temporary: a fragment link (#/c/…) opens at its path (docs/shims.md).
const legacyPath = location.pathname === '/' && legacyRoutePath(location.hash);
if (legacyPath) history.replaceState(null, '', `${legacyPath}${location.search}`);
setRouter({ render: renderRoute, scheduleRefresh });
render();
scheduleRefresh();

// The probes in dev/ reach these through the runner (dev/AGENTS.md).
export { SCHEDULE_REFRESH_MS, refreshTick, refreshTimer };
