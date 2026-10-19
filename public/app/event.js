import {
  combinedAthleteKey,
  combinedEventStarts,
  combinedGap,
  combinedLeaderPoints,
  combinedLegColumns,
  combinedRootStart,
  combinedStarted,
  combinedTotals,
  combinedWithdrawn,
  multiEventLeg,
} from '../lib/combined.js';
import { confirmCount, confirmNote, confirmStartAt } from '../lib/confirmation.js';
import { cupFinalRoundScores, cupScoringKey } from '../lib/cup.js';
import { parseTs } from '../lib/dates.js';
import { coversStart, scopeSplitLabel } from '../lib/districts.js';
import { filterCategories } from '../lib/filter.js';
import { isHurdleStart, shuttleLaneText } from '../lib/hurdles.js';
import { crossingsFor } from '../lib/lap-counter.js';
import { scopeResults, scopeTablesAddNothing } from '../lib/medals.js';
import {
  PLAIN_MARK,
  allocKey,
  attemptColumns,
  beatsMark,
  bestsParts,
  bibNumbersUsed,
  displayRank,
  earlierMarks,
  heatFinishOrder,
  heatPlaces,
  heatWind,
  heatsInOrder,
  markFormat,
  officialRank,
  qualificationNote,
  relayInfo,
  relayLegParts,
  resultWind,
  roundAllocated,
  verticalJumpHeights,
  verticalJumpRow,
  verticalMarkText,
} from '../lib/results.js';
import { dayPath, hurdleSheetPath } from '../lib/routes.js';
import {
  HEAT_STATUS_FI,
  betterStatus,
  defaultResultView,
  filedStart,
  hasEarlierRound,
  hasEntrants,
  previousRoundField,
  roundGroupKey,
  rowClassAge,
} from '../lib/schedule.js';
import { roundTables, startPageModel, startPageView, undrawnNotice } from '../lib/start.js';
import { allocMatches } from '../lib/watch.js';
import {
  fetchEventDoc,
  fetchMeetBody,
  fetchSchedule,
  followTargets,
  listedRow,
  loadCombinedRoot,
  loadGroup,
  loadScopeChoice,
  officialMenuRows,
  setCupMeetSeen,
  updateViewState,
  viewStateFor,
} from './data.js';
import { athleteNameLink, clubNameLink, confirmDeadline, qualBadgeEl, relayLegEls, soleAthleteId } from './follow.js';
import {
  SITE_MODE,
  appEl,
  cupPointsText,
  el,
  keptOpen,
  onLeave,
  render,
  renderSeq,
  segControl,
  setBack,
  setHelp,
  setScrollKey,
  setTitleMenu,
  statusChip,
  timeFmt,
  titleEl,
  wrap,
} from './shell.js';

// Juoksut mode draws the kenttä and the hurdle setups (app/hurdles.js), which
// Kisat mode never loads.
const juoksut = SITE_MODE === 'juoksut' ? await import('./hurdles.js') : null;

// --- The event view (/c/<compId>/g/<key>) ---

// Returns a category's own status. The results copy wins over the schedule's,
// as reconcileStatuses (lib/schedule.js) corrected it and a graft can be ahead.
const detailStatus = (d) => d.round?.Status || d.schedRound.Status;

// Shows a heat's state beside its "Erä N" heading, whether it has run or not.
// The caller passes the hasResults that picks the table's columns, so the chip
// cannot disagree with the table.
function heatChip(hasResults) {
  const state = hasResults ? 'done' : 'pending';
  return el('span', { class: `chip chip-heat-${state}` }, HEAT_STATUS_FI[state]);
}

// Holds the event view's layout ('heats', 'total' or 'medals') for one start.
// defaultResultView decides it when the start opens, and a refresh keeps it
// (docs/views.md, "A start's page"). leaveResultView clears
// it when the event view is left.
let resultViewState = null;

function resultViewFor(groupKey, rounds, medals = false) {
  const view = resultViewState?.key === groupKey ? resultViewState.view : defaultResultView(rounds, medals);
  resultViewState = { key: groupKey, view };
  return view;
}
function setResultView(groupKey, view) {
  resultViewState = { key: groupKey, view };
}
// Leaving the event view forgets the layout, so the next start opens by its
// own status.
function leaveResultView(route) {
  if (route.view !== 'group' && route.view !== 'combined') resultViewState = null;
}
onLeave(leaveResultView);

function confirmNotice(compId, v) {
  const closes = confirmDeadline(compId, v);
  return el('div', { class: 'notice' }, confirmCount(v), closes ? ' · ' : null, closes);
}

// The wind is an aside on a heading, and heatWind (lib/results.js) decides
// whether there is one. The span holds its own leading space, as the heading's
// other parts bring none.
function windSpan(wind) {
  return wind ? el('span', { class: 'wind' }, ` tuuli ${wind}`) : null;
}

// A category that ran one heat has one wind. With several heats each heading
// carries its own, so this gives null.
function soleHeatWind(d) {
  const heats = heatsInOrder(d.round);
  return heats.length === 1 ? heatWind(heats[0], d.data?.EventType) : null;
}

// Renders a start's page. Its highlighting and class filter read the meet's
// stored view state, as the schedule view does (docs/architecture.md,
// "View state").
async function renderGroup(compId, groupKey) {
  const seq = renderSeq;
  setScrollKey(`group:${compId}:${groupKey}`);
  setBack(`/c/${compId}`);
  setHelp(null);

  const state = viewStateFor(compId);
  // The meet body says whether this is a cup meet, which rows scored cup points
  // and how the meet confirms entries (docs/backend.md,
  // "What a competition's own settings say").
  const [loaded, targets, cupMeet, scopeChoice, listed] = await Promise.all([
    loadGroup(compId, groupKey),
    followTargets(compId, state),
    fetchMeetBody(compId),
    // The scope choice feeds the Mitalit view (scopeResults).
    loadScopeChoice(compId),
    listedRow(compId),
  ]);
  if (seq !== renderSeq) return;
  if (!loaded) {
    titleEl.textContent = 'Lähtöä ei löytynyt';
    appEl.replaceChildren(
      el('div', { class: 'notice' }, 'Lähtöä ei löytynyt aikataulusta. Se on ehkä siirretty tai poistettu.'),
    );
    return;
  }
  const { group, schedule } = loaded;
  const cup = cupMeet?.cup
    ? cupMeet.final
      ? { final: true, max: cupMeet.max }
      : { scoring: new Set(cupMeet.scoring) }
    : null;
  setCupMeetSeen(cup ? compId : null);
  const confirm = cupMeet?.confirm || null;
  const startsAt = confirmStartAt(schedule);
  // Categories nobody entered go last. They stay because their status chip is
  // the only place that says the class was not held. The sort is stable, so
  // programme order holds within each half.
  const detailed = [...loaded.detailed].sort(
    (a, b) => Number(hasEntrants(b.round, b.data?.Enrollments)) - Number(hasEntrants(a.round, a.data?.Enrollments)),
  );
  // A multi-event leg's page ends with the ottelu standings (docs/views.md,
  // "Multi-events"). The ottelu is found by the schedule row's name through
  // multiEventLeg, the same key the Ottelut section uses.
  const multiEvents = detailed.some((d) => d.data?.IsCombinedEvent) ? combinedEventStarts(schedule) : [];
  const standings = new Map(
    await Promise.all(
      detailed.map(async (d) => {
        const legOf = d.data?.IsCombinedEvent ? multiEventLeg(d.schedRound.EventName) : null;
        if (!legOf || !d.data.RootId) return [d.label, null];
        const start = multiEvents.find((m) => m.key === legOf.label);
        const root = await fetchEventDoc(compId, schedule, d.data.RootId).catch(() => null);
        const rows = combinedTotals(root);
        if (!rows.length) return [d.label, null];
        return [
          d.label,
          {
            legOf,
            status: betterStatus(start?.status || 'Progress', (root?.Rounds || [])[0]?.Status),
            rows,
            round: (root.Rounds || [])[0],
            start: start && combinedRootStart(start),
            legs: combinedLegColumns(root, start?.legs || []),
            scored: rows.some((a) => Number(a.Result) > 0),
          },
        ];
      }),
    ),
  );
  if (seq !== renderSeq) return;

  const model = startPageModel(detailed, {
    schedule,
    category: group.category,
    roundName: group.roundName,
    scopeChoice,
    standings,
  });
  const { singleCat, sharedRound, hasAnyResults, merged, shared, canCombine, offerMedals, leg } = model;

  const ts = parseTs(group.ts);
  const day = ts.toLocaleDateString('fi-FI');
  const dateKey = encodeURIComponent(day);
  const startTitle = [
    timeFmt.format(ts),
    singleCat ? [detailed[0].label, group.event].filter(Boolean).join(' ') : group.event,
    sharedRound,
  ]
    .filter(Boolean)
    .join(' · ');
  // In Juoksut mode the title menu links to the day's hurdle sheet and the
  // table page. Any hurdle start that day adds the sheet's link, whatever this
  // start's event, as the schedule's menu does (dayMenuRows, app/hurdles.js).
  const officialRows = officialMenuRows(listed, compId);
  if (juoksut) {
    setTitleMenu(startTitle, [
      ...((schedule[day] || []).some((r) => isHurdleStart(r.EventName))
        ? [{ label: 'Päivän aidat', href: hurdleSheetPath(compId, dateKey) }]
        : []),
      juoksut.tablePageRow(compId, juoksut.tablePageSection(group.event)),
      ...officialRows,
    ]);
  } else if (officialRows.length) setTitleMenu(startTitle, officialRows);
  else titleEl.textContent = startTitle;
  setBack(dayPath(compId, dateKey));

  // A badge ticks its class in the day list's class filter. On a shared start's
  // Erät view the badges are plain text.
  const setAges = (ages) => {
    updateViewState(compId, { ages });
    render(true);
  };
  const catBadges = (toggles) =>
    el(
      'div',
      { class: 'cat-badges' },
      detailed.map((d) => {
        const text = `${d.label}${!sharedRound && d.round ? ` · ${d.round.Name}` : ''}`;
        const age = toggles ? rowClassAge(d.schedRound, schedule) : null;
        if (age == null) return el('span', { class: 'cat-badge' }, text);
        const on = state.ages.includes(age);
        return el(
          'button',
          {
            class: `chip chip-toggle cat-badge${on ? ' on' : ''}`,
            'aria-pressed': String(on),
            onclick: () => setAges(on ? state.ages.filter((a) => a !== age) : [...state.ages, age]),
          },
          text,
        );
      }),
    );
  const parts = [];

  // This button is the only way into the lap counter besides its URL
  // (docs/juoksut.md). It stays after the race, since the counter keeps the
  // finish order and hand times.
  if (juoksut && model.laps) {
    const { raceLength, shuttle } = model.laps;
    const crossings = crossingsFor(raceLength, juoksut.storedTrack(compId, ts), shuttle);
    parts.push(
      el(
        'a',
        { class: 'btn', href: `/c/${compId}/g/${encodeURIComponent(groupKey)}/laps` },
        crossings > 1 ? '🔔 Kierroslaskuri' : '🏁 Maaliintulot',
      ),
    );
  }

  // The setup box loads the tables only where the event name says hurdles, so a
  // meet without any never fetches them.
  if (juoksut && isHurdleStart(group.event)) {
    const box = await juoksut.setupBox(loaded.detailed, hasAnyResults, groupKey, compId);
    if (seq !== renderSeq) return;
    if (box) parts.push(box);
  }

  // Each row appears once in whichever view is showing (docs/views.md,
  // "A start's page").
  const view =
    canCombine || offerMedals
      ? resultViewFor(
          groupKey,
          detailed.map((d) => d.round),
          // A multi-event's medals go by its total, so a finished leg never
          // opens on the scope split.
          offerMedals && !leg,
        )
      : 'heats';
  const { byScope, combined, heatTables, badgeToggles } = startPageView(model, view);
  if (!singleCat) parts.unshift(catBadges(badgeToggles));
  if (canCombine || offerMedals) {
    const setView = (v) => () => {
      setResultView(groupKey, v);
      render();
    };
    const medalsLabel = () =>
      leg
        ? scopeSplitLabel(scopeChoice.districts, scopeChoice.scopes, filedStart(detailed[0].schedRound, schedule))
        : 'Mitalit';
    parts.push(
      el(
        'div',
        { class: 'filter-bar' },
        segControl('Tulosten esitystapa', [
          ...(canCombine
            ? [
                { label: 'Erät', pressed: !combined && !byScope, onclick: setView('heats') },
                { label: shared ? 'Sarjat' : 'Kokonaistulokset', pressed: combined, onclick: setView('total') },
              ]
            : [{ label: 'Kaikki', pressed: !byScope, onclick: setView('heats') }]),
          offerMedals ? { label: medalsLabel(), pressed: byScope, onclick: setView('medals') } : null,
        ]),
      ),
    );
  }

  // The note says why most cup points are muted. It shows once a page after
  // something has run. A final mutes only a last place worth 0 and gets no
  // note.
  const cupNote =
    cup && !cup.final && hasAnyResults
      ? el('div', { class: 'qual-note' }, 'Seuracup: vain seuran paras tulos lasketaan')
      : null;

  const order = model.shuttleLanes ? SHUTTLE_ORDER : PLAIN_ORDER;

  let needsWide = false;
  if (heatTables) {
    // Each physical heat gets one table over everyone in it (docs/views.md,
    // "A start's page"). A merged row knows only its category's label,
    // so the category's data is looked up by that label.
    const byLabel = new Map(
      detailed.map((d) => [
        d.label,
        {
          team: relayInfo(d.data),
          round: d.round,
          marks: earlierMarks(d.data?.Rounds, d.round),
          eventType: d.data?.EventType,
          mark: markFormat(d.data),
          // Points are per category, since the cup scores per event and a shared
          // start holds several events (pointsRail).
          points: pointsRail(cup, d),
        },
      ]),
    );
    // Whether bib numbers are used is asked over the whole start. It depends on
    // the meet and the event, not the heat (docs/tuloslista-api.md).
    const bibs = bibNumbersUsed(merged.flatMap((h) => h.rows.map((r) => r.alloc)));
    parts.push(
      el(
        'h2',
        {},
        hasAnyResults ? 'Tulokset' : 'Ratajärjestys',
        // With one heat, its wind goes on this heading.
        merged.length === 1 ? windSpan(merged[0].wind) : null,
      ),
    );
    if (cupNote) parts.push(cupNote);
    for (const h of merged) {
      // Each heat is checked for results on its own, so a run heat reads in
      // finish order beside one still in lane order. The heading's chip and the
      // table use this one value.
      const heatRun = h.rows.some((r) => r.alloc?.Result);
      if (merged.length > 1) parts.push(el('h3', {}, `Erä ${h.index} `, heatChip(heatRun), windSpan(h.wind)));
      parts.push(sharedHeatTable(h, heatRun, byLabel, { targets, compId, bibs, order }));
    }
  } else {
    parts.push(
      el(
        'h2',
        {},
        hasAnyResults ? (singleCat ? 'Tulokset' : 'Tulokset sarjoittain') : singleCat ? 'Osallistujat' : 'Sarjat',
        singleCat ? ' ' : null,
        singleCat ? statusChip(detailStatus(detailed[0])) : null,
        // One category with one heat puts its wind on this heading.
        singleCat ? windSpan(soleHeatWind(detailed[0])) : null,
      ),
    );
    if (cupNote) parts.push(cupNote);
    const sections = categorySections(filterCategories(detailed, state.ages, schedule), {
      singleCat,
      sharedRound,
      combined,
      byScope,
      targets,
      compId,
      standings,
      cup,
      confirm,
      startsAt,
      order,
      scopeChoice: scopeChoice && { ...scopeChoice, schedule },
    });
    needsWide = sections.needsWide;
    parts.push(...sections.parts);
  }

  // The scroll offsets are read before the swap, so a refresh keeps each
  // ladder's horizontal position (docs/views.md, "The refresh"). If the
  // number of tables changed, they open as on a first visit.
  const wasScrolledTo = [...appEl.querySelectorAll('.ladder-views > .tbl-wrap')].map((w) => w.scrollLeft);
  appEl.classList.toggle('wide', needsWide);
  appEl.replaceChildren(...parts);
  // A ladder opens scrolled to its Result column. Its sticky identity columns
  // keep the names in view. scrollWidth is only known once the table is in the
  // document.
  const wraps = [...appEl.querySelectorAll('.ladder-views > .tbl-wrap')];
  const keep = wasScrolledTo.length === wraps.length;
  wraps.forEach((w, i) => {
    w.scrollLeft = keep ? wasScrolledTo[i] : w.scrollWidth;
  });
}

// Renders a start one class at a time, each under its own heading and status
// chip. It returns the nodes and whether any table needs the wide layout,
// which only the caller can set.
function categorySections(
  detailed,
  {
    singleCat,
    sharedRound,
    combined,
    byScope = false,
    targets,
    compId,
    standings = new Map(),
    cup = null,
    confirm = null,
    startsAt,
    order = PLAIN_ORDER,
    scopeChoice = null,
  },
) {
  const parts = [];
  let needsWide = false;
  for (const d of detailed) {
    if (!singleCat) {
      const roundName = !sharedRound && d.round ? ` — ${d.round.Name}` : '';
      // A category whose fetch failed takes its name from the schedule row
      // (loadGroupDetail).
      parts.push(
        el(
          'h3',
          {},
          `${d.data?.Name || d.schedRound.EventName}${roundName} `,
          statusChip(detailStatus(d)),
          windSpan(soleHeatWind(d)),
        ),
      );
    }
    if (!d.data) {
      // A 404 does not prove that nobody entered, so the text does not claim it.
      parts.push(
        el(
          'div',
          { class: d.missing ? 'notice' : 'notice error' },
          d.missing ? 'Sarjan tuloksia ei ole julkaistu.' : 'Sarjan tietojen haku epäonnistui.',
        ),
      );
      continue;
    }
    const isField = d.schedRound?.Category === 'Field';
    const isVertical = d.data?.EventSubCategory === 'VerticalJump';
    // A result cell shows a multi-event leg's points or the cup's points
    // (pointsRail). A leg's ottelu standings end the category (st).
    const points = pointsRail(cup, d);
    const st = standings.get(d.label);
    const team = relayInfo(d.data);
    const legs = team.legCount;
    // The API's own heat order is arbitrary (docs/tuloslista-api.md).
    const heats = heatsInOrder(d.round);

    const note = qualificationNote(d.round, isField);
    if (note) parts.push(el('div', { class: 'qual-note' }, note));

    // The bests are columns only while the round shows no earlier mark. It is
    // decided per round, so every heat under a heading has the same columns.
    const marks = earlierMarks(d.data?.Rounds, d.round);
    const bestCols = marks.size === 0;
    const mark = markFormat(d.data);
    // A table with results always shows the bests beside the name.
    const asideFor = (hasResults) =>
      nameAside(marks, d.data?.EventType, hasResults || !bestCols, mark, targets?.namedAthleteIds);
    // A leg's entry list marks whoever is out of the ottelu. It reads the root's
    // totals, already fetched for the standings (docs/views.md, "Varmistus").
    const outOfOttelu = combinedWithdrawn(st?.rows);
    const entryAside = outOfOttelu.size
      ? (a) => ({ ...asideFor(false)(a), note: outOfOttelu.has(combinedAthleteKey(a)) ? 'ei jatka' : null })
      : asideFor(false);
    const context = (allocs, t) =>
      tableContext(allocs, { legCount: legs, targets, team, compId, round: d.round, bestCols, points, order, ...t });

    // An undrawn round can carry an empty heat shell (docs/tuloslista-api.md),
    // which has to fall through to the entry list.
    if (roundAllocated(d.round)) {
      // Column counts and bib use are decided over the whole round, so its heat
      // tables line up.
      const allRoundAllocs = heats.flatMap((h) => h.Allocations || []);
      const cols = isField && !isVertical ? attemptColumns(allRoundAllocs) : 0;
      const heights = isField && isVertical ? verticalJumpHeights(allRoundAllocs) : [];
      const bibs = bibNumbersUsed(allRoundAllocs);
      if (
        ladderWidth(cols, bibs) > LADDER_WIDE_THRESHOLD_PX ||
        ladderWidth(heights.length, bibs) > LADDER_WIDE_THRESHOLD_PX
      ) {
        needsWide = true;
      }
      const tables = roundTables(d.round, {
        byScope,
        combined,
        eventType: d.data?.EventType,
        start: byScope ? filedStart(d.schedRound, scopeChoice.schedule) : null,
        scopeChoice,
      });
      for (const { heading, grouping, wind, allocs } of tables) {
        // One value drives the heading's chip and the table's columns, so they
        // cannot disagree (heatChip).
        const hasResults = allocs.some((a) => a.Result);
        const aside = asideFor(hasResults);
        if (heading) parts.push(el('h3', {}, `${heading} `, grouping ? null : heatChip(hasResults), windSpan(wind)));
        const t = context(allocs, { bibs, aside });
        if (isField && isVertical) parts.push(verticalJumpTable(allocs, hasResults, heights, t));
        else if (isField) parts.push(fieldLadderTable(allocs, hasResults, cols, t));
        else parts.push(trackTable(allocs, hasResults, t));
      }
      // The entries in no heat are listed on an event's first round, if the meet
      // confirms entries (docs/views.md, "Varmistus").
      const drawnIds = new Set(allRoundAllocs.map((a) => a.Id));
      const missing = hasEarlierRound(d.data.Rounds, d.round)
        ? []
        : (d.data.Enrollments || []).filter((e) => !drawnIds.has(e.Id));
      if (missing.length && confirmNote(d.data.Enrollments, confirm, startsAt(d.schedRound))) {
        parts.push(el('h3', {}, 'Ei erissä'));
        parts.push(enrollmentTable(missing, context(missing, { aside: entryAside, confirmCol: true, mark })));
      }
    } else {
      // An undrawn round lists the closest earlier round's qualifiers, as
      // Enrollments is event-wide (docs/views.md, "An undrawn round").
      const field = previousRoundField(d.data.Rounds, d.round);
      const list = field || d.data.Enrollments;
      if (list?.length) {
        // The status chip already says the heats are missing. The notice adds
        // whether the list can still change (docs/views.md,
        // "An undrawn round").
        const notice = undrawnNotice(d.data.Rounds, d.round, field);
        const prev = notice?.previous;
        if (notice) {
          parts.push(
            el(
              'div',
              { class: 'notice' },
              notice.text,
              // The link goes to the round the list came from, which need not be
              // the previous stage (previousRound, lib/schedule.js).
              prev ? ' ' : null,
              prev
                ? el(
                    'a',
                    {
                      href: `/c/${compId}/g/${encodeURIComponent(roundGroupKey({ BeginDateTimeWithTZ: prev.BeginDateTimeWithTZ, EventName: d.data.Name }))}`,
                    },
                    `→ ${prev.Name}`,
                  )
                : null,
            ),
          );
        }
        // Enrollments is this round's field only on an event's first round, so
        // only that round counts confirmations.
        const varmistus =
          field || hasEarlierRound(d.data.Rounds, d.round) ? null : confirmNote(list, confirm, startsAt(d.schedRound));
        if (varmistus) parts.push(confirmNotice(compId, varmistus));
        // The tick column shows exactly when the count line does, so the two
        // cannot disagree.
        parts.push(enrollmentTable(list, context(list, { aside: entryAside, confirmCol: varmistus != null, mark })));
      } else {
        parts.push(el('div', { class: 'notice' }, 'Ei ilmoittautuneita.'));
      }
    }

    // Under Mitalit the leg's ottelu standings split by scope too.
    if (st) {
      const tables =
        byScope && st.start
          ? scopeResults(st.round, st.start, scopeChoice.districts, scopeChoice.scopes).map((t) => [
              el('h3', {}, t.scope?.short || 'Muut'),
              t.allocs,
            ])
          : [[null, st.rows]];
      parts.push(
        standingsShell(
          st.legOf.label,
          `${st.legOf.label} · ottelupisteet `,
          st.status,
          tables.flatMap(([heading, rows]) => [
            heading,
            combinedStandingsTable(rows, st.legs, targets, compId, st.scored, d.schedRound.EventId),
          ]),
        ),
      );
      if (standingsWidth(st.legs.length) > LADDER_WIDE_THRESHOLD_PX) needsWide = true;
    }
  }
  return { parts, needsWide };
}

// --- A multi-event's standings, on a leg and on its own page ---

// Holds the multi-events whose standings are open on a leg page.
const standingsOpen = keptOpen('group');

// Folds a leg's ottelu standings. A reader's open or closed choice survives
// the refresh until the event view is left (keptOpen).
function standingsShell(label, title, status, children) {
  return el(
    'details',
    { class: 'ottelu', ...standingsOpen(label, false) },
    el('summary', {}, title, statusChip(status)),
    ...children,
  );
}

// Marks a leg in progress with the word "kesken" under its heading. A status
// chip would not fit the leg column.
function legStateEl(status) {
  return status === 'Progress' ? el('span', { class: 'leg-state' }, 'kesken') : null;
}

// A leg's cell shows the points over the mark that scored them. It is blank
// until a result exists, as a 0 is a real score.
function standingsCell(alloc) {
  if (!alloc?.Result) return el('td', { class: 'att' });
  return el(
    'td',
    { class: 'att' },
    el('span', { class: 'leg-points' }, `${alloc.CEPoints ?? 0} p.`),
    el('span', { class: 'leg-mark' }, alloc.Result),
  );
}

// Shows the row's gap to the leader under its total (combinedGap,
// lib/combined.js). The gap is signed both ways, as a guest can out-score the
// winner.
function gapEl(alloc, leaderPoints) {
  const gap = combinedGap(alloc, leaderPoints);
  if (gap == null) return null;
  return el('span', { class: 'total-gap' }, `${gap < 0 ? '−' : '+'}${Math.abs(gap)}`);
}

// A leg column fits the widest discipline name in a decathlon. Ten such
// columns still fit inside main.wide.
const STANDINGS_LEG_PX = 88;

function standingsWidth(numLegs, name = LADDER_NAME_MIN_PX) {
  return 40 + name + 64 + numLegs * STANDINGS_LEG_PX;
}

// Draws the standings as a ladder table with one column per leg, in contest
// order (combinedLegColumns, lib/combined.js). Before anything is scored every
// rank is 1., so with `scored` false the Sija column prints a dash.
function combinedStandingsTable(rows, legs, targets, compId, scored = true, hereLegId = null) {
  const leader = combinedLeaderPoints(rows);
  return wrap(
    el(
      'table',
      {
        class: 'tbl ladder no-bib standings',
        style: `min-width:${standingsWidth(legs.length)}px;max-width:${standingsWidth(legs.length, LADDER_NAME_MAX_PX)}px`,
      },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { class: 'num' }, 'Sija'),
          el('th', { class: 'name' }, 'Nimi'),
          legs.map((l) =>
            el(
              'th',
              { class: 'att' },
              // A heading links to its leg, except on that leg's own page
              // (hereLegId).
              l.key && String(l.id) !== String(hereLegId)
                ? el('a', { class: 'leg-link', href: `/c/${compId}/g/${encodeURIComponent(l.key)}` }, l.label)
                : l.label,
              legStateEl(l.status),
            ),
          ),
          el('th', { class: 'result' }, 'Pisteet'),
        ),
      ),
      el(
        'tbody',
        {},
        rows.map((a) => {
          const key = combinedAthleteKey(a);
          return el(
            'tr',
            { class: rowClass(a, targets, null, a.NotInCompetition ? 'ku' : null) },
            el('td', { class: 'num' }, scored ? rankText(a) : '—'),
            nameCell(a, 0, compId),
            legs.map((l) => standingsCell(l.results.get(key))),
            el('td', { class: 'result' }, a.Result || '', gapEl(a, leader)),
          );
        }),
      ),
    ),
  );
}

// --- The name cell ---

// Builds a row's name and the line under it, for nameCell and the ladder cards.
// The `aside` from nameAside adds the earlier mark and the bests, muted but for
// a best the result passed (docs/views.md, "The name cell"). A relay's second line lists its runners.
function athleteNameParts(a, legCount, compId, aside = null) {
  const legs = relayLegParts(a, legCount, aside?.named);
  // Juoksut mode has no follow-lists, so it prints a plain name (docs/juoksut.md,
  // "What each mode has").
  const athleteId = compId && SITE_MODE !== 'juoksut' ? soleAthleteId(a) : null;
  // A relay's club link moves up to the team name.
  const org = legs.length ? relayLegEls(legs) : clubNameLink(compId, a.Organization, a.Organization?.Name || '');
  const teamName = legs.length ? clubNameLink(compId, a.Organization, a.Name) : null;
  const prev = aside?.prev || null;
  const official = officialRank(a);
  const trailing = legs.length ? [] : aside?.bests || [];
  return [
    el(
      'div',
      { class: 'name-main' },
      teamName || (athleteId ? athleteNameLink(compId, athleteId, a, { marks: aside?.marks || [] }) : a.Name),
      a.NotInCompetition ? el('span', { class: 'name-badge' }, 'kilpailun ulkopuolella') : null,
      // aside.note flags an athlete who left the multi-event but is still
      // entered here.
      aside?.note ? el('span', { class: 'name-badge' }, aside.note) : null,
      // The earlier mark carries no Q/q of its own.
      prev ? el('span', { class: 'prev-mark' }, `${prev.label} ${prev.result}`) : null,
    ),
    el(
      'div',
      { class: 'org' },
      org,
      a.heatIndex != null ? el('span', { class: 'heat-tag' }, `Erä ${a.heatIndex}`) : null,
      // Under a championship scope the Sija column is the place within the
      // scope, so the official place shows here where the two differ
      // (officialRank, lib/results.js).
      official != null ? el('span', { class: 'heat-tag' }, `${official}. kaikista`) : null,
      trailing.map((m) =>
        el(
          'span',
          {
            // A best this result passed is not muted (beatsMark, docs/views.md,
            // "The name cell").
            class: m.beaten ? 'name-aside name-aside-beaten' : 'name-aside',
          },
          `${m.label} ${m.value ?? m.result}`,
        ),
      ),
    ),
  ];
}

function nameCell(a, legCount, compId, aside = null) {
  return el('td', { class: 'cell-name' }, ...athleteNameParts(a, legCount, compId, aside));
}

// Returns the per-row aside for one round's tables (docs/views.md,
// "The name cell"). `showBests` moves the bests from their columns into the
// name cell. `mark` formats only the display, as beatsMark compares the raw
// strings.
function nameAside(marks, eventType, showBests, mark = PLAIN_MARK, named = null) {
  const category = eventType?.Category;
  return (a) => {
    // The name cell shows the latest earlier round, and the athlete sheet
    // shows all of them.
    const rows = (marks.get(allocKey(a)) || []).map((m) => ({ ...m, result: mark(m.result) }));
    return {
      named,
      prev: rows[0] || null,
      marks: rows,
      bests: showBests
        ? bestsParts(a).map((b) => ({
            ...b,
            value: mark(b.value),
            beaten: beatsMark(a.Result, b.value, category, resultWind(a, eventType)),
          }))
        : [],
    };
  };
}

// A table that shows the name alone takes this aside function.
const NO_ASIDE = () => null;

// Picks whether a category's result cell shows multi-event points, cup points
// or none. The choice rests on IsCombinedEvent and the meet body, never on the
// values, because both values ride on every allocation.
function pointsRail(cup, d) {
  if (d.data?.IsCombinedEvent) return { kind: 'ce' };
  if (!cup) return null;
  // A cup final's points come from the round itself (cupFinalRoundScores).
  return cup.final
    ? { kind: 'final', scores: cupFinalRoundScores(d.round, cup.max) }
    : { kind: 'cup', scoring: cup.scoring, eventId: d.schedRound.EventId };
}

// Draws a row's points. Cup points are muted except on the rows that count in
// the standings (cupStandings, docs/views.md, "The club cup").
function pointsEl(a, rail) {
  if (!rail || !a?.Result) return null;
  if (rail.kind === 'ce') {
    // A leg's own 0 is a score and prints.
    return a.CEPoints == null ? null : el('span', { class: 'ce-points' }, `${a.CEPoints} p.`);
  }
  if (rail.kind === 'final') {
    // A guest, or an athlete beyond the club's scoring cap, has no score and
    // shows nothing. A score of 0 is a last place and shows muted.
    const points = rail.scores.get(a.Id);
    if (points == null) return null;
    return el(
      'span',
      { class: points > 0 ? 'cup-points cup-points-scored' : 'cup-points' },
      `${cupPointsText(points)} p.`,
    );
  }
  if (a.SeuraCUPPoints == null) return null;
  const scored = rail.scoring.has(cupScoringKey(rail.eventId, a));
  return el('span', { class: scored ? 'cup-points cup-points-scored' : 'cup-points' }, `${a.SeuraCUPPoints} p.`);
}

// Adds the followed-row class (allocMatches, lib/watch.js) to `extra`. `team`
// is the event's relayInfo, so a relay row matches on its club and lineup.
function rowClass(a, targets, team, extra) {
  const classes = [extra, allocMatches(a, targets, team) ? 'watched' : null].filter(Boolean);
  return classes.length ? classes.join(' ') : null;
}

// Prints a results row's Sija (displayRank, lib/results.js). A row with a
// result and no rank gets an em dash, because an empty cell would read as not
// in yet.
function rankText(a) {
  const rank = displayRank(a);
  return rank != null ? `${rank}.` : '—';
}

// --- The result tables ---

// These bound the name column of a ladder table (docs/style.md, "Width").
// The max fits a 22-character name at 14 px (~150 px)
// and a club with a PB&SB aside at 12 px (~250 px), each on one line.
const LADDER_NAME_MIN_PX = 150;
const LADDER_NAME_MAX_PX = 320;

// Computes a ladder table's width from its column count. Its numbers must match
// the fixed column widths in index.html. The width bounds the table
// (ladderWidthStyle) and decides when main widens (renderGroup).
function ladderWidth(numCols, bibs = true, name = LADDER_NAME_MIN_PX) {
  return (bibs ? 80 : 40) + name + 64 + numCols * 62;
}

function ladderWidthStyle(numCols, bibs) {
  return `min-width:${ladderWidth(numCols, bibs)}px;max-width:${ladderWidth(numCols, bibs, LADDER_NAME_MAX_PX)}px`;
}

// A ladder wider than this does not fit the 1000 px main, so renderGroup
// widens main (main.wide, docs/style.md, "Width").
const LADDER_WIDE_THRESHOLD_PX = 900;

// A ladder wider than the page prints as its stacked cards, as paper cannot
// scroll. A4 portrait at Chrome's default 1 cm margins measured 718 px with a
// print-media ruler, and Letter 741. The narrower one decides.
const PRINT_COLUMN_PX = 718;

// Puts both ladder layouts in one node. CSS shows the stacked cards below
// 700 px, and in print where the grid is too wide (index.html).
function ladderViews(numCols, bibs, table, cards) {
  const wide = ladderWidth(numCols, bibs) > PRINT_COLUMN_PX;
  return el('div', { class: wide ? 'ladder-views print-stack' : 'ladder-views' }, table, cards);
}

// An order column has a heading and a format for the drawn number. An
// aitaviesti team shows its lane pair where the draw allows it
// (shuttlePairDraw, lib/hurdles.js).
const PLAIN_ORDER = { label: 'Rata', text: (p) => String(p ?? '') };
const FIELD_ORDER = { ...PLAIN_ORDER, label: 'Järj.' };
const SHUTTLE_ORDER = { label: 'Radat', text: shuttleLaneText };

// Gives what the tables of one class share, over the defaults. A row's own data
// is read off the row, as the name cell's is (AGENTS.md, "The name cell is
// one function for every table"). Whether bib numbers show is asked over
// allocs.
function tableContext(allocs, t = {}) {
  return {
    legCount: 0,
    targets: null,
    team: null,
    compId: null,
    round: null,
    aside: NO_ASIDE,
    bestCols: true,
    points: null,
    order: PLAIN_ORDER,
    mark: PLAIN_MARK,
    confirmCol: false,
    ...t,
    bibs: t.bibs ?? bibNumbersUsed(allocs),
  };
}

// Any drawn start not yet contested shows the draw with the bests. With
// `bestCols` false the bests sit in the name cell (nameAside).
function startListTable(allocs, t) {
  const { order, legCount, targets, team, compId, round, bibs, aside, bestCols, mark } = t;
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
          el('th', { class: 'num' }, order.label),
          bibs ? el('th', { class: 'num' }, 'Nro') : null,
          el('th', {}, 'Nimi'),
          bestCols ? el('th', { class: 'result' }, 'PB') : null,
          bestCols ? el('th', { class: 'result' }, 'SB') : null,
        ),
      ),
      el(
        'tbody',
        {},
        allocs.map((a) =>
          el(
            'tr',
            { class: rowClass(a, targets, team, a.NotInCompetition ? 'ku' : null) },
            el('td', { class: 'num' }, order.text(a.Position)),
            bibs ? el('td', { class: 'num' }, a.Number || '') : null,
            nameCell(a, legCount, compId, aside(a)),
            bestCols ? el('td', { class: 'result' }, mark(a.PB)) : null,
            bestCols ? el('td', { class: 'result' }, mark(a.SB), qualBadgeEl(a, round)) : null,
          ),
        ),
      ),
    ),
  );
}

// Track and relay show the start list before results and rank order after.
function trackTable(allocs, hasResults, t) {
  if (!hasResults) return startListTable(allocs, t);
  const { legCount, targets, team, compId, round, bibs, aside, points } = t;
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
          bibs ? el('th', { class: 'num' }, 'Nro') : null,
          el('th', {}, 'Nimi'),
          el('th', { class: 'result' }, 'Tulos'),
        ),
      ),
      el(
        'tbody',
        {},
        allocs.map((a) =>
          el(
            'tr',
            { class: rowClass(a, targets, team, a.NotInCompetition ? 'ku' : null) },
            el('td', { class: 'num' }, rankText(a)),
            bibs ? el('td', { class: 'num' }, a.Number || '') : null,
            nameCell(a, legCount, compId, aside(a)),
            el('td', { class: 'result' }, a.Result || '', qualBadgeEl(a, round), pointsEl(a, points)),
          ),
        ),
      ),
    ),
  );
}

// Draws one physical heat with every category in it (docs/views.md,
// "A start's page"). heatPlaces and heatFinishOrder rank it as one
// race. `byLabel` maps a category label to what that category adds.
function sharedHeatTable(heat, hasResults, byLabel, { targets, compId, bibs, order }) {
  const places = heatPlaces(heat.rows);
  const rows = hasResults ? heatFinishOrder(heat.rows) : heat.rows;
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
          el('th', { class: 'num' }, hasResults ? 'Sija' : order.label),
          bibs ? el('th', { class: 'num' }, 'Nro') : null,
          el('th', {}, 'Nimi'),
          el('th', { class: 'cat' }, 'Sarja'),
          el('th', { class: 'result' }, hasResults ? 'Tulos' : 'SB'),
        ),
      ),
      el(
        'tbody',
        {},
        rows.map(({ lane, alloc: a, label }) => {
          const meta = byLabel.get(label) || {};
          const mark = meta.mark || PLAIN_MARK;
          return el(
            'tr',
            { class: rowClass(a, targets, meta.team, a.NotInCompetition ? 'ku' : null) },
            el(
              'td',
              { class: hasResults ? 'num' : 'num lane' },
              hasResults ? (places.get(a.Id) != null ? `${places.get(a.Id)}.` : '—') : order.text(lane),
            ),
            bibs ? el('td', { class: 'num' }, a.Number || '') : null,
            nameCell(
              a,
              meta.team?.legCount,
              compId,
              meta.marks && nameAside(meta.marks, meta.eventType, hasResults, mark, targets?.namedAthleteIds)(a),
            ),
            el(
              'td',
              { class: 'cat' },
              label,
              hasResults && a.ResultRank != null ? el('span', { class: 'cat-rank' }, ` ${a.ResultRank}.`) : null,
            ),
            el(
              'td',
              { class: 'result' },
              mark(hasResults ? a.Result : a.SB),
              qualBadgeEl(a, meta.round),
              hasResults ? pointsEl(a, meta.points) : null,
            ),
          );
        }),
      ),
    ),
  );
}

// Returns the class and text for an attempt that is a mark, a foul ("x") or a
// pass ("-").
function attemptMarkParts(att) {
  const mark = att.Line1;
  return {
    cls: mark === 'x' ? 'att-x' : mark === '-' ? 'att-pass' : 'att-mark',
    text: mark === 'x' ? 'X' : mark || '—',
  };
}

// Draws one attempt cell. A horizontal jump shows its wind reading under it.
function attemptCell(att) {
  if (!att) return el('td', { class: 'att' }, el('span', { class: 'att-empty' }, '·'));
  const { cls, text } = attemptMarkParts(att);
  return el(
    'td',
    { class: 'att' },
    el('span', { class: cls }, text),
    att.Line2 ? el('span', { class: 'att-wind' }, att.Line2) : null,
  );
}

// A phone card shows the same attempt as a chip labelled with its number.
function ladderCardAttempt(label, att) {
  const { cls, text } = attemptMarkParts(att);
  return el(
    'span',
    { class: 'att-item' },
    el('span', { class: 'att-n' }, label),
    el('span', { class: cls }, text),
    att.Line2 ? el('span', { class: 'att-wind' }, att.Line2) : null,
  );
}

// A bar's pattern ("xo") reads as cleared once it holds an "o".
function barPatternEl(pattern) {
  return el('span', { class: pattern.includes('o') ? 'att-mark' : 'att-x' }, pattern);
}

// A vertical jump card shows a bar's pattern as a chip labelled with the height.
function ladderCardHeight(label, pattern) {
  return el('span', { class: 'att-item' }, el('span', { class: 'att-n' }, label), barPatternEl(pattern));
}

// A ladder row at phone width is a head line over that athlete's attempts. A
// card shares no columns, so it holds only its own attempts or heights.
function ladderCard(extraClass, headChildren, attemptItems, attemptsAttrs = { class: 'ladder-card-attempts' }) {
  return el(
    'div',
    { class: extraClass ? `ladder-card ${extraClass}` : 'ladder-card' },
    el('div', { class: 'ladder-card-head' }, ...headChildren),
    attemptItems.length ? el('div', attemptsAttrs, attemptItems) : null,
  );
}

// A ladder's first column holds the rank once the heat has results, and the
// draw order before.
function ladderRankText(a, hasResults) {
  return hasResults ? rankText(a) : String(a.Position ?? '');
}

function ladderCardHead(a, hasResults, bibs, compId, resultChildren, aside = null) {
  return [
    el('span', { class: 'num' }, ladderRankText(a, hasResults)),
    bibs ? el('span', { class: 'num' }, a.Number || '') : null,
    el('div', { class: 'cell-name' }, ...athleteNameParts(a, 0, compId, aside)),
    el('span', { class: 'result' }, ...resultChildren),
  ];
}

// Draws throws and horizontal jumps as phone cards. `data-n` lets a container
// query fit a card's attempts on one row where there is room (index.html).
function fieldLadderCards(allocs, hasResults, { targets, team, compId, round, bibs, aside, points }) {
  return el(
    'div',
    { class: 'ladder-stack' },
    allocs.map((a) => {
      const attempts = a.Attempts || [];
      return ladderCard(
        rowClass(a, targets, team),
        ladderCardHead(
          a,
          hasResults,
          bibs,
          compId,
          // The badge precedes the wind, as in fieldLadderTable's result cell.
          [
            a.Result || '',
            qualBadgeEl(a, round),
            a.Wind ? el('span', { class: 'att-wind' }, a.Wind) : null,
            pointsEl(a, points),
          ],
          aside(a),
        ),
        attempts.map((att, n) => ladderCardAttempt(String(n + 1), att)),
        { class: 'ladder-card-attempts rounds', 'data-n': String(attempts.length) },
      );
    }),
  );
}

// Vertical jump cards list only the heights each athlete tried
// (verticalJumpRow, lib/results.js).
function verticalJumpCards(allocs, hasResults, { targets, team, compId, round, bibs, aside, points }) {
  return el(
    'div',
    { class: 'ladder-stack' },
    allocs.map((a) => {
      const byHeight = verticalJumpRow(a);
      const heights = [...byHeight.keys()].sort((x, y) => x - y);
      return ladderCard(
        rowClass(a, targets, team),
        ladderCardHead(
          a,
          hasResults,
          bibs,
          compId,
          [verticalMarkText(a.Result), qualBadgeEl(a, round), pointsEl(a, points)],
          aside(a),
        ),
        heights.map((h) => ladderCardHeight((h / 100).toFixed(2), byHeight.get(h))),
      );
    }),
  );
}

// A ladder heat with no result and no attempt yet is drawn as a start list,
// decided per heat.
function ladderStarted(allocs, hasResults) {
  return hasResults || allocs.some((a) => (a.Attempts || []).length);
}

// Draws throws and horizontal jumps as a grid of attempts. Pass `cols` from
// every heat of the round so the heats line up. A row may hold fewer attempts
// than there are columns.
function fieldLadderTable(allocs, hasResults, cols, t) {
  if (!ladderStarted(allocs, hasResults)) return startListTable(allocs, { ...t, order: FIELD_ORDER, legCount: 0 });
  const { targets, team, compId, round, bibs, aside, points } = t;
  const table = wrap(
    el(
      'table',
      { class: `tbl ladder${bibs ? '' : ' no-bib'}`, style: ladderWidthStyle(cols, bibs) },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { class: 'num' }, hasResults ? 'Sija' : 'Järj.'),
          bibs ? el('th', { class: 'num' }, 'Nro') : null,
          el('th', { class: 'name' }, 'Nimi'),
          Array.from({ length: cols }, (_, i) => el('th', { class: 'att' }, String(i + 1))),
          el('th', { class: 'result' }, 'Tulos'),
        ),
      ),
      el(
        'tbody',
        {},
        allocs.map((a) =>
          el(
            'tr',
            { class: rowClass(a, targets, team) },
            el('td', { class: 'num' }, ladderRankText(a, hasResults)),
            bibs ? el('td', { class: 'num' }, a.Number || '') : null,
            nameCell(a, 0, compId, aside(a)),
            Array.from({ length: cols }, (_, i2) => attemptCell((a.Attempts || [])[i2])),
            // The badge goes before the wind. .att-wind is a block, so a badge
            // after it would wrap onto a third line.
            el(
              'td',
              { class: 'result' },
              a.Result || '',
              qualBadgeEl(a, round),
              a.Wind ? el('span', { class: 'att-wind' }, a.Wind) : null,
              pointsEl(a, points),
            ),
          ),
        ),
      ),
    ),
  );
  return ladderViews(cols, bibs, table, fieldLadderCards(allocs, hasResults, t));
}

// Draws vertical jumps as a grid with a column per height anyone tried. Pass
// `heights` from every heat of the round (verticalJumpHeights, lib/results.js).
function verticalJumpTable(allocs, hasResults, heights, t) {
  if (!ladderStarted(allocs, hasResults)) {
    return startListTable(allocs, { ...t, order: FIELD_ORDER, legCount: 0, mark: verticalMarkText });
  }
  const { targets, team, compId, round, bibs, aside, points } = t;
  const rows = allocs.map((a) => ({ a, byHeight: verticalJumpRow(a) }));
  const table = wrap(
    el(
      'table',
      { class: `tbl ladder${bibs ? '' : ' no-bib'}`, style: ladderWidthStyle(heights.length, bibs) },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { class: 'num' }, hasResults ? 'Sija' : 'Järj.'),
          bibs ? el('th', { class: 'num' }, 'Nro') : null,
          el('th', { class: 'name' }, 'Nimi'),
          heights.map((h) => el('th', { class: 'att' }, (h / 100).toFixed(2))),
          el('th', { class: 'result' }, 'Tulos'),
        ),
      ),
      el(
        'tbody',
        {},
        rows.map(({ a, byHeight }) =>
          el(
            'tr',
            { class: rowClass(a, targets, team) },
            el('td', { class: 'num' }, ladderRankText(a, hasResults)),
            bibs ? el('td', { class: 'num' }, a.Number || '') : null,
            nameCell(a, 0, compId, aside(a)),
            heights.map((h) => {
              const pat = byHeight.get(h);
              if (!pat) return el('td', { class: 'att' }, el('span', { class: 'att-empty' }, '·'));
              return el('td', { class: 'att' }, barPatternEl(pat));
            }),
            el('td', { class: 'result' }, verticalMarkText(a.Result), qualBadgeEl(a, round), pointsEl(a, points)),
          ),
        ),
      ),
    ),
  );
  return ladderViews(heights.length, bibs, table, verticalJumpCards(allocs, hasResults, t));
}

// Lists the field before allocation, usually as the previous round's
// allocations (previousRoundField, lib/schedule.js). `bestCols` works as in
// startListTable. `confirmCol` adds the varmistus column (docs/views.md,
// "Varmistus").
function enrollmentTable(enrollments, t) {
  const { legCount, targets, team, compId, bibs, aside, bestCols, confirmCol, mark } = t;
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
          confirmCol ? el('th', { class: 'conf', 'aria-label': 'Varmistaneet' }) : null,
          bibs ? el('th', { class: 'num' }, 'Nro') : null,
          el('th', {}, 'Nimi'),
          bestCols ? el('th', { class: 'result' }, 'PB') : null,
          bestCols ? el('th', { class: 'result' }, 'SB') : null,
        ),
      ),
      el(
        'tbody',
        {},
        enrollments.map((a) =>
          el(
            'tr',
            { class: rowClass(a, targets, team) },
            confirmCol ? el('td', { class: 'conf' }, a.Confirmed ? '✓' : '') : null,
            bibs ? el('td', { class: 'num' }, a.Number || '') : null,
            nameCell(a, legCount, compId, aside(a)),
            bestCols ? el('td', { class: 'result' }, mark(a.PB)) : null,
            bestCols ? el('td', { class: 'result' }, mark(a.SB)) : null,
          ),
        ),
      ),
    ),
  );
}

// --- A multi-event's own page (/c/<compId>/o/<label>) ---

// Draws a multi-event's standings in three fetches, however many legs it has.
async function renderCombined(compId, key) {
  const seq = renderSeq;
  setScrollKey(`combined:${compId}:${key}`);
  setBack(`/c/${compId}`);
  setHelp(null);

  const state = viewStateFor(compId);
  const [schedule, targets, meet, scopeChoice] = await Promise.all([
    fetchSchedule(compId),
    followTargets(compId, state),
    fetchMeetBody(compId),
    loadScopeChoice(compId),
  ]);
  if (seq !== renderSeq) return;
  const start = combinedEventStarts(schedule).find((m) => m.key === key);
  if (!start) {
    titleEl.textContent = 'Ottelua ei löytynyt';
    appEl.replaceChildren(
      el('div', { class: 'notice' }, 'Ottelua ei löytynyt aikataulusta. Se on ehkä siirretty tai poistettu.'),
    );
    return;
  }
  titleEl.textContent = start.label;
  // Back goes to the first leg's day, as the Ottelut section belongs to no day.
  setBack(dayPath(compId, start.dates[0]));

  const root = await loadCombinedRoot(compId, start.legs, schedule);
  if (seq !== renderSeq) return;
  const rows = combinedTotals(root);
  // A leg's phase comes from the schedule's rows, because the root's copy of it
  // goes stale (combinedLegColumns, lib/combined.js).
  const legs = combinedLegColumns(root, start.legs);

  // Before the first leg is scored, the root ranks everyone 1. with a total of
  // "0" (docs/tuloslista-api.md). That is not a standing yet.
  const scored = rows.some((a) => Number(a.Result) > 0);
  const parts = [
    // The status is the further along of the legs' and the root round's. The
    // root round stays Unallocated until a graft fills it (fetchEventDoc).
    el('h2', {}, 'Kokonaispisteet', ' ', statusChip(betterStatus(start.status, (root?.Rounds || [])[0]?.Status))),
  ];
  // An athlete confirms a multi-event once. The count is over the root's entries
  // and the deadline is the first leg's.
  const startsAt = confirmStartAt(schedule);
  const varmistus = combinedStarted(start.status)
    ? null
    : confirmNote(root?.Enrollments, meet?.confirm || null, startsAt(start.legs[0]?.round));
  if (varmistus) parts.push(confirmNotice(compId, varmistus));
  // Mitalit works as on the event page (renderGroup), over the root's round.
  const rootRound = (root?.Rounds || [])[0];
  const rootStart = combinedRootStart(start);
  const scopeTables =
    scopeChoice && scored && scopeChoice.scopes.some((t) => coversStart(t.cover, rootStart))
      ? scopeResults(rootRound, rootStart, scopeChoice.districts, scopeChoice.scopes)
      : [];
  const offerMedals = !scopeTablesAddNothing(scopeTables);
  const viewKey = `combined:${key}`;
  const byScope = offerMedals && resultViewFor(viewKey, [{ ...rootRound, Status: start.status }], true) === 'medals';
  if (offerMedals) {
    const setView = (v) => () => {
      setResultView(viewKey, v);
      render();
    };
    parts.push(
      el(
        'div',
        { class: 'filter-bar' },
        segControl('Tulosten esitystapa', [
          { label: 'Kaikki', pressed: !byScope, onclick: setView('heats') },
          { label: 'Mitalit', pressed: byScope, onclick: setView('medals') },
        ]),
      ),
    );
  }
  if (!rows.length) {
    parts.push(
      el(
        'div',
        { class: root ? 'notice' : 'notice error' },
        root ? 'Ottelun kokonaispisteitä ei ole julkaistu.' : 'Ottelun kokonaispisteiden haku epäonnistui.',
      ),
    );
  } else if (byScope) {
    for (const t of scopeTables) {
      parts.push(el('h3', {}, t.scope?.short || 'Muut'));
      parts.push(combinedStandingsTable(t.allocs, legs, targets, compId, scored));
    }
  } else {
    parts.push(combinedStandingsTable(rows, legs, targets, compId, scored));
  }
  parts.push(el('h2', {}, 'Osalajit'));
  parts.push(
    el(
      'div',
      { class: 'list' },
      start.legs.map((l) =>
        el(
          'a',
          {
            class: 'row',
            href: `/c/${compId}/g/${encodeURIComponent(roundGroupKey(l.round))}`,
          },
          el('div', { class: 'row-time' }, timeFmt.format(parseTs(l.ts))),
          el(
            'div',
            { class: 'row-main' },
            el('div', { class: 'row-title' }, l.discipline),
            start.dates.length > 1 ? el('div', { class: 'row-sub' }, l.date) : null,
          ),
          statusChip(l.round.Status),
        ),
      ),
    ),
  );

  appEl.classList.toggle('wide', standingsWidth(legs.length) > LADDER_WIDE_THRESHOLD_PX);
  appEl.replaceChildren(...parts);
}

export {
  LADDER_WIDE_THRESHOLD_PX,
  combinedStandingsTable,
  confirmNotice,
  renderCombined,
  renderGroup,
  resultViewFor,
  setResultView,
  standingsWidth,
};
