import { agesSegment, parseAges } from './ages.js';
import { dateRange, fiToIsoDay, isoToFiDay } from './dates.js';
import { ALONE_ID_RE } from './elsewhere.js';
import { meetPlace } from './home.js';
import { WATCH_REGISTRY_MAX } from './watch.js';

// --- The two modes and the host ---

// The host alone picks the mode (docs/architecture.md, "The two modes"), and
// ?mode= works only on a dev host such as localhost or *.workers.dev. A
// counted race lives in one origin's localStorage, so the counter exists on
// exactly one host.
function isDevHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '' ||
    // Only a subdomain of Cloudflare's zone matches, and not a lookalike name.
    host.endsWith('.workers.dev')
  );
}

function siteMode(hostname, search) {
  const host = String(hostname || '').toLowerCase();
  if (isDevHost(host)) {
    const m = String(search || '').match(/[?&]mode=(\w+)/);
    if (m && (m[1] === 'juoksut' || m[1] === 'kisat')) return m[1];
  }
  // Only the first label counts, since the counter's storage rests on it.
  return host.split('.')[0] === 'juoksut' ? 'juoksut' : 'kisat';
}

// The manifest, favicon and iOS icon load before any script, so worker.js
// swaps in the Juoksut file by host (siteAssetPath). A new one also needs a row
// in wrangler.jsonc's `run_worker_first`, which nothing tests.
const SITE_ASSETS = {
  '/manifest.webmanifest': '/manifest-juoksut.webmanifest',
  '/icon.svg': '/icon-juoksut.svg',
  // index.html does not link it, as iOS asks the site root for it.
  '/apple-touch-icon.png': '/apple-touch-icon-juoksut.png',
};

// Null means serve what was asked, which is every path in Kisat mode.
function siteAssetPath(pathname, mode) {
  if (mode !== 'juoksut') return null;
  return SITE_ASSETS[pathname] || null;
}

// worker.js rewrites the one index.html's identity per host for a link
// preview's crawler, which runs no script.
const SITE_META = {
  juoksut: { title: 'Juoksut', description: 'Yleisurheilun juoksukisojen toimitsijan paras kaveri.' },
};
const SITE_NAMES = { kisat: 'Kisat', juoksut: 'Juoksut' };

// Returns a link preview, with a meet from its listing row or propertiesMeetRow.
// It names no status or result, as a messaging app caches a preview for days.
function siteMeta(mode, pathname = '/', meet = null) {
  const siteName = SITE_NAMES[mode];
  if (meet) {
    const when = meet.days?.length ? dateRange(meet.days) : isoToFiDay(meet.date);
    return {
      title: `${meet.name} · ${siteName}`,
      description: [meetPlace(meet.location, meet.organizationName), when].filter(Boolean).join(' · '),
      siteName,
    };
  }
  if (pathname === TABLE_PAGE_PATH)
    return { title: `${TABLE_PAGE_TITLE} · ${siteName}`, description: TABLE_PAGE_DESCRIPTION, siteName };
  if (pathname === MEDAL_SEASON_PAGE_PATH && mode === 'kisat')
    return { title: `${MEDAL_SEASON_PAGE_TITLE} · ${siteName}`, description: MEDAL_SEASON_PAGE_DESCRIPTION, siteName };
  if (pathname === CUP_SEASON_PAGE_PATH && mode === 'kisat')
    return { title: `${CUP_SEASON_PAGE_TITLE} · ${siteName}`, description: CUP_SEASON_PAGE_DESCRIPTION, siteName };
  return SITE_META[mode] ? { ...SITE_META[mode], siteName } : null;
}

// --- A preview's data (docs/deployment.md, "A preview with its own data") ---

// Swaps the KV for the preview namespaces where the PREVIEW_DATA secret is
// "own", and every other deploy keeps its own. The secret without both
// namespaces throws, so such a preview never writes production's KV.
function previewEnv(env) {
  if (env?.PREVIEW_DATA !== 'own') return env;
  if (!env.ROSTER_PREVIEW || !env.WATCHES_PREVIEW) throw new Error('PREVIEW_DATA is "own" with no preview namespace');
  return { ...env, ROSTER: env.ROSTER_PREVIEW, WATCHES: env.WATCHES_PREVIEW };
}

// --- Routes and links ---

// The two tables are one page on both hosts. The state rides in the fragment:
// /mitat[#/<aidat|valineet>[/<ages>][/k/<venueId|ulkoradat|sisaradat>][/viestit|/esteet]].
const TABLE_PAGE_PATH = '/mitat';
const TABLE_PAGE_TITLE = 'Aita- ja välinemitat';
const TABLE_PAGE_DESCRIPTION = 'Aitajuoksujen ja heittovälineiden mitat kaikille sarjoille.';
const TABLE_TABS = { aidat: 'Aidat', valineet: 'Heittovälineet' };
const TABLE_TAB_VIEWS = { aidat: 'hurdleTable', valineet: 'implementTable' };

// A scope's medals over a year are Kisat's alone. The fragment holds the state:
// /mestaruudet[#/[<scopeId>/]<year>[/<ages>][/s/<orgId>]] (docs/views.md).
const MEDAL_SEASON_PAGE_PATH = '/mestaruudet';
const MEDAL_SEASON_PAGE_TITLE = 'Mestaruuskilpailut';
const MEDAL_SEASON_PAGE_DESCRIPTION = 'Mestaruuskilpailuiden mitalit seuroittain koko vuodelta.';
// The cup's year is Kisat's alone. A piiri id narrows the osakilpailut tab in
// /seuracup[#/[<tab|piiriId>/]<year>[/s/<orgId>]].
const CUP_SEASON_PAGE_PATH = '/seuracup';
const CUP_TAB_ROUNDS = 'osakilpailut';
const CUP_TAB_FINALS = 'finaalit';
const CUP_SEASON_PAGE_TITLE = 'Seuracup';
const CUP_SEASON_PAGE_DESCRIPTION = 'Seuracupin koko vuoden pisteet ja finaalipaikat.';

// The demo meets' ids. demo.js builds a meet under each, and app/data.js loads
// demo.js only for these. Every other id is a number or a row that stands
// alone (ALONE_ID_RE).
const DEMO_ID = 'demo';
const DEMO_CUP_ID = 'democup';
const DEMO_CUP_FINAL_ID = 'democupfinal';
const DEMO_IDS = [DEMO_ID, DEMO_CUP_ID, DEMO_CUP_FINAL_ID];

function isDemoId(compId) {
  return DEMO_IDS.includes(String(compId));
}

// A view is a path, so a preview names the meet (worker.js), and an activation
// link's state is a fragment (parseLinkHash). Every back target is a constant
// (app/). No group key or date holds a "?", so [^?]+ rejects only ?w= URLs.
function parseRoute(pathname, hash = '') {
  let path;
  try {
    path = decodeURIComponent(String(pathname ?? ''));
  } catch {
    return { view: 'home' };
  }
  let m;
  // Ids are numeric apart from the demos' (DEMO_IDS) and a row of elsewhere.json
  // that stands alone (ALONE_ID_RE). The lap counter's route goes before the
  // group's, which would take "/laps" as the key's end.
  if ((m = path.match(/^\/c\/([\w-]+)\/g\/([^?]+)\/laps$/))) return { view: 'laps', compId: m[1], key: m[2] };
  if ((m = path.match(/^\/c\/([\w-]+)\/g\/([^?]+)$/))) return { view: 'group', compId: m[1], key: m[2] };
  // A day is YYYY-MM-DD in the path and the schedule's own key in the route
  // (dayPath).
  if ((m = path.match(/^\/c\/([\w-]+)\/d\/(\d{4}-\d{2}-\d{2})$/)))
    return { view: 'comp', compId: m[1], date: isoToFiDay(m[2]) };
  // A multi-event's standings key on the label, as the RootId is unknown
  // until a leg is fetched.
  if ((m = path.match(/^\/c\/([\w-]+)\/o\/([^?]+)$/))) return { view: 'combined', compId: m[1], key: m[2] };
  // The club cup is one table a meet, with no day and a picked club (cupPath).
  if ((m = path.match(/^\/c\/([\w-]+)\/cup(?:\/s\/([\p{L}\p{N}_-]+))?$/u)))
    return { view: 'cup', compId: m[1], club: m[2] || null };
  // The medal table has no day, like the cup's, and takes the age chips and a
  // picked club after its segment (medalsPath).
  if ((m = path.match(/^\/c\/([\w-]+)\/mitalit(?:\/([\d,]+))?(?:\/s\/([\p{L}\p{N}_-]+))?$/u)))
    return { view: 'medals', compId: m[1], ages: parseAges(m[2]), club: m[3] || null };
  // A club's cup page at /cup/<orgId> is the meet's cup page with the club
  // picked. This shim is temporary (docs/shims.md).
  if ((m = path.match(/^\/c\/(\w+)\/cup\/(\d+)$/))) return { view: 'cup', compId: m[1], club: m[2] };
  // The kenttä link carries an index id or a bare length, which is stored on
  // the way to the schedule view (docs/venues.md).
  if ((m = path.match(/^\/c\/([\w-]+)\/k\/([\w-]+)$/))) return { view: 'venueLink', compId: m[1], venueId: m[2] };
  // One day's hurdle setups make a printable page (docs/hurdles.md, "The day
  // sheet").
  if ((m = path.match(/^\/c\/([\w-]+)\/aidat\/(\d{4}-\d{2}-\d{2})$/)))
    return { view: 'hurdleSheet', compId: m[1], date: isoToFiDay(m[2]) };
  if ((m = path.match(/^\/c\/([\w-]+)$/))) {
    // In an activation link about a meet, the path says where to land and the
    // fragment what to activate. The pairing link lands on home.
    const link = hash ? parseLinkHash(hash, m[1]) : null;
    if (link && link.view !== 'home' && link.view !== 'pairLink') return link;
    return { view: 'comp', compId: m[1] };
  }
  if (path === TABLE_PAGE_PATH) {
    const { tab, ...rest } = parseTablePageHash(hash);
    return { view: TABLE_TAB_VIEWS[tab], ...rest };
  }
  if (path === MEDAL_SEASON_PAGE_PATH) return { view: 'medalSeason', ...parseSeasonHash(hash) };
  // The finals' tab has no club, and no scope leaves the tab to cupDefaultTab.
  if (path === CUP_SEASON_PAGE_PATH) {
    const { scopeId, year, club } = parseSeasonHash(hash);
    if (scopeId === CUP_TAB_FINALS) return { view: 'cupSeason', tab: CUP_TAB_FINALS, piiriId: null, year, club: null };
    return {
      view: 'cupSeason',
      tab: scopeId ? CUP_TAB_ROUNDS : null,
      piiriId: scopeId === CUP_TAB_ROUNDS ? null : scopeId,
      year,
      club,
    };
  }
  return path === '/' ? parseLinkHash(hash) : { view: 'home' };
}

// Parses the activation links, in the fragment under a meet's path or the
// root. Each replaces itself with a view (app/), and `compId` is the path's.
function parseLinkHash(rawHash, compId = null) {
  let hash;
  try {
    hash = decodeURIComponent(String(rawHash ?? '').replace(/^#/, ''));
  } catch {
    return { view: 'home' };
  }
  let m;
  // A demo's athlete ids hold a dash, and a made id keeps å, ä and ö
  // (personNameKey, clubNameKey). A club is /s/ (seura), as /o/ is the
  // multi-event's.
  if (compId && (m = hash.match(/^\/a\/([\p{L}\p{N}_-]+)$/u))) return { view: 'athleteLink', compId, athleteId: m[1] };
  if (compId && (m = hash.match(/^\/s\/([\p{L}\p{N}_-]+)$/u))) return { view: 'clubLink', compId, orgId: m[1] };
  // These shapes carry the meet inside the fragment. This shim is temporary
  // (docs/shims.md, fragment-link).
  if ((m = hash.match(/^\/c\/(\w+)\/a\/([\w-]+)$/))) return { view: 'athleteLink', compId: m[1], athleteId: m[2] };
  if ((m = hash.match(/^\/c\/(\w+)\/s\/([\w-]+)$/))) return { view: 'clubLink', compId: m[1], orgId: m[2] };
  // Watch ids are randomHex(6)'s 12 hex chars (worker.js). The editToken is the
  // last segment, so a truncated paste still activates read-only. The
  // /c/<compId> suffix is a temporary shim (docs/shims.md, fragment-link).
  if ((m = hash.match(/^\/w\/(\w+)(?:\/c\/(\w+))?(?:\/e\/(\w+))?$/))) {
    const route = { view: 'watchLink', watchId: m[1] };
    const comp = compId || m[2];
    if (comp) route.compId = comp;
    if (m[3]) route.editToken = m[3];
    return route;
  }
  // What the renders cost sits at a fragment nothing links to (renderMeasure).
  if (hash === '/measure') return { view: 'measure' };
  // The pairing link carries this device's whole registry (keyringPairs).
  if ((m = hash.match(/^\/k\/([\w:,]+)$/))) {
    const pairs = keyringPairs(m[1]);
    if (pairs.length) return { view: 'pairLink', pairs };
  }
  return { view: 'home' };
}

const KISAT_ONLY_VIEWS = ['watchLink', 'pairLink', 'athleteLink', 'clubLink', 'medals', 'medalSeason', 'cupSeason'];
const JUOKSUT_ONLY_VIEWS = ['laps', 'venueLink', 'hurdleSheet'];

// Returns the one mode a route renders in, or null where both modes render it.
// A meet that stands alone reads /api/results, which the Juoksut host does not
// serve. The Juoksut views go first, so no route bounces between the hosts.
function routeMode(route) {
  if (JUOKSUT_ONLY_VIEWS.includes(route.view)) return 'juoksut';
  if (KISAT_ONLY_VIEWS.includes(route.view) || ALONE_ID_RE.test(route.compId ?? '')) return 'kisat';
  return null;
}

// Returns a view's fragment shape (#/c/…) as its path, or null, and app.js
// replaces the address at boot. This shim is temporary (docs/shims.md).
function legacyRoutePath(rawHash) {
  const hashPath = String(rawHash ?? '').replace(/^#/, '');
  const path = legacyDayPath(hashPath) ?? hashPath;
  if (!path.startsWith('/c/')) return null;
  return parseRoute(path).view === 'home' ? null : path;
}

// Returns a day's path with its D.M.YYYY key as YYYY-MM-DD, or null. worker.js
// redirects such a path. This shim is temporary (docs/shims.md).
function legacyDayPath(pathname) {
  const m = String(pathname ?? '').match(/^(\/c\/[\w-]+\/(?:d|aidat)\/)(\d{1,2}\.\d{1,2}\.\d{4})$/);
  return m ? `${m[1]}${fiToIsoDay(m[2])}` : null;
}

// Returns the path of a meet's day (parseRoute), from the schedule's day key.
function dayPath(compId, day) {
  return `/c/${compId}/d/${fiToIsoDay(day)}`;
}

// Returns the path of a day's hurdle sheet (parseRoute), from the schedule's
// day key.
function hurdleSheetPath(compId, day) {
  return `/c/${compId}/aidat/${fiToIsoDay(day)}`;
}

// Parses the table page's fragment (TABLE_PAGE_PATH). A fragment with no tab
// is the hurdle tab.
function parseTablePageHash(rawHash) {
  const none = { tab: 'aidat', ages: [], venueId: null, open: null };
  let hash;
  try {
    hash = decodeURIComponent(String(rawHash ?? '').replace(/^#/, ''));
  } catch {
    return none;
  }
  const m = hash.match(/^\/?(aidat|valineet)?(?:\/?([\d,]+))?(?:\/?k\/([\w-]+))?(?:\/?(viestit|esteet))?\/?$/);
  if (!m) return none;
  return { tab: m[1] || 'aidat', ages: parseAges(m[2]), venueId: m[3] || null, open: m[4] || null };
}

function tablePageHash(tab, ages, venueId = null, open = null) {
  return `#/${[tab, agesSegment(ages), venueId ? `k/${venueId}` : '', open].filter(Boolean).join('/')}`;
}

// Returns a cup meet's path (parseRoute) with the picked club after it.
function cupPath(compId, club = null) {
  return `/c/${compId}/cup${club ? `/s/${club}` : ''}`;
}

// Returns the medal page's path (parseRoute) with the ages and club after it.
function medalsPath(compId, ages = [], club = null) {
  return `/c/${compId}/mitalit${agesSegment(ages) ? `/${agesSegment(ages)}` : ''}${club ? `/s/${club}` : ''}`;
}

// Parses a year page's fragment, a scope id the view checks or a year alone for
// the scopes' list. No year is this year, and the view refuses a year outside
// seasonYears, as that needs today.
function parseSeasonHash(rawHash) {
  const none = { scopeId: null, year: null, ages: [], club: null };
  let hash;
  try {
    hash = decodeURIComponent(String(rawHash ?? '').replace(/^#/, ''));
  } catch {
    return none;
  }
  const bare = hash.match(/^\/?(\d{4})\/?$/);
  if (bare) return { ...none, year: Number(bare[1]) };
  const m = hash.match(/^\/?(?:([a-z][\w-]*)(?:\/(\d{4}))?(?:\/([\d,]+))?(?:\/s\/([\p{L}\p{N}_-]+))?)?\/?$/u);
  if (!m) return none;
  return { scopeId: m[1] || null, year: m[2] ? Number(m[2]) : null, ages: parseAges(m[3]), club: m[4] || null };
}

function seasonHash(scopeId, year = null, ages = [], club = null) {
  if (!scopeId) return `#/${year || ''}`;
  return `#/${[scopeId, year, agesSegment(ages), club ? `s/${club}` : ''].filter(Boolean).join('/')}`;
}

// Returns the link a quick-filter is shared by, the meet's path with the filter
// in the fragment. A test round-trips it through parseRoute.
function focusLink(compId, focus) {
  return `/c/${compId}#/${focus?.kind === 'club' ? 's' : 'a'}/${focus?.id}`;
}

// Returns the links "Jaa" and "Jaa muokkauslinkki" hand out. A test
// round-trips them through parseRoute.
function watchLink(watchId, compId = null, editToken = null) {
  return `${compId ? `/c/${compId}` : '/'}#/w/${watchId}${editToken ? `/e/${editToken}` : ''}`;
}

// --- The modules a route loads ---

// Names the module of public/app/ that each view renders from. app.js imports
// it the first time the view renders.
const VIEW_MODULES = {
  athleteLink: 'follow',
  clubLink: 'follow',
  combined: 'event',
  comp: 'meet',
  cup: 'cup',
  cupSeason: 'cup',
  group: 'event',
  home: 'home',
  hurdleSheet: 'hurdles',
  hurdleTable: 'tables',
  implementTable: 'tables',
  laps: 'laps',
  measure: 'measure',
  medalSeason: 'medals',
  medals: 'medals',
  pairLink: 'follow',
  venueLink: 'hurdles',
  watchLink: 'follow',
};

// Names the modules a module imports on demand in Juoksut mode alone.
const JUOKSUT_MODULES = { event: ['hurdles'], meet: ['hurdles'] };

// Names the modules a mode's reader moves between. app.js preloads them once
// the first view is on screen, so a tap does not wait for a module.
const MAIN_MODULES = { juoksut: ['home', 'meet', 'event', 'hurdles', 'laps'], kisat: ['home', 'meet', 'event'] };

// A page reloads itself for a module it failed to load at most this often, so
// a deploy that is broken shows its error and does not reload forever.
const RELOAD_GAP_MS = 60_000;

// Says whether a page that last reloaded at `last` may reload at `now`. The
// time is unknown or unreadable on a page that has not reloaded.
function reloadDue(last, now) {
  return !(Number(last) > now - RELOAD_GAP_MS);
}

// Returns the files app.js imports on demand before a route's first render,
// from `files`, the bundle's chunks per module (modules.json, build.mjs). The
// Worker preloads them with the document, since app.js asks only once it runs.
function routeModules(route, mode, files) {
  const name = VIEW_MODULES[route?.view] ?? 'home';
  const names = [name, ...(mode === 'juoksut' ? (JUOKSUT_MODULES[name] ?? []) : [])];
  if (isDemoId(route?.compId)) names.push('demo');
  return [...new Set(names.flatMap((n) => files?.[n] ?? []))];
}

// --- Layers, and the browser's own back gesture ---

// A sheet or the quick-filter lies over a view at its own URL, and one sentinel
// entry stands for the stack (docs/architecture.md). `sentinel` and `here` are
// ids, since a layer and its view share a URL (dev/probe-layers.js).
function layerEntryIsHere(sentinel, here) {
  return sentinel != null && here === sentinel;
}

// Returns 'settle' for a traversal app/shell.js asked for (pendingBack),
// 'close' for the reader's back off the sentinel, and else 'route', which
// leaveView draws.
function layerPopAction(sentinel, here, pendingBack) {
  if (pendingBack > 0) return 'settle';
  return layerEntryIsHere(sentinel, here) ? 'close' : 'route';
}

// Says how closing a layer from inside the page treats history. `depth` is the
// layers left, and 'keep' holds while any is stacked. 'rewind' gives the entry
// back, and 'drop' is for a sentinel that navigation has buried.
function layerCloseAction(sentinel, here, depth) {
  if (depth > 0) return 'keep';
  return layerEntryIsHere(sentinel, here) ? 'rewind' : 'drop';
}

// --- A menu's place under its button ---

// Places a menu's card under its button with the left edges aligned, or above
// it where there is no room below (openMenu, app/shell.js).
// Rects are getBoundingClientRect's, and `pad` is the margin a too-big card is
// pinned to.
function menuAnchorPos(anchor, card, view, pad = 12, gap = 6) {
  const left = Math.max(pad, Math.min(anchor.left, view.width - card.width - pad));
  const below = anchor.bottom + gap;
  const roomBelow = below + card.height + pad <= view.height;
  return { left, top: roomBelow ? below : Math.max(pad, anchor.top - gap - card.height) };
}

// Says whether the button has moved, so openMenu closes the menu. The pixel of
// slack covers a still button's fractional rect re-measuring a hundredth off.
function anchorMoved(before, after, slack = 1) {
  return Math.abs(after.top - before.top) > slack || Math.abs(after.left - before.left) > slack;
}

// --- The view state ---
// These functions take plain arrays, and app/data.js owns the localStorage I/O.

// The view state holds a row per meet, {compId, watchId, mode, focus, cats,
// ages, events, counts, ottelut, recentOpen, scopes}, with the last used first.
// Each field is as normalizeCompView reads it. The caps are bounds, not
// measured limits.
const COMP_VIEW_MAX = 10;
const SCOPES_MAX = 5;

function normalizeMode(mode) {
  return mode === 'all' ? 'all' : 'watched';
}

// Reads Juoksut mode's category toggle, which defaults to the track.
function normalizeCats(cats) {
  return cats === 'all' ? 'all' : 'run';
}

// Reads a stored view state, or garbage, into the one shape the schedule view
// reads. `focus` is the quick-filter on a person or a club (`kind`). Its mode
// starts 'watched' and is its own, so it never rewrites the watch's mode.
function normalizeCompView(v) {
  return {
    watchId: typeof v?.watchId === 'string' && v.watchId ? v.watchId : null,
    mode: normalizeMode(v?.mode),
    focus:
      v?.focus && typeof v.focus === 'object' && v.focus.id != null
        ? {
            kind: v.focus.kind === 'club' ? 'club' : 'athlete',
            id: String(v.focus.id),
            name: String(v.focus.name ?? ''),
            mode: normalizeMode(v.focus.mode),
          }
        : null,
    cats: normalizeCats(v?.cats),
    // ages and events hold the class and discipline filter (activeFilter).
    ages: Array.isArray(v?.ages) ? [...new Set(v.ages.filter(Number.isInteger))] : [],
    events: Array.isArray(v?.events) ? [...new Set(v.events.filter((e) => typeof e === 'string' && e.trim()))] : [],
    counts: v?.counts === true,
    // ottelut is the Ottelut section's fold, which renderComp reads.
    ottelut: v?.ottelut !== false,
    // recentOpen is home's Viimeksi katsotut fold, closed until opened.
    recentOpen: v?.recentOpen === true,
    scopes: normalizeScopes(v?.scopes ?? v?.piirit), // piirit is a temporary shim (docs/shims.md)
  };
}

// null is unset, so the meet's own defaults apply, where [] is a choice. A bare
// id is a stored piirit choice, a temporary shim (docs/shims.md).
function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) return null;
  const out = new Map();
  for (const s of scopes) {
    const id = typeof s === 'string' ? s : s?.id;
    if (typeof id === 'string' && id && !out.has(id)) out.set(id, { id, cover: normalizeCover(s?.cover) });
  }
  return [...out.values()].slice(0, SCOPES_MAX);
}

// Reads a cover for coversStart, where null holds all and a null field any.
function normalizeCover(cover) {
  if (!cover || typeof cover !== 'object') return null;
  const list = (xs, ok) => (Array.isArray(xs) ? [...new Set(xs.filter(ok))] : null);
  return {
    ages: list(cover.ages, Number.isInteger),
    events: list(cover.events, (w) => typeof w === 'string' && w.trim()),
  };
}

// Returns one meet's view state, or else defaultWatchId, the list picked last
// on any meet.
function compViewState(list, compId, defaultWatchId = null) {
  const v = (Array.isArray(list) ? list : []).find((x) => x && x.compId === compId);
  return normalizeCompView(v || { watchId: defaultWatchId });
}

// Patches one meet's view state and moves it first. {watchId: null} unsets the
// follow-list, and app/data.js's viewStateFor overrides the stored watchId. A
// key opening on '#' is a page's, such as home's, and the meets' cap passes it
// by.
function compViewUpdate(list, compId, patch, defaultWatchId = null) {
  const next = normalizeCompView({ ...compViewState(list, compId, defaultWatchId), ...patch });
  const rest = (Array.isArray(list) ? list : []).filter((x) => x && x.compId !== compId);
  let meets = 0;
  return [{ compId, ...next }, ...rest].filter((x) => String(x.compId).startsWith('#') || ++meets <= COMP_VIEW_MAX);
}

// Returns the quick-filter's mode while it is set, and else the watch's.
function compViewMode(state) {
  return state.focus ? state.focus.mode : state.mode;
}

// Sets the mode in whichever slot compViewMode reads.
function compViewSetMode(list, compId, mode, defaultWatchId = null) {
  const state = compViewState(list, compId, defaultWatchId);
  return compViewUpdate(list, compId, state.focus ? { focus: { ...state.focus, mode } } : { mode }, defaultWatchId);
}

// --- The pairing link ---

// The registry is device-local, so the link carries it whole in registry
// order, as `#/k/<id>:<token>,<id>`. It is a snapshot and not a sync, and it
// needs nothing of the Worker.
function keyringLinkHash(rows) {
  return `#/k/${(rows || []).map((r) => (r.editToken ? `${r.watchId}:${r.editToken}` : r.watchId)).join(',')}`;
}

// Both halves are `\w+` as in the single-Watch route, so a wrong id gets the
// 404 and a wrong token the 403. A malformed pair is skipped, and a repeated
// id keeps its first. The registry's cap holds.
function keyringPairs(raw) {
  const pairs = [];
  for (const part of String(raw ?? '').split(',')) {
    const [watchId, editToken, ...rest] = part.split(':');
    if (rest.length || !/^\w+$/.test(watchId || '')) continue;
    if (editToken !== undefined && !/^\w+$/.test(editToken)) continue;
    if (pairs.some((p) => p.watchId === watchId)) continue;
    pairs.push(editToken === undefined ? { watchId } : { watchId, editToken });
    if (pairs.length === WATCH_REGISTRY_MAX) break;
  }
  return pairs;
}

// --- A link that arrives by clipboard or search ---
// An installed app has no address bar, and a tapped link opens the browser.

// Returns the address of a Watch or pairing link in the text, or null. The
// match stops at a character no link holds and must parse as one of the two,
// the only views that carry state browsing cannot.
function pastedLink(text) {
  const m = String(text ?? '').match(/(\/c\/[\w-]+)?#\/(?:w\/[\w/]+|k\/[\w:,/]+)/);
  if (!m) return null;
  const path = m[1] || '/';
  const hash = m[0].slice(m[1]?.length || 0);
  const view = parseRoute(path, hash).view;
  return view === 'watchLink' || view === 'pairLink' ? `${path}${hash}` : null;
}

// Returns where home's search jumps on Enter. A meet id, digits or a demo's
// id, reaches a meet where the app has no URL bar.
function searchJumpPath(text) {
  const id = String(text ?? '').trim();
  if (/^\d+$/.test(id)) return `/c/${id}`;
  const demoId = id.toLowerCase();
  return isDemoId(demoId) ? `/c/${demoId}` : null;
}

export {
  CUP_SEASON_PAGE_PATH,
  CUP_SEASON_PAGE_TITLE,
  CUP_TAB_FINALS,
  CUP_TAB_ROUNDS,
  DEMO_CUP_FINAL_ID,
  DEMO_CUP_ID,
  DEMO_ID,
  DEMO_IDS,
  JUOKSUT_MODULES,
  MAIN_MODULES,
  MEDAL_SEASON_PAGE_PATH,
  MEDAL_SEASON_PAGE_TITLE,
  RELOAD_GAP_MS,
  TABLE_PAGE_PATH,
  TABLE_PAGE_TITLE,
  TABLE_TABS,
  TABLE_TAB_VIEWS,
  VIEW_MODULES,
  anchorMoved,
  compViewMode,
  compViewSetMode,
  compViewState,
  compViewUpdate,
  cupPath,
  dayPath,
  focusLink,
  hurdleSheetPath,
  isDemoId,
  isDevHost,
  keyringLinkHash,
  keyringPairs,
  layerCloseAction,
  layerPopAction,
  legacyDayPath,
  legacyRoutePath,
  medalsPath,
  menuAnchorPos,
  parseLinkHash,
  parseRoute,
  parseSeasonHash,
  parseTablePageHash,
  pastedLink,
  previewEnv,
  reloadDue,
  routeMode,
  routeModules,
  searchJumpPath,
  seasonHash,
  siteAssetPath,
  siteMeta,
  siteMode,
  tablePageHash,
  watchLink,
};
