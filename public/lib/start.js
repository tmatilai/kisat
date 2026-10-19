import { coversStart } from './districts.js';
import { shuttlePairDraw } from './hurdles.js';
import { isShuttleRelay, raceDistance } from './lap-counter.js';
import { scopeResults, scopeTablesAddNothing } from './medals.js';
import {
  heatWind,
  heatsAreShared,
  heatsInOrder,
  isFinalRound,
  mergeHeats,
  roundAllocated,
  sortResults,
  totalResults,
} from './results.js';
import { fieldMayChange, filedStart, hasEarlierRound, previousRound } from './schedule.js';

// --- A start's page (renderGroup, docs/views.md) --------

// Decides how a start's page lays out. `detailed` has one entry per class, as
// loadGroupDetail gives them. `standings` holds a leg's ottelu standings by
// class label, and `scopeChoice` the meet's scopes for Mitalit. `category`
// and `roundName` are the schedule group's. The stored result view picks among
// the views this offers (startPageView).
function startPageModel(
  detailed,
  { schedule, category = null, roundName = null, scopeChoice = null, standings = new Map() },
) {
  const roundNames = [...new Set(detailed.map((d) => d.round?.Name).filter(Boolean))];
  const singleCat = detailed.length === 1;
  const hasAnyResults = detailed.some((d) =>
    (d.round?.Heats || []).some((h) => (h.Allocations || []).some((a) => a.Result)),
  );
  // One control switches between Erät and Kokonaistulokset, and on a shared
  // start between Erät and Sarjat. A shared start always offers both, and any
  // other start the merged list once a round has several heats and a result.
  const merged = singleCat ? [] : mergeHeats(detailed);
  const shared = heatsAreShared(merged);
  const canCombine = shared || (hasAnyResults && detailed.some((d) => (d.round?.Heats?.length || 0) > 1));
  // Mitalit splits a covered final with a result by scope, where that adds
  // something to the round or to its ottelu standings.
  const splits = (round, start) =>
    !scopeTablesAddNothing(scopeResults(round, start, scopeChoice.districts, scopeChoice.scopes));
  const offerMedals =
    !!scopeChoice &&
    hasAnyResults &&
    detailed.some((d) => {
      const start = filedStart(d.schedRound, schedule);
      const st = standings.get(d.label);
      return (
        isFinalRound(d.data?.Rounds, d.round) &&
        scopeChoice.scopes.some((t) => coversStart(t.cover, start)) &&
        (splits(d.round, start) || (!!st?.start && splits(st.round, st.start)))
      );
    });
  const shuttle = detailed.some((d) => isShuttleRelay(d.data?.EventType, d.data?.Name));
  // A relay's EventType.Length is one leg (raceDistance). An undrawn round can
  // carry an empty heat shell, and the lap counter would open on no tiles.
  const raceLength = Math.max(0, ...detailed.map((d) => raceDistance(d.data?.EventType, d.data?.Name)));
  const runs = category === 'Track' || category === 'Relay';
  return {
    singleCat,
    // A round every class shares is named once, in the title.
    sharedRound: roundNames.length > 1 ? null : roundNames[0] || roundName,
    hasAnyResults,
    merged,
    shared,
    canCombine,
    offerMedals,
    // A multi-event leg awards no medal. Its Mitalit button is named for the
    // scopes, and a start never opens on it.
    leg: detailed.some((d) => d.data?.RootId),
    // An aitaviesti team runs in a pair of lanes, named where the draw allows.
    shuttleLanes: shuttle && shuttlePairDraw(detailed.map((d) => d.round)),
    laps: runs && raceLength > 0 && detailed.some((d) => roundAllocated(d.round)) ? { raceLength, shuttle } : null,
  };
}

// Gives the flags a start's page draws by, once `view` (heats, total or
// medals) is picked among those the model offers. A shared start's Erät view
// draws a table per physical heat, and its class badges are plain text.
function startPageView(model, view) {
  const byScope = model.offerMedals && view === 'medals';
  const combined = model.canCombine && view === 'total';
  return {
    byScope,
    combined,
    heatTables: model.shared && !combined && !byScope,
    badgeToggles: !model.shared || combined || byScope,
  };
}

// Gives the tables a class's drawn round shows: one per heat, one per scope
// under Mitalit, or the merged round (docs/views.md). A round of one heat is
// not merged, so no name is tagged "Erä 1". `start` is the class's filed
// schedule row, which Mitalit reads.
function roundTables(round, { byScope = false, combined = false, eventType = null, start = null, scopeChoice = null }) {
  const heats = heatsInOrder(round);
  if (byScope) {
    return scopeResults(round, start, scopeChoice.districts, scopeChoice.scopes).map((t) => ({
      heading: t.scope?.short || 'Muut',
      grouping: true,
      allocs: t.allocs,
    }));
  }
  if (combined) {
    return [{ allocs: heats.length > 1 ? totalResults(round) : sortResults(heats[0]?.Allocations || []) }];
  }
  return heats.map((h) => ({
    heading: heats.length > 1 ? `Erä ${h.Index}` : null,
    wind: heatWind(h, eventType),
    allocs: sortResults(h.Allocations || []),
  }));
}

// Says what an undrawn round's list waits on (docs/views.md). `field` is the
// earlier round's qualifiers (previousRoundField), or null where the list is
// the event's entries. `previous` is the round to link while it is unfinished.
function undrawnNotice(rounds, round, field) {
  if (!field) return hasEarlierRound(rounds, round) ? { text: 'Edellinen vaihe kilpailematta.', previous: null } : null;
  const prev = previousRound(rounds, round);
  if (prev.Status !== 'Official') return { text: 'Edellinen vaihe kesken.', previous: prev };
  return fieldMayChange(rounds, round) ? { text: 'Edellinen vaihe kilpailematta.', previous: null } : null;
}

export { roundTables, startPageModel, startPageView, undrawnNotice };
