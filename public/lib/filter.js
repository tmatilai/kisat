import { ageOrder } from './ages.js';
import { multiEventLeg } from './combined.js';
import { foldEvent } from './districts.js';
import { parseEventName, rowClassAge } from './schedule.js';

// --- The class and discipline filter (docs/views.md) --------

// Returns a row's discipline, reading a multi-event's leg as its discipline.
const rowDiscipline = (row) => multiEventLeg(row?.EventName)?.discipline ?? parseEventName(row?.EventName).event;

// Returns the whole meet's ages and disciplines, so the chips hold still from
// day to day. Ages go in class order, and disciplines go track, relay, field.
const DISCIPLINE_ORDER = ['Track', 'Relay', 'Field'];
function meetFilterChoices(schedule, category = null) {
  const rows = Object.values(schedule || {})
    .flat()
    .filter((r) => r && (!category || category.includes(r.Category)));
  const ages = rows.map((r) => rowClassAge(r, schedule)).filter((a) => a != null);
  const events = new Map();
  for (const r of rows) {
    const name = rowDiscipline(r);
    if (name && !events.has(foldEvent(name)))
      events.set(foldEvent(name), { name, rank: DISCIPLINE_ORDER.indexOf(r.Category) });
  }
  return {
    ages: [...new Set(ages)].sort((a, b) => ageOrder(a) - ageOrder(b)),
    events: [...events.values()]
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'fi', { numeric: true }))
      .map((e) => e.name),
  };
}

// Keeps only picks with a chip, as a pick with none cannot be unticked.
function activeFilter(pick, choices) {
  const folded = new Set((pick?.events || []).map(foldEvent));
  return {
    ages: choices.ages.filter((a) => (pick?.ages || []).includes(a)),
    events: choices.events.filter((e) => folded.has(foldEvent(e))),
  };
}

// Returns the rows a filter keeps. An empty list of ages or of disciplines
// keeps every row. It filters rows, not starts, so a start regroups over the
// classes shown (groupRounds).
function filterRows(rows, filter, schedule = null) {
  const ages = filter?.ages || [];
  const events = new Set((filter?.events || []).map(foldEvent));
  if (!ages.length && !events.size) return rows || [];
  return (rows || []).filter(
    (r) =>
      (!ages.length || ages.includes(rowClassAge(r, schedule))) &&
      (!events.size || events.has(foldEvent(rowDiscipline(r)))),
  );
}

// Returns a start's classes under the class filter, or all of them where it
// keeps none, so a start of other classes does not open on an empty page.
function filterCategories(detailed, ages, schedule = null) {
  const kept = (detailed || []).filter((d) => (ages || []).includes(rowClassAge(d.schedRound, schedule)));
  return kept.length ? kept : detailed || [];
}

export { activeFilter, filterCategories, filterRows, meetFilterChoices };
