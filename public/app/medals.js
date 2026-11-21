import { ageOrder, ageRangeLabel } from '../lib/ages.js';
import { dateRange, dateSortKey, isoToFiDay } from '../lib/dates.js';
import { coverWords, coversStart, medalScope, meetScopes, scopeTree, tickedScopes } from '../lib/districts.js';
import { medalYearOk, medalYears } from '../lib/indexes.js';
import {
  athleteYears,
  athleteYearsName,
  clubMedalStarts,
  clubMedalists,
  clubYearAges,
  clubYearMedalists,
  clubYearTable,
  followedRows,
  medalAges,
  medalPlaces,
  medalSeasonAges,
  medalSeasonClubMeets,
  medalSeasonFollowedMedalists,
  medalSeasonMedalists,
  medalSeasonMeetAges,
  medalSeasonMeetHolds,
  medalSeasonTable,
  medalStartAt,
  medalTables,
  medalistBoxes,
  medalistsOpenAll,
  restMedals,
} from '../lib/medals.js';
import { allocMark, relayLegs } from '../lib/results.js';
import {
  MEDAL_SEASON_PAGE_PATH,
  MEDAL_SEASON_PAGE_TITLE,
  athleteYearsHash,
  clubYearsHash,
  isDemoId,
  medalStartPath,
  medalsPath,
  seasonHash,
} from '../lib/routes.js';
import { reconcileStatuses, scheduleStatuses } from '../lib/schedule.js';
import { SEARCH_MIN_CHARS } from '../lib/search.js';
import { filterEventIds, watchAthletes, watchClubs, watchTargets } from '../lib/watch.js';
import {
  HOME_VIEW_KEY,
  fetchCompProps,
  fetchEventDoc,
  fetchJson,
  fetchSchedule,
  listedRow,
  loadActiveWatch,
  loadDistricts,
  officialMenuRows,
  piiriDefaults,
  viewStateFor,
  watchLabel,
} from './data.js';
import {
  SCOPES_SHEET_TITLE,
  ageChips,
  clubNameLink,
  filterBar,
  openPiiriSheet,
  resolveFilter,
  scopeTitle,
} from './follow.js';
import {
  appEl,
  el,
  keepData,
  keptData,
  navigate,
  renderFillStatus,
  renderSeq,
  replaceAddress,
  scanTodayIso,
  scrollKey,
  scrollPositions,
  segControl,
  setBack,
  setHelp,
  setScrollKey,
  setTitleMenu,
  titleEl,
  wrap,
} from './shell.js';

// --- The medal table (/c/<compId>/mitalit) ---

// A relay of several classes counts its medals in one class (startLine,
// lib/districts.js).
const onlyNote = (l) => (l.only ? `Mitalit lasketaan vain sarjaan ${l.only}` : null);

// The medal page costs one results fetch per followed event and one root fetch
// per followed multi-event.
async function renderMedals(compId, ages = [], club = null) {
  const seq = renderSeq;
  setScrollKey(`medals:${compId}`);
  setBack(`/c/${compId}`);
  setHelp(null);

  const state = viewStateFor(compId);
  const [props, schedule, filter, medalBody, districts, listed] = await Promise.all([
    keptData(`props:${compId}`, () => fetchCompProps(compId)),
    keptData(`schedule:${compId}`, () => fetchSchedule(compId)),
    keptData(`filter:${compId}`, () => resolveFilter(compId, state)),
    // The meet's medal table and one per scope (docs/backend.md,
    // "The medal table").
    keptData(`/api/medals/${compId}`, () => fetchJson(`/api/medals/${compId}`).catch(() => null)),
    loadDistricts(compId),
    listedRow(compId),
  ]);
  if (seq !== renderSeq) return;
  // The ticked scopes are the chosen ones (openPiiriSheet), or with no choice
  // the meet's own. A chosen scope the body lacks is skipped and stays stored.
  if (medalBody) piiriDefaults.set(compId, medalBody.defaults || []);
  const ticked = tickedScopes(state.scopes, medalBody?.defaults).filter((t) =>
    (medalBody?.scopes || []).some((p) => p.id === t.id),
  );
  // The tables come from the body's classes (medalTables), or from the Worker
  // without districts.json. A chosen class with no chip stays in the address.
  const chipAges = medalBody && districts ? medalAges(medalBody, ticked, districts) : [];
  const shown = ages.filter((a) => chipAges.includes(a));
  const cover = shown.length ? { ages: shown, events: null } : null;
  const { scopes: chosen, rest } = !medalBody
    ? { scopes: [], rest: [] }
    : districts
      ? medalTables(medalBody, ticked, districts, cover)
      : {
          scopes: medalBody.scopes.filter((p) => ticked.some((t) => t.id === p.id)),
          rest: restMedals(medalBody, ticked),
        };
  const scopeOf = chosen.length && districts ? medalScope(districts, ticked) : null;
  setTitleMenu(filter?.label ? `Mitalitaulukko · ${filter.label}` : 'Mitalitaulukko', [
    { label: SCOPES_SHEET_TITLE, onclick: () => openPiiriSheet(compId) },
    ...officialMenuRows(listed, compId),
  ]);
  const compName = props?.Competition?.Name || `Kilpailu ${compId}`;
  const days = Object.keys(schedule).sort((a, b) => dateSortKey(a) - dateSortKey(b));
  const meetLine = el('div', { class: 'medals-meet' }, `${compName} · ${dateRange(days)}`);
  const year = days[0]?.slice(days[0].lastIndexOf('.') + 1);
  const seasonOf = (p) =>
    !isDemoId(compId) && medalYearOk(year, scanTodayIso())
      ? el('a', { href: `${MEDAL_SEASON_PAGE_PATH}${seasonHash(p.id, Number(year), ages, pick)}` }, p.short)
      : p.short;

  // The meet page decides the same way whether a list filters it (renderComp).
  const targets = filter?.targets || null;
  const eventIds = targets && filter?.roster ? filterEventIds(targets, filter.roster) : null;
  const followed = !!(eventIds && filter.entries.some((e) => e.enabled));
  // This is the meet page's filter bar without its mode toggle.
  const head = [
    meetLine,
    filterBar(compId, state, filter, false),
    filter?.notice ? el('div', { class: 'notice' }, filter.notice) : null,
    chipAges.length
      ? ageChips(chipAges, shown, (next) => navigate(medalsPath(compId, next, pick), { redraw: true }))
      : null,
  ];
  let followedIds = null;
  let followedBoxes = [];
  const medalsEl = el('div', {});
  let pick = club;
  let pickedEl = null;
  const onPick = (id) => {
    pick = pick === String(id) ? null : String(id);
    replaceAddress(medalsPath(compId, ages, pick));
    paintMedals();
    if (pick && pickedEl) scrollToPicked(pickedEl);
  };
  const followedEls = () => {
    if (!followed) return [];
    const openKeys = medalistOpenKeys(`followed:${compId}:${shown.join(',')}`, followedBoxes);
    return [
      el('h2', {}, 'Seuratut mitalistit'),
      followedBoxes.length > 1
        ? el('div', { class: 'medalist-bar medalist-bar-end' }, medalistAllEl(followedBoxes, openKeys, paintMedals))
        : null,
      !eventIds.size
        ? el(
            'div',
            { class: 'notice' },
            `Kukaan seurannan "${filter.label || 'Seuranta'}" urheilijoista ei osallistu tähän kilpailuun.`,
          )
        : followedBoxes.length
          ? el(
              'div',
              { class: 'list' },
              followedBoxes.map((b) =>
                medalistRowEl(
                  b,
                  { club: b.athleteId ? b.org?.NameShort || b.org?.Name || '' : '' },
                  (r) => medalistLineEl(compId, r, multiDay),
                  openKeys.has(b.key),
                  () => {
                    toggleMedalist(openKeys, b.key);
                    paintMedals();
                  },
                ),
              ),
            )
          : el('div', { class: 'notice' }, 'Ei mitalisteja.'),
    ];
  };
  const medals = () => {
    if (!medalBody)
      return [
        el('h2', {}, 'Seurat'),
        el('div', { class: 'notice error' }, 'Mitalitaulukon haku epäonnistui.'),
        ...followedEls(),
      ];
    const tableClubs = [...chosen.flatMap((p) => p.table), ...rest];
    const picked = tableClubs.find((c) => String(c.id) === pick) || null;
    const tableEl = (rows) =>
      rows.length
        ? medalTableEl(compId, rows, followedIds, { id: picked?.id, onPick })
        : el('div', { class: 'notice' }, 'Ei mitaleita.');
    const lines = picked ? clubMedalStarts(medalBody, ticked, districts, cover, picked.id, schedule) : [];
    const boxes =
      picked && medalistsShown ? clubMedalists(medalBody, ticked, districts, cover, picked.id, schedule) : [];
    const openKeys = medalistsShown
      ? medalistOpenKeys(`medals:${compId}:${picked?.id}:${shown.join(',')}`, boxes)
      : new Set();
    return [
      el('h2', {}, 'Seurat'),
      ...(chosen.length
        ? [
            ...chosen.map((p) => {
              const cover = ticked.find((t) => t.id === p.id)?.cover;
              return {
                table: p.table,
                title: [
                  `${SCOPE_CHAMPIONSHIP[p.kind]} · `,
                  seasonOf(p),
                  cover && (cover.ages || cover.events)
                    ? el('span', { class: 'medalist-sub' }, ` · ${coverWords(cover)}`)
                    : null,
                ],
              };
            }),
            ...(rest.length ? [{ title: ['Muut lajit'], table: rest }] : []),
          ].flatMap((p) => [el('h3', {}, ...p.title), tableEl(p.table)])
        : [tableEl(rest)]),
      chosen.length && medalBody.unknown?.length
        ? el('div', { class: 'medals-unknown' }, `Ei piiritietoa: ${medalBody.unknown.join(', ')}`)
        : null,
      ...(!picked
        ? followedEls()
        : [
            (pickedEl = pickedHeadEl(picked, onPick)),
            el(
              'div',
              { class: 'medalist-bar' },
              medalistsSwitchEl('Lajit', paintMedals),
              medalistsShown && boxes.length > 1 ? medalistAllEl(boxes, openKeys, paintMedals) : null,
            ),
            !medalistsShown
              ? el(
                  'div',
                  { class: 'list' },
                  lines.map((l) => {
                    const sub = [l.names.join(', '), multiDay && l.date, onlyNote(l)].filter(Boolean).join(' · ');
                    return el(
                      l.link ? 'a' : 'div',
                      { class: 'row', href: l.link ? medalStartHref(compId, l.link) : null },
                      el(
                        'div',
                        { class: 'row-main' },
                        el('div', { class: 'row-title' }, l.event),
                        sub ? el('div', { class: 'row-sub' }, sub) : null,
                      ),
                      medalSlotsEl(l.medals),
                    );
                  }),
                )
              : el(
                  'div',
                  { class: 'list' },
                  boxes.map((b) =>
                    medalistRowEl(
                      b,
                      { watched: !!b.athleteId && !!targets?.athleteIds?.has(b.athleteId) },
                      (l) =>
                        bodyMedalLineEl(
                          l,
                          l.link && medalStartHref(compId, l.link),
                          [multiDay && l.date && dayMonth(l.date), onlyNote(l)].filter(Boolean).join(' · '),
                        ),
                      openKeys.has(b.key),
                      () => {
                        toggleMedalist(openKeys, b.key);
                        paintMedals();
                      },
                    ),
                  ),
                ),
          ]),
    ].filter(Boolean);
  };
  const paintMedals = () => medalsEl.replaceChildren(...medals());
  const multiDay = Object.keys(schedule).length > 1;

  if (followed && eventIds.size) {
    // Results are reconciled with the schedule (reconcileStatuses). An event
    // that does not answer is left out, as on the day list.
    const statusById = scheduleStatuses(schedule);
    const results = (
      await Promise.all(
        [...eventIds].map(async (eventId) => {
          try {
            return { eventId, data: reconcileStatuses(await fetchEventDoc(compId, schedule, eventId), statusById) };
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);
    // A followed multi-event's line is its root's standing, not its legs'
    // (followedRows, lib/medals.js).
    const rootIds = [...new Set(results.map((r) => r.data?.RootId).filter(Boolean))];
    const roots = (
      await Promise.all(
        rootIds.map(async (eventId) => {
          try {
            return { eventId, data: await fetchEventDoc(compId, schedule, eventId) };
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);
    if (seq !== renderSeq) return;

    // The followed lines count medals under the tables' scopes and chips
    // (medalFor).
    const rows = followedRows(schedule, [...results, ...roots], targets, scopeOf).filter((r) =>
      coversStart(cover, r.start),
    );
    // Boxes hold only medals that stand. Every followed club is still
    // highlighted on the table.
    followedBoxes = medalistBoxes(rows.filter((r) => r.medal && !r.pending));
    followedIds = new Set(rows.map((r) => String(r.org?.Id)));
  }
  paintMedals();
  appEl.replaceChildren(el('div', {}, ...head, medalsEl));
}

// Draws one medal in a box. The event carries its round, its day on a
// multi-day meet and a relay's legs. The placing is followedRows' `place`.
function medalistLineEl(compId, r, multiDay) {
  const mark = r.points ? r.alloc.Result || '' : allocMark(r.alloc, { EventSubCategory: r.subCategory });
  const legs = r.legCount > 1 ? relayLegs(r.alloc, r.legCount) : [];
  return el(
    'a',
    { class: 'medalist-entry', href: medalStartHref(compId, r.link) },
    el('span', { class: 'medalist-disc' }, medalEl(r.medal)),
    el(
      'span',
      { class: 'medalist-event' },
      r.event,
      r.roundName ? el('span', { class: 'medalist-sub' }, ` · ${r.roundName}`) : null,
      multiDay ? el('span', { class: 'medalist-sub' }, ` · ${dayMonth(r.date)}`) : null,
      legs.length ? el('span', { class: 'medalist-sub relay-legs' }, ` (${legs.join(', ')})`) : null,
    ),
    el('span', { class: 'medalist-place' }, r.place),
    el(
      'span',
      { class: 'medalist-result' },
      mark,
      r.points && mark ? el('span', { class: 'medalist-sub' }, ' p.') : null,
    ),
  );
}

function medalStartHref(compId, link) {
  return `/c/${compId}/${link.kind === 'combined' ? 'o' : 'g'}/${encodeURIComponent(link.key)}`;
}

// Draws a medal line off a medal body, which keeps no placing or mark.
function bodyMedalLineEl(l, href, sub) {
  return el(
    href ? 'a' : 'span',
    { class: 'medalist-entry', href: href || null },
    el('span', { class: 'medalist-disc' }, medalEl(l.medal, !!l.relay)),
    el(
      'span',
      { class: 'medalist-event' },
      l.event,
      sub ? el('span', { class: 'medalist-sub' }, ` · ${sub}`) : null,
      runnersEl(l.runners),
    ),
  );
}

// A relay's runners after its event, as medalistLineEl draws a relay's legs.
function runnersEl(runners) {
  const named = (runners || []).filter(Boolean);
  return named.length ? el('span', { class: 'medalist-sub relay-legs' }, ` (${named.join(', ')})`) : null;
}

// Draws a medal table with the place, the club, a column per metal and the
// total. `followed` highlights rows. `pick` ({id, onPick}) makes each a toggle.
function medalTableEl(compId, clubs, followed = null, pick = null) {
  const places = medalPlaces(clubs);
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
          el('th', { class: 'num', 'aria-label': 'Sija' }),
          el('th', { 'aria-label': 'Seura' }),
          [1, 2, 3].map((m) => el('th', { class: 'num' }, medalEl(m))),
          el('th', { class: 'num' }, 'Yht'),
        ),
      ),
      el(
        'tbody',
        {},
        clubs.map((c, i) =>
          el(
            'tr',
            {
              class:
                [followed?.has(c.id) ? 'watched' : '', pick?.id === c.id ? 'picked' : ''].filter(Boolean).join(' ') ||
                null,
              ...(pick ? { onclick: () => pick.onPick(c.id) } : {}),
            },
            el('td', { class: 'num' }, `${places[i]}.`),
            el(
              'td',
              {},
              pick
                ? el('button', { class: 'club-pick', type: 'button', 'aria-pressed': String(pick.id === c.id) }, c.name)
                : clubNameLink(compId, { Id: c.id, Name: c.name }, c.name),
            ),
            c.medals.map((n) => el('td', { class: 'num' }, n ? String(n) : '')),
            el('td', { class: 'num' }, c.total ? String(c.total) : ''),
          ),
        ),
      ),
    ),
  );
}

// --- A championship's year (MEDAL_SEASON_PAGE_PATH, docs/views.md) ---

// Draws a picked club's meet on the year page (medalSeasonClubMeets). It opens
// onto a line per class, each linking to the meet's table.
function medalSeasonMeetEl(meet, box, href, open, onToggle) {
  const sub = [isoToFiDay(meet.date), meet.cover && coverWords(meet.cover), meet.stale && 'Vanhentunut']
    .filter(Boolean)
    .join(' · ');
  return el(
    'div',
    { class: 'row' },
    el(
      'div',
      { class: 'row-main' },
      medalistHeadEl(
        open,
        onToggle,
        [el('span', { class: 'row-title' }, meet.name), el('span', { class: 'row-sub' }, sub)],
        medalSlotsEl(box.medals),
      ),
      open
        ? el(
            'div',
            { class: 'medalist-entries' },
            box.lines.map((l) => {
              const lineSub = [l.names.join(', '), onlyNote(l)].filter(Boolean).join(' · ');
              return el(
                'a',
                { class: 'medalist-entry', href },
                el(
                  'span',
                  { class: 'medalist-event' },
                  l.event,
                  lineSub ? el('span', { class: 'medalist-sub' }, ` · ${lineSub}`) : null,
                ),
                medalSlotsEl(l.medals),
              );
            }),
          )
        : null,
    ),
  );
}

const SCOPE_CHAMPIONSHIP = { maa: 'Suomenmestaruus', alue: 'Aluemestaruus', piiri: 'Piirinmestaruus' };

// Names a scope as its championship, or a notable meet by its own name.
function championshipTitle(scope) {
  if (scope.kind === 'notable') return scope.name;
  return scope.kind === 'maa' ? SCOPE_CHAMPIONSHIP.maa : `${SCOPE_CHAMPIONSHIP[scope.kind]} · ${scope.short}`;
}

// A scope's year's back target, and whether the next render keeps it.
let seasonBack = null;
let keepSeasonBack = false;

// Lists the scopes when none is named, and otherwise draws one scope's year.
async function renderMedalSeason({ scopeId, year: wantedYear, ages, club }, isRefresh = false) {
  const seq = renderSeq;
  setHelp(null);
  const districts = await loadDistricts(null);
  if (seq !== renderSeq) return;
  const scopes = meetScopes(districts);
  const scope = scopes.find((s) => s.id === scopeId);
  if (!scope) {
    setScrollKey('medalseason');
    setBack('/');
    titleEl.textContent = MEDAL_SEASON_PAGE_TITLE;
    const row = (s) =>
      el(
        'a',
        { class: s.kind === 'piiri' ? 'row scope-piiri' : 'row', href: seasonHash(s.id) },
        el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, scopeTitle(s))),
      );
    const state = viewStateFor(HOME_VIEW_KEY);
    const bar = filterBar(HOME_VIEW_KEY, state, { label: watchLabel(state.watchId) }, false);
    const watch = state.watchId ? await loadActiveWatch(state.watchId) : null;
    if (seq !== renderSeq) return;
    const followed = { clubs: watchClubs(watch?.entries), athletes: watchAthletes(watch?.entries) };
    const clubsEl = el('div', {});
    const clubRow = (c) => {
      clubNames.set(String(c.id), c.name);
      return el(
        'a',
        { class: 'row', href: clubYearsHash(c.id) },
        el(
          'div',
          { class: 'row-main' },
          el(
            'div',
            { class: 'row-title' },
            c.name,
            c.nameShort ? [' ', el('span', { class: 'scope-short' }, c.nameShort)] : null,
          ),
        ),
      );
    };
    const athleteRow = (a) => {
      athleteNames.set(a.licence, a.name);
      return el(
        'a',
        { class: 'row', href: athleteYearsHash(a.licence) },
        el(
          'div',
          { class: 'row-main' },
          el('div', { class: 'row-title' }, a.name),
          a.club ? el('div', { class: 'row-sub' }, a.club) : null,
        ),
      );
    };
    const paintClubs = (found) => {
      const { clubs, athletes } = found ?? {
        clubs: followed.clubs,
        athletes: followed.athletes.map(({ id, name }) => ({ licence: id, name })),
      };
      clubsEl.replaceChildren(
        clubs.length || athletes.length
          ? el('div', { class: 'list' }, clubs.map(clubRow), athletes.map(athleteRow))
          : found
            ? el('div', { class: 'notice' }, 'Ei osumia.')
            : '',
      );
    };
    // An answer to a query the reader has already typed past is dropped.
    let asked = 0;
    const search = el('input', {
      class: 'search',
      type: 'search',
      placeholder: 'Hae seuraa tai urheilijaa…',
      oninput: async () => {
        const q = search.value.trim();
        const mine = ++asked;
        if (q.length < SEARCH_MIN_CHARS) {
          paintClubs(null);
          return;
        }
        const answer = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`).catch(() => null);
        if (mine !== asked) return;
        if (answer)
          paintClubs({
            clubs: answer.clubs || [],
            athletes: (answer.athletes || []).map((a) => ({ licence: a.licenseId, name: a.name, club: a.club })),
          });
        else clubsEl.replaceChildren(el('div', { class: 'notice error' }, 'Haku epäonnistui.'));
      },
    });
    paintClubs(null);
    appEl.replaceChildren(
      bar,
      el('h2', {}, 'Vuositilastot'),
      search,
      clubsEl,
      el('h2', {}, 'Mestaruudet'),
      districts
        ? el(
            'div',
            { class: 'list' },
            scopeTree(districts).flatMap((t) => [row(t.alue), ...t.piirit.map(row)]),
          )
        : el('div', { class: 'notice error' }, 'Piirien haku epäonnistui.'),
    );
    return;
  }

  const todayIso = scanTodayIso();
  const year = wantedYear ?? medalYears(todayIso)[0];
  setScrollKey(`medalseason:${scope.id}:${year}:${club ?? ''}`);
  // The back target is set on arrival (docs/views.md, "The years"). A redraw
  // or a year tab keeps it.
  if (!(isRefresh || keepSeasonBack) || !seasonBack)
    seasonBack = club ? `${MEDAL_SEASON_PAGE_PATH}${clubYearsHash(club, ages)}` : MEDAL_SEASON_PAGE_PATH;
  keepSeasonBack = false;
  setBack(seasonBack);
  titleEl.textContent = scope.kind === 'alue' ? scope.short : scope.name;
  // The page belongs to no meet, so it shows home's filter bar under home's key.
  const state = viewStateFor(HOME_VIEW_KEY);
  const label = watchLabel(state.watchId);
  const bar = filterBar(HOME_VIEW_KEY, state, { label }, false);
  const yearLinks = medalYears(todayIso).map((y) => [
    y,
    el(
      'a',
      {
        class: 'seg-btn',
        href: seasonHash(scope.id, y, ages, club),
        'aria-current': y === year ? 'page' : null,
        onclick: () => {
          keepSeasonBack = true;
        },
      },
      String(y),
    ),
  ]);
  bar.append(
    segControl(
      'Vuosi',
      yearLinks.map(([, a]) => a),
    ),
  );
  if (!medalYearOk(year, todayIso)) {
    appEl.replaceChildren(bar, el('div', { class: 'notice' }, `Vuoden ${year} mitaleita ei ole saatavilla.`));
    return;
  }
  const url = `/api/medalseason/${scope.id}/${year}`;
  const [data, watch] = await Promise.all([
    keptData(url, () => fetchJson(url).catch(() => null)),
    state.watchId ? keptData(`watch:${state.watchId}`, () => loadActiveWatch(state.watchId)) : null,
  ]);
  if (seq !== renderSeq) return;
  if (!data) {
    appEl.replaceChildren(bar, el('div', { class: 'notice error' }, 'Mestaruuskilpailuiden haku epäonnistui.'));
    return;
  }

  // A list highlights its clubs on the table. While no club is picked, its
  // people's medals are listed by licence.
  const targets = watch ? watchTargets(watch.entries, null) : null;
  const followed = targets?.clubIds || null;
  let pick = club;
  let pickedEl = null;
  const go = (next) => navigate(seasonHash(scope.id, year, next, pick), { redraw: true });
  const bodyEl = el('div', {});
  const pendingEl = el('div', {});
  const meetRow = (m, href, picked, cover) =>
    el(
      'a',
      { class: medalSeasonMeetHolds(m, cover) ? 'row' : 'row row-out', href },
      el(
        'div',
        { class: 'row-main' },
        el('div', { class: 'row-title' }, m.name),
        el(
          'div',
          { class: 'row-sub' },
          [isoToFiDay(m.date), m.cover && coverWords(m.cover)].filter(Boolean).join(' · '),
        ),
      ),
      m.starts == null
        ? el('span', { class: 'chip' }, 'Ei haettu')
        : m.stale
          ? el('span', { class: 'chip' }, 'Vanhentunut')
          : null,
      picked ? medalSlotsEl(picked.meets.find((x) => x.id === m.id)?.medals || [0, 0, 0]) : null,
      picked ? el('span', { class: 'medalist-chevron medalist-chevron-none', 'aria-hidden': 'true' }) : null,
    );
  let season = data;
  const paint = (next = season) => {
    season = next;
    // A chosen age with no chip stays in the address, as on the medal page.
    const chipAges = medalSeasonAges(season.meets);
    const shown = ages.filter((a) => chipAges.includes(a));
    const cover = shown.length ? { ages: shown, events: null } : null;
    const meetHref = (id) =>
      medalsPath(
        id,
        shown.length
          ? ages
          : medalSeasonMeetAges(
              season.meets.find((m) => m.id === id),
              chipAges,
            ),
        pick,
      );
    const clubs = medalSeasonTable(season.meets, cover);
    const picked = clubs.find((c) => String(c.id) === pick) || null;
    const onPick = (id) => {
      pick = pick === String(id) ? null : String(id);
      replaceAddress(seasonHash(scope.id, year, ages, pick));
      for (const [y, a] of yearLinks) a.setAttribute('href', seasonHash(scope.id, y, ages, pick));
      paint();
      if (pick && pickedEl) scrollToPicked(pickedEl);
    };
    const boxes = !picked
      ? medalSeasonFollowedMedalists(season.meets, targets || {}, cover)
      : medalistsShown
        ? medalSeasonMedalists(season.meets, picked.id, cover)
        : medalSeasonClubMeets(season.meets, picked.id, cover);
    const meetNames = new Map(season.meets.map((m) => [m.id, m.name]));
    const openKeys = medalistOpenKeys(
      `medalseason:${picked ? medalistsShown : 'followed'}:${scope.id}:${year}:${picked?.id}:${shown.join(',')}`,
      boxes,
    );
    const toggle = (key) => () => {
      toggleMedalist(openKeys, key);
      paint();
    };
    const medalistRows = (withClub) =>
      el(
        'div',
        { class: 'list' },
        boxes.map((b) =>
          medalistRowEl(
            b,
            {
              club: withClub && b.club,
              watched: !withClub && !!targets?.licences.has(b.key),
              after: athleteYearsEntryEl(b),
            },
            (l) =>
              bodyMedalLineEl(
                l,
                meetHref(l.meet),
                [meetNames.get(l.meet), dayMonth(isoToFiDay(l.date)), onlyNote(l)].filter(Boolean).join(' · '),
              ),
            openKeys.has(b.key),
            toggle(b.key),
          ),
        ),
      );
    const unknown = [...new Set(season.meets.flatMap((m) => m.unknown || []))].sort((a, b) => a.localeCompare(b, 'fi'));
    bodyEl.replaceChildren(
      el(
        'div',
        {},
        chipAges.length ? ageChips(chipAges, shown, go) : null,
        el('h2', {}, championshipTitle(scope)),
        clubs.length
          ? medalTableEl(null, clubs, followed, { id: picked?.id, onPick })
          : el('div', { class: 'notice' }, 'Ei mitaleita.'),
        unknown.length ? el('div', { class: 'medals-unknown' }, `Ei piiritietoa: ${unknown.join(', ')}`) : null,
        ...(!picked && boxes.length
          ? [
              el('h2', {}, 'Seuratut mitalistit'),
              boxes.length > 1
                ? el(
                    'div',
                    { class: 'medalist-bar medalist-bar-end' },
                    medalistAllEl(boxes, openKeys, () => paint()),
                  )
                : null,
              medalistRows(true),
            ]
          : []),
        (pickedEl = picked ? pickedHeadEl(picked, onPick) : el('h2', {}, 'Kilpailut')),
        picked
          ? el(
              'div',
              { class: 'medalist-bar' },
              medalistsSwitchEl('Kilpailut', () => paint()),
              boxes.length > 1 ? medalistAllEl(boxes, openKeys, () => paint()) : null,
            )
          : null,
        picked && medalistsShown
          ? medalistRows(false)
          : season.meets.length
            ? el(
                'div',
                { class: 'list' },
                season.meets.map((m) => {
                  const box = picked && boxes.find((b) => b.key === m.id);
                  return box
                    ? medalSeasonMeetEl(m, box, meetHref(m.id), openKeys.has(box.key), toggle(box.key))
                    : meetRow(m, meetHref(m.id), picked, cover);
                }),
              )
            : el('div', { class: 'notice' }, `Ei mestaruuskilpailuja vuonna ${year}.`),
      ),
    );
  };
  paint(data);
  appEl.replaceChildren(bar, pendingEl, bodyEl);
  // renderRoute (app.js) scrolls to the view's stored position after the
  // render. The club's section is stored only where the view has none.
  if (pick && pickedEl && !scrollPositions.has(scrollKey)) {
    const header = document.querySelector('header');
    scrollPositions.set(
      scrollKey,
      pickedEl.getBoundingClientRect().top + window.scrollY - (header?.offsetHeight || 0) - 8,
    );
  }
  renderFillStatus(pendingEl, `medalseason:${scope.id}:${year}`, data, {
    left: (season) => season.pending.length + season.meets.filter((m) => m.stale).length,
    // One build round builds a few meets within a time budget (SEASON_ROUND,
    // docs/backend.md, "A scope's year").
    build: () =>
      fetchJson(`${url}?build=1`, { signal: AbortSignal.timeout(40_000) }).then(
        (d) => ({ data: d }),
        (e) => ({ status: e.status }),
      ),
    onUpdate: (next) => {
      keepData(url, next);
      paint(next);
    },
  });
}

// --- A club's years (MEDAL_SEASON_PAGE_PATH, docs/views.md) ---

// The club names /mestaruudet has shown, so a club's page has its title before
// its fetch answers, and a refresh keeps it.
const clubNames = new Map();

// Draws a club's medals as a table per scope with a row per year. The
// medalists' tab instead draws one year's medalists per scope, with a tab per
// year.
async function renderMedalClub({ club, medalists, year: wantedYear, ages }) {
  const seq = renderSeq;
  setHelp(null);
  setBack(MEDAL_SEASON_PAGE_PATH);
  titleEl.textContent = clubNames.get(club) || MEDAL_SEASON_PAGE_TITLE;
  const todayIso = scanTodayIso();
  const year = wantedYear ?? medalYears(todayIso)[0];
  setScrollKey(`medalclub:${club}:${medalists ? year : 'vuodet'}`);
  const state = viewStateFor(HOME_VIEW_KEY);
  const bar = filterBar(HOME_VIEW_KEY, state, { label: watchLabel(state.watchId) }, false);
  const url = `/api/medalclub/${encodeURIComponent(club)}`;
  const data = await keptData(url, () => fetchJson(url).catch(() => null));
  if (seq !== renderSeq) return;
  if (!data) {
    appEl.replaceChildren(bar, el('div', { class: 'notice error' }, 'Seuran mitalien haku epäonnistui.'));
    return;
  }
  // The `medalists` argument of clubYearsHash, with the year from the address.
  const tab = medalists ? (wantedYear ?? true) : false;
  // A duplicate record's id gets its canonical club (docs/backend.md, "The
  // club index").
  if (data.club.id !== club) {
    club = data.club.id;
    replaceAddress(`${MEDAL_SEASON_PAGE_PATH}${clubYearsHash(club, ages, tab)}`);
  }
  const tabLink = (label, to, current) =>
    redrawTabEl(label, `${MEDAL_SEASON_PAGE_PATH}${clubYearsHash(club, ages, to)}`, current);
  bar.append(segControl('Näkymä', [tabLink('Vuodet', false, !medalists), tabLink('Mitalistit', true, medalists)]));
  if (medalists)
    bar.append(
      segControl(
        'Vuosi',
        medalYears(todayIso).map((y) => tabLink(String(y), y, y === year)),
      ),
    );
  clubNames.set(club, data.club.name);
  titleEl.textContent = data.club.name;
  if (medalists && !medalYearOk(year, todayIso)) {
    appEl.replaceChildren(bar, el('div', { class: 'notice' }, `Vuoden ${year} mitaleita ei ole saatavilla.`));
    return;
  }
  // A chosen age with no chip stays in the address, as on the year page.
  const chipAges = clubYearAges(data);
  const shown = ages.filter((a) => chipAges.includes(a));
  const cover = shown.length ? { ages: shown, events: null } : null;
  const go = (next) => navigate(`${MEDAL_SEASON_PAGE_PATH}${clubYearsHash(club, next, tab)}`, { redraw: true });
  appEl.replaceChildren(
    bar,
    el(
      'div',
      {},
      chipAges.length ? ageChips(chipAges, shown, go) : null,
      medalists
        ? clubMedalistsEls(data, clubYearMedalists(data, year, cover), { year, ages, shown, chipAges, club })
        : clubYearTable(data, cover).flatMap(({ scope, years }) =>
            scope.kind === 'notable'
              ? notableYearsEls(scope, years, ages, club)
              : [
                  el('h2', {}, championshipTitle(scope)),
                  clubYearsTableEl(years, (y) =>
                    el(
                      'a',
                      {
                        class: 'year-link',
                        href: `${MEDAL_SEASON_PAGE_PATH}${seasonHash(scope.id, y.year, ages, club)}`,
                      },
                      String(y.year),
                    ),
                  ),
                ],
          ),
    ),
  );
}

// Draws a club's medalists of one year per scope: a heading with the club's
// medals, then the medalists' boxes as a scope's year page draws them.
function clubMedalistsEls(data, rows, { year, ages, shown, chipAges, club }) {
  if (!rows.length) return [el('div', { class: 'notice' }, 'Ei mitalisteja.')];
  const meets = new Map(data.years.flatMap((y) => y.scopes.flatMap((s) => s.meets)).map((m) => [m.id, m]));
  const meetHref = (id) => medalsPath(id, shown.length ? ages : medalSeasonMeetAges(meets.get(id), chipAges), club);
  const lineEl = (l) =>
    bodyMedalLineEl(
      l,
      meetHref(l.meet),
      [meets.get(l.meet)?.name, dayMonth(isoToFiDay(l.date)), onlyNote(l)].filter(Boolean).join(' · '),
    );
  // One set of open keys covers every scope, so one button opens every box.
  // Every box starts closed. A person has a box in each scope where they won a
  // medal, so a key includes the scope.
  const keyOf = (r, b) => `${r.scope.id}|${b.key}`;
  const all = rows.flatMap((r) => r.boxes.map((b) => ({ key: keyOf(r, b) })));
  const keys = medalistOpenKeys(`medalclub:${club}:${year}:${shown.join(',')}`, all, false);
  const barEl = el('div', { class: 'medalist-bar medalist-bar-end' });
  const lists = rows.map((r) => [r, el('div', { class: 'list' })]);
  const paint = () => {
    barEl.replaceChildren(all.length > 1 ? medalistAllEl(all, keys, paint) : '');
    for (const [r, listEl] of lists)
      listEl.replaceChildren(
        ...r.boxes.map((b) =>
          medalistRowEl(b, { after: athleteYearsEntryEl(b) }, lineEl, keys.has(keyOf(r, b)), () => {
            toggleMedalist(keys, keyOf(r, b));
            paint();
          }),
        ),
      );
  };
  paint();
  return [
    barEl,
    ...lists.flatMap(([r, listEl]) => [
      el('h2', { class: 'count-head' }, el('span', {}, clubScopeTitleEl(r, year, ages, club)), medalSlotsEl(r.medals)),
      listEl,
    ]),
  ];
}

// Links a scope's heading to its year page, or a notable meet's to the meet's
// medal page (docs/views.md, "The years").
function clubScopeTitleEl({ scope, meets }, year, ages, club) {
  if (scope.kind !== 'notable')
    return el(
      'a',
      { class: 'year-link', href: `${MEDAL_SEASON_PAGE_PATH}${seasonHash(scope.id, year, ages, club)}` },
      championshipTitle(scope),
    );
  const link = (m, label) => el('a', { class: 'year-link', href: medalsPath(m.id, ages, club) }, label);
  const built = meets.filter((m) => m.ages?.length);
  if (built.length === 1) return link(built[0], scope.name);
  const youngest = (m) => ageOrder(m.ages[0]);
  return [
    scope.name,
    ...built.sort((a, b) => youngest(a) - youngest(b)).flatMap((m) => [' · ', link(m, ageRangeLabel(m.ages))]),
  ];
}

// A notable meet's table (docs/views.md, "The years").
function notableYearsEls(scope, years, ages, club) {
  const link = (m, label) => el('a', { class: 'year-link', href: medalsPath(m.id, ages, club) }, label);
  // An unbuilt meet has no ages yet, so its first day stands in.
  const label = (m) => ageRangeLabel(m.ages) || `${Number(m.date.slice(8, 10))}.${Number(m.date.slice(5, 7))}.`;
  const youngest = (m) => (m.ages?.length ? ageOrder(m.ages[0]) : Infinity);
  const youngestFirst = (a, b) => youngest(a) - youngest(b);
  const shown = years.filter((y) => y.meets.length);
  if (!shown.length) return [];
  return [
    el('h2', {}, scope.name),
    clubYearsTableEl(shown, (y) =>
      y.meets.length === 1
        ? link(y.meets[0], String(y.year))
        : [String(y.year), ...[...y.meets].sort(youngestFirst).flatMap((m) => [' · ', link(m, label(m))])],
    ),
  ];
}

function clubYearsTableEl(years, yearCell) {
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
          el('th', {}, 'Vuosi'),
          [1, 2, 3].map((m) => el('th', { class: 'num' }, medalEl(m))),
          el('th', { class: 'num' }, 'Yht'),
        ),
      ),
      el(
        'tbody',
        {},
        years.map((y) =>
          el(
            'tr',
            {},
            el(
              'td',
              {},
              yearCell(y),
              y.pending ? el('span', { class: 'medalist-sub' }, ` · ${y.pending} hakematta`) : null,
            ),
            y.medals.map((n) => el('td', { class: 'num' }, n ? String(n) : '')),
            el('td', { class: 'num' }, String(y.total)),
          ),
        ),
      ),
    ),
  );
}

// --- An athlete's years (MEDAL_SEASON_PAGE_PATH, docs/views.md) ---

// The athlete names that /mestaruudet has shown, kept as clubNames keeps the
// club names.
const athleteNames = new Map();

// A tab that draws from the data already fetched, so a tab switch doesn't
// fetch again.
function redrawTabEl(label, href, current) {
  return el(
    'a',
    {
      class: 'seg-btn',
      href,
      'aria-current': current ? 'page' : null,
      onclick: (e) => {
        e.preventDefault();
        navigate(href, { redraw: true });
      },
    },
    label,
  );
}

// Draws an athlete's championship medals of one year, with a tab per year that
// has medals. Each level has a card per meet and a line per medal that links
// to the medal's start.
async function renderMedalAthlete({ licence, year: wantedYear }) {
  const seq = renderSeq;
  setHelp(null);
  setBack(MEDAL_SEASON_PAGE_PATH);
  titleEl.textContent = athleteNames.get(licence) || MEDAL_SEASON_PAGE_TITLE;
  const state = viewStateFor(HOME_VIEW_KEY);
  const bar = filterBar(HOME_VIEW_KEY, state, { label: watchLabel(state.watchId) }, false);
  const url = `/api/medalathlete/${encodeURIComponent(licence)}`;
  const data = await keptData(url, () => fetchJson(url).catch(() => null));
  if (seq !== renderSeq) return;
  if (!data) {
    setScrollKey(`medalathlete:${licence}`);
    appEl.replaceChildren(bar, el('div', { class: 'notice error' }, 'Urheilijan mitalien haku epäonnistui.'));
    return;
  }
  const name = athleteYearsName(data) || athleteNames.get(licence);
  if (name) {
    athleteNames.set(licence, name);
    titleEl.textContent = name;
  }
  const years = athleteYears(data);
  const year = wantedYear ?? years[0]?.year;
  setScrollKey(`medalathlete:${licence}:${year}`);
  if (years.length)
    bar.append(
      segControl(
        'Vuosi',
        years.map((y) =>
          redrawTabEl(String(y.year), `${MEDAL_SEASON_PAGE_PATH}${athleteYearsHash(licence, y.year)}`, y.year === year),
        ),
      ),
    );
  const shown = years.find((y) => y.year === year);
  const levels = shown?.levels || [];
  // A line names its club only when the athlete's medals that year are for
  // more than one club.
  const clubs = shown?.clubs || [];
  const meetEl = (m) =>
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'row-main' },
        el('div', { class: 'row-title' }, m.name),
        el('div', { class: 'row-sub' }, dayMonth(isoToFiDay(m.date))),
        el(
          'div',
          { class: 'medalist-entries' },
          m.lines.map((l) =>
            el(
              'a',
              { class: 'medalist-entry', href: medalStartPath(m.id, l.event, licence) },
              el(
                'span',
                { class: 'medalist-event' },
                l.event,
                clubs.length > 1 ? el('span', { class: 'medalist-sub' }, ` · ${l.club}`) : null,
                runnersEl(l.runners),
              ),
              medalSlotEl(l.medal, l.runners.length > 0),
            ),
          ),
        ),
      ),
    );
  // A championship's heading links to its year page.
  const titleOf = (scope) =>
    scope.kind === 'notable'
      ? scope.name
      : el(
          'a',
          { class: 'year-link', href: `${MEDAL_SEASON_PAGE_PATH}${seasonHash(scope.id, year)}` },
          championshipTitle(scope),
        );
  // The year's clubs link to their medalists of the year.
  const clubsEl = clubs.length
    ? el(
        'div',
        { class: 'athlete-clubs' },
        clubs.flatMap((c, i) => [
          i ? ' · ' : '',
          el('a', { class: 'year-link', href: `${MEDAL_SEASON_PAGE_PATH}${clubYearsHash(c.id, [], year)}` }, c.name),
        ]),
      )
    : null;
  appEl.replaceChildren(
    bar,
    clubsEl || '',
    ...(levels.length
      ? levels.flatMap((l) => [
          el('h2', { class: 'count-head' }, el('span', {}, titleOf(l.scope)), medalSlotsEl(l.medals, l.relays)),
          el('div', { class: 'list' }, l.meets.map(meetEl)),
        ])
      : [
          el(
            'div',
            { class: 'notice' },
            years.length ? `Ei mestaruusmitaleja vuonna ${year}.` : 'Ei mestaruusmitaleja.',
          ),
        ]),
  );
}

// Opens the start that decided a class's medals (medalStartPath) in place of
// this link's history entry. A meet whose schedule is gone opens its medal
// table.
async function renderMedalStart({ compId, name, licence }) {
  const seq = renderSeq;
  const schedule = await keptData(`schedule:${compId}`, () => fetchSchedule(compId)).catch(() => null);
  if (seq !== renderSeq) return;
  const link = schedule ? medalStartAt(schedule)(name).link : null;
  const spot = licence ? athleteYearsHash(licence) : '';
  navigate(link ? `${medalStartHref(compId, link)}${spot}` : medalsPath(compId), { replace: true });
}

// --- The medalists, on the medal pages and the cup's year ---

// Scrolls a picked club's heading to just under the sticky header.
function scrollToPicked(headEl) {
  const header = document.querySelector('header');
  const top = headEl.getBoundingClientRect().top + window.scrollY - (header?.offsetHeight || 0) - 8;
  window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// Each metal gets a slot, empty or not, so a list's counts line up.
// `relays`, when given and not all zero, adds a second row of the relay medals
// as rings, in the same slots.
function medalSlotsEl(medals, relays = null) {
  const row = (counts, ring) =>
    counts.map((n, i) => el('span', { class: 'medal-slot' }, n ? [medalEl(i + 1, ring), String(n)] : null));
  return el('span', { class: 'medal-slots' }, row(medals, false), relays?.some(Boolean) ? row(relays, true) : null);
}

// Places one medal in its metal's slot of medalSlotsEl, with no count.
function medalSlotEl(medal, ring = false) {
  return el(
    'span',
    { class: 'medal-slots' },
    [1, 2, 3].map((m) => el('span', { class: 'medal-slot' }, m === medal ? medalEl(m, ring) : null)),
  );
}

// Heads the picked club's list with its name and a × that clears the pick.
function pickedHeadEl(club, onPick) {
  return el(
    'h2',
    { class: 'pick-head' },
    el('span', {}, club.name),
    el(
      'button',
      { class: 'pick-clear', type: 'button', 'aria-label': 'Poista seuran valinta', onclick: () => onPick(club.id) },
      '×',
    ),
  );
}

// Drops the year from a Finnish date.
const dayMonth = (fi) => fi.slice(0, fi.lastIndexOf('.') + 1);

// Says whether a picked club shows its people (`second`) or its lines (`first`).
// The choice holds across clubs, meets and years.
let medalistsShown = false;
function medalistsSwitchEl(first, repaint, second = 'Mitalistit') {
  return segControl(
    'Näytä',
    [
      [false, first],
      [true, second],
    ].map(([shown, label]) => ({
      label,
      pressed: medalistsShown === shown,
      onclick: () => {
        medalistsShown = shown;
        repaint();
      },
    })),
  );
}

// A holder keeps one list's open rows and resets them when `sig` changes. A
// long list starts closed (medalistsOpenAll, lib/medals.js) unless `openAll`
// overrides.
function openKeysHolder() {
  let held = { sig: null, keys: new Set() };
  return (sig, boxes, openAll = medalistsOpenAll(boxes)) => {
    if (held.sig !== sig) held = { sig, keys: new Set(openAll ? boxes.map((b) => b.key) : []) };
    return held.keys;
  };
}
const medalistOpenKeys = openKeysHolder();

function toggleMedalist(keys, key) {
  if (!keys.delete(key)) keys.add(key);
}

// Opens every row, or closes them all when all are open.
function medalistAllEl(boxes, keys, repaint) {
  const allOpen = boxes.every((b) => keys.has(b.key));
  return el(
    'button',
    {
      class: 'medalist-all',
      type: 'button',
      onclick: () => {
        keys.clear();
        if (!allOpen) for (const b of boxes) keys.add(b.key);
        repaint();
      },
    },
    allOpen ? 'Sulje kaikki' : 'Avaa kaikki',
  );
}

// Draws a box (medalistBoxes and the like) as a row. Its whole head is the
// button that opens its lines, so the name is plain text. `after` is drawn
// after the lines, such as a link to the athlete's years.
function medalistRowEl(
  box,
  { club = '', watched = false, tail = medalSlotsEl(box.medals, box.relays), after = null },
  lineEl,
  open,
  onToggle,
) {
  return el(
    'div',
    { class: watched ? 'row watched' : 'row' },
    el(
      'div',
      { class: 'row-main' },
      medalistHeadEl(
        open,
        onToggle,
        [
          el(
            'span',
            { class: 'row-title' },
            box.name,
            club ? el('span', { class: 'medalist-club' }, ` · ${club}`) : null,
          ),
        ],
        tail,
      ),
      open ? el('div', { class: 'medalist-entries' }, box.lines.map(lineEl), after) : null,
    ),
  );
}

// Ends an opened box of a licensed athlete with a link to the athlete's years.
function athleteYearsEntryEl(box) {
  if (!box.licence) return null;
  athleteNames.set(box.licence, box.name);
  return el(
    'a',
    { class: 'medalist-more', href: `${MEDAL_SEASON_PAGE_PATH}${athleteYearsHash(box.licence)}` },
    'Kaikki mitalit ›',
  );
}

// The whole head toggles the row, with `tail` and a chevron at its end.
function medalistHeadEl(open, onToggle, main, tail) {
  return el(
    'button',
    { class: 'medalist-head', type: 'button', 'aria-expanded': String(open), onclick: onToggle },
    el('span', { class: 'medalist-head-main' }, main),
    tail,
    el('span', { class: 'medalist-chevron', 'aria-hidden': 'true' }),
  );
}

const MEDAL_FI = ['Kulta', 'Hopea', 'Pronssi'];
// Draws a medal as a disc in its metal, named for a screen reader. A relay's
// medal in a runner's box or on a runner's page is a ring (`ring`).
function medalEl(medal, ring = false) {
  return el('span', {
    class: `medal medal-${medal}${ring ? ' medal-ring' : ''}`,
    role: 'img',
    'aria-label': `${MEDAL_FI[medal - 1]}${ring ? ', viesti' : ''}`,
  });
}

export {
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
  renderMedalAthlete,
  renderMedalClub,
  renderMedalSeason,
  renderMedalStart,
  renderMedals,
  scrollToPicked,
  toggleMedalist,
};
