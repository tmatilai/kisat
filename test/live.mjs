// Tests public/lib/ against the live API. It reads a competition's schedule and
// results, and checks that the data still has the shape public/lib/ assumes.
//   node test/live.mjs [compId]   # 20224 by default, Nuorten SM-kilpailut
//                                 # M/N16-17 (Track, Field and Relay)
import assert from 'node:assert/strict';
import { dateSortKey } from '../public/lib/dates.js';
import {
  attemptColumns,
  displayRank,
  relayInfo,
  sortResults,
  totalResults,
  verticalJumpHeights,
} from '../public/lib/results.js';
import { relayTeams } from '../public/lib/roster.js';
import { API, groupRounds } from '../public/lib/schedule.js';

const compId = process.argv[2] || '20224';
console.log(`--- live checks against competition ${compId} ---`);

const scheduleRes = await fetch(`${API}/competition/${compId}`);
assert.equal(scheduleRes.ok, true, `schedule fetch for ${compId}`);
const schedule = await scheduleRes.json();
const days = Object.keys(schedule).sort((a, b) => dateSortKey(a) - dateSortKey(b));
assert.ok(days.length > 0, 'at least one day');

let checkedField = 0;
let checkedVertical = 0;
let checkedMultiHeat = 0;
let checkedRankPair = 0;
let checkedTeams = 0;
for (const day of days) {
  const groups = groupRounds(schedule[day]);
  for (const g of groups.slice(0, 12)) {
    for (const e of g.entries) {
      const res = await fetch(`${API}/results/${compId}/${e.round.EventId}`);
      if (!res.ok) continue;
      const data = await res.json();
      // Every relay entry makes a team with a club id and a name, which the
      // front page's relay lines need (relayTeams, buildDigest).
      if (relayInfo(data).relay) {
        const teams = relayTeams([{ eventId: e.round.EventId, data }]);
        assert.equal(
          teams.length,
          (data.Enrollments || []).length,
          `${data.Name}: a relay entry that produced no team row`,
        );
        for (const t of teams) {
          assert.notEqual(t.organizationId, null, `${data.Name}: a relay team belonging to no club`);
          assert.ok(t.name, `${data.Name}: club ${t.organizationId} has no name at all`);
          checkedTeams += 1;
        }
      }

      const round = (data.Rounds || []).find((r) => r.Id === e.round.Id);
      if (!round) continue;
      // ResultRank is round-wide (docs/tuloslista-api.md), so a shared rank
      // in a multi-heat round shares its mark.
      if ((round.Heats || []).length > 1) {
        const byRank = new Map();
        for (const a of totalResults(round)) {
          if (a.ResultRank == null || a.NotInCompetition) continue;
          const seen = byRank.get(a.ResultRank);
          assert.ok(
            seen === undefined || seen === a.Result,
            `${data.Name} ${round.Name}: rank ${a.ResultRank} on both ${seen} and ${a.Result}` +
              ' — ResultRank would have to be per-heat for that',
          );
          byRank.set(a.ResultRank, a.Result);
        }
        if (byRank.size) checkedMultiHeat += 1;
      }
      for (const h of round.Heats || []) {
        const allocs = sortResults(h.Allocations || []);
        // A ranked row has a HeatRank for displayRank to print. A single-heat
        // round's HeatRank is its ResultRank (docs/tuloslista-api.md).
        for (const a of allocs) {
          if (a.ResultRank == null) continue;
          checkedRankPair += 1;
          assert.notEqual(a.HeatRank, null, `${data.Name} ${round.Name}: ranked ${a.Name} has no HeatRank`);
          if ((round.Heats || []).length === 1) {
            assert.equal(
              displayRank(a),
              a.ResultRank,
              `${data.Name} ${round.Name}: single-heat row ${a.Name} would change place`,
            );
          }
        }
        // Nothing here may throw, and the column and height counts are sane.
        if (data.EventCategory === 'Field') {
          if (data.EventSubCategory === 'VerticalJump') {
            const heights = verticalJumpHeights(allocs);
            assert.ok(heights.every((x) => Number.isFinite(x)));
            checkedVertical += 1;
          } else {
            const cols = attemptColumns(allocs);
            assert.ok(cols >= 0);
            checkedField += 1;
          }
        }
      }
    }
  }
}
console.log(`field events checked: ${checkedField} throw/jump, ${checkedVertical} vertical — ok`);
console.log(`multi-heat rounds checked for round-wide ResultRank: ${checkedMultiHeat} — ok`);
console.log(`ranked rows checked for a HeatRank to print: ${checkedRankPair} — ok`);
console.log(`relay entries checked for a named club: ${checkedTeams} — ok`);
