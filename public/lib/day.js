import { combinedEventStarts } from './combined.js';
import { defaultDay, scheduleDays } from './dates.js';
import { activeFilter, filterRows, meetFilterChoices } from './filter.js';
import { RUN_CATEGORIES, groupRounds } from './schedule.js';
import { filterEventIds } from './watch.js';

// --- A meet's day list (renderComp, docs/views.md) --------

// Lays out a meet's day list from its schedule and the stored view state. The
// day is `wantedDate` where the meet has it, and otherwise the first day from
// `today` on. `filter` is resolveFilter's answer, and `runOnly` is set by
// Juoksut mode's Ratalajit toggle (Track and Relay only). Returns null for a
// meet with no start at all.
function meetDay(schedule, { state, filter = null, wantedDate = null, today, runOnly = false }) {
  // byDate holds every day of the programme with a start. A filter narrows what
  // a day lists and never which day tabs exist, so a day of field events alone
  // keeps its tab under Ratalajit.
  const byDate = new Map();
  for (const d of scheduleDays(schedule)) {
    const groups = groupRounds(schedule[d]);
    if (groups.length) byDate.set(d, groups);
  }
  if (!byDate.size) return null;
  const dates = [...byDate.keys()];
  const date = byDate.has(wantedDate) ? wantedDate : defaultDay(dates, today);
  // The class and discipline filter offers chips only for rows Ratalajit
  // leaves, because a chip for a hidden row would filter nothing.
  const choices = meetFilterChoices(schedule, runOnly ? RUN_CATEGORIES : null);
  const pick = activeFilter(state, choices);
  const narrowed = pick.ages.length > 0 || pick.events.length > 0;
  // Ratalajit and the class filter regroup the day's rows, so a start's status
  // chip covers only the classes it lists.
  const groups =
    runOnly || narrowed
      ? groupRounds(filterRows(schedule[date], pick, schedule), runOnly ? RUN_CATEGORIES : null)
      : byDate.get(date);
  // Every multi-event sits above the day tabs, as one can span two days. The
  // class filter keeps the chosen classes' multi-events. A discipline chip or
  // Ratalajit drops them, since none is a discipline.
  const multiEvents =
    runOnly || pick.events.length
      ? []
      : combinedEventStarts(
          pick.ages.length
            ? Object.fromEntries(
                Object.entries(schedule).map(([d, rows]) => [d, filterRows(rows, { ages: pick.ages }, schedule)]),
              )
            : schedule,
        );
  // The filter's athletes and clubs resolve through the roster to EventIds. A
  // filter that did not resolve shows the plain day. A follow-list with nobody
  // entered here shows the whole day with a notice. The test is on EventIds,
  // as a followed club's relay team can hold none of its own athletes.
  const targets = filter?.targets || null;
  const eventIds = targets && filter?.roster ? filterEventIds(targets, filter.roster) : null;
  const filterActive = !!(eventIds && filter.entries.some((e) => e.enabled));
  const emptyHere = filterActive && filter.kind === 'watch' && eventIds.size === 0;
  return {
    dates,
    date,
    // The day's starts before any filter, which its confirmations count over.
    dayGroups: byDate.get(date),
    choices,
    pick,
    narrowed,
    groups,
    multiEvents,
    targets,
    eventIds,
    emptyHere,
    listFiltered: filterActive && !emptyHere,
  };
}

export { meetDay };
