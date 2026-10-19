import { cupBody, cupDetail } from './cup.js';
import { isFollowableOrgId } from './indexes.js';
import { meetMedalsBody } from './medals.js';
import { buildRoster, rosterPeople, scheduleEventIds } from './roster.js';
import { searchBody } from './search.js';

// --- A demo meet's /api bodies ------------------------------------------

// Returns the body for a demo meet's /api `url`, or null for any other url.
// app/data.js answers with it offline and worker.js serves it, merging a search
// with its indexes. `demo` is demo.js's DEMO_API.
function demoApiBody(url, demo) {
  if (url.startsWith('/api/search?')) {
    const params = new URLSearchParams(url.slice('/api/search?'.length));
    const scope = demoSearchScope(params.get('comp') || '', demo);
    return scope && searchBody(scope, [], null, params.get('q'));
  }
  const m = /^\/api\/(roster|meet|cup|medals)\/([^/?]+)$/.exec(url);
  if (!m || !demo.demoMeet(m[2])) return null;
  const [, route, compId] = m;
  const schedule = demo.demoSchedule(compId);
  const byId = demo.demoEvents(compId);
  const props = demo.demoResponse(`/competition/${compId}/properties`);
  // As in a real meet's fan-out (fetchEventResults, worker.js), only the
  // medals count the multi-events' roots.
  if (route === 'medals') {
    return meetMedalsBody(
      schedule,
      Object.entries(byId).map(([eventId, data]) => ({ eventId, data })),
      demo.DEMO_DISTRICTS,
      { name: props?.Competition?.Name, organiser: props?.Competition?.Organization },
    );
  }
  const events = scheduleEventIds(schedule).map((eventId) => ({ eventId, data: byId[eventId] }));
  if (route === 'roster') return buildRoster(events);
  return route === 'cup' ? cupDetail(props, schedule, events) : cupBody(props, schedule, events);
}

// Returns a demo meet's own rows for the picker, its clubs among them since no
// index holds them, or null for any other meet.
function demoSearchScope(compId, demo) {
  const roster = demoApiBody(`/api/roster/${compId}`, demo);
  return roster && { clubs: roster.organizations.filter((o) => isFollowableOrgId(o.id)), people: rosterPeople(roster) };
}

export { demoApiBody, demoSearchScope };
