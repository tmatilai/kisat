// --- A class's age ---

// Yleinen, the adult class at Age 0, sorts after the youth classes and before
// every masters' row, also one filed at Age 30 (docs/tuloslista-api.md).
const ageOrder = (a) => (a === 0 ? 29.5 : a);
// Returns a start's class age, 0 for yleinen, or null for a non-numeric `Age`.
const startAge = (start) => (/^\d+$/.test(String(start?.Age ?? '')) ? Number(start.Age) : null);
// parseAges and agesSegment read and write the ages in a fragment or a path,
// such as `13,15`. A chip's toggle round-trips them, so both sort and dedupe.
const parseAges = (s) =>
  [
    ...new Set(
      String(s || '')
        .split(',')
        .filter(Boolean)
        .map(Number),
    ),
  ].sort((a, b) => ageOrder(a) - ageOrder(b));
const agesSegment = (ages) => parseAges((ages || []).join(',')).join(',');

// An age of 30 splits youth from masters, as no class has an age near it
// (docs/tuloslista-api.md, "Categories, names and identity").
const MASTERS_MIN_AGE = 30;

// --- The age chips ---

// Classes 1 to 13 are named T and P. Yleinen and 14 up are N and M.
const girlsBoysAge = (age) => age > 0 && age <= 13;

// One chip names an age class of both sexes, as "T/P 12", "N/M" or "N/M 50".
const ageChipLabel = (age) => (age === 0 ? 'N/M' : `${girlsBoysAge(age) ? 'T/P' : 'N/M'} ${age}`);

// The age chips' rows (ageChips, app/follow.js) are T/P, N/M with yleinen,
// and the masters.
function ageChipRows(classAges) {
  const rows = [
    { label: 'T/P', ages: [] },
    { label: 'N/M', ages: [] },
    { label: 'N/M', ages: [] },
  ];
  for (const a of classAges) rows[girlsBoysAge(a) ? 0 : a < MASTERS_MIN_AGE ? 1 : 2].ages.push(a);
  return rows.filter((r) => r.ages.length);
}

export { MASTERS_MIN_AGE, ageChipLabel, ageChipRows, ageOrder, agesSegment, girlsBoysAge, parseAges, startAge };
