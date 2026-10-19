// Holds the demo helpers that several test files share.
import {
  DEMO_CUP_EVENTS,
  DEMO_CUP_FINAL_EVENTS,
  DEMO_CUP_FINAL_ID,
  DEMO_CUP_ID,
  DEMO_EVENTS,
  demoSchedule,
} from '../public/demo.js';
import districts from '../public/data/districts.json' with { type: 'json' };
import { scheduleEventIds } from '../public/lib/roster.js';

// Gives the federation's piiris invented clubs in place of their own, for the
// cases whose measured meet names name a real piiri. A club is [name, short].
export const INVENTED_MEMBERS = {
  helsy: [
    ['Mittalan Veikot', 'MitVe'],
    ['Helsingin Mitta', 'HelMi'],
  ],
  uudy: [['Kaavakylän Kunto', 'KaavKu']],
  eky: [['Koejärven Urheilijat', 'KoejU']],
  lasy: [
    ['Aihiolan Riento', 'AihRi'],
    ['Lahden Aihio', 'LahAi'],
  ],
  hamsy: [['Arviolan Pyrkijät', 'ArvPy']],
  saty: [
    ['Luonnoslahden Voima', 'LuonVo'],
    ['Hahmolan Into', 'HahmIn'],
    ['Lapin Luonnos', 'LapLu'],
  ],
  varsy: [['Otantalan Jyske', 'OtanJy']],
  kesy: [['Otosmäen Isku', 'OtosI']],
  oid: [
    ['IF Prov', 'IFProv'],
    ['IK Mönster', 'IKMönst'],
  ],
};
export const inventedDistricts = {
  ...districts,
  outside: { clubs: [], names: [] },
  piirit: districts.piirit.map((p) => ({
    ...p,
    clubs: (INVENTED_MEMBERS[p.id] || []).map(([, short]) => short),
    names: (INVENTED_MEMBERS[p.id] || []).map(([name]) => name),
  })),
};

// Returns the events the Worker's roster fetch reads, one per scheduled id.
// The multi-events' roots are on no day's schedule (combinedEventStarts).
export const demoEventResults = () =>
  scheduleEventIds(demoSchedule()).map((eventId) => ({ eventId, data: DEMO_EVENTS[eventId] }));

// Returns the same for the club cup and for its final.
export const demoCupEventResults = () =>
  scheduleEventIds(demoSchedule(DEMO_CUP_ID)).map((eventId) => ({ eventId, data: DEMO_CUP_EVENTS[eventId] }));
export const demoCupFinalEventResults = () =>
  scheduleEventIds(demoSchedule(DEMO_CUP_FINAL_ID)).map((eventId) => ({
    eventId,
    data: DEMO_CUP_FINAL_EVENTS[eventId],
  }));
