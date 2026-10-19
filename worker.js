// The Worker serves the /api layer, the calendar feed and each host's
// document in front of the static assets (docs/backend.md). It sees only the
// paths in wrangler.jsonc's run_worker_first and the paths with no asset.
import { confirmSetting } from './public/lib/confirmation.js';
import { cupBody, cupDetail, cupMode, cupSeasonMeets, cupSeasonRecord, cupSeasonRows } from './public/lib/cup.js';
import { fiToIsoDay, isoDay, scheduleDays, shiftIsoDay } from './public/lib/dates.js';
import { demoApiBody, demoSearchScope } from './public/lib/demo-api.js';
import { meetScopes } from './public/lib/districts.js';
import {
  T4R_BASE,
  aloneEntries,
  athleteLicences,
  elsewhereLastDay,
  elsewhereRow,
  elsewhereTag,
  olAloneMeet,
  olGraft,
  t4rAloneMeet,
  t4rGraft,
} from './public/lib/elsewhere.js';
import { RECENT_DAYS, calendarCandidates, calendarWindow } from './public/lib/home.js';
import { DIGEST_VERSION, buildDigest, digestPeople, scanDigest, scheduleEventOrder } from './public/lib/digest.js';
import {
  athleteBackfillAt,
  athleteBackfillCursor,
  digestSeasonPeople,
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
} from './public/lib/indexes.js';
import {
  buildRoundGoesOn,
  cacheTtlFor,
  medalSeasonMeetEmpty,
  medalSeasonMeets,
  medalSeasonRecord,
  meetMedalsBody,
  recordSettled,
  scopeMedalStarts,
  warmSeasonMeets,
} from './public/lib/medals.js';
import {
  buildRoster,
  combinedEventRoots,
  drawnEntries,
  relayTeams,
  rosterPeople,
  scheduleEventIds,
} from './public/lib/roster.js';
import {
  CUP_SEASON_PAGE_PATH,
  DEMO_IDS,
  MEDAL_SEASON_PAGE_PATH,
  TABLE_PAGE_PATH,
  legacyDayPath,
  parseRoute,
  previewEnv,
  routeModules,
  siteAssetPath,
  siteMeta,
  siteMode,
} from './public/lib/routes.js';
import { API } from './public/lib/schedule.js';
import { searchBody, searchQuery } from './public/lib/search.js';
import { t4rDecode, t4rSitePages } from './public/lib/t4r.js';
import { WATCH_MAX_BODY_BYTES, normalizeWatchInput, watchTargets } from './public/lib/watch.js';
import { DEMO_API, demoMeet, demoEvents, demoSchedule, demoResponse } from './public/demo.js';
import districts from './public/data/districts.json';
import elsewhere from './public/data/elsewhere.json';

// A live meet's roster can gain a late entry, and a miss rebuilds it with a
// subrequest per event (docs/backend.md, "The roster"). The TTL is a guess.
const ROSTER_CACHE_TTL_S = 300;
// A meet that is over has final entrants and medals (cacheTtlFor, lib/medals.js).
const PAST_CACHE_TTL_S = 7 * 24 * 60 * 60;
const CACHE_TTLS = { live: ROSTER_CACHE_TTL_S, past: PAST_CACHE_TTL_S };

// A cup's standings move with every final, and the official reader sums them
// again on a short timer (docs/tuloslista-api.md, "An osakilpailu").
const CUP_CACHE_TTL_S = 60;

// A body with no standings holds the settings, which can change on the meet
// day (docs/tuloslista-api.md, "The flag moves"). A miss is one subrequest.
const NOT_A_CUP_TTL_S = 300;

// Tuloslista's ids are numeric, and the demos' are DEMO_IDS. Any other id is
// refused before it costs a limiter token or a subrequest.
const COMP_ID_RE = new RegExp(`^(\\d+|${DEMO_IDS.join('|')})$`);

// The header turns away scanners that replay no headers. It is no secret, as
// app/data.js ships it. The zone's WAF checks it first (docs/backend.md), and
// fetchJson (app/data.js) sends it on every /api/* fetch.
const CLIENT_HEADER = 'x-kisat-client';
const CLIENT_HEADER_VALUE = '1';

// Matches the one /api route the Juoksut host serves too (the gate in fetch).
const MEDALS_PATH_RE = /^\/api\/medals\/([^/]+)$/;

// Maps a vanity path to each demo competition. A 302 lets the target change,
// as a browser keeps a 301 for good. It stays on the request's own origin, so
// the Juoksut host lands in its own mode.
const DEMO_PATHS = new Map(
  DEMO_IDS.flatMap((id) => [
    [`/${id}`, `/c/${id}`],
    [`/${id}/`, `/c/${id}`],
  ]),
);

// Lists the paths that serve the document. A meet's views are the paths under
// /c/ (parseRoute, lib/routes.js), so a link preview can name the meet.
const DOC_PATHS = new Set(['/', '/index.html', TABLE_PAGE_PATH, MEDAL_SEASON_PAGE_PATH, CUP_SEASON_PAGE_PATH]);
const MEET_PATH_PREFIX = '/c/';

// --- The document, per host and per meet ---

// Keeps a meet's row for its link preview in KV for a day, a 404 included, so
// a dead id costs one fetch a day. The row comes from the cached calendar or
// from /properties behind META_LIMITER. Any failure serves the plain tags
// (siteMeta, lib/routes.js).
const META_TTL_S = 86_400;
// The document waits for the row, so a slower /properties is dropped as a
// failure and not cached. It answered in under 0.2 s (2026-10).
const META_FETCH_TIMEOUT_MS = 2000;

async function loadMeetRow(env, request, compId) {
  if (demoMeet(compId)) {
    return { row: propertiesMeetRow(demoResponse(`/competition/${compId}/properties`)), cache: 'demo' };
  }
  // A meet that stands alone in elsewhere.json takes its preview row from the
  // file.
  const alone = elsewhereRow(elsewhere, compId);
  if (alone?.id)
    return {
      row: { name: alone.name, location: '', organizationName: '', date: alone.date, days: [] },
      cache: 'elsewhere',
    };
  if (!COMP_ID_RE.test(compId)) return null;
  try {
    const key = `meta:${compId}`;
    const cached = await env.ROSTER.get(key, 'json');
    if (cached) return { row: cached.row, cache: 'hit' };
    const listed = (await env.ROSTER.get(CAL_KEY, 'json'))?.comps?.find((c) => String(c.id) === compId);
    let row;
    if (listed) {
      row = {
        name: listed.name,
        location: listed.location || '',
        organizationName: listed.organizationName || '',
        date: listed.date || '',
        days: listed.days || [],
      };
    } else {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.META_LIMITER.limit({ key: ip });
      if (!success) return null;
      const res = await fetch(`${API}/competition/${compId}/properties`, {
        signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
      });
      if (res.status === 404) row = null;
      else if (!res.ok) return null;
      else row = propertiesMeetRow(await res.json());
    }
    await env.ROSTER.put(key, JSON.stringify({ row }), { expirationTtl: META_TTL_S });
    return { row, cache: 'miss' };
  } catch (err) {
    console.warn(`meta ${compId}: ${err?.message || err}`);
    return null;
  }
}

// Rewrites the tags in the stream, so the Worker never buffers the document. A
// selector that matches nothing fails silently (test/routes.test.mjs checks
// the names).
function rewriteSiteMeta(response, meta) {
  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute('content', meta.title);
      },
    })
    .on('meta[property="og:site_name"]', {
      element(el) {
        el.setAttribute('content', meta.siteName);
      },
    })
    .on('meta[name="description"], meta[property="og:description"]', {
      element(el) {
        el.setAttribute('content', meta.description);
      },
    })
    .transform(response);
}

// Holds the bundle's chunks per module (modules.json, build.mjs) for the
// isolate's life. public/, which `make dev` serves, has none, so its pages
// get no route's preloads.
let bundleModules = null;
async function moduleFiles(env, url) {
  if (!bundleModules) {
    const res = await env.ASSETS.fetch(new Request(new URL('/modules.json', url)));
    bundleModules = res.ok ? (await res.json()).modules : {};
  }
  return bundleModules;
}

// Adds a modulepreload line before the page's script for each file in `paths`,
// in the form of index.html's own lines.
function preloadModules(response, paths) {
  return new HTMLRewriter()
    .on('script[type="module"]', {
      element(el) {
        for (const path of paths) el.before(`<link rel="modulepreload" href="${path}" />\n    `, { html: true });
      },
    })
    .transform(response);
}

// --- The /api routes ---

// Each route has a handler per method, and any other method gets 405 with the
// route's methods in `allow`. A handler gets the request's parts, then the
// pattern's groups, URI-decoded. test-worker.mjs asserts each route's 405.
const API_ROUTES = [
  { re: /^\/api\/search$/, GET: (r) => handleSearch(r.env, r.request, r.url) },
  { re: /^\/api\/clubs$/, GET: (r) => handleClubs(r.env) },
  { re: /^\/api\/meets$/, GET: (r) => handleMeets(r.env) },
  { re: /^\/api\/roster\/([^/]+)$/, GET: (r, id) => handleRoster(id, r.env, r.request, r.ctx) },
  { re: /^\/api\/meet\/([^/]+)$/, GET: (r, id) => handleMeet(id, r.env, r.request) },
  { re: /^\/api\/cup\/([^/]+)$/, GET: (r, id) => handleMeet(id, r.env, r.request, 'cup') },
  { re: MEDALS_PATH_RE, GET: (r, id) => handleMedals(id, r.env, r.request) },
  {
    re: /^\/api\/results\/([^/]+)(?:\/([^/]+))?$/,
    GET: (r, id, eventId) => handleResults(id, eventId, r.env, r.request),
  },
  { re: /^\/api\/scan\/([^/]+)$/, GET: (r, id) => handleScan(id, r.env, r.request, r.url) },
  {
    re: /^\/api\/medalseason\/([^/]+)\/([^/]+)$/,
    GET: (r, scope, year) => handleMedalSeason(scope, year, r.env, r.request, r.url),
  },
  { re: /^\/api\/cupseason\/([^/]+)$/, GET: (r, year) => handleCupSeason(year, r.env, r.request, r.url) },
  { re: /^\/api\/watch$/, POST: (r) => handleWatchCreate(r.env, r.request) },
  {
    re: /^\/api\/watch\/([^/]+)$/,
    GET: (r, id) => handleWatchGet(id, r.env),
    PUT: (r, id) => handleWatchUpdate(id, r.env, r.request),
    DELETE: (r, id) => handleWatchDelete(id, r.env, r.request),
  },
];
const API_METHODS = ['GET', 'PUT', 'POST', 'DELETE'];

function routeApi(r) {
  for (const route of API_ROUTES) {
    const m = route.re.exec(r.url.pathname);
    if (!m) continue;
    const handler = route[r.request.method];
    if (!handler) {
      const allow = API_METHODS.filter((method) => route[method]).join(', ');
      return new Response('Method Not Allowed', { status: 405, headers: { allow } });
    }
    return handler(r, ...m.slice(1).map((part) => part && decodeURIComponent(part)));
  }
  return new Response('Not Found', { status: 404 });
}

// --- The entry points ---

export default {
  async fetch(request, bindings, ctx) {
    const env = previewEnv(bindings);
    const url = new URL(request.url);
    // The one route another origin reads sits outside /api/ (handleCalendar).
    if (url.pathname === CALENDAR_PATH) {
      if (request.method === 'OPTIONS') return calendarPreflight();
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      }
      return handleCalendar(env, request, url, ctx);
    }
    // Only GET and HEAD redirect, and any other method falls through to ASSETS.
    if (DEMO_PATHS.has(url.pathname) && (request.method === 'GET' || request.method === 'HEAD')) {
      // The query rides along for ?mode=juoksut on a dev host (siteMode,
      // lib/routes.js).
      return Response.redirect(`${url.origin}${DEMO_PATHS.get(url.pathname)}${url.search}`, 302);
    }
    if (!url.pathname.startsWith('/api/')) {
      // The manifest and the icons are per host (siteAssetPath, lib/routes.js).
      // The mode comes off the host alone, since a manifest's URL carries none
      // of the page's query. So a dev host always shows Kisat's identity.
      const mode = siteMode(url.hostname, '');
      const alt = siteAssetPath(url.pathname, mode);
      if (alt) {
        const altUrl = new URL(url);
        altUrl.pathname = alt;
        return env.ASSETS.fetch(new Request(altUrl, request));
      }
      // A shared /aidat link lands on /mitat, and the browser carries the
      // fragment. The redirect is temporary (docs/shims.md).
      if (url.pathname === '/aidat') return Response.redirect(`${url.origin}${TABLE_PAGE_PATH}${url.search}`, 302);
      // The /sarjat redirect is temporary the same way (docs/shims.md).
      if (url.pathname === '/sarjat')
        return Response.redirect(`${url.origin}${MEDAL_SEASON_PAGE_PATH}${url.search}`, 302);
      // A day's D.M.YYYY path lands on its YYYY-MM-DD one. The redirect is
      // temporary the same way (legacyDayPath, docs/shims.md).
      const dayPath = legacyDayPath(url.pathname);
      if (dayPath) return Response.redirect(`${url.origin}${dayPath}${url.search}`, 302);
      // The document is per host too, rewritten in the stream (siteMeta,
      // lib/routes.js). Under a meet's path it names the meet.
      const meetPath = url.pathname.startsWith(MEET_PATH_PREFIX);
      if (DOC_PATHS.has(url.pathname) || meetPath) {
        const docUrl = new URL(url);
        docUrl.pathname = '/';
        const route = parseRoute(url.pathname);
        const compId = meetPath ? route.compId : null;
        const [doc, meet, files] = await Promise.all([
          env.ASSETS.fetch(new Request(docUrl, request)),
          compId ? loadMeetRow(env, request, compId) : null,
          moduleFiles(env, url).catch(() => ({})),
        ]);
        const meta = siteMeta(mode, url.pathname, meet?.row);
        // The page's own mode picks its modules, and ?mode= sets it on a dev
        // host.
        const modules = routeModules(route, siteMode(url.hostname, url.search), files);
        let body = meta ? rewriteSiteMeta(doc, meta) : doc;
        if (modules.length) body = preloadModules(body, modules);
        const res = new Response(body.body, doc);
        if (meetPath) res.headers.set('x-meet-meta', meet?.row ? meet.cache : 'none');
        return res;
      }
      return env.ASSETS.fetch(request);
    }
    // The Juoksut host answers 404 to every /api path but the meet's medals,
    // which its piiri sheet and Mitalit view read (loadScopeChoice, app/data.js,
    // docs/backend.md). The host decides, so ?mode=juoksut keeps all of /api.
    if (siteMode(url.hostname, '') === 'juoksut' && !(request.method === 'GET' && MEDALS_PATH_RE.test(url.pathname))) {
      return new Response('Not Found', { status: 404 });
    }
    if (request.headers.get(CLIENT_HEADER) !== CLIENT_HEADER_VALUE) {
      return new Response('Forbidden', { status: 403 });
    }
    // The bearer must match the preview's CRON_TOKEN secret, as a preview's
    // host is public. A preview without the secret refuses every call.
    if (url.pathname === '/api/cron' && env.PREVIEW_DATA === 'own') {
      const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!tokenMatches(bearer, env.CRON_TOKEN)) return new Response('Forbidden', { status: 403 });
      if (request.method !== 'POST')
        return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
      const startMs = Date.now();
      await runCron(env);
      return new Response(`cron done in ${Date.now() - startMs}ms\n`);
    }
    return routeApi({ env, request, url, ctx });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
};

// --- The cron, and a meet's roster ---

// Runs the cron's work. The scheduler calls no preview's scheduled(), so a
// preview with its own data runs it through POST /api/cron (docs/deployment.md,
// "A preview with its own data").
function runCron(env) {
  return crawlMeets(env)
    .then(() => warmSeason(env))
    .then(() => backfillAthletes(env));
}

async function handleRoster(compId, env, request, ctx) {
  const alone = elsewhereRow(elsewhere, compId);
  if (!COMP_ID_RE.test(compId) && !alone?.id) return new Response('Virheellinen kilpailu-id.', { status: 400 });

  const cacheKey = `roster:${compId}`;
  const cached = await env.ROSTER.get(cacheKey, 'json');
  if (cached) {
    const ageS = Math.round((Date.now() - cached.builtAt) / 1000);
    console.log(`roster ${compId}: cache hit, age ${ageS}s`, cached.stats);
    return jsonResponse(cached.roster, { ...cached.stats, cacheHit: true, ageS });
  }

  // Only a miss spends the limiter, since the fan-out is what costs. It counts
  // per IP, so one noisy client cannot use up the other clients' misses.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.ROSTER_LIMITER.limit({ key: ip });
  if (!success) {
    console.warn(`roster ${compId}: rate limit hit for ${ip}`);
    return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', { status: 429 });
  }

  const start = Date.now();
  const built = demoMeet(compId)
    ? buildDemoRoster(compId)
    : alone?.id
      ? await aloneRoster(env, alone)
      : await aggregateRoster(compId);
  if (!built) return new Response('Kilpailua ei löytynyt.', { status: 404 });
  const buildMs = Date.now() - start;
  const stats = { ...built.stats, buildMs };

  console.log(
    `roster ${compId}: built in ${buildMs}ms`,
    stats,
    `${built.roster.athletes.length} athletes, ${built.roster.organizations.length} organizations`,
  );
  if (stats.eventsFailed > 0) {
    console.warn(
      `roster ${compId}: ${stats.eventsFailed}/${stats.eventsTotal} event fetches failed`,
      stats.failedStatuses,
    );
  }

  // A demo roster is static and small, so it is never written to KV.
  if (!demoMeet(compId)) {
    await env.ROSTER.put(cacheKey, JSON.stringify({ builtAt: start, roster: built.roster, stats }), {
      expirationTtl: cacheTtlFor(built.lastDay ?? lastDayIso(scheduleDays(built.schedule)), todayIso(), CACHE_TTLS),
    });
    // After the response, these results build the scan's digest, the picker's
    // two indexes, the meet body and the medals. The meet body and the medals
    // share one /properties read. A row that stands alone skips all five, as
    // aloneRoster writes its medals and the other four are a Tuloslista meet's.
    if (!alone?.id) {
      const props = fetchProps(compId);
      ctx?.waitUntil(
        Promise.all([
          cacheDigest(env, compId, built),
          cacheOrgs(env, built.roster),
          cacheAthletes(env, built),
          cacheMeet(env, compId, built, props),
          cacheMedals(env, compId, built, props),
        ]),
      );
    }
  }
  return jsonResponse(built.roster, { ...stats, cacheHit: false, ageS: 0 });
}

// Builds the roster of a meet that stands alone off the build its medals come
// from (aggregateAlone). Its rows are the people of its rounds, as it has no
// entries here (aloneEntries). It keeps that build's medal body.
async function aloneRoster(env, row) {
  const built = await aggregateAlone(env, row);
  if (!built) return null;
  await putMedals(env, row.id, built.body, { ...built.stats, buildMs: 0 }, built.lastDay);
  const events = built.kept.map(({ eventId, data }) => ({
    eventId,
    data: { ...data, Enrollments: aloneEntries(data) },
  }));
  return { roster: buildRoster(events), stats: built.stats, lastDay: built.lastDay };
}

// Tuloslista publishes no rate limit (docs/tuloslista-api.md), so a miss runs
// its subrequests through a small pool. The pool's size is a guess.
const ROSTER_FETCH_CONCURRENCY = 8;

// Reads an upstream body as JSON, or null where it does not parse, so a
// broken body fails the fetch as a bad status does and throws no build.
const upstreamJson = (res) => res.json().catch(() => null);

// Fetches every scheduled event's results for the roster, the cup standings
// and the medals. `label` names the caller in the log line.
async function fetchEventResults(compId, label) {
  const scheduleRes = await fetch(`${API}/competition/${compId}`);
  const schedule = scheduleRes.ok ? await upstreamJson(scheduleRes) : null;
  if (!schedule) return null;
  const eventIds = scheduleEventIds(schedule);

  // Tallies failures per status, as a 429 is throttling and a lone 502 is not.
  const failedStatuses = {};
  const results = await mapWithConcurrency(eventIds, ROSTER_FETCH_CONCURRENCY, async (eventId) => {
    const r = await fetch(`${API}/results/${compId}/${eventId}`);
    const data = r.ok ? await upstreamJson(r) : null;
    if (!data) {
      const why = r.ok ? 'body' : r.status;
      failedStatuses[why] = (failedStatuses[why] || 0) + 1;
      console.warn(
        `${label} ${compId}: /results/${compId}/${eventId} -> ${r.ok ? 'a broken body' : `HTTP ${r.status}`}`,
      );
      return null;
    }
    return { eventId, data };
  });

  const ok = results.filter(Boolean);
  // Fetches the multi-events' roots for the medal table alone (cacheMedals).
  // They are on no day's schedule. They stay out of `events`, since the cup
  // scores a club through the legs and would score it twice (docs/backend.md,
  // "The medal table").
  const rootIds = [...new Set([...combinedEventRoots(ok).values()].map((r) => r.id))];
  const roots = (
    await mapWithConcurrency(rootIds, ROSTER_FETCH_CONCURRENCY, async (eventId) => {
      const r = await fetch(`${API}/results/${compId}/${eventId}`);
      const data = r.ok ? await upstreamJson(r) : null;
      if (!data) {
        console.warn(
          `${label} ${compId}: /results/${compId}/${eventId} (root) -> ${r.ok ? 'a broken body' : `HTTP ${r.status}`}`,
        );
        return null;
      }
      return { eventId, data };
    })
  ).filter(Boolean);
  return {
    schedule,
    events: ok,
    roots,
    stats: { eventsTotal: eventIds.length, eventsFailed: eventIds.length - ok.length, failedStatuses },
  };
}

async function aggregateRoster(compId) {
  const fetched = await fetchEventResults(compId, 'roster');
  if (!fetched) return null;
  const ok = fetched.events;
  return {
    roster: buildRoster(ok),
    // The digest, the cup standings and the medals are cut from the same
    // fetch (cacheDigest, cacheMeet, cacheMedals).
    schedule: fetched.schedule,
    events: ok,
    roots: fetched.roots,
    combinedRoots: combinedEventRoots(ok),
    stats: fetched.stats,
  };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// --- What a competition's own settings say ----------------------
//
// GET /api/meet/:compId answers the meet body (cupBody, lib/cup.js). Its
// shapes are in docs/backend.md, "What a competition's own settings say".

function meetKey(compId) {
  return `meet:${compId}`;
}

// GET /api/cup/:compId answers where each club's points came from
// (cupBreakdown, lib/cup.js). It is the same build's other half, with a key
// and a route of its own for its size (docs/backend.md).
function cupKey(compId) {
  return `cup:${compId}`;
}

// `want` picks the half of the build to answer with, 'meet' or 'cup'.
async function handleMeet(compId, env, request, want = 'meet') {
  if (!COMP_ID_RE.test(compId)) return new Response('Virheellinen kilpailu-id.', { status: 400 });

  const cached = await env.ROSTER.get(want === 'cup' ? cupKey(compId) : meetKey(compId), 'json');
  if (cached) {
    const ageS = Math.round((Date.now() - cached.builtAt) / 1000);
    console.log(`${want} ${compId}: cache hit, age ${ageS}s`, cached.stats);
    return jsonResponse(cached.body, { ...cached.stats, cacheHit: true, ageS }, want);
  }

  // A miss can pay the roster's fan-out, so it spends the roster's limiter.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.ROSTER_LIMITER.limit({ key: ip });
  if (!success) {
    console.warn(`meet ${compId}: rate limit hit for ${ip}`);
    return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', { status: 429 });
  }

  const start = Date.now();
  const built = demoMeet(compId) ? buildDemoMeet(compId) : await aggregateMeet(compId);
  if (!built) return new Response('Kilpailua ei löytynyt.', { status: 404 });
  const stats = { ...built.stats, buildMs: Date.now() - start };

  console.log(
    `meet ${compId}: built in ${stats.buildMs}ms`,
    stats,
    built.body.cup
      ? `${built.body.clubs.length} clubs${built.body.final ? ', a final' : `, ${built.body.scoring.length} scoring rows`}`
      : 'not a cup',
  );

  // A demo's body is static and small like its roster, and KV never holds it.
  if (!demoMeet(compId)) await putMeet(env, compId, built, stats, built.lastDay);
  return jsonResponse(want === 'cup' ? built.detail : built.body, { ...stats, cacheHit: false, ageS: 0 }, want);
}

// A demo's roster is app/data.js's offline body (demoApiBody, lib/demo-api.js).
function buildDemoRoster(compId) {
  return {
    roster: demoApiBody(`/api/roster/${compId}`, DEMO_API),
    stats: { eventsTotal: scheduleEventIds(demoSchedule(compId)).length, eventsFailed: 0, failedStatuses: {} },
  };
}

// Builds the meet body and the breakdown off one `/properties` read. Only a
// cup pays the fan-out.
async function aggregateMeet(compId) {
  const propsRes = await fetch(`${API}/competition/${compId}/properties`);
  const props = propsRes.ok ? await upstreamJson(propsRes) : null;
  if (!props) return null;
  const empty = { eventsTotal: 0, eventsFailed: 0, failedStatuses: {} };
  if (!cupMode(props)) return { body: { cup: false, confirm: confirmSetting(props) }, stats: empty, lastDay: null };

  const fetched = await fetchEventResults(compId, 'cup');
  if (!fetched) return null;
  return {
    body: cupBody(props, fetched.schedule, fetched.events),
    detail: cupDetail(props, fetched.schedule, fetched.events),
    stats: fetched.stats,
    lastDay: lastDayIso(scheduleDays(fetched.schedule)),
  };
}

// A demo's two halves are the bodies app/data.js answers with offline
// (demoApiBody, lib/demo-api.js).
function buildDemoMeet(compId) {
  const schedule = demoSchedule(compId);
  return {
    body: demoApiBody(`/api/meet/${compId}`, DEMO_API),
    detail: demoApiBody(`/api/cup/${compId}`, DEMO_API),
    stats: { eventsTotal: scheduleEventIds(schedule).length, eventsFailed: 0, failedStatuses: {} },
    lastDay: lastDayIso(scheduleDays(schedule)),
  };
}

// Writes a build's two halves under one TTL. Only a cup keeps a breakdown and
// a season record, which lasts as long as a digest. Returns that record.
async function putMeet(env, compId, built, stats, lastDay) {
  const { body, detail } = built;
  const builtAt = Date.now();
  const expirationTtl = body.cup ? CUP_CACHE_TTL_S : NOT_A_CUP_TTL_S;
  await env.ROSTER.put(meetKey(compId), JSON.stringify({ builtAt, body, stats }), { expirationTtl });
  if (!body.cup || !detail) return null;
  const record = cupSeasonRecord(body, detail, builtAt, lastDay);
  await Promise.all([
    env.ROSTER.put(cupKey(compId), JSON.stringify({ builtAt, body: detail, stats }), { expirationTtl }),
    env.ROSTER.put(cupSeasonKey(compId), JSON.stringify(record), { expirationTtl: DIGEST_KV_TTL_S }),
  ]);
  return record;
}

// --- The meet's medal table ---------------------------------------
//
// GET /api/medals/:compId answers the meet's medal tables (meetMedalsBody,
// lib/medals.js), whose fields docs/backend.md lists ("The medal table"). It
// counts every event and the multi-events' roots. Its key
// keeps the roster's TTL, as it is the same fan-out reduced another way.
function medalsKey(compId) {
  return `medals:v9:${compId}${elsewhereTag(elsewhere, compId)}`;
}

// Writes the medal body and its season record, which lasts as long as a
// digest (medalSeasonRecord, lib/medals.js). The meet's `lastDay` sets the
// body's TTL and the record's freshness (isStale). Returns the record.
async function putMedals(env, compId, body, stats, lastDay) {
  const builtAt = Date.now();
  const record = medalSeasonRecord(body, builtAt, lastDay);
  await Promise.all([
    env.ROSTER.put(medalsKey(compId), JSON.stringify({ builtAt, body, stats }), {
      expirationTtl: cacheTtlFor(lastDay, todayIso(), CACHE_TTLS),
    }),
    env.ROSTER.put(medalSeasonKey(compId), JSON.stringify(record), { expirationTtl: DIGEST_KV_TTL_S }),
  ]);
  return record;
}

// Reads a meet's /properties, or null where it does not answer.
async function fetchProps(compId) {
  const res = await fetch(`${API}/competition/${compId}/properties`).catch(() => null);
  return res?.ok ? upstreamJson(res) : null;
}

// Gives the meet's name and organiser, which say whose championship it is
// (defaultScopes, lib/districts.js), and whether elsewhere.json lists it. A
// /properties that does not answer costs the body the defaults its name gives.
function meetNames(compId, props) {
  return {
    name: props?.Competition?.Name || '',
    organiser: props?.Competition?.Organization || '',
    listed: Boolean(elsewhereRow(elsewhere, compId)),
  };
}

// A meet that elsewhere.json lists has its results on another site, read
// once the meet is over (docs/elsewhere.md). Each page is kept parsed with its
// ETag, so a rebuild parses only a page that changed.
const ELSEWHERE_USER_AGENT = 'kisat.matilainen.fi (+https://kisat.matilainen.fi/)';
// Outlasts the month in which a record is still rebuilt (recordSettled).
const T4R_KV_TTL_S = 45 * 24 * 60 * 60;

function t4rPagesKey(compId) {
  return `t4r:v7:${compId}`;
}

// Returns {schedule, events} for meetMedalsBody with the roots among the
// events. `kept` is what putResults writes, empty until the meet is over. Null
// means the source gave nothing, so a meet never settles without its medals.
async function graftElsewhere(env, compId, { schedule, events, roots }) {
  const all = [...events, ...(roots || [])];
  const row = elsewhereRow(elsewhere, compId);
  const lastDay = lastDayIso(scheduleDays(schedule));
  if (!lastDay || lastDay >= todayIso()) return { schedule, events: all, kept: [] };
  if (row?.ol) return graftRace(env, compId, row, schedule, all);
  if (row?.t4r) return graftSite(env, compId, row, schedule, all);
  return { schedule, events: all, kept: [] };
}

// Puts the other site's results on the meet's own entries (t4rGraft).
async function graftSite(env, compId, row, schedule, all) {
  const [pages, licences] = await Promise.all([t4rPagesOf(env, compId, row.t4r, all), madeLicences(env)]);
  if (!pages.length) {
    console.warn(`medals ${compId}: ${row.t4r} gave no pages`);
    return null;
  }
  const grafted = t4rGraft(schedule, all, pages, licences);
  await putResults(env, compId, grafted.events, grafted.schedule);
  return { ...grafted, kept: grafted.events };
}

// Returns the other site's parsed pages, kept under the meet's key and asked
// again with their `ETag`. A row with no meet here passes null (t4rWanted).
async function t4rPagesOf(env, compId, slug, eventResults) {
  const stored = (await env.ROSTER.get(t4rPagesKey(compId), 'json')) || {};
  const kept = {};
  const counts = { read: 0, unchanged: 0, failed: 0 };
  const read = async (path, parse) => {
    const prev = stored[path];
    const res = await fetch(`${T4R_BASE}/${slug}/${path}`, {
      headers: { 'User-Agent': ELSEWHERE_USER_AGENT, ...(prev?.etag ? { 'If-None-Match': prev.etag } : {}) },
    }).catch(() => null);
    if (res?.status === 304 && prev) {
      counts.unchanged += 1;
      kept[path] = prev;
    } else if (res?.ok) {
      counts.read += 1;
      kept[path] = { etag: res.headers.get('etag'), body: parse(t4rDecode(await res.arrayBuffer())) };
    } else {
      counts.failed += 1;
      console.warn(`medals ${compId}: ${slug}/${path} -> HTTP ${res?.status ?? 'none'}`);
      if (prev) kept[path] = prev;
    }
    return kept[path]?.body ?? null;
  };
  const pages = await t4rSitePages(read, eventResults, (items, fn) =>
    mapWithConcurrency(items, ROSTER_FETCH_CONCURRENCY, fn),
  );
  if (counts.read) await env.ROSTER.put(t4rPagesKey(compId), JSON.stringify(kept), { expirationTtl: T4R_KV_TTL_S });
  console.log(`medals ${compId}: ${pages.length} pages of ${slug}`, counts);
  return pages;
}

// GET /api/results/:compId/:eventId answers one event of a listed meet in
// the shape of Tuloslista's own /results. A key holds one event, since a
// start view asks for a few events, and a meet's events are large together
// (docs/backend.md, "Results from another site").
function resultsKey(compId, eventId) {
  return `results:v2:${compId}:${eventId}${elsewhereTag(elsewhere, compId)}`;
}

// GET /api/results/:compId answers the same meet's schedule in the shape of
// Tuloslista's /competition/:id. It carries the rounds the meet's own schedule
// lacks (t4rGraft), so a day list can show them.
function graftedScheduleKey(compId) {
  return `schedule:v1:${compId}${elsewhereTag(elsewhere, compId)}`;
}

// Keeps the graft's events and schedule as long as a digest. Only a medal
// build makes them, so a miss builds the medals again (handleResults).
async function putResults(env, compId, events, schedule) {
  await mapWithConcurrency(events, ROSTER_FETCH_CONCURRENCY, ({ eventId, data }) =>
    env.ROSTER.put(resultsKey(compId, eventId), JSON.stringify({ builtAt: Date.now(), data }), {
      expirationTtl: DIGEST_KV_TTL_S,
    }),
  );
  if (schedule) {
    await env.ROSTER.put(graftedScheduleKey(compId), JSON.stringify({ builtAt: Date.now(), data: schedule }), {
      expirationTtl: DIGEST_KV_TTL_S,
    });
  }
  console.log(`results ${compId}: ${events.length} events kept`);
}

// Builds the medals as a byproduct of a roster build, like cacheMeet. The
// results and roots are in hand, so an unlisted meet costs one /properties
// read. A listed meet whose source gives nothing is left to the next build.
async function cacheMedals(env, compId, built, propsRead) {
  const grafted = await graftElsewhere(env, compId, built);
  if (!grafted) {
    console.warn(`medals ${compId}: the source gave nothing, no medals kept`);
    return;
  }
  const body = meetMedalsBody(grafted.schedule, grafted.events, districts, meetNames(compId, await propsRead));
  await putMedals(env, compId, body, { ...built.stats, buildMs: 0 }, lastDayIso(scheduleDays(built.schedule)));
  console.log(`medals ${compId}: ${body.table.length} clubs, from the roster's fan-out`);
}

// Builds the medals of a meet no roster build has covered, for a cache miss
// or a year's build. Returns null when the meet does not answer or a listed
// meet's source gives nothing.
async function aggregateMedals(env, compId) {
  const fetched = await fetchEventResults(compId, 'medals');
  if (!fetched) return null;
  const grafted = await graftElsewhere(env, compId, fetched);
  if (!grafted) return null;
  const { schedule, events, kept } = grafted;
  const body = meetMedalsBody(schedule, events, districts, meetNames(compId, await fetchProps(compId)));
  return { body, kept, schedule, stats: fetched.stats, lastDay: lastDayIso(scheduleDays(fetched.schedule)) };
}

// Reads the race files that olAloneMeet and olGraft read (docs/elsewhere.md,
// "A championship in a race's files"). A race publishes its results whole or
// one file a class. Returns null when a file does not answer or when the race
// lacks a class the row names.
const OL_FILES_BASE = 'https://online.tulospalvelu.fi/tulokset-new/online';
async function olFiles(row) {
  const read = (file) =>
    fetch(`${OL_FILES_BASE}/online_${row.ol}_${file}.json`, { headers: { 'User-Agent': ELSEWHERE_USER_AGENT } })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  const classIds = [...new Set(Object.values(row.classes || {}))];
  const [event, competitors, whole] = await Promise.all([read('event'), read('competitors'), read('results')]);
  if (!event || !competitors) return null;
  const byClass = new Map((whole?.Results || []).map((r) => [r.ClassID, r]));
  const races = whole
    ? classIds.map((id) => byClass.get(id))
    : await mapWithConcurrency(classIds, ROSTER_FETCH_CONCURRENCY, (id) => read(`results_${id}_1`));
  if (races.some((r) => !r)) return null;
  return { event, competitors, results: Object.fromEntries(classIds.map((id, i) => [id, races[i]])) };
}

// Grafts a race's results onto a meet that is here for its entries alone
// (olGraft). The meet's own entries keep their ids and licences. Returns null
// where the files do not answer.
async function graftRace(env, compId, row, schedule, all) {
  const [files, orgs, licences] = await Promise.all([
    olFiles(row),
    env.ROSTER.get(ORGS_KEY, 'json'),
    madeLicences(env),
  ]);
  if (!files) {
    console.warn(`medals ${compId}: ${row.ol} did not answer`);
    return null;
  }
  const grafted = olGraft(schedule, all, row, files, orgIndexClubs(orgs), elsewhere, districts, licences);
  await putResults(env, compId, grafted.events, grafted.schedule);
  console.log(`medals ${compId}: ${Object.keys(row.classes).length} classes of ${row.ol}`);
  return { ...grafted, kept: grafted.events };
}

// Builds a championship with no meet here off a mass race's files or off the
// other site, once its last day is over (docs/elsewhere.md). Returns null
// where the source gives nothing. A race's schedule is not kept (olSchedule).
async function aggregateAlone(env, row) {
  const meet = { name: row.name, organiser: '', listed: true };
  const stats = { eventsTotal: Object.keys(row.classes || {}).length, eventsFailed: 0, failedStatuses: {} };
  const lastDay = elsewhereLastDay(row);
  if (lastDay >= todayIso()) {
    return { body: meetMedalsBody({}, [], districts, meet), kept: [], schedule: null, stats, lastDay };
  }
  const [orgs, licences] = await Promise.all([env.ROSTER.get(ORGS_KEY, 'json'), madeLicences(env)]);
  const clubs = orgIndexClubs(orgs);
  let built;
  if (row.t4r) {
    const pages = await t4rPagesOf(env, row.id, row.t4r, null);
    built = pages.length ? t4rAloneMeet(row, pages, clubs, elsewhere, districts, licences) : null;
  } else {
    const files = await olFiles(row);
    built = files ? olAloneMeet(row, files, clubs, elsewhere, districts, licences) : null;
  }
  if (!built) return null;
  const schedule = row.t4r ? built.schedule : null;
  await putResults(env, row.id, built.events, schedule);
  return {
    body: meetMedalsBody(built.schedule, built.events, districts, meet),
    kept: built.events,
    schedule,
    stats: { ...stats, eventsTotal: stats.eventsTotal || built.events.length },
    lastDay,
  };
}

// Builds a year's meet and writes its record. A Tuloslista meet builds off
// its own results, and a row that stands alone off its race's files or the
// other site (aggregateAlone). Returns null when the meet does not answer.
async function buildMedalSeason(env, id) {
  const start = Date.now();
  const row = elsewhereRow(elsewhere, id);
  const built = row?.id ? await aggregateAlone(env, row) : COMP_ID_RE.test(id) ? await aggregateMedals(env, id) : null;
  return built && putMedals(env, id, built.body, { ...built.stats, buildMs: Date.now() - start }, built.lastDay);
}

// A demo's medals are the body app/data.js answers with offline (demoApiBody,
// lib/demo-api.js).
function buildDemoMedals(compId) {
  return {
    body: demoApiBody(`/api/medals/${compId}`, DEMO_API),
    stats: { eventsTotal: Object.keys(demoEvents(compId)).length, eventsFailed: 0, failedStatuses: {} },
  };
}

// Follows handleMeet's shape, over a fan-out that every meet pays.
async function handleMedals(compId, env, request) {
  const row = elsewhereRow(elsewhere, compId);
  if (!COMP_ID_RE.test(compId) && !row) return new Response('Virheellinen kilpailu-id.', { status: 400 });

  const cached = await env.ROSTER.get(medalsKey(compId), 'json');
  if (cached) {
    const ageS = Math.round((Date.now() - cached.builtAt) / 1000);
    console.log(`medals ${compId}: cache hit, age ${ageS}s`, cached.stats);
    return jsonResponse(cached.body, { ...cached.stats, cacheHit: true, ageS }, 'medals');
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.ROSTER_LIMITER.limit({ key: ip });
  if (!success) {
    console.warn(`medals ${compId}: rate limit hit for ${ip}`);
    return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', { status: 429 });
  }

  const start = Date.now();
  let built;
  if (demoMeet(compId)) built = buildDemoMedals(compId);
  else {
    built = row?.id ? await aggregateAlone(env, row) : await aggregateMedals(env, compId);
    if (!built) return new Response('Kilpailua ei löytynyt.', { status: 404 });
  }
  const stats = { ...built.stats, buildMs: Date.now() - start };
  console.log(`medals ${compId}: built in ${stats.buildMs}ms`, stats, `${built.body.table.length} clubs`);
  if (!demoMeet(compId)) await putMedals(env, compId, built.body, stats, built.lastDay);
  return jsonResponse(built.body, { ...stats, cacheHit: false, ageS: 0 }, 'medals');
}

// Answers a listed meet's grafted event, or its schedule with no `eventId`,
// off the keys a medal build wrote. A miss runs that build and keeps its medal
// body. A row alone in a race's files serves no schedule (olSchedule).
async function handleResults(compId, eventId, env, request) {
  const row = elsewhereRow(elsewhere, compId);
  if (!row || (!eventId && row.id && row.ol)) return new Response('Kilpailua ei löytynyt.', { status: 404 });

  const label = eventId ? `results ${compId}/${eventId}` : `schedule ${compId}`;
  const key = eventId ? resultsKey(compId, eventId) : graftedScheduleKey(compId);
  const cached = await env.ROSTER.get(key, 'json');
  if (cached) {
    const ageS = Math.round((Date.now() - cached.builtAt) / 1000);
    console.log(`${label}: cache hit, age ${ageS}s`);
    return resultsResponse(cached.data, { hit: true, ageS });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.ROSTER_LIMITER.limit({ key: ip });
  if (!success) {
    console.warn(`${label}: rate limit hit for ${ip}`);
    return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', { status: 429 });
  }

  const start = Date.now();
  const built = row.id ? await aggregateAlone(env, row) : await aggregateMedals(env, compId);
  if (!built) return new Response('Kilpailua ei löytynyt.', { status: 404 });
  await putMedals(env, compId, built.body, { ...built.stats, buildMs: Date.now() - start }, built.lastDay);
  const data = eventId ? built.kept.find((e) => String(e.eventId) === eventId)?.data : built.schedule;
  console.log(`${label}: built ${built.kept.length} events in ${Date.now() - start}ms`);
  if (!data) return new Response(eventId ? 'Lajia ei löytynyt.' : 'Kilpailua ei löytynyt.', { status: 404 });
  return resultsResponse(data, { hit: false, ageS: 0 });
}

function resultsResponse(data, { hit, ageS }) {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'x-content-type-options': 'nosniff',
      'x-results-cache': hit ? 'hit' : 'miss',
      'x-results-cache-age-s': String(ageS),
    },
  });
}

// Writes the meet body off a roster build's results and its `/properties`
// read. It writes the body of a meet with no cup too, which is most meets.
async function cacheMeet(env, compId, built, propsRead) {
  const props = await propsRead;
  if (!props) return null;
  const body = cupBody(props, built.schedule, built.events);
  const detail = cupDetail(props, built.schedule, built.events);
  await putMeet(
    env,
    compId,
    { body, detail },
    { ...built.stats, buildMs: 0 },
    lastDayIso(scheduleDays(built.schedule)),
  );
  console.log(`meet ${compId}: ${body.cup ? `${body.clubs.length} clubs` : 'not a cup'}, from the roster's fan-out`);
  return body;
}

// --- Cross-meet front page ------------------------------------
//
// GET /api/scan/:watchId?day=YYYY-MM-DD[&build=1] answers which meets around
// `day` have somebody of this follow-list entered. Its three cached layers,
// L1 to L3, and its fixed window are in docs/backend.md, "The scan, and its
// three layers".
const CAL_WINDOW_PAST_DAYS = RECENT_DAYS;
const CAL_WINDOW_FUTURE_DAYS = 60;
const CAL_KEY = 'cal:v1';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Sets the calendar's age before a rebuild, how long a meet's known days are
// trusted, and when an empty schedule is asked again. A meet that is over is
// never asked again. All three are guesses.
const CAL_CACHE_TTL_S = 900;
const CAL_DAYS_REFRESH_S = 43_200;
const CAL_EMPTY_RETRY_S = 3600;
// Caps a cold rebuild at about one roster build's upstream traffic, as
// estimated in docs/backend.md, "L1 is the calendar index".
const CAL_SCHEDULE_FETCH_LIMIT = 60;

// Caps the digests built per build=1 request, and the rest come back pending
// for app/home.js to ask again. A cold window at its busiest takes a few
// minutes under SCAN_LIMITER's 10 a minute (docs/backend.md).
const SCAN_BUILD_LIMIT = 3;
// Sets when a digest turns stale, and a stale one is served and queued for a
// rebuild. A past meet's digest has stopped changing. Both figures are
// guesses.
const DIGEST_FRESH_PAST_S = 7 * 24 * 60 * 60;
const DIGEST_FRESH_LIVE_S = 60 * 60;
// Keeps a digest in KV far past either window, so a quiet spell never deletes
// the last known data. The figure is a guess, of WATCH_TTL_S's order.
const DIGEST_KV_TTL_S = 180 * 24 * 60 * 60;

// Returns the Worker's UTC day. A request's own `day` is the client's Finnish
// day, which is the one that matters around midnight.
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function digestKey(compId) {
  return `digest:${compId}`;
}

function lastDayIso(days) {
  return days?.length ? fiToIsoDay(days[days.length - 1]) : '';
}

async function cacheDigest(env, compId, built) {
  const days = scheduleDays(built.schedule);
  const drawn = drawnEntries(built.events);
  const order = scheduleEventOrder(built.schedule);
  const digest = buildDigest(buildRoster(drawn), days, order, built.combinedRoots, relayTeams(drawn));
  await env.ROSTER.put(digestKey(compId), JSON.stringify({ builtAt: Date.now(), digest }), {
    expirationTtl: DIGEST_KV_TTL_S,
  });
  console.log(
    `digest ${compId}: ${digest.athletes.length} athletes, ${digest.teams.length} teams, kept ${DIGEST_KV_TTL_S}s`,
  );
  return digest;
}

// --- Club index (see mergeOrgIndex, lib/indexes.js) ----------------------

const ORGS_KEY = 'orgs:v1';

// Writes the index only where the merge changed it. It has no TTL, since a
// follow-list is built from it with no meet open. KV has no compare-and-swap,
// so a concurrent build's clubs can be lost until that meet's next build.
async function cacheOrgs(env, roster) {
  const stored = await env.ROSTER.get(ORGS_KEY, 'json');
  const { index, changed } = mergeOrgIndex(stored, roster?.organizations);
  if (!changed) return index;
  await env.ROSTER.put(ORGS_KEY, JSON.stringify(index));
  console.log(`orgs: index now ${index.orgs.length} clubs`);
  return index;
}

// Answers the whole club list to an open app whose app.js still asks for it.
// The route is a temporary shim (docs/shims.md).
async function handleClubs(env) {
  const clubs = orgIndexClubs(await env.ROSTER.get(ORGS_KEY, 'json'));
  return new Response(JSON.stringify({ clubs }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=600',
      'x-content-type-options': 'nosniff',
      'x-clubs': String(clubs.length),
    },
  });
}

// --- Athlete index (see mergeAthleteIndex, lib/indexes.js) ---------------

const ATHLETES_KEY = 'athletes:v1';

// Writes the index only where the merge changed it. It has no TTL, since the
// merge prunes it to two seasons. KV has no compare-and-swap, so a concurrent
// build's people can be lost until that meet's next build.
async function cacheAthletes(env, built) {
  const stored = await env.ROSTER.get(ATHLETES_KEY, 'json');
  const year = Number((lastDayIso(scheduleDays(built.schedule)) || todayIso()).slice(0, 4));
  const { index, changed } = mergeAthleteIndex(stored, rosterPeople(built.roster), { year, todayIso: todayIso() });
  if (!changed) return index;
  await env.ROSTER.put(ATHLETES_KEY, JSON.stringify(index));
  console.log(`athletes: index now ${index.athletes.length} people`);
  return index;
}

// Looks up a made person's licence by name and club (athleteLicences).
const madeLicences = async (env) => athleteLicences(await env.ROSTER.get(ATHLETES_KEY, 'json'));

// Walks one page of digest keys per cron run, as every meet a roster build has
// covered has one. A digest written behind the walk is not missed, since its
// build indexed its own people at the same moment.
const ATHLETE_BACKFILL_PAGE = 50;

async function backfillAthletes(env) {
  const stored = await env.ROSTER.get(ATHLETES_KEY, 'json');
  const cursor = athleteBackfillCursor(stored);
  if (cursor === null) return;

  const startMs = Date.now();
  const page = await env.ROSTER.list({ prefix: 'digest:', limit: ATHLETE_BACKFILL_PAGE, cursor: cursor || undefined });
  const today = todayIso();
  // Groups the people by year, since a merge takes one year for its whole
  // batch. At most two years survive seasonYears (lib/indexes.js).
  const byYear = new Map();
  for (const { name } of page.keys) {
    const record = await env.ROSTER.get(name, 'json');
    const { year, people } = digestSeasonPeople(record?.digest, today);
    if (people.length) byYear.set(year, (byYear.get(year) || []).concat(people));
  }

  let index = stored;
  for (const [year, people] of byYear) index = mergeAthleteIndex(index, people, { year, todayIso: today }).index;
  index = athleteBackfillAt(index, page.list_complete ? null : page.cursor);
  await env.ROSTER.put(ATHLETES_KEY, JSON.stringify(index));
  console.log(
    `athletes backfill: ${page.keys.length} digests in ${Date.now() - startMs}ms, ` +
      `index now ${index.athletes.length} people${page.list_complete ? ', done' : ''}`,
  );
}

// --- The picker's search (docs/backend.md) ------------------------------

// Returns what the open meet adds to the search (docs/backend.md). Its clubs
// are in the club index already, and only a demo's are added. A demo is
// built on the spot, since KV never holds one.
async function scopedSearch(env, compId) {
  if (demoMeet(compId)) return demoSearchScope(compId, DEMO_API);
  const stored = await env.ROSTER.get(digestKey(compId), 'json');
  if (stored?.digest?.v !== DIGEST_VERSION) return { clubs: [], people: [] };
  return { clubs: [], people: digestPeople(stored.digest) };
}

// Costs two KV reads and the open meet's one. A query under SEARCH_MIN_CHARS
// answers empty, since a keystroke is no error, and spends no SEARCH_LIMITER.
async function handleSearch(env, request, url) {
  const query = url.searchParams.get('q') || '';
  const compId = url.searchParams.get('comp') || '';
  if (!searchQuery(query)) return searchResponse([], []);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.SEARCH_LIMITER.limit({ key: ip });
  if (!success) {
    console.warn(`search: rate limit hit for ${ip}`);
    return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', { status: 429 });
  }

  const scoped = COMP_ID_RE.test(compId) ? await scopedSearch(env, compId) : { clubs: [], people: [] };
  const [orgs, athleteIndex] = await Promise.all([
    env.ROSTER.get(ORGS_KEY, 'json'),
    env.ROSTER.get(ATHLETES_KEY, 'json'),
  ]);
  const { clubs, athletes } = searchBody(scoped, orgIndexClubs(orgs), athleteIndex, query);
  return searchResponse(clubs, athletes);
}

function searchResponse(clubs, athletes) {
  return new Response(JSON.stringify({ clubs, athletes }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The query string is the whole of the key, so a repeated search
      // costs nothing upstream. A name just indexed waits out the 300 s.
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'x-search-clubs': String(clubs.length),
      'x-search-athletes': String(athletes.length),
    },
  });
}

// --- Meet index (see mergeMeetIndex, lib/indexes.js) ---------------------

const MEETS_KEY = 'meets:v1';

// Caps a run's /properties asks, made one at a time, well inside the
// 10-minute interval and the paid plan's 10,000 subrequests (docs/backend.md,
// "The meet index").
const MEET_CRAWL_BUDGET = 400;

// Crawls the meet index. The cron is the key's only writer, so the write
// cannot race. The key has no TTL, as the merge prunes by season. An answer
// other than a meet or a 404 ends the run (meetCrawlStops).
async function crawlMeets(env) {
  const startMs = Date.now();
  const stored = await env.ROSTER.get(MEETS_KEY, 'json');
  const res = await fetch(`${API}/competition`).catch(() => null);
  const listing = res?.ok ? await upstreamJson(res) : null;
  if (!listing) console.warn(`meets: listing fetch failed (${res?.status ?? 'network'})`);
  const merged = mergeMeetIndex(stored, listingMeets(listing), { todayIso: todayIso() });
  const ids = (listing || []).map((c) => Number(c.Id)).filter(Number.isFinite);
  const plan = meetCrawlPlan(merged.index, { top: ids.length ? Math.max(...ids) : null, budget: MEET_CRAWL_BUDGET });

  const answers = [];
  for (const id of plan.ids) {
    const r = await fetch(`${API}/competition/${id}/properties`).catch(() => null);
    const status = r?.status ?? 0;
    answers.push({ id, status, props: r?.ok ? await r.json().catch(() => null) : null });
    if (meetCrawlStops(status)) break;
  }
  const applied = meetCrawlApply(merged.index, plan, answers, { todayIso: todayIso() });
  const { index } = applied;
  const stop = answers.find((a) => meetCrawlStops(a.status));
  console.log(
    `meets: ${answers.length} asked in ${Date.now() - startMs}ms${stop ? `, stopped at HTTP ${stop.status}` : ''}, ` +
      `${index.meets.length} indexed, crawl ${index.crawl?.done ? 'done' : (index.crawl?.next ?? '-')}`,
  );
  if (merged.changed || applied.changed) await env.ROSTER.put(MEETS_KEY, JSON.stringify(index));
}

// Costs one KV read, and answers no meets until the cron has run once.
async function handleMeets(env) {
  const index = await env.ROSTER.get(MEETS_KEY, 'json');
  const meets = meetIndexMeets(index);
  return new Response(JSON.stringify({ meets }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=600',
      'x-content-type-options': 'nosniff',
      'x-meets': String(meets.length),
      'x-meets-crawl': index?.crawl?.done ? 'done' : String(index?.crawl?.next ?? '-'),
    },
  });
}

// Says whether a digest or a season record is past its freshness window
// (DIGEST_FRESH_PAST_S, DIGEST_FRESH_LIVE_S), off its builtAt and the meet's
// last day. A stale one can still be in KV.
function isStale(builtAt, lastDay, now) {
  const freshS = lastDay && lastDay < todayIso() ? DIGEST_FRESH_PAST_S : DIGEST_FRESH_LIVE_S;
  return (now - builtAt) / 1000 > freshS;
}

// Says whether a competition's days need fetching again. A meet that is over
// is never fetched again, as its days are final and half the listing is over.
function needsSchedule(comp, now) {
  if (!comp.daysAt) return true;
  const last = lastDayIso(comp.days);
  if (last && last < todayIso()) return false;
  const ageS = (now - comp.daysAt) / 1000;
  return ageS > (comp.days.length ? CAL_DAYS_REFRESH_S : CAL_EMPTY_RETRY_S);
}

// Builds L1, returning { comps, cache } with every listed competition and the
// real days of each whose schedule was fetched. Returns null if the listing
// fails and no calendar is cached.
async function loadCalendar(env, dayIso, fromIso, toIso) {
  const cached = await env.ROSTER.get(CAL_KEY, 'json');
  const now = Date.now();
  if (cached && now - cached.builtAt < CAL_CACHE_TTL_S * 1000) {
    return { comps: cached.comps, cache: 'hit' };
  }

  const res = await fetch(`${API}/competition`).catch(() => null);
  const listing = res?.ok ? await upstreamJson(res) : null;
  if (!Array.isArray(listing)) {
    // A stale calendar beats none while upstream fails or sends a broken body.
    if (cached) {
      console.warn(
        `calendar: listing fetch failed (${res?.ok ? 'a broken body' : (res?.status ?? 'network')}), serving stale`,
      );
      return { comps: cached.comps, cache: 'stale' };
    }
    return null;
  }
  const known = new Map((cached?.comps || []).map((c) => [String(c.id), c]));
  const comps = (listing || []).map((c) => {
    const prev = known.get(String(c.Id));
    return {
      id: c.Id,
      name: c.Name || '',
      location: c.Location || '',
      organizationName: c.OrganizationName || '',
      date: isoDay(c.Date),
      days: prev?.days || [],
      daysAt: prev?.daysAt || 0,
    };
  });

  // Only candidates need a schedule, nearest `day` first, so the fetch limit
  // drops the meets furthest from it (docs/backend.md, "The scan, and its
  // three layers").
  const centre = Date.parse(`${dayIso}T00:00:00Z`);
  const byId = new Map(comps.map((c) => [String(c.id), c]));
  const need = calendarCandidates(listing, fromIso, toIso)
    .map((c) => byId.get(String(c.Id)))
    .filter((c) => c && needsSchedule(c, now))
    .sort(
      (a, b) =>
        Math.abs(Date.parse(`${a.date}T00:00:00Z`) - centre) - Math.abs(Date.parse(`${b.date}T00:00:00Z`) - centre),
    )
    .slice(0, CAL_SCHEDULE_FETCH_LIMIT);

  await mapWithConcurrency(need, ROSTER_FETCH_CONCURRENCY, async (comp) => {
    const r = await fetch(`${API}/competition/${comp.id}`).catch(() => null);
    const schedule = r?.ok ? await upstreamJson(r) : null;
    if (!schedule) {
      console.warn(
        `calendar: /competition/${comp.id} -> ${r?.ok ? 'a broken body' : `HTTP ${r?.status ?? 'network'}`}`,
      );
      return null;
    }
    comp.days = scheduleDays(schedule);
    comp.daysAt = now;
    return null;
  });

  console.log(`calendar: ${comps.length} listed, ${need.length} schedules fetched`);
  await env.ROSTER.put(CAL_KEY, JSON.stringify({ builtAt: now, comps }), { expirationTtl: CAL_CACHE_TTL_S * 4 });
  return { comps, cache: 'miss' };
}

// --- The public calendar feed -------------------------------------------
//
// GET /calendar.json[?day=YYYY-MM-DD] answers the listing with each meet's
// real days where loadCalendar knows them, for both modes' front pages. Any
// origin may read it, so it sits outside /api/, where the WAF blocks a
// preflight. A GET with no custom header is never preflighted. The Cache API,
// KV and CALENDAR_LIMITER guard it, as no WAF rule does (docs/backend.md).
const CALENDAR_PATH = '/calendar.json';

// Allows any origin with `*`, since the body is public and the same for
// every caller. So one cache entry serves them all.
const CALENDAR_CORS = {
  'access-control-allow-origin': '*',
  'access-control-max-age': '600',
};

// Sets how often a phone with the page open reaches the Worker at all. It is
// under CAL_CACHE_TTL_S.
const CALENDAR_MAX_AGE_S = 300;

function calendarPreflight() {
  return new Response(null, {
    status: 204,
    headers: { ...CALENDAR_CORS, allow: 'GET, HEAD', 'access-control-allow-methods': 'GET, HEAD' },
  });
}

async function handleCalendar(env, request, url, ctx) {
  const dayParam = url.searchParams.get('day');
  const day = DAY_RE.test(dayParam || '') ? dayParam : todayIso();

  // The cache keys on the normalized day, so a junk ?day= or query string
  // shares the entry and cannot walk past the cache into the limiter.
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${CALENDAR_PATH}?day=${day}`, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Only a miss spends the limiter, as with the roster. loadCalendar's own
  // miss fans out over up to CAL_SCHEDULE_FETCH_LIMIT schedules.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.CALENDAR_LIMITER.limit({ key: ip });
  if (!success) {
    console.warn(`calendar feed: rate limit hit for ${ip}`);
    return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', {
      status: 429,
      headers: CALENDAR_CORS,
    });
  }

  const from = shiftIsoDay(day, -CAL_WINDOW_PAST_DAYS);
  const to = shiftIsoDay(day, CAL_WINDOW_FUTURE_DAYS);
  const cal = await loadCalendar(env, day, from, to);
  // Answers 502, since an empty comps array would read as "no competitions".
  if (!cal) {
    return new Response('Kilpailulistaa ei saatu haettua.', { status: 502, headers: CALENDAR_CORS });
  }

  // The feed carries nothing of a follow-list. Every field has a default,
  // since a stored calendar can lack one and JSON drops an undefined field.
  const comps = cal.comps.map((c) => ({
    id: c.id,
    name: c.name || '',
    location: c.location || '',
    organizationName: c.organizationName || '',
    date: c.date || '',
    days: c.days || [],
  }));
  const resolved = comps.filter((c) => c.days.length).length;
  console.log(`calendar feed: ${comps.length} listed, ${resolved} with days (${cal.cache})`);

  const res = new Response(JSON.stringify({ day, comps }), {
    headers: {
      ...CALENDAR_CORS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CALENDAR_MAX_AGE_S}`,
      'x-content-type-options': 'nosniff',
      'x-calendar-cache': cal.cache,
      'x-calendar-comps': String(comps.length),
      'x-calendar-days': String(resolved),
    },
  });
  // Populating the edge cache must not hold the response up.
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function handleScan(watchId, env, request, url) {
  if (!WATCH_ID_RE.test(watchId)) return new Response('Not Found', { status: 404 });
  const stored = await env.WATCHES.get(`watch:${watchId}`, 'json');
  if (!stored) return new Response('Seurantaa ei löytynyt.', { status: 404 });
  if (!isCurrent(stored)) return new Response('Seuranta on vanhentunut. Luo uusi.', { status: 404 });

  const dayParam = url.searchParams.get('day');
  const day = DAY_RE.test(dayParam || '') ? dayParam : todayIso();
  const from = shiftIsoDay(day, -CAL_WINDOW_PAST_DAYS);
  const to = shiftIsoDay(day, CAL_WINDOW_FUTURE_DAYS);
  // Only build=1 builds a digest, since app.js re-renders home on every
  // visibilitychange. The default request reads the shared calendar and the
  // digests in KV.
  const wantBuild = url.searchParams.get('build') === '1';

  const cal = await loadCalendar(env, day, from, to);
  if (!cal) return new Response('Kilpailulistaa ei saatu haettua.', { status: 502 });
  const { inWindow } = calendarWindow(cal.comps, from, to);

  // A digest of another DIGEST_VERSION counts as missing, as scanDigest would
  // misread it. It rebuilds as pending (derived data, AGENTS.md).
  const digests = (await Promise.all(inWindow.map((c) => env.ROSTER.get(digestKey(c.id), 'json')))).map((d) =>
    d?.digest?.v === DIGEST_VERSION ? d : null,
  );
  const now = Date.now();
  const staleFlags = digests.map((d) => !!d && isStale(d.builtAt, lastDayIso(d.digest.days), now));

  let builtCount = 0;
  // A stale digest shares the build queue with a missing one on equal terms.
  const needsBuild = inWindow.map((c, i) => (!digests[i] || staleFlags[i] ? i : null)).filter((i) => i != null);
  if (wantBuild && needsBuild.length) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.SCAN_LIMITER.limit({ key: ip });
    if (!success) {
      console.warn(`scan ${watchId}: rate limit hit for ${ip}`);
      return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', { status: 429 });
    }
    // Builds one at a time, since each build is already a fan-out under
    // ROSTER_FETCH_CONCURRENCY, and two at once would double the burst that
    // cap bounds.
    for (const i of needsBuild.slice(0, SCAN_BUILD_LIMIT)) {
      const compId = String(inWindow[i].id);
      if (!COMP_ID_RE.test(compId)) continue;
      const built = await aggregateRoster(compId);
      if (!built) continue;
      digests[i] = { builtAt: now, digest: await cacheDigest(env, compId, built) };
      // A front page's own scans fill the picker's two indexes too, as
      // handleRoster's builds do.
      await cacheOrgs(env, built.roster);
      await cacheAthletes(env, built);
      staleFlags[i] = false;
      builtCount += 1;
    }
  }

  // A null `matches` means not scanned yet, and an array is the last known
  // answer, stale or not. The front page says different things of each.
  const pending = [];
  const stale = [];
  const comps = inWindow.map((c, i) => {
    if (!digests[i]) pending.push(c.id);
    else if (staleFlags[i]) stale.push(c.id);
    return {
      id: c.id,
      name: c.name,
      location: c.location,
      organizationName: c.organizationName,
      days: c.days,
      matches: digests[i] ? scanDigest(digests[i].digest, stored.entries) : null,
      stale: !!digests[i] && staleFlags[i],
    };
  });

  console.log(
    `scan ${watchId}: ${comps.length} in window, ${pending.length} pending, ` +
      `${stale.length} stale, ${builtCount} built`,
  );
  return new Response(JSON.stringify({ day, from, to, comps, pending }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-scan-calendar': cal.cache,
      'x-scan-comps': String(comps.length),
      'x-scan-pending': String(pending.length),
      'x-scan-stale': String(stale.length),
      'x-scan-built': String(builtCount),
    },
  });
}

// --- A scope's year ---------------------------------------------
//
// GET /api/medalseason/:scopeId/:year[?build=1] answers the scope's meets of
// the year off the meet index (medalSeasonMeets, lib/medals.js). Each has its
// medals projected to the scope off its season record. It has the scan's
// layers, with a record in a digest's place.
function medalSeasonKey(compId) {
  return `medalseason:v4:${compId}${elsewhereTag(elsewhere, compId)}`;
}

// Bounds a build=1 round. Filling a cold year one meet per request would
// outrun SCAN_LIMITER (docs/backend.md, "A scope's year").
const SEASON_ROUND = { limit: 4, budgetMs: 12_000 };

async function handleMedalSeason(scopeId, yearParam, env, request, url) {
  if (!meetScopes(districts).some((s) => s.id === scopeId))
    return new Response('Aluetta ei löytynyt.', { status: 404 });
  if (!seasonYearOk(yearParam, todayIso())) return new Response('Virheellinen vuosi.', { status: 400 });
  const year = Number(yearParam);
  // Only build=1 builds, as in the scan, so repeated reads cost nothing.
  const wantBuild = url.searchParams.get('build') === '1';

  const indexed = medalSeasonMeets(
    meetIndexMeets(await env.ROSTER.get(MEETS_KEY, 'json')),
    scopeId,
    year,
    districts,
    elsewhere,
  );
  const found = await Promise.all(indexed.map((m) => env.ROSTER.get(medalSeasonKey(m.id), 'json')));
  const kept = indexed.map((m, i) => [m, found[i]]).filter(([, r]) => !medalSeasonMeetEmpty(r));
  const meets = kept.map(([m]) => m);
  const records = kept.map(([, r]) => r);
  const now = Date.now();
  const today = todayIso();
  const staleFlags = records.map((r) => !!r && isStale(r.builtAt, r.lastDay, now) && !recordSettled(r.lastDay, today));

  let builtCount = 0;
  const needsBuild = meets.map((m, i) => (!records[i] || staleFlags[i] ? i : null)).filter((i) => i != null);
  if (wantBuild && needsBuild.length) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.SCAN_LIMITER.limit({ key: ip });
    if (!success) {
      console.warn(`medalseason ${scopeId}/${year}: rate limit hit for ${ip}`);
      return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', { status: 429 });
    }
    // Builds one at a time as the scan does, since each build is a fan-out.
    const roundStart = Date.now();
    for (const i of needsBuild) {
      if (!buildRoundGoesOn(builtCount, Date.now() - roundStart, SEASON_ROUND)) break;
      const record = await buildMedalSeason(env, meets[i].id);
      if (!record) continue;
      records[i] = record;
      staleFlags[i] = false;
      builtCount += 1;
    }
  }

  const pending = meets.filter((m, i) => !records[i]).map((m) => m.id);
  const body = {
    scope: scopeId,
    year,
    meets: meets.map((m, i) => ({
      ...m,
      starts: records[i] ? scopeMedalStarts(records[i], scopeId) : null,
      names: records[i]?.names || [],
      athletes: records[i]?.athletes || [],
      unknown: records[i]?.unknown || [],
      stale: staleFlags[i],
    })),
    pending,
  };
  const staleCount = staleFlags.filter(Boolean).length;
  console.log(
    `medalseason ${scopeId}/${year}: ${meets.length} meets, ${pending.length} pending, ${staleCount} stale, ${builtCount} built`,
  );
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-season-meets': String(meets.length),
      'x-season-pending': String(pending.length),
      'x-season-stale': String(staleCount),
      'x-season-built': String(builtCount),
    },
  });
}

// GET /api/cupseason/:year[?club=<orgId>][&watch=<watchId>][&build=1] answers
// every cup meet of the year (cupSeasonMeets, lib/cup.js), with its clubs off
// its record and the rows asked for. It has handleMedalSeason's layers.
function cupSeasonKey(compId) {
  return `cupseason:v2:${compId}`;
}

// Builds a cup meet for its year and writes its record beside the meet body.
// A meet whose settings score nothing gets a record with no clubs, so it is
// not rebuilt. A demo's record is not kept, as in handleMeet.
async function buildCupSeason(env, meet) {
  const start = Date.now();
  const built = demoMeet(meet.id) ? buildDemoMeet(meet.id) : await aggregateMeet(meet.id);
  if (!built) return null;
  const lastDay = built.lastDay || meet.date;
  if (demoMeet(meet.id)) return cupSeasonRecord(built.body, built.detail, Date.now(), lastDay);
  const record = await putMeet(env, meet.id, built, { ...built.stats, buildMs: Date.now() - start }, lastDay);
  if (record) return record;
  const empty = cupSeasonRecord(built.body, built.detail, Date.now(), lastDay);
  await env.ROSTER.put(cupSeasonKey(meet.id), JSON.stringify(empty), { expirationTtl: DIGEST_KV_TTL_S });
  return empty;
}

// Returns the targets a request asks for, `club` and a current Watch's clubs
// and licences. An unknown or malformed Watch asks for none.
async function cupSeasonTargets(env, url) {
  const club = url.searchParams.get('club');
  const watchId = url.searchParams.get('watch') || '';
  const stored = WATCH_ID_RE.test(watchId) ? await env.WATCHES.get(`watch:${watchId}`, 'json') : null;
  const { clubIds, licences } = watchTargets(isCurrent(stored) ? stored.entries : [], null);
  if (/^\d+$/.test(club || '')) clubIds.add(club);
  return { clubIds, licences };
}

async function handleCupSeason(yearParam, env, request, url) {
  if (!seasonYearOk(yearParam, todayIso())) return new Response('Virheellinen vuosi.', { status: 400 });
  const year = Number(yearParam);
  const wantBuild = url.searchParams.get('build') === '1';

  const meets = cupSeasonMeets(meetIndexMeets(await env.ROSTER.get(MEETS_KEY, 'json')), year, districts);
  const records = await Promise.all(meets.map((m) => env.ROSTER.get(cupSeasonKey(m.id), 'json')));
  const now = Date.now();
  const today = todayIso();
  const staleFlags = records.map((r) => !!r && isStale(r.builtAt, r.lastDay, now) && !recordSettled(r.lastDay, today));

  let builtCount = 0;
  const needsBuild = meets.map((m, i) => (!records[i] || staleFlags[i] ? i : null)).filter((i) => i != null);
  if (wantBuild && needsBuild.length) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.SCAN_LIMITER.limit({ key: ip });
    if (!success) {
      console.warn(`cupseason ${year}: rate limit hit for ${ip}`);
      return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', { status: 429 });
    }
    // Builds one at a time as the scan does, since each build is a fan-out.
    const roundStart = Date.now();
    for (const i of needsBuild) {
      if (!buildRoundGoesOn(builtCount, Date.now() - roundStart, SEASON_ROUND)) break;
      if (!COMP_ID_RE.test(meets[i].id)) continue;
      const record = await buildCupSeason(env, meets[i]);
      if (!record) continue;
      records[i] = record;
      staleFlags[i] = false;
      builtCount += 1;
    }
  }

  const targets = await cupSeasonTargets(env, url);
  const pending = meets.filter((m, i) => !records[i]).map((m) => m.id);
  const body = {
    year,
    meets: meets.map((m, i) => ({
      ...m,
      clubs: records[i] ? records[i].clubs.map(({ rows, ...c }) => c) : null,
      stale: staleFlags[i],
      rows: cupSeasonRows(records[i], targets),
    })),
    pending,
  };
  const staleCount = staleFlags.filter(Boolean).length;
  console.log(
    `cupseason ${year}: ${meets.length} meets, ${pending.length} pending, ${staleCount} stale, ${builtCount} built`,
  );
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-season-meets': String(meets.length),
      'x-season-pending': String(pending.length),
      'x-season-stale': String(staleCount),
      'x-season-built': String(builtCount),
    },
  });
}

// --- The cron's warming -------------------------------------------------
//
// Warms the championship and cup years' records over the year's meets that
// have run, at SEASON_WARM_LIMIT builds and SEASON_WARM_READS reads a run.
// A run starts its reads at an offset set by its 10-minute slot. A settled
// record is never rebuilt, so a finished year goes quiet.
const SEASON_WARM_LIMIT = 2;
const SEASON_WARM_READS = 60;

async function warmSeason(env) {
  const startMs = Date.now();
  const today = todayIso();
  const index = await env.ROSTER.get(MEETS_KEY, 'json');
  const meets = warmSeasonMeets(meetIndexMeets(index), Number(today.slice(0, 4)), districts, today, elsewhere);
  if (!meets.length) return;
  const from = Math.floor(startMs / (10 * 60 * 1000)) % meets.length;
  let warmed = 0;
  let read = 0;
  // Copies a record's `closed` pair onto its index row, since a year lists its
  // meets off the index alone. A record without the field changes nothing.
  const pairs = [];
  const closedOf = (meet, record) => {
    if (record?.closed !== undefined) pairs.push([meet.id, record.closed]);
  };
  for (let i = 0; i < meets.length && warmed < SEASON_WARM_LIMIT && read < SEASON_WARM_READS; i++) {
    const meet = meets[(from + i) % meets.length];
    if (!COMP_ID_RE.test(meet.id) && !elsewhereRow(elsewhere, meet.id)) continue;
    read += 1;
    const record = await env.ROSTER.get(meet.kind ? cupSeasonKey(meet.id) : medalSeasonKey(meet.id), 'json');
    if (!meet.kind) closedOf(meet, record);
    if (record && (recordSettled(record.lastDay, today) || !isStale(record.builtAt, record.lastDay, Date.now())))
      continue;
    if (meet.kind) {
      if (await buildCupSeason(env, meet)) warmed += 1;
      continue;
    }
    const built = await buildMedalSeason(env, meet.id);
    if (!built) continue;
    closedOf(meet, built);
    warmed += 1;
  }
  const joined = meetIndexClosed(index, pairs);
  if (joined.changed) await env.ROSTER.put(MEETS_KEY, JSON.stringify(joined.index));
  console.log(
    `season warm: ${warmed} built, ${read} read of ${meets.length} in ${today.slice(0, 4)}, ${Date.now() - startMs}ms`,
  );
}

// --- Watches ----------------------------------------------
//
// A Watch is a follow-list shared by a `#/w/<id>` link and read in any meet.
// With no accounts, the id reads it and only the editToken changes it. The
// token stays out of the public shape, in a browser that made the Watch or
// opened its edit link. normalizeWatchInput (lib/watch.js) validates the shape.

// An id is randomHex(6). Any other id is refused before a KV read.
const WATCH_ID_RE = /^[0-9a-f]{12}$/;

// Versions the stored record. A v1 record names athletes by one meet's
// Athletes[].Id, which v2 resolves to nobody, so it is refused with a 404.
const WATCH_VERSION = 2;

// Lets an abandoned or spammed Watch leave KV in the end. Every edit rewrites
// the record and resets it. The figure is a guess.
const WATCH_TTL_S = 60 * 60 * 24 * 180;

function randomHex(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compares a claimed token with the stored one in constant time. A token's
// length is public, and timingSafeEqual throws on unequal lengths, so the
// length is checked first. A non-string claim or stored token is no match.
function tokenMatches(claimed, stored) {
  if (typeof claimed !== 'string' || typeof stored !== 'string') return false;
  const enc = new TextEncoder();
  const a = enc.encode(claimed),
    b = enc.encode(stored);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

// Parses a Watch write's JSON body, or returns the refusal. A body with no
// content-length or one over WATCH_MAX_BODY_BYTES is refused unread, as
// request.json() buffers the whole of it.
async function readWatchBody(request) {
  const length = request.headers.get('content-length');
  if (length == null) return { refusal: new Response('Virheellinen pyyntö.', { status: 411 }) };
  if (!(Number(length) <= WATCH_MAX_BODY_BYTES))
    return { refusal: new Response('Liian suuri pyyntö.', { status: 413 }) };
  try {
    return { body: await request.json() };
  } catch {
    return { refusal: new Response('Virheellinen pyyntö.', { status: 400 }) };
  }
}

// Drops the editToken, as the secret goes out once, in the create response.
function publicWatch({ editToken, ...pub }) {
  return pub;
}

async function handleWatchCreate(env, request) {
  // No secret gates a create, so it is the one Watch endpoint capped against
  // spamming the KV namespace.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.WATCH_LIMITER.limit({ key: ip });
  if (!success) return new Response('Liikaa pyyntöjä, yritä hetken kuluttua uudelleen.', { status: 429 });

  const { body, refusal } = await readWatchBody(request);
  if (refusal) return refusal;
  const input = normalizeWatchInput(body);
  if (!input) return new Response('Virheellinen pyyntö.', { status: 400 });

  const now = Date.now();
  const watch = {
    id: randomHex(6),
    editToken: randomHex(16),
    v: WATCH_VERSION,
    label: input.label,
    entries: input.entries,
    createdAt: now,
    updatedAt: now,
  };
  await env.WATCHES.put(`watch:${watch.id}`, JSON.stringify(watch), { expirationTtl: WATCH_TTL_S });
  console.log(`watch ${watch.id}: created, ${watch.entries.length} entries`);
  // Only this response carries the editToken, which the creator keeps.
  return watchJsonResponse(watch, 201);
}

// Says whether the record is of WATCH_VERSION, as another one reads as gone.
function isCurrent(stored) {
  return stored?.v === WATCH_VERSION;
}

async function handleWatchGet(id, env) {
  if (!WATCH_ID_RE.test(id)) return new Response('Not Found', { status: 404 });
  const stored = await env.WATCHES.get(`watch:${id}`, 'json');
  if (!stored) return new Response('Seurantaa ei löytynyt.', { status: 404 });
  if (!isCurrent(stored)) return new Response('Seuranta on vanhentunut. Luo uusi.', { status: 404 });
  return watchJsonResponse(publicWatch(stored));
}

async function handleWatchUpdate(id, env, request) {
  if (!WATCH_ID_RE.test(id)) return new Response('Not Found', { status: 404 });
  const key = `watch:${id}`;
  const stored = await env.WATCHES.get(key, 'json');
  if (!stored) return new Response('Seurantaa ei löytynyt.', { status: 404 });
  if (!isCurrent(stored)) return new Response('Seuranta on vanhentunut. Luo uusi.', { status: 404 });

  const { body, refusal } = await readWatchBody(request);
  if (refusal) return refusal;
  if (!tokenMatches(body?.editToken, stored.editToken)) return new Response('Väärä muokkausavain.', { status: 403 });
  // A PUT whose `ifUpdatedAt` differs from the stored `updatedAt` hears 409.
  // It is optional, as a caller could GET first. KV has no compare-and-swap,
  // so this catches only a race minutes long (docs/backend.md).
  if (body.ifUpdatedAt !== undefined && body.ifUpdatedAt !== stored.updatedAt) {
    console.log(`watch ${id}: conflict, ${body.ifUpdatedAt} != ${stored.updatedAt}`);
    return new Response('Listaa muutettiin toisaalla.', { status: 409 });
  }
  const input = normalizeWatchInput(body);
  if (!input) return new Response('Virheellinen pyyntö.', { status: 400 });

  const updated = { ...stored, label: input.label, entries: input.entries, updatedAt: Date.now() };
  await env.WATCHES.put(key, JSON.stringify(updated), { expirationTtl: WATCH_TTL_S });
  console.log(`watch ${id}: updated, ${updated.entries.length} entries`);
  return watchJsonResponse(publicWatch(updated));
}

// DELETE /api/watch/:id ends a Watch whose edit link went too far, as nothing
// rotates a token. The token comes in a JSON body, since a query string ends up
// in history and logs. It takes no `ifUpdatedAt`, as it undoes every write.
async function handleWatchDelete(id, env, request) {
  if (!WATCH_ID_RE.test(id)) return new Response('Not Found', { status: 404 });
  const key = `watch:${id}`;
  const stored = await env.WATCHES.get(key, 'json');
  if (!stored) return new Response('Seurantaa ei löytynyt.', { status: 404 });
  // A record GET and PUT refuse is one whose editToken this Worker will not
  // trust either. It ages out on its TTL.
  if (!isCurrent(stored)) return new Response('Seuranta on vanhentunut. Luo uusi.', { status: 404 });

  const { body, refusal } = await readWatchBody(request);
  if (refusal) return refusal;
  if (!tokenMatches(body?.editToken, stored.editToken)) return new Response('Väärä muokkausavain.', { status: 403 });

  await env.WATCHES.delete(key);
  console.log(`watch ${id}: deleted, ${stored.entries.length} entries`);
  return new Response(null, { status: 204 });
}

// Sends every Watch response no-store, as a stale GET after one's own PUT
// would read as a lost edit.
function watchJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

// _headers applies to the assets binding alone, so nosniff is repeated here.
// A build's stats go out as x-<prefix>-* headers, hit or miss, so a GET's
// headers answer what a dashboard would (docs/backend.md).
function jsonResponse(body, stats, prefix = 'roster') {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=60',
    'x-content-type-options': 'nosniff',
    [`x-${prefix}-cache`]: stats.cacheHit ? 'hit' : 'miss',
    [`x-${prefix}-cache-age-s`]: String(stats.ageS),
    [`x-${prefix}-events`]: `${stats.eventsTotal - stats.eventsFailed}/${stats.eventsTotal}`,
  };
  if (!stats.cacheHit) headers[`x-${prefix}-build-ms`] = String(stats.buildMs);
  if (stats.eventsFailed > 0) {
    headers[`x-${prefix}-failed-statuses`] = Object.entries(stats.failedStatuses)
      .map(([code, n]) => `${code}:${n}`)
      .join(',');
  }
  return new Response(JSON.stringify(body), { headers });
}
