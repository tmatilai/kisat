import { MASTERS_MIN_AGE, ageOrder, startAge } from './ages.js';
import { multiEventLeg } from './combined.js';
import { followedKey } from './results.js';
import { classlessStart, filedStart, parseEventName, rowClassAge } from './schedule.js';

// --- Piirit: a club's district, from districts.json ---
// The API says nothing about piiris (docs/tuloslista-api.md), so the file
// lists the piiris' clubs by NameShort, and by Name where known
// (docs/districts.md).

// Keys a club name for comparing. Case, spacing, punctuation and a trailing
// "ry" or "rf" drop out, since a hand-made record writes them its own way.
function clubNameKey(name) {
  return String(name ?? '')
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+(?:ry|r\.y\.|rf|r\.f\.)$/u, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// Says whether a row's club is the scope's, by its abbreviation exactly or by
// its name, which a second record of the club made by hand still carries.
const scopeNameKeys = new WeakMap();
function inScope(scope, org) {
  if (!scope || !org) return false;
  if (scope.clubs.includes(org.NameShort)) return true;
  if (!scopeNameKeys.has(scope)) scopeNameKeys.set(scope, new Set((scope.names || []).map(clubNameKey)));
  const key = clubNameKey(org.Name);
  return key !== '' && scopeNameKeys.get(scope).has(key);
}

// Proof-reads districts.json. It returns a line per problem, or [] if none.
function districtProblems(d) {
  if (!Array.isArray(d?.alueet) || !d.alueet.length) return ['alueet: not a list'];
  if (!Array.isArray(d?.piirit) || !d.piirit.length) return ['piirit: not a list'];
  const problems = [];
  const alueIds = new Set();
  for (const a of d.alueet) {
    const label = typeof a?.id === 'string' && a.id ? a.id : '?';
    if (label === '?') problems.push('an alue with no id');
    else if (label === NATIONAL_SCOPE_ID) problems.push(`${label}: the country's id`);
    else if (alueIds.has(label)) problems.push(`${label}: id twice`);
    alueIds.add(label);
    // A meet's name inflects the alue ("Eteläisen alueen"), so defaultScopes
    // matches it by the stem before "nen".
    if (typeof a?.name !== 'string' || !a.name.endsWith('nen'))
      problems.push(`${label}: name ${JSON.stringify(a?.name ?? null)} does not end in "nen"`);
  }
  const ids = new Set();
  const seen = { club: new Map(), name: new Map() };
  const listed = (label, what, list, keyOf) => {
    for (const c of list) {
      if (typeof c !== 'string' || !c || c !== c.trim() || !keyOf(c)) {
        problems.push(`${label}: ${what} ${JSON.stringify(c)}`);
        continue;
      }
      const prev = seen[what].get(keyOf(c));
      if (prev === label) problems.push(`${label}: ${c} twice`);
      else if (prev) problems.push(`${c}: in ${prev} and ${label}`);
      seen[what].set(keyOf(c), label);
    }
  };
  for (const p of d.piirit) {
    const label = typeof p?.id === 'string' && p.id ? p.id : '?';
    if (label === '?') problems.push('a piiri with no id');
    else if (label === NATIONAL_SCOPE_ID) problems.push(`${label}: the country's id`);
    else if (ids.has(label)) problems.push(`${label}: id twice`);
    else if (alueIds.has(label)) problems.push(`${label}: an alue's id and a piiri's`);
    ids.add(label);
    for (const k of ['name', 'short']) if (typeof p?.[k] !== 'string' || !p[k]) problems.push(`${label}: no ${k}`);
    if (!alueIds.has(p?.alue)) problems.push(`${label}: alue ${JSON.stringify(p?.alue ?? null)} is not in alueet`);
    if (!Array.isArray(p?.clubs) || !p.clubs.length) {
      problems.push(`${label}: no clubs`);
      continue;
    }
    if (p.names !== undefined && !Array.isArray(p.names)) problems.push(`${label}: names not a list`);
    listed(label, 'club', p.clubs, (c) => c);
    listed(label, 'name', Array.isArray(p.names) ? p.names : [], clubNameKey);
  }
  // A club in `outside` is in no piiri, and the unknown line leaves it out.
  if (d.outside !== undefined) {
    const list = (k) =>
      Array.isArray(d.outside?.[k]) ? d.outside[k] : (problems.push(`outside: ${k} not a list`), []);
    listed('outside', 'club', list('clubs'), (c) => c);
    listed('outside', 'name', list('names'), clubNameKey);
  }
  return problems;
}

// --- Scopes: the country, the alueet and the piirit ---

// Returns every scope a medal is ranked within as {id, kind, name, short,
// clubs, names}. The country comes first and holds every piiri's clubs. The
// alueet follow, each over its piiris', and then the piiris, in file order.
const NATIONAL_SCOPE_ID = 'sm';
const districtScopes = new WeakMap();
function meetScopes(districts) {
  if (!districts || typeof districts !== 'object') return [];
  if (!districtScopes.has(districts)) {
    const piirit = districts.piirit || [];
    const over = (own) => ({ clubs: own.flatMap((p) => p.clubs || []), names: own.flatMap((p) => p.names || []) });
    const alueet = (districts.alueet || []).map((a) => ({
      id: a.id,
      kind: 'alue',
      name: a.name,
      short: `${a.name} alue`,
      ...over(piirit.filter((p) => p.alue === a.id)),
    }));
    const national = piirit.length
      ? [{ id: NATIONAL_SCOPE_ID, kind: 'maa', name: 'Suomenmestaruus', short: 'SM', ...over(piirit) }]
      : [];
    districtScopes.set(districts, [
      ...national,
      ...alueet,
      ...piirit.map((p) => ({
        id: p.id,
        kind: 'piiri',
        name: p.name,
        short: p.short,
        clubs: p.clubs || [],
        names: p.names || [],
      })),
    ]);
  }
  return districtScopes.get(districts);
}

// Returns the scope of `ticked` ([{id, cover}]) a row is ranked within, or
// null. It is the first in meetScopes' order whose cover holds the start and
// that holds the club, so an alue's cover leaves the rest to its piiri.
function scopeFor(districts, ticked, org, start) {
  const covers = new Map((ticked || []).map((t) => [t.id, t.cover ?? null]));
  return (
    meetScopes(districts).find((s) => covers.has(s.id) && coversStart(covers.get(s.id), start) && inScope(s, org)) ||
    null
  );
}

// Returns the `scopeOf` a ranking reads, a row's scope for a start (scopeFor).
function medalScope(districts, ticked) {
  return (org, start) => scopeFor(districts, ticked, org, start);
}

// Labels a split's segment that hands out no medal, such as a multi-event's
// leg. One ticked scope covering the start gives its short name, alueet alone
// give `Alueittain`, and any other mix gives `Piireittäin`.
function scopeSplitLabel(districts, ticked, start) {
  const covers = new Map((ticked || []).map((t) => [t.id, t.cover ?? null]));
  const on = meetScopes(districts).filter((s) => covers.has(s.id) && coversStart(covers.get(s.id), start));
  if (on.length === 1) return on[0].short;
  return on.length && on.every((s) => s.kind === 'alue') ? 'Alueittain' : 'Piireittäin';
}

// Returns the scopes in force, the chosen ones or with `scopes` null the
// defaults. A chosen scope with no cover takes its default's or the whole meet.
function tickedScopes(scopes, defaults) {
  return scopes
    ? scopes.map((s) => (s.cover ? s : ((defaults || []).find((d) => d.id === s.id) ?? { id: s.id, cover: null })))
    : defaults || [];
}

// Returns the scopes as [{alue, piirit}], the country first with none under it
// and then each alue with its piirit, by name in Finnish order. Given `ids`, an
// alue stays while it or one of its piirit is in them.
function scopeTree(districts, ids = null) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'fi');
  const scopes = meetScopes(districts).filter((s) => !ids || ids.includes(s.id));
  const alueOf = (s) => districts.piirit.find((p) => p.id === s.id)?.alue;
  return meetScopes(districts)
    .filter((s) => s.kind === 'maa' || s.kind === 'alue')
    .sort((a, b) => (b.kind === 'maa') - (a.kind === 'maa') || byName(a, b))
    .map((alue) => ({
      alue,
      piirit: scopes.filter((s) => s.kind === 'piiri' && alueOf(s) === alue.id).sort(byName),
    }))
    .filter((t) => scopes.includes(t.alue) || t.piirit.length);
}

// --- Covers: the starts a championship holds ---

// Places a start on a picked club's lines under `cover`, or returns null.
// `counted` says the tables count it. A relay filedStart moved also shows,
// uncounted, where the meet runs a ticked class, and `only` is its class.
function startLine(cover, start, starts) {
  const moved = classlessStart(start) && rowClassAge(start) > 0;
  const only = cover?.ages && moved ? rowClassAge(start) : null;
  if (coversStart(cover, start)) return { counted: true, only };
  if (!only || cover.events) return null;
  const runs = (starts || []).some(
    (s) => !classlessStart(s) && cover.ages.includes(rowClassAge(s)) && rowClassAge(s) < MASTERS_MIN_AGE,
  );
  return runs ? { counted: false, only } : null;
}

// A cover names the starts a championship holds, and null holds all. Its ages
// are classes (rowClassAge), 0 the adults. Its events compare folded, a leg as
// its ottelu, and a family word with no digit holds the family. Either list is
// null for any.
const EVENT_FAMILY = ['kävely', 'viesti', 'ottelu'];
const foldEvent = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/gu, '');
function coversStart(cover, start) {
  if (!cover) return true;
  // A stored cover or chip can name a masters' row by its filed Age 30 and not
  // by its class. This shim is temporary (docs/shims.md).
  const filed = startAge(start) === MASTERS_MIN_AGE && cover.ages?.includes(MASTERS_MIN_AGE);
  if (cover.ages && !cover.ages.includes(rowClassAge(start)) && !filed) return false;
  const event = multiEventLeg(start?.EventName)?.kind ?? parseEventName(start?.EventName).event;
  return !cover.events || coversEvent(cover.events, event);
}
function coversEvent(words, name) {
  const event = foldEvent(name);
  return words.some((w) => {
    const word = foldEvent(w);
    return word === event || (!/\d/.test(word) && EVENT_FAMILY.some((k) => word.includes(k) && event.includes(k)));
  });
}

// Returns the choices a cover is picked from (openCoverSheet). The ages go in
// class order, and each event keeps its first spelling. A multi-event's leg
// counts as its ottelu, which its medals are filed under.
function meetCoverChoices(schedule) {
  const rows = Object.values(schedule || {}).flat();
  const ages = rows.map((r) => rowClassAge(r, schedule)).filter((a) => a != null);
  const events = new Map();
  for (const e of rows.map((r) => multiEventLeg(r?.EventName)?.kind ?? parseEventName(r?.EventName).event))
    if (e && !events.has(foldEvent(e))) events.set(foldEvent(e), e);
  return { ages: [...new Set(ages)].sort((a, b) => ageOrder(a) - ageOrder(b)), events: [...events.values()] };
}

// coverTicks ticks the choices a cover holds, and all where it names none.
// coverOfTicks stores a list ticked whole as null, so a new start is held too.
function coverTicks(cover, choices) {
  return {
    ages: choices.ages.filter((a) => !cover?.ages || cover.ages.includes(a)),
    events: choices.events.filter((e) => !cover?.events || coversEvent(cover.events, e)),
  };
}
function coverOfTicks(ticks, choices) {
  const part = (on, all) => (on.length === all.length ? null : all.filter((x) => on.includes(x)));
  return { ages: part(ticks.ages, choices.ages), events: part(ticks.events, choices.events) };
}

// Puts a cover in words. Its ages read as ranges with the adult class, and its
// events by name or as a count past four. With neither it is "kaikki lajit".
function coverWords(cover) {
  if (!cover || (!cover.ages && !cover.events)) return 'kaikki lajit';
  const runs = [];
  for (const a of [...new Set(cover.ages || [])].sort((a, b) => ageOrder(a) - ageOrder(b))) {
    const last = runs[runs.length - 1];
    if (a !== 0 && last && last[1] === a - 1) last[1] = a;
    else runs.push([a, a]);
  }
  const ages = runs
    .filter(([a]) => a !== 0)
    .map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`))
    .join(', ');
  return [
    cover.ages &&
      ([ages && `${ages} v.`, cover.ages.includes(0) && 'yleinen'].filter(Boolean).join(', ') || 'ei sarjoja'),
    cover.events && (cover.events.length > 4 ? `${cover.events.length} lajia` : cover.events.join(', ') || 'ei lajeja'),
  ]
    .filter(Boolean)
    .join(' · ');
}

// --- A meet's championships, from its name and entries ---

// A meet name's pm and am words, each read in place by nameCover. The am word
// takes in "Pohjois-Suomen mestaruus" and "PSM" too.
const PM_WORD_RE = /\bpm\b|piirin?mestaruus?|\bdm\b|distriktsm/iu;
const AM_WORD_RE = /\bam\b|alue(?:en)?\s*mestaruus?|pohjois[- ]suomen\s+mestaruus?|\bpsm\b/iu;
// The SM word takes in SAUL's masters' SM. The SMs of school sports, para
// athletics and superpainonheitto are not official SMs (test/districts.test.mjs).
const SM_WORD_RE = /\bsm\b/iu;
const NO_SM_RE = /\btul\b|piiriottelu|seuracup|föreningscup|koululiikunta|\bpara(?:yleisurheil|\b)|superpainonheit/iu;
// An adults' SM here carries its entries alone (docs/elsewhere.md). One naming
// no class needs a youth, masters or walk word, or a row in elsewhere.json.
const SM_RESULTS_RE = /nuorten|\bsaul|kävely/iu;
// The long throws' winter championship is on the rules' list of SMs. Its name
// says the throw and the season where every other says SM. Its
// results are here, so it needs no word of SM_RESULTS_RE.
const THROW_SM_RE = /(?:kiekon|moukarin|keihään)(?:heiton)?\s+(?:talvi|kevät)mestaruus/iu;
// A SAUL SM is its masters' classes, and an adult start is none.
const SAUL_RE = /\bsaul/iu;
const MASTERS_AGES = Array.from({ length: 71 }, (_, i) => MASTERS_MIN_AGE + i);
// TUL's, SAUL's, the aikuisurheilijat's and the veterans' championships are
// no SUL scope's. A piiriottelu and a Seuracup meet are no championship.
const NO_SCOPE_RE = /\btul\b|\bsaul\b|aikuisurheil|veteraan|piiriottelu|seuracup|föreningscup/iu;
// A junnu word marks a piiri's youth meet, whose medals go to its own kids
// whatever "avoimet" says. An open meet without it gives them to all.
const JUNNU_RE = /junnu/iu;

// A name writes a class range as "14-15v", "14,15,17,19" and a "v.", "9-15-v",
// "12-13-sarjojen", "T/P13", "M/N17", "M/N15-14", "M/N17-19-22" or "14-15 år".
// "M/N" and "aikuiset" are the adult class, and "ja", "&" or a comma joins two.
const CLASS_ITEM_RE =
  /^(?:(?:[mnpt](?:\/[mnpt])?)?\d{1,2}(?:[-–]\d{1,2})*(?:,\d{1,2}(?:[-–]\d{1,2})?)*(?:-?v\.?|-?sarjo(?:jen|t))?|[mnpt]\/[mnpt]|aikuiset|yleinen|v\.?|år)$/iu;
const CLASS_JOIN_RE = /^(?:ja|,|&)$/iu;
// A run is classes only when a class letter, a range, "v" or "sarjojen" in it
// says so. So "osa 3" names no class.
const CLASS_MARK_RE = /[mnptv]|sarjo|aikuiset|yleinen|\d[-–]\d/iu;
// Such a word names the meet and no event ("pm-kilpailut", 19166's maastot).
const MEET_WORD_RE = /kilpailu|kisa|huipentum|halli|junnu|maasto|maantiejuoksu/iu;

// Returns the ages a class item names, with 0 for the adult class. A chain of
// three is three classes and no range (18266, 20363).
function classItemAges(item) {
  if (/^(?:[mnpt]\/[mnpt]|aikuiset|yleinen)$/iu.test(item)) return [0];
  if (/\d[-–]\d{1,2}[-–]\d/u.test(item)) return [...item.matchAll(/\d{1,2}/gu)].map((m) => Number(m[0]));
  const ages = [];
  for (const m of item.matchAll(/(\d{1,2})(?:[-–](\d{1,2}))?/gu)) {
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    for (let x = Math.min(a, b); x <= Math.max(a, b); x++) ages.push(x);
  }
  return ages;
}

// Splits a name into {text, start} tokens. A comma is a token of its own unless
// it has no space on either side, as in "14,15,17,19".
function nameTokens(text) {
  return [...text.matchAll(/[^\s,]+(?:,[^\s,]+)*|,/gu)].map((m) => ({ text: m[0], start: m.index }));
}

// Returns the ages a run of class items names, with `start` and `end` in the
// text, or null where nothing says class. A part number before the first item
// (16957) and a "T/P" before a number (20054) name no class.
function runAges(run) {
  while (run.length && CLASS_JOIN_RE.test(run[0].text)) run.shift();
  while (run.length && CLASS_JOIN_RE.test(run[run.length - 1].text)) run.pop();
  if (run.length > 1 && /^\d{1,2}$/u.test(run[0].text) && !CLASS_JOIN_RE.test(run[1].text)) run.shift();
  if (!run.length || !CLASS_MARK_RE.test(run.map((t) => t.text).join(' '))) return null;
  const ages = run.flatMap((t, i) =>
    /^[mnpt]\/[mnpt]$/iu.test(t.text) && /^\d/u.test(run[i + 1]?.text ?? '') ? [] : classItemAges(t.text),
  );
  return { ages, start: run[0].start, end: run[run.length - 1].start + run[run.length - 1].text.length };
}

const isClassToken = (t) => CLASS_ITEM_RE.test(t.text) || CLASS_JOIN_RE.test(t.text);

// Returns the class run `tokens` end with. leadingClassRun returns the first.
function classRun(tokens) {
  const run = [];
  for (let i = tokens.length - 1; i >= 0 && isClassToken(tokens[i]); i--) run.unshift(tokens[i]);
  return runAges(run);
}
// A roman part number before it is no class, as a digit is (20828).
function leadingClassRun(tokens) {
  const run = [];
  const from = /^(?:i{1,3}|iv)$/iu.test(tokens[0]?.text ?? '') && CLASS_ITEM_RE.test(tokens[1]?.text ?? '') ? 1 : 0;
  for (let i = from; i < tokens.length && isClassToken(tokens[i]); i++) run.push(tokens[i]);
  return runAges(run);
}

// Returns the {ages, events} a word binds, null where none. Ages are class runs
// ending at it or starting after it (18897). Events compound in or follow it
// to a comma, not past a meet word. A bracket or the next word's run ends both.
function wordBindings(text, [start, end], words) {
  const ages = [];
  const events = [];
  const before = classRun(nameTokens(text.slice(0, start)));
  if (before) ages.push(...before.ages);
  const suffix = /^-?(\p{L}+)/u.exec(text.slice(end));
  const meetWord = Boolean(suffix && MEET_WORD_RE.test(suffix[1]));
  if (suffix && !meetWord) events.push(suffix[1].toLowerCase());
  let limit = text.length;
  for (const w of words) {
    if (w[0] <= start) continue;
    limit = Math.min(limit, classRun(nameTokens(text.slice(0, w[0])))?.start ?? w[0]);
  }
  const rest = text.slice(end + (suffix?.[0].length ?? 0), limit).split(/[()]/u)[0];
  const lead = leadingClassRun(nameTokens(rest));
  if (lead) ages.push(...lead.ages);
  for (const part of rest.slice(lead?.end ?? 0).split(/\s+ja\s+|\s*&\s*/iu)) {
    const item = part.trim();
    if (/^\d[\d\s]*(?:m|km)$/iu.test(item)) {
      events.push(item.replace(/\s+/gu, ''));
      continue;
    }
    if (/^\p{L}[\p{L}-]*$/u.test(item) && !MEET_WORD_RE.test(item) && !meetWord) {
      events.push(item.toLowerCase());
      continue;
    }
    break;
  }
  return { ages: ages.length ? [...new Set(ages)] : null, events: events.length ? events : null };
}

// Returns the cover a word (`re`) gives, as the union of what the name binds to
// each of its occurrences. It is null where the word is absent or one
// occurrence binds nothing.
function nameCover(text, re) {
  const own = [...text.matchAll(new RegExp(re.source, 'giu'))].map((m) => [m.index, m.index + m[0].length]);
  if (!own.length) return null;
  const words = [
    ...own,
    ...[...text.matchAll(new RegExp(`${PM_WORD_RE.source}|${AM_WORD_RE.source}|${SM_WORD_RE.source}`, 'giu'))].map(
      (m) => [m.index, m.index + m[0].length],
    ),
  ].sort((a, b) => a[0] - b[0]);
  const bound = own.map((w) => wordBindings(text, w, words));
  if (bound.some((b) => !b.ages && !b.events)) return null;
  const union = (key) => (bound.some((b) => !b[key]) ? null : [...new Set(bound.flatMap((b) => b[key]))]);
  return { ages: union('ages')?.sort((a, b) => ageOrder(a) - ageOrder(b)) ?? null, events: union('events') };
}

// An alue takes these ages where both words stand and the name gives none. They
// are the youth classes from 14 to 22 (categoryParts) and the adult class.
const ALUE_AGES = [...Array.from({ length: 9 }, (_, i) => 14 + i), 0];

// Returns the scopes a meet is the championship of as [{id, cover}] in
// meetScopes' order, from its name and organiser (docs/views.md). `closed` gives
// a piiri's closed pair, and a `listed` meet is an SM whatever its name.
function defaultScopes(name, organiser, districts, shortOf, closed = null, listed = false) {
  const piirit = districts?.piirit || [];
  const text = String(name ?? '');
  const named = namedPiirit(text, piirit);
  const home = organiserPiiri(organiser, piirit, shortOf);
  const none = NO_SCOPE_RE.test(text);
  const pm = PM_WORD_RE.test(text) && !none;
  const am = AM_WORD_RE.test(text) && !none;
  const junnu = JUNNU_RE.test(text) && !none && (named.length === 1 || home?.own);
  let piiriIds = [];
  if (named.length >= 2 && !am && !none) piiriIds = named;
  else if (pm || (junnu && !am))
    piiriIds = piirit.map((p) => p.id).filter((id) => named.includes(id) || id === home?.id);
  const piiriCover = pm ? nameCover(text, PM_WORD_RE) : null;
  const pair = piiriIds.length ? closed?.(piiriCover) : null;
  if (pair?.some((id) => piiriIds.includes(id)))
    piiriIds = piirit.map((p) => p.id).filter((id) => piiriIds.includes(id) || pair.includes(id));
  const scopes = [];
  if (am) {
    // An alue matches by the stem before "nen" in any case, as in "Eteläisen
    // alueen" or "Pohjois-Suomen", and PSM reads as the name it shortens.
    const stemText = text.replace(/\bpsm\b/iu, 'Pohjois-Suomen');
    const alue =
      (districts?.alueet || []).find((a) =>
        new RegExp(`(?<!\\p{L})${a.name.slice(0, -3)}(?:nen|se\\p{L}*|s[- ]suomen)(?!\\p{L})`, 'iu').test(stemText),
      )?.id ??
      home?.alue ??
      null;
    const cover = nameCover(text, AM_WORD_RE);
    if (alue)
      scopes.push({ id: alue, cover: pm && !cover?.ages ? { ages: ALUE_AGES, events: cover?.events ?? null } : cover });
  }
  // The country takes the classes alone, as an SM is the championship whole.
  // An event word such as "SM-maantiekymppi" spells a distance its own way.
  const smAges = SM_WORD_RE.test(text) && !NO_SM_RE.test(text) ? nameCover(text, SM_WORD_RE)?.ages : null;
  const smNamed = SM_WORD_RE.test(text) && !NO_SM_RE.test(text) && Boolean(smAges || SM_RESULTS_RE.test(text));
  const sm = piirit.length > 0 && (listed || smNamed || THROW_SM_RE.test(text));
  const nationalAges = smAges ?? (SAUL_RE.test(text) ? MASTERS_AGES : null);
  const national = sm
    ? [{ id: NATIONAL_SCOPE_ID, cover: nationalAges ? { ages: nationalAges, events: null } : null }]
    : [];
  return [...national, ...scopes, ...piiriIds.map((id) => ({ id, cover: piiriCover }))];
}

// Returns the piiris a name carries, by short name or by the first word of the
// piiri's name, which is its region's genitive (18044). A region word that goes
// on into a club's name, as "Lapin Luonnoksen" does, is the club's (regionClub).
function namedPiirit(text, piirit) {
  const s = String(text ?? '');
  const bound = (re) => `(?<![\\p{L}\\p{N}])${re}(?![\\p{L}\\p{N}])`;
  return piirit
    .filter((p) => {
      const short = `${p.short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?::?(?:n|in))?`;
      if (new RegExp(bound(short), 'iu').test(s)) return true;
      const region = p.name.split(' ')[0];
      return [...s.matchAll(new RegExp(`${bound(region)}\\s*([\\p{L}-]*)`, 'giu'))].some(
        (m) => !regionClub(piirit, region, m[1]),
      );
    })
    .map((p) => p.id);
}

// Says whether a region word and the word after it open a club's name in the
// piiris' `names`. The second word is compared by its stem, as a meet's name
// inflects it ("Veikot", "Veikkojen").
const regionClubs = new WeakMap();
function regionClub(piirit, region, next) {
  if (!regionClubs.has(piirit)) {
    const byRegion = new Map();
    for (const name of piirit.flatMap((p) => p.names || [])) {
      const [first, second] = name.normalize('NFC').toLowerCase().split(/\s+/u);
      if (second) byRegion.set(first, [...(byRegion.get(first) || []), second]);
    }
    regionClubs.set(piirit, byRegion);
  }
  const word = next.normalize('NFC').toLowerCase();
  return (regionClubs.get(piirit).get(region.toLowerCase()) || []).some((club) => {
    let n = 0;
    while (n < word.length && word[n] === club[n]) n++;
    return n >= Math.max(3, Math.min(word.length, club.length) - 2);
  });
}

// Returns the organiser's piiri and alue. It is the piiri itself (`own`), or a
// club's by name or by abbreviation (`shortOf`). Several organisers joined by
// "ja", "/", "&" or a comma agree on each or give it null.
function organiserPiiri(organiser, piirit, shortOf) {
  const found = [];
  for (const part of String(organiser ?? '')
    .split(/\s+ja\s+|\s*[/&,]\s*/iu)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const own = piirit.find((p) => clubNameKey(p.name) === clubNameKey(part));
    const short = own ? null : shortOf?.(part);
    const piiri = own || piirit.find((p) => inScope(p, { Name: part, NameShort: short }));
    if (!piiri) continue;
    found.push({ id: piiri.id, own: Boolean(own), alue: piiri.alue ?? null });
  }
  if (!found.length) return null;
  const agreed = (key) => (found.every((f) => f[key] === found[0][key]) ? found[0][key] : null);
  return { id: agreed('id'), own: found.every((f) => f.own), alue: agreed('alue') };
}

// Counts the people entered per piiri over the starts `cover` holds, largest
// first, with a club in no piiri under null. A person counts once and a team
// as its club (followedKey).
function piiriEntries(schedule, eventResults, districts, cover = null) {
  const byEvent = new Map((eventResults || []).map(({ eventId, data }) => [String(eventId), data]));
  const held = Object.values(schedule || {})
    .flat()
    .filter((sr) => coversStart(cover, { EventName: sr.EventName, Age: filedStart(sr, schedule).Age }));
  const entered = new Map();
  for (const eventId of new Set(held.map((sr) => String(sr.EventId)))) {
    for (const enr of byEvent.get(eventId)?.Enrollments || []) {
      const key = followedKey(enr);
      if (!entered.has(key))
        entered.set(key, (districts?.piirit || []).find((p) => inScope(p, enr.Organization))?.id ?? null);
    }
  }
  const counts = new Map();
  for (const id of entered.values()) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

// Returns the two piiris a meet's entries (piiriEntries) are closed to, else
// null. It bounds the second's share and head count and the entries from
// outside (test/districts.test.mjs). A looser bound joins a neighbour to an open meet.
const CLOSED_PAIR = { share: 0.12, people: 5, outside: 0.05 };
function closedPair(entries) {
  const total = (entries || []).reduce((n, [, count]) => n + count, 0);
  const [first, second] = (entries || []).filter(([id]) => id != null);
  if (!second || second[1] < CLOSED_PAIR.people || second[1] < CLOSED_PAIR.share * total) return null;
  return total - first[1] - second[1] <= CLOSED_PAIR.outside * total ? [first[0], second[0]] : null;
}

export {
  NATIONAL_SCOPE_ID,
  NO_SM_RE,
  SAUL_RE,
  SM_WORD_RE,
  closedPair,
  clubNameKey,
  coverOfTicks,
  coverTicks,
  coverWords,
  coversStart,
  defaultScopes,
  districtProblems,
  foldEvent,
  inScope,
  medalScope,
  meetCoverChoices,
  meetScopes,
  namedPiirit,
  organiserPiiri,
  piiriEntries,
  scopeFor,
  scopeSplitLabel,
  scopeTree,
  startLine,
  tickedScopes,
};
