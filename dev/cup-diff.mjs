// node dev/cup-diff.mjs <year> <host> [all] compares the cup year that
// <host>'s /api/cupseason sums with the series' own site
// (docs/tuloslista-api.md, "The season"). It lists each club whose sum
// differs and the rows behind it, then the places and finals the differences
// move. `all` compares every club's rows.
import { readFileSync } from 'node:fs';
import { cupFinalOrganisers, cupSeasonTable, cupSeries } from '../public/lib/cup.js';
import { clubNameKey } from '../public/lib/districts.js';

const SITE = 'http://seuracup.tuloslista.com';
const [year, host, all] = process.argv.slice(2);
if (!/^\d{4}$/.test(year || '') || !host) {
  console.error('usage: node dev/cup-diff.mjs <year> <host> [all]');
  process.exit(2);
}

const text = async (url, headers = {}) => {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
};
const ours = async (query = '') =>
  JSON.parse(await text(`https://${host}/api/cupseason/${year}${query}`, { 'x-kisat-client': '1' }));
const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

const season = await ours();
const osa = season.meets.filter((m) => m.kind === 'osa');
// An unbuilt meet leaves every sum short. Opening the year's page builds it.
const unbuilt = osa.filter((m) => !m.clubs).map((m) => m.id);
if (unbuilt.length) {
  console.error(`${unbuilt.length} of ${osa.length} osakilpailut not built on ${host} yet: ${unbuilt.join(' ')}`);
  process.exit(1);
}

// The site's A, B and C lists give each club's team id there and its sum.
const official = new Map();
for (const series of 'ABC') {
  const html = await text(`${SITE}/list/${series}/${year}/`);
  for (const m of html.matchAll(/<a href="\/team\/(\d+)\/\d+">([^<]*)<\/a><\/td><td>(\d+)</g)) {
    official.set(clubNameKey(decode(m[2])), { team: m[1], name: decode(m[2]), points: Number(m[3]) });
  }
}

const seriesOf = cupSeries(JSON.parse(readFileSync(new URL('../public/data/seuracup.json', import.meta.url), 'utf8')));
const organisers = cupFinalOrganisers(season.meets);
const here = cupSeasonTable(season.meets, seriesOf, organisers);
const byKey = new Map(here.map((r) => [clubNameKey(r.name), r]));

for (const [key, o] of official) if (!byKey.has(key)) console.log(`there alone: ${o.name} ${o.points}`);
for (const [key, r] of byKey) if (!official.has(key)) console.log(`here alone: ${r.name} ${r.points}`);

// Reads a team page's meets as [{date, head, rows: [{event, result, points}]}].
const teamSections = (html) =>
  html
    .split('<tr><td colspan="3"><h3>')
    .slice(1)
    .map((part) => {
      const [d, mo, y] = part.slice(0, 10).split('.');
      return {
        date: `${y}-${mo}-${d}`,
        head: decode(part.slice(0, part.indexOf('</h3>'))),
        rows: [...part.matchAll(/<tr><td>([^<]*)<\/td><td>([^<]*)<\/td><td>(\d+)<\/td><\/tr>/g)].map((m) => ({
          event: decode(m[1]),
          result: decode(m[2]),
          points: Number(m[3]),
        })),
      };
    });

const differing = [...official].filter(([key, o]) => byKey.has(key) && (all || byKey.get(key).points !== o.points));
const same = [...official].filter(([key, o]) => byKey.get(key)?.points === o.points).length;
console.log(`${year}: ${official.size} clubs there, ${here.length} here, ${same} sums the same`);

for (const [key, o] of differing) {
  const club = byKey.get(key);
  const rows = (await ours(`?club=${club.id}`)).meets;
  const lines = [];
  for (const section of teamSections(await text(`${SITE}/team/${o.team}/${year}/`))) {
    const meet = rows.find(
      (m) => m.kind === 'osa' && m.date === section.date && m.clubs?.some((c) => c.id === club.id),
    );
    if (!meet) {
      lines.push(`  ${section.head}: no meet of that day here`);
      continue;
    }
    // Rows pair on points and result, and what is left on either side differs.
    const left = meet.rows.filter((r) => r.club === club.id && r.points > 0);
    const there = section.rows.filter((r) => {
      const i = left.findIndex((u) => u.points === r.points && u.result === r.result);
      if (i >= 0) left.splice(i, 1);
      return i < 0 && r.points > 0;
    });
    for (const r of there) lines.push(`  ${meet.id} there: ${r.event} | ${r.result} | ${r.points}`);
    for (const r of left)
      lines.push(`  ${meet.id} here:  ${r.event} | ${r.name} | ${r.result} | place ${r.place ?? '-'} | ${r.points}`);
  }
  if (lines.length || club.points !== o.points)
    console.log(`${club.name}: ${club.points} here, ${o.points} there (${signed(club.points - o.points)})`);
  lines.forEach((l) => console.log(l));
}

// Ranks the site's sums the same way to find the places and finals that move.
const siteTable = cupSeasonTable(
  [
    {
      kind: 'osa',
      clubs: [...official]
        .filter(([key]) => byKey.has(key))
        .map(([key, o]) => ({ id: byKey.get(key).id, name: byKey.get(key).name, points: o.points })),
    },
  ],
  seriesOf,
  organisers,
);
const thereById = new Map(siteTable.map((r) => [r.id, r]));
for (const r of here) {
  const t = thereById.get(r.id);
  if (t && (t.rank !== r.rank || t.final !== r.final)) {
    console.log(
      `${r.name}: place ${r.rank} here, ${t.rank} there${t.final !== r.final ? `; final ${r.final ?? '-'} here, ${t.final ?? '-'} there` : ''}`,
    );
  }
}
console.log(`${osa.length} osakilpailut compared`);
