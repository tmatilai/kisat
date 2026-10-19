import {
  cupDefaultTab,
  cupFinalOrganisers,
  cupFinalOver,
  cupFinalTables,
  cupFollowedClubs,
  cupMeetRound,
  cupSeasonAthletes,
  cupSeasonClub,
  cupSeasonHref,
  cupSeasonPiirit,
  cupSeasonRecord,
  cupSeasonRows,
  cupSeasonScope,
  cupSeasonTable,
  cupSeries,
  cupTableHead,
  cupTableShown,
} from '../lib/cup.js';
import { isoToFiDay } from '../lib/dates.js';
import { meetScopes } from '../lib/districts.js';
import { propertiesMeetRow, seasonYearOk, seasonYears } from '../lib/indexes.js';
import { positionText } from '../lib/results.js';
import { CUP_SEASON_PAGE_TITLE, CUP_TAB_FINALS, CUP_TAB_ROUNDS, cupPath, isDemoId, seasonHash } from '../lib/routes.js';
import { watchTargets } from '../lib/watch.js';
import {
  HOME_VIEW_KEY,
  fetchCompProps,
  fetchJson,
  followTargets,
  loadActiveWatch,
  loadDistricts,
  setCupMeetSeen,
  viewStateFor,
  watchLabel,
} from './data.js';
import { filterBar } from './follow.js';
import {
  dayMonth,
  medalEl,
  medalistAllEl,
  medalistHeadEl,
  medalistOpenKeys,
  medalistRowEl,
  medalistsShown,
  medalistsSwitchEl,
  openKeysHolder,
  pickedHeadEl,
  scrollToPicked,
  toggleMedalist,
} from './medals.js';
import {
  appEl,
  cupPointsText,
  el,
  navigate,
  renderFillStatus,
  renderSeq,
  replaceAddress,
  scanTodayIso,
  segControl,
  setBack,
  setHelp,
  setScrollKey,
  statusChip,
  titleEl,
  wrap,
} from './shell.js';

// --- The club cup (/c/<compId>/cup) ---

// Draws one cup meet's club standings. The page is the cup year's page narrowed
// to that meet (docs/views.md, "The club cup").
async function renderCup(compId, club = null, isRefresh = false) {
  const seq = renderSeq;
  setScrollKey(`cup:${compId}`);
  setBack(`/c/${compId}`);
  setHelp(null);

  const state = viewStateFor(compId);
  // Both filter kinds carry club ids and licences, so no roster is fetched.
  const [cup, detail, props, districts, targets] = await Promise.all([
    fetchJson(`/api/meet/${compId}`).catch(() => null),
    fetchJson(`/api/cup/${compId}`).catch(() => null),
    fetchCompProps(compId).catch(() => null),
    loadDistricts(compId),
    followTargets(compId, state, false),
  ]);
  if (seq !== renderSeq) return;
  titleEl.textContent = 'Seuracup';

  setCupMeetSeen(cup?.cup ? compId : null);
  if (!cup?.cup) {
    appEl.replaceChildren(
      el(
        'div',
        { class: cup ? 'notice' : 'notice error' },
        cup ? 'Tämä kilpailu ei ole Seuracup-osakilpailu.' : 'Seuracupin pistetilanteen haku epäonnistui.',
      ),
    );
    return;
  }
  const todayIso = scanTodayIso();
  const row = propertiesMeetRow(props);
  const year = row?.date?.slice(0, 4);
  const up = row && !isDemoId(compId) && seasonYearOk(year, todayIso) ? cupSeasonHref(row, districts) : null;
  const over = !!cup.final && cupFinalOver(row, todayIso);
  // The breakdown is read as a one-meet year record, so the boxes match the
  // year page.
  const kind = cup.final ? 'final' : 'osa';
  const record = cupSeasonRecord(cup, detail, 0, null);
  const meetOf = (asked) => [
    {
      id: compId,
      name: row?.name || '',
      date: row?.date || '',
      kind,
      clubs: record.clubs,
      rows: cupSeasonRows(record, asked),
    },
  ];
  const status = cup.phase || null;

  let pick = club;
  let pickedEl = null;
  const bodyEl = el('div', {});
  const onPick = (id) => {
    pick = pick === String(id) ? null : String(id);
    replaceAddress(cupPath(compId, pick));
    paint();
    if (pick && pickedEl) scrollToPicked(pickedEl);
  };
  const lineEl = (l) => cupLineEl(compId, { ...l, name: null });
  // Seuratut lists people followed by name. Their clubs and the followed clubs
  // are tinted.
  const named = targets?.licences?.size ? { licences: targets.licences } : null;
  const tinted = targets ? cupFollowedClubs(named ? meetOf(named) : [], targets) : null;
  const followed = cupFollowedEls(
    `cup:${compId}:${state.watchId}`,
    named ? cupSeasonAthletes(meetOf(named), named, kind) : [],
    () => paint(),
    { lineEl, sub: (l) => l.event },
  );
  const paint = () => {
    const picked = pick ? cup.clubs.find((c) => String(c.id) === pick) || null : null;
    const lines = picked ? cupBoxRows(detail?.clubs?.[pick] || []) : [];
    bodyEl.replaceChildren(
      ...followed(),
      el('h2', {}, 'Seurapisteet', status ? ' ' : null, status ? statusChip(status) : null),
      cup.clubs.length
        ? cupStandingsTable(cup.clubs, { followed: tinted, over, pick: { id: picked ? pick : null, onPick } })
        : el('div', { class: 'notice' }, 'Kilpailussa ei ole vielä pisteitä.'),
      ...(picked
        ? [
            (pickedEl = pickedHeadEl(picked, onPick)),
            lines.length
              ? el(
                  'div',
                  { class: 'list' },
                  el(
                    'div',
                    { class: 'row' },
                    el(
                      'div',
                      { class: 'row-main' },
                      el(
                        'div',
                        { class: 'medalist-entries' },
                        lines.map((r) => cupLineEl(compId, r)),
                      ),
                    ),
                  ),
                )
              : el(
                  'div',
                  { class: detail ? 'notice' : 'notice error' },
                  detail ? 'Seuralle ei ole vielä kertynyt pisteitä.' : 'Seuracupin pistetilanteen haku epäonnistui.',
                ),
          ]
        : []),
    );
  };
  paint();
  appEl.replaceChildren(
    el(
      'div',
      { class: 'medals-meet' },
      [row?.name, isoToFiDay(row?.date)].filter(Boolean).join(' · '),
      up ? [' · ', el('a', { href: up }, `Seuracup ${year}`)] : null,
    ),
    bodyEl,
  );
  if (pick && pickedEl && !isRefresh) scrollToPicked(pickedEl);
}

// Draws the Sija, Seura and Pisteet table. `over` puts medal discs on the first
// three. `followed` tints rows. `pick` ({id, onPick}) makes each row a toggle,
// and otherwise `href` links the club's name.
function cupStandingsTable(clubs, { followed = null, over = false, pick = null, href = null } = {}) {
  return wrap(
    el(
      'table',
      { class: 'tbl' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { class: 'num' }, 'Sija'),
          el('th', {}, 'Seura'),
          el('th', { class: 'result' }, 'Pisteet'),
        ),
      ),
      el(
        'tbody',
        {},
        clubs.map((c) =>
          el(
            'tr',
            {
              class:
                [followed?.has(String(c.id)) ? 'watched' : '', pick?.id === String(c.id) ? 'picked' : '']
                  .filter(Boolean)
                  .join(' ') || null,
              ...(pick ? { onclick: () => pick.onPick(c.id) } : {}),
            },
            el(
              'td',
              { class: 'num' },
              over && c.rank <= 3 ? medalEl(c.rank) : null,
              over && c.rank <= 3 ? ' ' : null,
              c.rank == null ? '' : `${c.rank}.`,
            ),
            el(
              'td',
              {},
              pick
                ? el(
                    'button',
                    { class: 'club-pick', type: 'button', 'aria-pressed': String(pick.id === String(c.id)) },
                    c.name,
                  )
                : href
                  ? el('a', { class: 'club-link', href: href(c) }, c.name)
                  : c.name,
            ),
            el('td', { class: 'result' }, c.points == null ? '' : cupPointsText(c.points)),
          ),
        ),
      ),
    ),
  );
}

// Draws a row that scored, in cupSeasonRecord's shape. It links to its round
// where the schedule has one.
function cupLineEl(compId, row) {
  return el(
    row.group ? 'a' : 'span',
    { class: 'medalist-entry', href: row.group ? `/c/${compId}/g/${encodeURIComponent(row.group)}` : null },
    el(
      'span',
      { class: 'medalist-event' },
      row.event,
      row.name ? el('span', { class: 'medalist-sub' }, ` · ${row.name}`) : null,
    ),
    el('span', { class: 'medalist-place' }, positionText(row.place, row.field)),
    el('span', { class: 'medalist-mark' }, row.result || ''),
    el('span', { class: 'medalist-result' }, `${cupPointsText(row.points)} p.`),
  );
}

// Flattens boxes (cupBreakdown, cupSeasonClub) into the rows cupLineEl draws.
const cupBoxRows = (boxes) =>
  boxes.flatMap((b) => b.entries.map((e) => ({ ...e, event: b.event, group: b.group, field: b.field })));

// Draws each scorer (cupSeasonAthletes) as a row. A scorer with several lines
// opens onto them. A scorer with one line links straight to its start.
function cupAthleteRowsEl(boxes, openKeys, repaint, { withClub = false, licences = null, lineEl, sub }) {
  return el(
    'div',
    { class: 'list' },
    boxes.map((b) => {
      const club = withClub && b.club !== b.name && b.club;
      const watched = !withClub && !!licences?.has(b.key);
      const tail = el('span', { class: 'medalist-result' }, `${cupPointsText(b.points)} p.`);
      if (b.lines.length > 1)
        return medalistRowEl(b, { club, watched, tail }, lineEl, openKeys.has(b.key), () => {
          toggleMedalist(openKeys, b.key);
          repaint();
        });
      const [l] = b.lines;
      return el(
        l.group ? 'a' : 'div',
        {
          class: watched ? 'row watched' : 'row',
          href: l.group ? `/c/${l.id}/g/${encodeURIComponent(l.group)}` : null,
        },
        el(
          'div',
          { class: 'row-main' },
          el(
            'div',
            { class: 'medalist-head' },
            el(
              'span',
              { class: 'medalist-head-main' },
              el(
                'span',
                { class: 'row-title' },
                b.name,
                club ? el('span', { class: 'medalist-club' }, ` · ${club}`) : null,
              ),
              el('span', { class: 'row-sub' }, sub(l)),
            ),
            tail,
            el('span', { class: 'medalist-chevron medalist-chevron-none', 'aria-hidden': 'true' }),
          ),
        ),
      );
    }),
  );
}

// Returns a function that draws the Seuratut section. It draws nothing for an
// empty list. Its open rows reset when `sig` changes, so a refresh keeps them.
function cupFollowedEls(sig, first, repaint, opts) {
  return (boxes = first) => {
    if (!boxes.length) return [];
    const multi = boxes.filter((b) => b.lines.length > 1);
    const open = followedOpenKeys(sig, multi);
    return [
      el('h2', {}, 'Seuratut'),
      ...(multi.length > 1
        ? [el('div', { class: 'medalist-bar medalist-bar-end' }, medalistAllEl(multi, open, repaint))]
        : []),
      cupAthleteRowsEl(boxes, open, repaint, { ...opts, withClub: true }),
    ];
  };
}

// Seuratut keeps its open rows apart from the picked club's (medalistOpenKeys),
// as the cup year shows both at once.
const followedOpenKeys = openKeysHolder();

// --- The cup's year (CUP_SEASON_PAGE_PATH, docs/views.md) ---

const CUP_SERIES = ['A', 'B', 'C'];
// A standings table longer than this shows its first rows until the reader
// asks for the whole table (cupTableHead).
const CUP_TABLE_HEAD = 30;
const CUP_FINAL_LABELS = { super: 'Super', A: 'A', B: 'B', C: 'C' };
const CUP_FINAL_NAMES = { super: 'Superfinaali', A: 'A-sarjan finaali', B: 'B-sarjan finaali', C: 'C-sarjan finaali' };
// The Seuracup's own site answers over plain HTTP only (docs/tuloslista-api.md).
const CUP_SITE_URL = 'http://seuracup.tuloslista.com/';

let cupSeriesFile = null;
async function loadCupSeries() {
  if (!cupSeriesFile) cupSeriesFile = await fetchJson('/data/seuracup.json').catch(() => null);
  return cupSeriesFile;
}

// Draws Kokonaistilanne, the year's club standings (docs/views.md,
// "The years"). `followed` and `pick` work as in medalTableEl.
function cupSeasonTableEl(clubs, followed, pick) {
  return wrap(
    el(
      'table',
      { class: 'tbl' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { class: 'num' }, 'Sija'),
          el('th', {}, 'Seura'),
          el('th', {}, 'Sarja'),
          el('th', { class: 'result' }, 'Pisteet'),
          el('th', {}, 'Finaali'),
        ),
      ),
      el(
        'tbody',
        {},
        clubs.map((c) =>
          el(
            'tr',
            {
              class:
                [followed?.has(String(c.id)) ? 'watched' : '', pick.id === String(c.id) ? 'picked' : '']
                  .filter(Boolean)
                  .join(' ') || null,
              onclick: () => pick.onPick(c.id),
            },
            el('td', { class: 'num' }, `${c.rank}.`),
            el(
              'td',
              {},
              el(
                'button',
                { class: 'club-pick', type: 'button', 'aria-pressed': String(pick.id === String(c.id)) },
                c.name,
              ),
            ),
            el('td', {}, c.series || ''),
            el('td', { class: 'result' }, cupPointsText(c.points)),
            el(
              'td',
              {},
              el(
                'span',
                { class: 'cup-final-place' },
                c.final ? `${CUP_FINAL_LABELS[c.final]} ` : null,
                c.finalPlace ? el('span', { class: 'org' }, `(${c.finalPlace}.)`) : null,
              ),
              c.organiser ? el('span', { class: 'org' }, ' järj.') : null,
            ),
          ),
        ),
      ),
    ),
  );
}

// Draws one final's section of the Finaalit tab (cupFinalTables). The first
// three clubs get medal discs once the final's day is past (cupFinalOver).
function cupFinalTableEl({ final, meet, clubs }, followed, todayIso) {
  return el(
    'div',
    {},
    el(
      'h3',
      {},
      meet ? el('a', { class: 'cup-final-link', href: cupPath(meet.id) }, meet.name) : CUP_FINAL_NAMES[final] || '',
      meet?.date ? el('span', { class: 'round-name' }, ` · ${isoToFiDay(meet.date)}`) : null,
    ),
    clubs.length
      ? cupStandingsTable(clubs, {
          followed,
          over: cupFinalOver(meet, todayIso),
          href: meet ? (c) => cupPath(meet.id, c.id) : null,
        })
      : el('div', { class: 'notice' }, 'Ei seuroja.'),
  );
}

// Renders the Seuracup's year from GET /api/cupseason/:year (docs/views.md,
// "The years"). The filter bar, the club pick and the fill-in loop work as
// in renderMedalSeason.
async function renderCupSeason({ tab: wantedTab, piiriId, year: wantedYear, club }) {
  const seq = renderSeq;
  setHelp(null);
  const todayIso = scanTodayIso();
  const year = wantedYear ?? seasonYears(todayIso)[0];
  const [districts, seriesFile] = await Promise.all([loadDistricts(null), loadCupSeries()]);
  if (seq !== renderSeq) return;
  const piiri = meetScopes(districts).find((s) => s.kind === 'piiri' && s.id === piiriId) || null;
  setScrollKey(`cupseason:${piiri ? piiri.id : wantedTab || ''}:${year}`);
  setBack('/');
  titleEl.textContent = CUP_SEASON_PAGE_TITLE;
  const state = viewStateFor(HOME_VIEW_KEY);
  const label = watchLabel(state.watchId);
  const bar = filterBar(HOME_VIEW_KEY, state, { label }, false);
  // With a piiri chosen, its id replaces the osakilpailut tab's name in the
  // address.
  const tabId = (t) => (t === CUP_TAB_FINALS ? CUP_TAB_FINALS : piiri ? piiri.id : CUP_TAB_ROUNDS);
  const yearHref = (y, clubId) =>
    wantedTab || clubId ? seasonHash(tabId(wantedTab), y, [], clubId) : seasonHash(null, y);
  const yearLinks = seasonYears(todayIso).map((y) => [
    y,
    el('a', { class: 'seg-btn', href: yearHref(y, club), 'aria-current': y === year ? 'page' : null }, String(y)),
  ]);
  bar.append(
    segControl(
      'Vuosi',
      yearLinks.map(([, a]) => a),
    ),
  );
  if (!seasonYearOk(year, todayIso)) {
    appEl.replaceChildren(bar, el('div', { class: 'notice' }, `Vuoden ${year} Seuracupia ei ole saatavilla.`));
    return;
  }
  const url = `/api/cupseason/${year}`;
  let pick = club;
  // The endpoint adds rows for the picked club and the active Watch.
  const query = () => {
    const q = new URLSearchParams();
    if (pick) q.set('club', pick);
    if (state.watchId) q.set('watch', state.watchId);
    return q.size ? `?${q}` : '';
  };
  const [data, watch] = await Promise.all([
    fetchJson(url + query()).catch(() => null),
    state.watchId ? loadActiveWatch(state.watchId) : null,
  ]);
  if (seq !== renderSeq) return;
  if (!data || !districts) {
    appEl.replaceChildren(bar, el('div', { class: 'notice error' }, 'Seuracupin haku epäonnistui.'));
    return;
  }
  const tab = wantedTab ?? cupDefaultTab(data.meets, todayIso);
  const scopeId = tabId(tab);
  const tabsEl = el(
    'div',
    { class: 'seg cup-tabs', role: 'group', 'aria-label': 'Vaihe' },
    [
      [CUP_TAB_ROUNDS, 'Osakilpailut'],
      [CUP_TAB_FINALS, 'Finaalit'],
    ].map(([t, text]) =>
      el(
        'a',
        {
          class: 'seg-btn',
          href: seasonHash(tabId(t), year),
          'aria-current': t === tab ? 'page' : null,
        },
        text,
      ),
    ),
  );

  // The chosen piiri stays in the select even where it has no meet.
  const piiriSel = el(
    'select',
    {
      'aria-label': 'Piiri',
      onchange: () => navigate(seasonHash(piiriSel.value, year, [], pick)),
    },
    el('option', { value: CUP_TAB_ROUNDS }, 'Koko maa'),
    cupSeasonPiirit([...data.meets, { piirit: piiri ? [piiri.id] : [] }], districts).map((t) =>
      el(
        'optgroup',
        { label: t.alue.short },
        t.piirit.map((p) => el('option', { value: p.id }, `${p.name} (${p.short})`)),
      ),
    ),
  );
  piiriSel.value = tabId(CUP_TAB_ROUNDS);
  const piiriPick = el('label', { class: 'track-pick' }, piiriSel);

  const targets = watch ? watchTargets(watch.entries, null) : null;
  const seriesOf = seriesFile ? cupSeries(seriesFile) : undefined;
  const piiriShort = new Map(districts.piirit.map((p) => [p.id, p.short]));
  let series = [];
  let pickedEl = null;
  const bodyEl = el('div', {});
  const pendingEl = el('div', {});
  const onPick = (id) => {
    pick = pick === String(id) ? null : String(id);
    replaceAddress(seasonHash(tabId(CUP_TAB_ROUNDS), year, [], pick));
    for (const [y, a] of yearLinks) a.setAttribute('href', seasonHash(tabId(CUP_TAB_ROUNDS), y, [], pick));
    paint();
    if (!pick) return;
    if (pickedEl) scrollToPicked(pickedEl);
    const asked = pick;
    fetchJson(url + query()).then(
      (d) => {
        if (seq === renderSeq && pick === asked) paint(d);
      },
      () => {},
    );
  };
  const meetSub = (m) => [isoToFiDay(m.date), ...m.piirit.map((id) => piiriShort.get(id))].filter(Boolean).join(' · ');
  const meetRow = (m, picked) =>
    el(
      'a',
      { class: m.kind === 'nines' ? 'row row-out' : 'row', href: cupPath(m.id) },
      el(
        'div',
        { class: 'row-main' },
        el('div', { class: 'row-title' }, m.name),
        el('div', { class: 'row-sub' }, meetSub(m)),
      ),
      m.clubs == null
        ? el('span', { class: 'chip' }, 'Ei haettu')
        : m.stale
          ? el('span', { class: 'chip' }, 'Vanhentunut')
          : null,
      picked ? el('span', { class: 'medalist-chevron medalist-chevron-none', 'aria-hidden': 'true' }) : null,
    );
  // Draws one meet of the picked club. Its row opens onto the club's scoring
  // results, like a meet row in medalSeasonMeetEl.
  const clubMeetEl = (l, open, onToggle) => {
    const cls = l.kind === 'nines' ? 'row row-out' : 'row';
    const href = cupPath(l.id, pick);
    const points = el('span', { class: 'medalist-result' }, `${cupPointsText(l.points)} p.`);
    const main = [
      el('span', { class: 'row-title' }, l.name),
      el('span', { class: 'row-sub' }, [meetSub(l), l.stale && 'Vanhentunut'].filter(Boolean).join(' · ')),
    ];
    if (!l.boxes.length) {
      return el(
        'a',
        { class: cls, href },
        el(
          'div',
          { class: 'row-main' },
          el(
            'div',
            { class: 'medalist-head' },
            el('span', { class: 'medalist-head-main' }, main),
            points,
            el('span', { class: 'medalist-chevron medalist-chevron-none', 'aria-hidden': 'true' }),
          ),
        ),
      );
    }
    return el(
      'div',
      { class: cls },
      el(
        'div',
        { class: 'row-main' },
        medalistHeadEl(open, onToggle, main, points),
        open
          ? el(
              'div',
              { class: 'medalist-entries' },
              cupBoxRows(l.boxes).map((r) =>
                el(
                  'a',
                  { class: 'medalist-entry', href },
                  el(
                    'span',
                    { class: 'medalist-event' },
                    r.event,
                    el('span', { class: 'medalist-sub' }, ` · ${r.name}`),
                  ),
                  el('span', { class: 'medalist-result' }, `${cupPointsText(r.points)} p.`),
                ),
              ),
            )
          : null,
      ),
    );
  };
  const lineSub = (l) => `${l.name} · ${dayMonth(isoToFiDay(l.date))}`;
  const athleteOpts = {
    licences: targets?.licences,
    sub: (l) => `${l.event} · ${lineSub(l)}`,
    lineEl: (l) =>
      el(
        l.group ? 'a' : 'span',
        { class: 'medalist-entry', href: l.group ? `/c/${l.id}/g/${encodeURIComponent(l.group)}` : null },
        el('span', { class: 'medalist-event' }, l.event, el('span', { class: 'medalist-sub' }, ` · ${lineSub(l)}`)),
        el('span', { class: 'medalist-result' }, `${cupPointsText(l.points)} p.`),
      ),
  };
  // Seuratut lists the people followed by name. A followed club is a tinted row.
  const named = targets?.licences.size ? { licences: targets.licences } : null;
  const followedEls = cupFollowedEls(`cupseason:${tab}:${year}:${state.watchId}`, [], () => paint(), athleteOpts);
  let season = data;
  let allRows = false;
  const roundsOpen = new Map();
  const paintFinals = () => {
    const rows = cupSeasonTable(season.meets, seriesOf, cupFinalOrganisers(season.meets));
    const tinted = targets ? cupFollowedClubs(season.meets, targets) : null;
    bodyEl.replaceChildren(
      el(
        'div',
        {},
        ...followedEls(named ? cupSeasonAthletes(season.meets, named, 'final') : []),
        el('h2', {}, 'Finaalit'),
        cupFinalTables(season.meets, rows).map((t) => cupFinalTableEl(t, tinted, todayIso)),
      ),
    );
  };
  const paint = (next = season) => {
    season = next;
    if (tab === CUP_TAB_FINALS) {
      paintFinals();
      return;
    }
    const scoped = cupSeasonScope(season, piiri?.id);
    const rows = cupSeasonTable(season.meets, seriesOf, cupFinalOrganisers(season.meets));
    const inScope = cupTableShown(rows, scoped.meets);
    const clubs = cupTableShown(rows, scoped.meets, series);
    const noSeries = seriesFile
      ? inScope
          .filter((c) => !c.series)
          .map((c) => c.name)
          .sort((a, b) => a.localeCompare(b, 'fi'))
      : [];
    // A picked club's meets ignore the piiri select.
    const clubMeets = pick ? cupSeasonClub(season.meets, pick).filter((l) => l.kind !== 'final') : [];
    // A club that appears only in a final has no standings row but can still
    // be picked.
    const picked = pick ? season.meets.flatMap((m) => m.clubs || []).find((c) => String(c.id) === pick) || null : null;
    const athletes =
      picked && medalistsShown ? cupSeasonAthletes(season.meets, { clubIds: new Set([pick]) }, 'osa') : [];
    const meetList = picked && !medalistsShown;
    const boxes = meetList
      ? clubMeets.filter((l) => l.boxes.length).map((l) => ({ ...l, key: l.id }))
      : athletes.filter((b) => b.lines.length > 1);
    // A picked club's meet rows start closed.
    const openKeys = medalistOpenKeys(
      `cupseason:${medalistsShown}:${year}:${picked?.id}`,
      boxes,
      meetList ? false : undefined,
    );
    const toggle = (key) => () => {
      toggleMedalist(openKeys, key);
      paint();
    };
    const byId = new Map(clubMeets.map((l) => [l.id, l]));
    const scopedIds = new Set(scoped.meets.map((m) => m.id));
    // A meet in scope that is not built yet is listed too, since the club may
    // be in it.
    const clubRows = season.meets.filter(
      (m) => m.kind !== 'final' && (byId.has(m.id) || (m.clubs == null && scopedIds.has(m.id))),
    );
    const tinted = targets ? cupFollowedClubs(season.meets, targets) : null;
    const head = allRows
      ? { rows: clubs, more: 0 }
      : cupTableHead(clubs, CUP_TABLE_HEAD, new Set([...(tinted || []), ...(pick ? [pick] : [])]));
    const rounds = [1, 2]
      .map((r) => [r, scoped.meets.filter((m) => m.kind !== 'final' && cupMeetRound(m.date) === r)])
      .filter(([, ms]) => ms.length);
    const controls = el(
      'div',
      { class: 'aidat-chips no-print' },
      el(
        'div',
        { class: 'aidat-chip-row' },
        piiriPick,
        el(
          'div',
          { class: 'cup-series-chips' },
          CUP_SERIES.map((x) => {
            const on = series.includes(x);
            return el(
              'button',
              {
                class: `chip chip-toggle${on ? ' on' : ''}`,
                'aria-pressed': String(on),
                onclick: () => {
                  series = on ? series.filter((y) => y !== x) : [...series, x];
                  paint();
                },
              },
              `${x}-sarja`,
            );
          }),
        ),
      ),
    );
    bodyEl.replaceChildren(
      el(
        'div',
        {},
        ...followedEls(named ? cupSeasonAthletes(season.meets, named, 'osa') : []),
        el(
          'h2',
          {},
          'Kokonaistilanne',
          el(
            'span',
            { class: 'round-name' },
            ' · ',
            el(
              'a',
              { class: 'cup-site-link', href: CUP_SITE_URL, target: '_blank', rel: 'noopener' },
              'seuracup.tuloslista.com',
            ),
          ),
        ),
        controls,
        clubs.length
          ? cupSeasonTableEl(head.rows, tinted, { id: picked ? pick : null, onPick })
          : el('div', { class: 'notice' }, 'Ei pisteitä.'),
        head.more
          ? el(
              'button',
              {
                class: 'medalist-all',
                type: 'button',
                onclick: () => {
                  allRows = true;
                  paint();
                },
              },
              `Näytä kaikki ${clubs.length} seuraa`,
            )
          : null,
        noSeries.length ? el('div', { class: 'medals-unknown' }, `Ei sarjatietoa: ${noSeries.join(', ')}`) : null,
        ...(picked
          ? [
              (pickedEl = pickedHeadEl(picked, onPick)),
              el(
                'div',
                { class: 'medalist-bar' },
                medalistsSwitchEl('Kilpailut', () => paint(), 'Urheilijat'),
                boxes.length > 1 ? medalistAllEl(boxes, openKeys, () => paint()) : null,
              ),
              medalistsShown
                ? athletes.length
                  ? cupAthleteRowsEl(athletes, openKeys, () => paint(), athleteOpts)
                  : el('div', { class: 'notice' }, 'Ei pisteitä.')
                : el(
                    'div',
                    { class: 'list' },
                    clubRows.map((m) =>
                      byId.has(m.id)
                        ? clubMeetEl(
                            { ...byId.get(m.id), piirit: m.piirit, stale: m.stale },
                            openKeys.has(m.id),
                            toggle(m.id),
                          )
                        : meetRow(m, true),
                    ),
                  ),
            ]
          : [
              (pickedEl = el('h2', {}, 'Osakilpailut')),
              ...(rounds.length
                ? rounds.map(([r, ms]) =>
                    el(
                      'details',
                      {
                        class: 'fold',
                        open: roundsOpen.get(r) ?? !!piiri,
                        ontoggle: (e) => roundsOpen.set(r, e.target.open),
                      },
                      el(
                        'summary',
                        {},
                        `${r}. osakilpailut · ${ms.length} ${ms.length === 1 ? 'kilpailu' : 'kilpailua'}`,
                      ),
                      el(
                        'div',
                        { class: 'list' },
                        ms.map((m) => meetRow(m)),
                      ),
                    ),
                  )
                : [el('div', { class: 'notice' }, `Ei osakilpailuja vuonna ${year}.`)]),
            ]),
      ),
    );
  };
  paint(data);
  appEl.replaceChildren(bar, tabsEl, pendingEl, bodyEl);
  renderFillStatus(pendingEl, `cupseason:${scopeId}:${year}`, data, {
    left: (d) => {
      const s = cupSeasonScope(d, piiri?.id);
      return s.pending.length + s.meets.filter((m) => m.stale).length;
    },
    // One build request builds several meets within a time budget
    // (docs/backend.md, "A scope's year").
    build: () =>
      fetchJson(`${url}${query() ? `${query()}&` : '?'}build=1`, { signal: AbortSignal.timeout(40_000) }).then(
        (d) => ({ data: d }),
        (e) => ({ status: e.status }),
      ),
    onUpdate: paint,
  });
}

export { renderCup, renderCupSeason };
