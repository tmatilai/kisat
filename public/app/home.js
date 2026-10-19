import { dateRange, parseTs } from '../lib/dates.js';
import { meetIsRecent, meetPlace, meetSortValue, meetWhen, scanHits, scanSince } from '../lib/home.js';
import { archivedListingRows } from '../lib/indexes.js';
import {
  CUP_SEASON_PAGE_PATH,
  CUP_SEASON_PAGE_TITLE,
  MEDAL_SEASON_PAGE_PATH,
  MEDAL_SEASON_PAGE_TITLE,
  TABLE_PAGE_PATH,
  TABLE_PAGE_TITLE,
  searchJumpPath,
  tablePageHash,
} from '../lib/routes.js';
import { API } from '../lib/schedule.js';
import { HOME_VIEW_KEY, fetchJson, recentComps, updateViewState, viewStateFor, watchLabel } from './data.js';
import { filterBar } from './follow.js';
import {
  KISAT_ORIGIN,
  SITE_MODE,
  SITE_NAME,
  appEl,
  el,
  fmtDate,
  hideBack,
  navigate,
  renderFillStatus,
  renderSeq,
  scanTodayIso,
  setHelp,
  setScrollKey,
  setTitleMenu,
} from './shell.js';

// --- The front page (/) ---

// Fetches the real days of the listed meets from /calendar.json (docs/home.md,
// "Dates and sorting"). fetchJson sends no-store and home re-renders on every
// visibilitychange, so a plain fetch lets the browser's cache answer the
// repeats.
const CALENDAR_TIMEOUT_MS = 3000;

async function fetchCalendarDays(dayIso) {
  try {
    const r = await fetch(`/calendar.json?day=${encodeURIComponent(dayIso)}`, {
      signal: AbortSignal.timeout(CALENDAR_TIMEOUT_MS),
    });
    if (!r.ok) return new Map();
    const { comps } = await r.json();
    return new Map((comps || []).filter((c) => c.days?.length).map((c) => [String(c.id), c.days]));
  } catch {
    // On a failure each row falls back to the listing's single Date.
    return new Map();
  }
}

async function renderHome() {
  const seq = renderSeq;
  setScrollKey('home');
  setTitleMenu(SITE_NAME, [
    { label: TABLE_PAGE_TITLE, href: `${TABLE_PAGE_PATH}${location.search}${tablePageHash('aidat', [])}` },
    ...(SITE_MODE === 'juoksut'
      ? [{ label: 'Kisat', href: KISAT_ORIGIN }]
      : [
          { label: MEDAL_SEASON_PAGE_TITLE, href: `${MEDAL_SEASON_PAGE_PATH}${location.search}` },
          { label: CUP_SEASON_PAGE_TITLE, href: `${CUP_SEASON_PAGE_PATH}${location.search}` },
        ]),
  ]);
  hideBack();
  setHelp(
    SITE_MODE === 'juoksut'
      ? {
          title: 'Juoksut',
          aria: 'Tietoa palvelusta',
          text: [
            [
              'Juoksut-palvelu on tehty yleisurheilun ratalajien toimitsijoille (tai ainakin itselleni siinä hommassa). Se syntyi alkujaan kisoissa, joissa oli paljon eri sarjoja ja kategorioita samoissa lähdöissä.',
            ],
            [
              'Perusideana on koota saman lähdön kaikki sarjat yhteen näkymään. Lisäksi pian syntyin myös ensimmäinen versio kierroslaskurista, jonka kehitys toivottavasti etenee vieläkin. Sittemmin mukaan on tullut myös aitajuoksujen mitat ja merkinnät, ja nyt myös kaikkien sarjojen ',
              el(
                'a',
                { href: `${TABLE_PAGE_PATH}${location.search}${tablePageHash('aidat', [])}` },
                'aita- ja välinemitat',
              ),
              '.',
            ],
            [
              'Kaikki data tulee ',
              el('a', { href: 'https://live.tuloslista.com/', target: '_blank', rel: 'noopener' }, 'tuloslista.com'),
              '-palvelusta. Juoksut on vain omanlainen käyttöliittymä siihen.',
            ],
            [
              'Jos kaipaat normaalia tulospalvelua urheilijaseurannalla, katso sisarpalvelu ',
              el('a', { href: KISAT_ORIGIN, target: '_blank', rel: 'noopener' }, 'Kisat'),
              '.',
            ],
            [
              'Kehittelen palvelua kun pääsen sitä kisoissa testaamaan. En takaa toimivuutta enkä ota vastuuta sen tuotoksista, mutta kiva jos joku muukin kokeilee. Palaute ja ideat ovat tervetulleita: ',
              el('a', { href: `mailto:${CONTACT_EMAIL}` }, CONTACT_EMAIL),
              '.',
            ],
            ['Lähdekoodi on ', el('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener' }, 'GitHubissa'), '.'],
          ],
        }
      : {
          title: 'Kisat',
          aria: 'Tietoa palvelusta',
          text: [
            [
              'Kisat on erilainen käyttöliittymä ',
              el('a', { href: 'https://live.tuloslista.com/', target: '_blank', rel: 'noopener' }, 'tuloslista.com'),
              '-palvelulle, josta sen kaikki data tulee.',
            ],
            [
              'Perusideana on koota saman lähdön kaikki sarjat yhteen näkymään. Voit myös seurata haluamiasi seuroja ja urheilijoita.',
            ],
            [
              'Tunnuksia ei ole, joten seuranta jaetaan linkillä. Muokkauslinkkiä ei voi perua, joten jaa se harkiten. Siirtolinkki on vain omille laitteillesi.',
            ],
            [
              'Kotivalikkoon asennettu sovellus ei avaa linkkejä. Kopioi linkki ja valitse seurantavalikosta "Ota linkki käyttöön".',
            ],
            ['Palaute ja ideat ovat tervetulleita: ', el('a', { href: `mailto:${CONTACT_EMAIL}` }, CONTACT_EMAIL), '.'],
            ['Lähdekoodi on ', el('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener' }, 'GitHubissa'), '.'],
          ],
        },
  );

  const state = viewStateFor(HOME_VIEW_KEY);
  const todayIso = scanTodayIso();
  const [comps, initialScan, calendarDays] = await Promise.all([
    fetchJson(`${API}/competition`),
    fetchScan(state.watchId, false),
    fetchCalendarDays(todayIso),
  ]);
  if (seq !== renderSeq) return;
  // A meet's real days come from the feed, the meets this device has opened and
  // the scan's window. Each source overrides the one before it (docs/home.md,
  // "Dates and sorting").
  const knownDays = new Map(calendarDays);
  const knownRanges = new Map([...calendarDays].map(([id, days]) => [id, dateRange(days)]));
  const recent = recentComps();
  for (const c of recent) {
    if (c.days?.length) knownDays.set(String(c.id), c.days);
    if (c.range) knownRanges.set(String(c.id), c.range);
  }
  for (const c of initialScan?.comps ?? []) {
    if (!c.days?.length) continue;
    knownDays.set(String(c.id), c.days);
    knownRanges.set(String(c.id), dateRange(c.days));
  }

  // Rows outside the listing take their venue byline from here. Only the
  // listing carries a venue (docs/tuloslista-api.md). A recent meet missing
  // from the listing shows its date range alone.
  const knownPlaces = new Map(comps.map((c) => [String(c.Id), meetPlace(c.Location, c.OrganizationName)]));

  // The sort, the today highlight and the recent/older split all read this one
  // meetWhen per meet, so they cannot disagree.
  const whens = new Map(comps.map((c) => [String(c.Id), meetWhen(knownDays.get(String(c.Id)), c.Date, todayIso)]));
  const whenOf = (c) => whens.get(String(c.Id));

  comps.sort((a, b) => meetSortValue(whenOf(b), todayIso) - meetSortValue(whenOf(a), todayIso));
  // Finished meets hide behind a button (meetIsRecent, docs/home.md,
  // "Dates and sorting").
  const older = comps.filter((c) => !meetIsRecent(whenOf(c)));
  let showOlder = false;
  // The meets the listing has dropped come from /api/meets on the first
  // search (docs/home.md, "The search"). The Juoksut host serves no /api/meets.
  let archived = null;
  function loadArchived() {
    if (archived || SITE_MODE === 'juoksut') return;
    archived = [];
    fetchJson('/api/meets')
      .then((r) => {
        if (seq !== renderSeq) return;
        archived = archivedListingRows(comps, r.meets);
        for (const c of archived) whens.set(String(c.Id), meetWhen(null, c.Date, todayIso));
        if (search.value) paint(search.value);
      })
      .catch(() => {});
  }

  const label = watchLabel(state.watchId);
  // Home fetches no Watch record, so the chip's label comes from the local
  // registry. filterActive is false because home has no mode toggle. Juoksut
  // mode has no follow-lists, so it gets no bar.
  const bar = SITE_MODE === 'juoksut' ? null : filterBar(HOME_VIEW_KEY, state, { label }, false);

  const listEl = el('div', { class: 'list' });
  const olderEl = el('div', {});
  const scanEl = el('div', {});
  const pendingEl = el('div', {});
  const search = el('input', {
    class: 'search',
    type: 'search',
    placeholder: 'Hae kilpailua…',
    oninput: () => {
      if (search.value.trim()) loadArchived();
      paint(search.value);
    },
    // An id opens that meet whether or not the listing has it (searchJumpPath).
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const path = searchJumpPath(search.value);
      if (!path) return;
      e.preventDefault();
      navigate(path);
    },
  });

  function compRow(c) {
    const range = knownRanges.get(String(c.Id)) || fmtDate(parseTs(c.Date));
    const sub = [range, meetPlace(c.Location, c.OrganizationName)].filter(Boolean).join(' · ');
    return homeRow(c.Id, c.Name, sub, whenOf(c)?.running);
  }

  // paint() redraws Kilpailut in place, since render() would lose the search
  // box's focus. A search shows one flat list over every meet, however old
  // (docs/home.md, "The search").
  function paint(filterText) {
    const f = (filterText || '').toLowerCase();
    const pool = f ? [...comps, ...(archived || [])] : showOlder ? comps : comps.filter((c) => meetIsRecent(whenOf(c)));
    // A search matches the byline the row prints (meetPlace). The raw Location
    // often holds a placeholder word, which would match meets that never show
    // it (docs/tuloslista-api.md, "`Location` defaults to the placeholder
    // `Kilpailupaikka`").
    listEl.replaceChildren(
      ...pool
        .filter((c) => !f || `${c.Name} ${meetPlace(c.Location, c.OrganizationName)}`.toLowerCase().includes(f))
        .map(compRow),
    );
    const showButton = !f && !showOlder && older.length > 0;
    olderEl.replaceChildren(
      ...(showButton
        ? [
            el(
              'button',
              {
                class: 'btn btn-secondary',
                onclick: () => {
                  showOlder = true;
                  paint(search.value);
                },
              },
              `Näytä vanhemmat kilpailut (${older.length})`,
            ),
          ]
        : []),
    );
  }

  if (initialScan) scanEl.replaceChildren(...scanSection(initialScan, todayIso));
  renderFillStatus(pendingEl, state.watchId, initialScan, {
    left: (scan) => scan.pending.length + scan.comps.filter((c) => c.stale).length,
    build: () => fetchScanBuild(state.watchId),
    onUpdate: (scan) => scanEl.replaceChildren(...scanSection(scan, todayIso)),
  });

  const recentList = recent.length
    ? el(
        'div',
        { class: 'list' },
        recent.map((c) =>
          homeRow(
            c.id,
            c.name,
            [c.range, knownPlaces.get(String(c.id))].filter(Boolean).join(' · '),
            meetWhen(c.days, null, todayIso)?.running,
          ),
        ),
      )
    : null;
  // Viimeksi katsotut folds in Kisat mode and keeps its state (recentOpen).
  // Juoksut mode leaves it open, as the official's way back to the day's meet.
  const recentEl = !recentList
    ? null
    : SITE_MODE === 'juoksut'
      ? el('div', {}, el('h2', {}, 'Viimeksi katsotut'), recentList)
      : el(
          'details',
          {
            class: 'fold',
            open: state.recentOpen,
            ontoggle: (e) => updateViewState(HOME_VIEW_KEY, { recentOpen: e.currentTarget.open }),
          },
          el('summary', {}, 'Viimeksi katsotut'),
          recentList,
        );

  paint('');
  // The filter bar shows even with no follow-list. Its chip is the only way to
  // start a follow-list from home (watchPickerSheet).
  appEl.replaceChildren(
    ...[
      bar,
      // A failed scan leaves stored state alone, because a 404 looks the same as
      // a transient failure (docs/architecture.md, "View state").
      state.watchId && !initialScan
        ? el('div', { class: 'notice error' }, 'Seurannan kilpailujen haku epäonnistui.')
        : null,
      scanEl,
      pendingEl,
      recentEl,
      el('h2', {}, 'Kilpailut'),
      search,
      listEl,
      olderEl,
    ].filter(Boolean),
  );
}

// Asks which meets around today have somebody followed entered. The default
// request leaves out build=1 because home re-renders on every
// visibilitychange (docs/backend.md, "The Worker builds only when asked").
async function fetchScan(watchId, build) {
  if (!watchId) return null;
  return fetchJson(`/api/scan/${watchId}?day=${scanTodayIso()}${build ? '&build=1' : ''}`).catch(() => null);
}
// Sends fetchScan's request with build=1, for the fill-in loop. It keeps the
// status, so the loop can tell a 429 from other failures.
async function fetchScanBuild(watchId) {
  try {
    return { data: await fetchJson(`/api/scan/${watchId}?day=${scanTodayIso()}&build=1`) };
  } catch (e) {
    return { status: e.status };
  }
}

// A scan row shows this many followed lines before "+N muuta".
const SCAN_ROW_LINES = 5;

// Renders a followed athlete's name, club and events as one line of a scan
// row. A followed club's relays arrive as one line of the same shape
// (scanDigest, lib/digest.js).
function scanAthleteLine(m) {
  return el(
    'div',
    { class: 'scan-athlete' },
    el('span', { class: 'scan-athlete-name' }, m.name),
    el('span', { class: 'scan-athlete-club', title: m.club }, m.club),
    el('span', { class: 'scan-athlete-events' }, m.events.join(', ')),
  );
}

// Draws a front-page row. A meet running today takes the tint in every section
// (docs/style.md, "Emphasis"), and a followed athlete on the row adds none.
// `lines` go under the byline and `chip` beside the row.
function homeRow(id, title, sub, running = false, lines = null, chip = null) {
  return el(
    'a',
    { class: `row${running ? ' watched' : ''}`, href: `/c/${id}` },
    el(
      'div',
      { class: 'row-main' },
      el('div', { class: 'row-title' }, title),
      sub ? el('div', { class: 'row-sub' }, sub) : null,
      lines,
    ),
    chip,
  );
}

// Renders Seuratut, the window's meets with somebody followed in them, under
// the window's first day. Its empty notice waits for the fill-in loop, since a
// meet not scanned yet has no row.
function scanSection(scan, todayIso) {
  const since = scanSince(scan);
  const rows = scanHits(scan, todayIso).map((c) => {
    const shown = c.matches.slice(0, SCAN_ROW_LINES);
    const more = c.matches.length - shown.length;
    return homeRow(
      c.id,
      c.name,
      [dateRange(c.days), meetPlace(c.location, c.organizationName)].filter(Boolean).join(' · '),
      meetWhen(c.days, null, todayIso)?.running,
      el(
        'div',
        { class: 'scan-athletes' },
        shown.map(scanAthleteLine),
        more > 0 ? el('div', { class: 'scan-more' }, `+${more} muuta`) : null,
      ),
      // A stale answer is past its freshness window (isStale, worker.js).
      // It stays visible with a chip while the fill-in loop refreshes it.
      c.stale ? el('span', { class: 'chip' }, 'Vanhentunut') : null,
    );
  });
  return [
    el('h2', {}, 'Seuratut', since ? el('span', { class: 'scan-since' }, ` ${since} alkaen`) : null),
    rows.length
      ? el('div', { class: 'list' }, rows)
      : scan.pending.length
        ? null
        : el('div', { class: 'notice' }, 'Ei osallistumisia.'),
  ].filter(Boolean);
}

const CONTACT_EMAIL = ['teemu', 'matilainen.fi'].join('@');
const SOURCE_URL = 'https://github.com/tmatilai/kisat';

export { renderHome };
