import { combinedCounts, combinedStarted, combinedTotals } from '../lib/combined.js';
import { confirmCount, confirmRows, confirmSetting, confirmStartAt, watchConfirmations } from '../lib/confirmation.js';
import { dateRange, parseTs, scheduleDays } from '../lib/dates.js';
import { meetDay } from '../lib/day.js';
import { allocMark, allocPosition, relayInfo, relayLegParts, roundAllocated } from '../lib/results.js';
import { compViewMode, dayPath, isDemoId, medalsPath } from '../lib/routes.js';
import {
  countLine,
  fieldMayChange,
  groupStatuses,
  previousRoundField,
  roundDetails,
  startCounts,
  startFinished,
} from '../lib/schedule.js';
import { allocMatches, matchedEntries } from '../lib/watch.js';
import {
  eventStoreFor,
  fetchCompProps,
  fetchMeetBody,
  fetchSchedule,
  listedRow,
  loadCombinedRoot,
  officialMenuRows,
  rememberComp,
  setCupMeetSeen,
  updateViewState,
  viewStateFor,
} from './data.js';
import {
  SCOPES_SHEET_TITLE,
  ageChips,
  athleteNameLink,
  closeFocusFilter,
  clubNameLink,
  confirmDeadline,
  filterBar,
  openPiiriSheet,
  qualBadgeEl,
  relayLegEls,
  resolveFilter,
  soleAthleteId,
} from './follow.js';
import {
  SITE_MODE,
  appEl,
  el,
  keptOpen,
  render,
  renderSeq,
  setBack,
  setHelp,
  setScrollKey,
  setTitleMenu,
  statusChip,
  timeFmt,
  titleEl,
} from './shell.js';

// Juoksut mode draws the kenttä and the hurdle setups (app/hurdles.js), which
// Kisat mode never loads.
const juoksut = SITE_MODE === 'juoksut' ? await import('./hurdles.js') : null;

// --- The meet view (/c/<compId>) ---

// The schedule view shows one day at a time, with the day in the route. What
// it shows comes from the meet's stored view state (viewStateFor), never from
// the URL, so every back target to it is a constant (docs/architecture.md,
// "Back targets and scroll").
async function renderComp(compId, wantedDate) {
  const seq = renderSeq;
  setHelp(null);

  const state = viewStateFor(compId);
  // The back target is set before the fetches, as it needs only local state.
  // With the quick-filter on, the header's `‹` only closes the filter.
  setBack(state.focus ? `/c/${compId}` : '/', state.focus ? () => closeFocusFilter(compId) : null);
  const [props, schedule, filter, cup, listed] = await Promise.all([
    fetchCompProps(compId),
    fetchSchedule(compId),
    resolveFilter(compId, state),
    // The meet body says whether this is a cup meet (docs/views.md,
    // "The club cup").
    fetchMeetBody(compId),
    listedRow(compId),
  ]);
  if (seq !== renderSeq) return;
  const compName = props?.Competition?.Name || `Kilpailu ${compId}`;
  const allDays = scheduleDays(schedule);
  // A demo is not remembered, so home never lists it under Viimeksi katsotut.
  if (!isDemoId(compId)) rememberComp(compId, compName, dateRange(allDays), allDays);
  setCupMeetSeen(cup?.cup ? compId : null);

  const runOnly = SITE_MODE === 'juoksut' && state.cats === 'run';
  const today = new Date().toLocaleDateString('fi-FI');
  const day = meetDay(schedule, { state, filter, wantedDate, today, runOnly });
  if (!day) {
    titleEl.textContent = compName;
    appEl.replaceChildren(el('div', { class: 'notice' }, 'Ei lajeja tässä kilpailussa.'));
    return;
  }
  const { date } = day;

  const title = `${compName} · ${dateRange(allDays)}`;
  // The medal table and the scopes sheet belong to the meet, so the title menu
  // carries them (docs/views.md, "Medals"). Both modes offer the
  // scopes sheet.
  const piiriRow = { label: SCOPES_SHEET_TITLE, onclick: () => openPiiriSheet(compId) };
  const officialRows = officialMenuRows(listed, compId);
  if (SITE_MODE === 'kisat')
    setTitleMenu(title, [{ label: 'Mitalitaulukko', href: medalsPath(compId) }, piiriRow, ...officialRows]);
  else setTitleMenu(title, [piiriRow, ...officialRows]);
  // The scroll key uses the resolved day, because /c/<id> and its default day
  // are the same list. The quick-filter's shorter list gets a key of its own
  // (docs/architecture.md, "Back targets and scroll").
  setScrollKey(
    `comp:${compId}:${date}${state.focus ? `:${state.focus.kind === 'club' ? 's' : 'a'}${state.focus.id}` : ''}`,
  );

  // The kenttä select, in Juoksut mode only, feeds the lap counter and the
  // hurdle lines (docs/venues.md).
  let trackPick = null;
  if (juoksut) {
    const track = await juoksut.trackSelect(compId, parseTs(day.dayGroups[0].ts));
    trackPick = track.el;
    setTitleMenu(title, [...juoksut.dayMenuRows(compId, date, day.dayGroups, track.pick), piiriRow, ...officialRows]);
    setHelp({
      title: 'Aikataulun ohje',
      items: [
        [
          'Kenttä',
          'Tämän kilpailun paikka tai pelkkä radan pituus. Valittu kenttä määrittää radan pituuden ja aitamerkinnät. Otsikon valikosta voit jakaa kenttälinkin, joka asettaa saman kentän toisella laitteella.',
        ],
        ['Ratalajit', 'Näyttää vain juoksut. "Kaikki" näyttää myös kenttälajit.'],
        [
          'Aidat',
          'Ratalajit-näkymässä aitalähdöille näytetään: radat · korkeus · merkintä · aitojen määrä · mitat (alkusileä / väli / loppusileä).',
        ],
      ],
    });
  }

  const loaded = await loadDay(compId, day, { state, schedule, props, runOnly });
  if (seq !== renderSeq) return;
  appEl.replaceChildren(...drawDay(compId, day, loaded, { state, filter, cup, trackPick, allDays }));
}

// Loads what the day list draws besides the schedule: the followed lines, the
// hurdle lines, the counts and the confirmations. One store serves the whole
// render, so they share each document.
async function loadDay(compId, day, { state, schedule, props, runOnly }) {
  const { groups, multiEvents, targets, eventIds, listFiltered, narrowed } = day;
  const store = eventStoreFor(compId, schedule);
  const startsAt = confirmStartAt(schedule);
  // Only Ratalajit loads the hurdle settings, since only its rows carry the
  // day's lines (docs/hurdles.md, "The day's lines"). The settings and the counts load a document per category of each
  // start still to come.
  const [multiLines, withLines, hurdleSubs, countPairs, multiConfirm] = await Promise.all([
    listFiltered
      ? Promise.all(multiEvents.map((m) => combinedWatchLines(compId, m, eventIds, targets, schedule)))
      : multiEvents.map(() => []),
    listFiltered && groups.length
      ? Promise.all(
          groups.map(async (g) => ({
            g,
            ...(await groupLines(g, eventIds, targets, store, compId, startsAt)),
          })),
        )
      : [],
    runOnly ? juoksut.hurdleDayLines(compId, groups, store) : new Map(),
    state.counts
      ? Promise.all(
          groups
            .filter((g) => !startFinished(g.entries))
            .map(async (g) => [g.key, startCounts(await roundDetails(g.entries, store))]),
        )
      : [],
    // An ottelu's count line stops once the ottelu starts.
    state.counts
      ? Promise.all(multiEvents.map((m) => (combinedStarted(m.status) ? null : combinedCountLine(store, m))))
      : [],
  ]);
  // Confirmations count over the whole day, never the narrowed list. The
  // second pass reuses the store's documents.
  const confirmParts = !listFiltered
    ? []
    : runOnly || narrowed
      ? await Promise.all(day.dayGroups.map((g) => groupLines(g, eventIds, targets, store, compId, startsAt)))
      : withLines;
  const varmistus = watchConfirmations(
    confirmParts.flatMap((r) => r.confirmable),
    confirmSetting(props),
    confirmParts.some((r) => r.confirmsHere),
  );
  return { multiLines, withLines, hurdleSubs, countPairs, multiConfirm, varmistus };
}

// Draws the day list's sections in their order: the filter bar, the class and
// discipline filter, the notices, the day's confirmations, the cup's row,
// Ottelut, the day tabs and the list (docs/views.md, "The day list").
function drawDay(compId, day, loaded, { state, filter, cup, trackPick, allDays }) {
  const { dates, date, choices, pick, narrowed, groups, multiEvents, targets, emptyHere, listFiltered } = day;
  const { multiLines, withLines, hurdleSubs, countPairs, multiConfirm, varmistus } = loaded;
  const sections = [filterBar(compId, state, filter, listFiltered, trackPick)];
  const pickBox = dayFilterBox(compId, choices, pick, state.counts);
  if (pickBox) sections.push(pickBox);
  if (filter?.notice) sections.push(el('div', { class: 'notice' }, filter.notice));
  if (emptyHere) {
    sections.push(
      el(
        'div',
        { class: 'notice' },
        `Kukaan seurannan "${filter.label || 'Seuranta'}" urheilijoista ei osallistu tähän kilpailuun.`,
      ),
    );
  }
  if (varmistus) sections.push(confirmSection(compId, varmistus));

  // The cup's row sits above Ottelut and the day tabs, because it belongs to no
  // day. A followed club gets a line under it, matched on club ids alone.
  if (cup?.cup) {
    const followed = targets?.clubIds?.size ? cup.clubs.filter((c) => targets.clubIds.has(String(c.id))) : [];
    // The phase comes from the Worker, because only its fan-out sees a category
    // nobody entered (meetPhase, lib/schedule.js).
    const cupStatus = cup.phase;
    sections.push(
      el(
        'div',
        { class: 'list' },
        cupRow(
          compId,
          cupStatus,
          followed.map((c) => cupWatchLine(c, cup.clubs.length, cupStatus)),
          followed.length ? ' watched' : '',
        ),
      ),
    );
  }

  const countSubs = new Map(countPairs.map(([key, counts]) => [key, countRowLines(counts)]));
  const subsFor = (g) => {
    const hurdles = hurdleSubs.get(g.key);
    const counts = countSubs.get(g.key);
    if (!hurdles && !counts?.lines.length) return null;
    return { lines: [...(hurdles?.lines || []), ...(counts?.lines || [])], named: !!hurdles?.named || !!counts?.named };
  };
  const watchedOnly = listFiltered && compViewMode(state) === 'watched';
  const multiRows = multiEvents
    .map((m, i) => ({ m, lines: multiLines[i], sub: multiConfirm[i] || null }))
    .filter((r) => !watchedOnly || r.lines.length);
  if (multiRows.length) {
    // Ottelut folds in a details.fold, whose summary is the section's h2.
    sections.push(
      el(
        'details',
        {
          class: 'fold',
          open: state.ottelut,
          ontoggle: (e) => updateViewState(compId, { ottelut: e.currentTarget.open }),
        },
        el('summary', {}, 'Ottelut'),
        el(
          'div',
          { class: 'list' },
          multiRows.map(({ m, lines, sub }) =>
            // A matched row is highlighted only where unmatched rows show too.
            combinedStartRow(compId, m, lines, allDays.length > 1, watchedOnly ? '' : ' watched', sub),
          ),
        ),
      ),
    );
  }

  // A one-day meet has no day tabs. Its list takes a heading when the cup's row
  // or Ottelut sits above it.
  if (dates.length > 1)
    sections.push(
      el(
        'div',
        { class: 'days' },
        dates.map((d) =>
          el(
            'a',
            {
              class: 'day-tab',
              href: dayPath(compId, d),
              'aria-current': d === date ? 'page' : null,
            },
            d,
          ),
        ),
      ),
    );
  else if (cup?.cup || multiRows.length) sections.push(el('h2', {}, 'Aikataulu'));

  if (!groups.length) {
    // Only a narrowing can empty a day, because byDate holds no empty day.
    sections.push(
      el(
        'div',
        { class: 'notice' },
        narrowed ? 'Ei valintoihin sopivia lähtöjä tänä päivänä.' : 'Ei ratalajeja tänä päivänä.',
      ),
    );
  } else if (!listFiltered) {
    sections.push(
      el(
        'div',
        { class: 'list' },
        groups.map((g) => plainGroupRow(compId, g, subsFor(g))),
      ),
    );
  } else {
    if (compViewMode(state) === 'watched') {
      // Seuratut keeps only the starts where groupLines found somebody followed
      // in the round.
      const rows = withLines.filter((r) => r.lines.length > 0);
      sections.push(
        rows.length
          ? el(
              'div',
              { class: 'list' },
              rows.map(({ g, lines, provisional }) => watchedGroupRow(compId, g, lines, provisional, '', subsFor(g))),
            )
          : el('div', { class: 'notice' }, 'Ei seurannan lähtöjä tänä päivänä.'),
      );
    } else {
      // Koko päivä shows the whole day, and a followed start keeps its lines.
      sections.push(
        el(
          'div',
          { class: 'list' },
          withLines.map(({ g, lines, provisional }) =>
            lines.length
              ? watchedGroupRow(compId, g, lines, provisional, ' watched', subsFor(g))
              : plainGroupRow(compId, g, subsFor(g)),
          ),
        ),
      );
    }
  }
  return sections;
}

// The class and discipline filter's fold reuses the medal page's age chips.
// It stays open until the schedule view is left.
const dayFilterOpen = keptOpen('comp');
function dayFilterBox(compId, choices, pick, counts) {
  const byAge = choices.ages.length > 1;
  const byEvent = choices.events.length > 1;
  if (!byAge && !byEvent) return null;
  const put = (patch) => {
    updateViewState(compId, patch);
    render(true);
  };
  const chosen = [pick.ages.map((a) => (a === 0 ? 'yleinen' : String(a))).join(', '), pick.events.join(', ')]
    .filter(Boolean)
    .join(' · ');
  return el(
    'details',
    {
      class: `day-filter${chosen ? ' on' : ' no-print'}`,
      ...dayFilterOpen('day', false),
    },
    el('summary', {}, byAge && byEvent ? 'Sarjat ja lajit' : byAge ? 'Sarjat' : 'Lajit', chosen ? `: ${chosen}` : null),
    byAge ? ageChips(choices.ages, pick.ages, (ages) => put({ ages })) : null,
    byEvent
      ? el(
          'div',
          { class: 'aidat-chips no-print' },
          el(
            'div',
            { class: 'aidat-chip-row' },
            choices.events.map((e) => {
              const on = pick.events.includes(e);
              return el(
                'button',
                {
                  class: `chip chip-toggle${on ? ' on' : ''}`,
                  'aria-pressed': String(on),
                  onclick: () => put({ events: on ? pick.events.filter((x) => x !== e) : [...pick.events, e] }),
                },
                e,
              );
            }),
          ),
        )
      : null,
    el(
      'div',
      { class: 'aidat-chips no-print' },
      el(
        'div',
        { class: 'aidat-chip-row' },
        el(
          'button',
          {
            class: `chip chip-toggle${counts ? ' on' : ''}`,
            'aria-pressed': String(counts),
            onclick: () => put({ counts: !counts }),
          },
          'Erät ja osallistujat',
        ),
      ),
    ),
  );
}

// --- A start's row ---

// Builds the count lines in the hurdle lines' shape. `named` tells rowHeadParts
// to drop the class list, so it is true only where every line names its class.
// A draw shared by several classes has one line that names none.
function countRowLines(counts) {
  const several = counts.length > 1;
  const lines = counts
    .map((c) => {
      const text = countLine(c);
      return text
        ? el(
            'div',
            { class: 'row-sub' },
            several && c.label ? el('span', { class: 'hurdle-lead' }, `${c.label}: `) : null,
            text,
          )
        : null;
    })
    .filter(Boolean);
  return { lines, named: several && counts.every((c) => c.label) && lines.length === counts.length };
}

// Every day-list row shares this head of time, title, classes and status
// (docs/views.md, "The day list"). Classes in different phases get a status
// chip each (groupStatuses). catsNamedBelow never drops those chips, only the
// class line.
function rowHeadParts(g, catsNamedBelow = false) {
  const statuses = groupStatuses(g.entries);
  const mixed = statuses.length > 1;
  return [
    el('div', { class: 'row-time' }, timeFmt.format(parseTs(g.ts))),
    el(
      'div',
      { class: 'row-main' },
      el(
        'div',
        { class: 'row-title' },
        g.event,
        g.roundName
          ? [el('span', { class: 'round-dot' }, ' '), el('span', { class: 'round-name' }, g.roundName)]
          : null,
      ),
      mixed
        ? el(
            'div',
            { class: 'row-sub row-sub-statuses' },
            statuses.map((s) =>
              el('span', { class: 'row-cat-status' }, s.labels.filter(Boolean).join(', '), statusChip(s.status)),
            ),
          )
        : catsNamedBelow
          ? null
          : el(
              'div',
              { class: 'row-sub' },
              g.entries
                .map((e) => e.label)
                .filter(Boolean)
                .join(', '),
            ),
    ),
    mixed ? null : statusChip(g.status),
  ];
}

// Builds an Ottelut row's count line (combinedCounts). It counts the root's
// field, because a leg's own Confirmed can disagree with it
// (docs/tuloslista-api.md, "Varmistus (confirmation)").
async function combinedCountLine(store, m) {
  for (const leg of m.legs) {
    const rootId = (await store.get(leg.eventId))?.data?.RootId;
    if (!rootId) continue;
    return countLine(combinedCounts((await store.get(rootId)).data)) || null;
  }
  return null;
}

// A multi-event's row in Ottelut uses the day list's .row shape. It shows no
// time and no leg count. The sub-line names the days where the meet has
// several.
function combinedStartRow(compId, m, lines = [], showDates = false, extraClass = '', sub = null) {
  const head = [
    el(
      'div',
      { class: 'row-main' },
      el('div', { class: 'row-title' }, m.label),
      showDates ? el('div', { class: 'row-sub' }, m.dates.join(' · ')) : null,
      sub ? el('div', { class: 'row-sub' }, sub) : null,
    ),
    statusChip(m.status),
  ];
  return linesRow(`/c/${compId}/o/${encodeURIComponent(m.key)}`, head, lines, extraClass);
}

// The club cup's row takes a multi-event row's shape.
function cupRow(compId, status, lines = [], extraClass = '') {
  const head = [
    el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, 'Seuracup-pisteet')),
    statusChip(status),
  ];
  return linesRow(`/c/${compId}/cup`, head, lines, extraClass);
}

// Builds a row above the day tabs, with any followed lines under its head.
function linesRow(href, head, lines, extraClass) {
  if (!lines.length) return el('a', { class: 'row', href }, head);
  return el(
    'a',
    { class: `row watch-day-row${extraClass}`, href },
    el('div', { class: 'row-head' }, head),
    el('div', { class: 'watch-row-athletes' }, lines),
  );
}

// Draws a line of points on watchAllocLine's five columns, with an empty class
// column. Points fill the mark column, and the unit fills the badge's slot.
function pointsWatchLine({ name, team = '', title = null, position, points = null }) {
  return el(
    'div',
    { class: 'watch-row-athlete' },
    el('span', { class: 'watch-row-cat' }, ''),
    el('span', { class: 'watch-row-name' }, name),
    el('span', { class: 'watch-row-team', title }, team),
    el('span', { class: position.pending ? 'watch-row-pos watch-row-pos-pending' : 'watch-row-pos' }, position.text),
    el(
      'span',
      { class: 'watch-row-result' },
      el('span', { class: 'watch-row-mark' }, points ?? ''),
      points == null ? null : el('span', { class: 'watch-row-unit' }, 'p.'),
    ),
  );
}

// A followed club's line has the club in the name column. The placing is
// muted until the meet is over (allocPosition).
function cupWatchLine(club, total, status) {
  const position = allocPosition({ ResultRank: club.rank }, total, null, 0, { Status: status });
  return pointsWatchLine({ name: club.name, position, points: String(club.points) });
}

// Lists the followed athletes' standings on a multi-event's row. The root is
// fetched only where one of its legs is a followed EventId. A failed fetch
// costs the lines and not the section.
async function combinedWatchLines(compId, m, eventIds, targets, schedule) {
  if (!m.legs.some((l) => eventIds.has(l.eventId))) return [];
  const root = await loadCombinedRoot(compId, m.legs, schedule).catch(() => null);
  const rows = combinedTotals(root);
  return rows
    .filter((a) => allocMatches(a, targets, null))
    .map((a) => combinedWatchLine(a, rows.length, m.status, compId));
}

// One followed athlete's line on a multi-event's row. Before any scoring the
// root ranks everyone 1. on 0 points (docs/tuloslista-api.md), so the line
// shows neither.
function combinedWatchLine(alloc, total, status, compId) {
  const club = alloc.Organization?.NameShort || alloc.Organization?.Name || '';
  const scored = Number(alloc.Result) > 0;
  // The placing is muted until the whole multi-event is finished.
  const position = scored ? allocPosition(alloc, total, null, 0, { Status: status }) : { text: '', pending: false };
  const athleteId = soleAthleteId(alloc);
  const name = athleteId ? athleteNameLink(compId, athleteId, alloc, { nested: true }) : alloc.Name || '';
  return pointsWatchLine({
    name,
    team: clubNameLink(compId, alloc.Organization, club, { nested: true }),
    title: club,
    position,
    points: scored ? alloc.Result : null,
  });
}

// Builds a plain day-list row. Hurdle settings and count lines go under the
// head at full width, because beside the status chip they wrap on a phone.
function plainGroupRow(compId, g, subs = null) {
  const href = `/c/${compId}/g/${encodeURIComponent(g.key)}`;
  if (!subs) return el('a', { class: 'row', href }, rowHeadParts(g));
  return el(
    'a',
    { class: 'row watch-day-row', href },
    el('div', { class: 'row-head' }, rowHeadParts(g, subs.named)),
    el('div', {}, subs.lines),
  );
}

// Builds a followed day-list row. The athlete grid goes under .row-head at the
// row's full width, because it does not fit beside the status chip.
function watchedGroupRow(compId, g, lines, provisional, extraClass, subs = null) {
  return el(
    'a',
    {
      class: `row watch-day-row${extraClass}`,
      href: `/c/${compId}/g/${encodeURIComponent(g.key)}`,
    },
    el('div', { class: 'row-head' }, rowHeadParts(g, subs?.named)),
    subs ? el('div', {}, subs.lines) : null,
    el('div', { class: 'watch-row-athletes' }, lines),
    // An undrawn round's lines may still change (docs/views.md,
    // "An undrawn round").
    provisional
      ? el(
          'div',
          { class: 'watch-provisional-note' },
          'Osallistujat voivat vielä muuttua edellisen vaiheen tulosten mukaan.',
        )
      : null,
  );
}

// --- The followed athletes' lines ---

// Draws the day's confirmation list, folded under its count (docs/views.md,
// "Varmistus").
function confirmSection(compId, v) {
  const rows = v.rows.map((r) => {
    const when = r.confirmed ? null : confirmDeadline(compId, r, true);
    return el(
      'tr',
      { class: r.confirmed ? null : 'unconfirmed' },
      el('td', { class: 'conf' }, r.confirmed ? '✓' : ''),
      el('td', { class: 'conf-name' }, r.name),
      el('td', { class: 'conf-ev' }, r.label),
      el('td', { class: 'conf-when' }, when),
    );
  });
  return el(
    'details',
    { class: 'varmistus' },
    el('summary', {}, confirmCount(v)),
    el(
      'div',
      { class: 'tbl-wrap' },
      el(
        'table',
        { class: 'tbl' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { class: 'conf', 'aria-label': 'Varmistaneet' }),
            el('th', {}, 'Nimi'),
            el('th', {}, 'Laji'),
            el('th', {}, 'Varmistus'),
          ),
        ),
        el('tbody', {}, rows),
      ),
    ),
  );
}

// Builds the followed lines of one day-list group. A group with no followed
// event returns before any fetch, and an empty `lines` drops it
// (docs/views.md, "The day list").
async function groupLines(g, eventIds, targets, store, compId, startsAt) {
  const relevant = g.entries.filter((e) => eventIds.has(e.round.EventId));
  if (!relevant.length) return { lines: [], confirmable: [], confirmsHere: false, provisional: false };
  const detailed = await roundDetails(relevant, store);
  const perCategory = await Promise.all(
    detailed.map(async (d) => {
      // A relay is matched on the club that entered it (docs/tuloslista-api.md).
      const team = relayInfo(d.data);
      const legCount = team.legCount;
      // An undrawn round shows the earlier round's qualifiers, as Enrollments is
      // event-wide. The gate is the one matchedEntries uses (docs/views.md,
      // "An undrawn round").
      const usingFallback = !roundAllocated(d.round);
      const prevField = usingFallback ? previousRoundField(d.data?.Rounds, d.round) : null;
      const enrollments = prevField || d.data?.Enrollments;
      // The last argument strips the earlier round's results from the borrowed
      // rows, which would otherwise read as this round's.
      const line = { legCount, compId, named: targets?.namedAthleteIds };
      const lines = matchedEntries(d.round, enrollments, targets, team, prevField != null).map((m) =>
        watchAllocLine(g.entries.length > 1 ? d.label : '', m, d, line),
      );
      const { rows: confirmable, confirmsHere } = await confirmRows(
        d,
        g.event,
        targets,
        team,
        startsAt(d.schedRound),
        store,
      );
      return {
        lines,
        confirmable,
        confirmsHere,
        // True only where an undrawn round gave a line and its field can
        // still change (docs/views.md, "An undrawn round").
        provisional: usingFallback && lines.length > 0 && fieldMayChange(d.data?.Rounds, d.round),
      };
    }),
  );
  return {
    lines: perCategory.flatMap((c) => c.lines),
    confirmable: perCategory.flatMap((c) => c.confirmable),
    confirmsHere: perCategory.some((c) => c.confirmsHere),
    provisional: perCategory.some((c) => c.provisional),
  };
}

// Draws a followed entry's line in a day-list row on five fixed-width columns.
// A relay's runners go in the name cell, as they tell a followed club's teams
// apart.
function watchAllocLine(label, { alloc, total, heatIndex, heatCount }, { data, round }, { legCount, compId, named }) {
  const legs = legCount > 1 ? relayLegParts(alloc, legCount, named) : [];
  const club = alloc.Organization?.NameShort || alloc.Organization?.Name || '';
  const position = allocPosition(alloc, total, heatIndex, heatCount, round);
  const mark = allocMark(alloc, data);
  const athleteId = soleAthleteId(alloc);
  const name = athleteId ? athleteNameLink(compId, athleteId, alloc, { nested: true }) : alloc.Name || '';
  return el(
    'div',
    { class: 'watch-row-athlete' },
    el('span', { class: 'watch-row-cat' }, label),
    el(
      'span',
      { class: 'watch-row-name' },
      name,
      legs.length ? el('span', { class: 'watch-row-legs' }, ' (', relayLegEls(legs), ')') : null,
    ),
    el(
      'span',
      { class: 'watch-row-team', title: club },
      clubNameLink(compId, alloc.Organization, club, { nested: true }),
    ),
    el('span', { class: position.pending ? 'watch-row-pos watch-row-pos-pending' : 'watch-row-pos' }, position.text),
    el('span', { class: 'watch-row-result' }, el('span', { class: 'watch-row-mark' }, mark), qualBadgeEl(alloc, round)),
  );
}

export { renderComp };
