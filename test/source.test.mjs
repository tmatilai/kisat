// Tests the shim table, the import and export lists, the modules
// index.html preloads, that the imports form no cycle, that a Preview gets
// the Worker's bindings, and that the docs' references resolve.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { DEMO_ID, JUOKSUT_MODULES, MAIN_MODULES, VIEW_MODULES, routeModules } from '../public/lib/routes.js';
import { shimProblems, shimsDue } from '../public/lib/shims.js';

// --- docs/shims.md's shim table, proof-reading itself ----------------------
test("docs/shims.md's shim table, proof-reading itself", () => {
  const shims = fs.readFileSync(new URL('../docs/shims.md', import.meta.url), 'utf8');
  assert.deepEqual(shimProblems(shims), [], `docs/shims.md: ${shimProblems(shims).join('; ')}`);
  const doc = (...rows) =>
    [
      '# Shims to delete',
      '',
      '| after | shim | what goes |',
      '| --- | --- | --- |',
      ...rows,
      '',
      '## Next',
      '',
      '| 2020-01-01 | a | b |',
    ].join('\n');
  // (Break on purpose: drop the order test or the calendar test, or read
  // past the next ## heading.)
  assert.deepEqual(
    shimProblems(
      doc(
        '| 2026-12-15 | a | b |',
        '| 2026-11-30 | c | d |',
        '| 2026-12-01 | e |',
        '| 1.1.2027 | f | g |',
        '| 2026-02-30 | h | i |',
        '| 2026-12-01 | | j |',
      ),
    ),
    [
      'row 2: 2026-11-30 is out of order',
      'row 3: not three cells',
      'row 4: 1.1.2027 is not a day as YYYY-MM-DD',
      'row 5: 2026-02-30 is not a day as YYYY-MM-DD',
      'row 6: a cell is empty',
    ],
  );
  assert.deepEqual(shimProblems('# Shims\n\n## Shims to delete\n'), ['no "# Shims to delete" section']);
  // A shim is due the day after its date.
  assert.deepEqual(
    shimsDue(doc('| 2026-09-26 | a | b |', '| 2026-09-27 | c | d |'), '2026-09-27').map((s) => s.shim),
    ['a'],
  );
  console.log('shim table ok');
});

// --- Each import and export list in app.js, app/ and lib/ is sorted, and so
// are their imports by path. A lib file's export list names all it exports.
// (Break on purpose: swap two names, swap two imports of a lib file, or put
// `export` on a function.) ---
const appFiles = ['app.js', ...fs.readdirSync(new URL('../public/app/', import.meta.url)).map((f) => `app/${f}`)];
test('export and import order', async () => {
  const lists = (text, re) => [...text.matchAll(re)].map((m) => m[1].split(/[\s,]+/).filter(Boolean));
  const lib = fs.readdirSync(new URL('../public/lib/', import.meta.url)).map((f) => `lib/${f}`);
  for (const file of [...appFiles, ...lib]) {
    const text = fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    const exports = lists(text, /^export \{([^}]*)\};$/gm);
    for (const names of [...lists(text, /^import \{([^}]*)\} from '[^']+';$/gm), ...exports]) {
      const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const at = names.findIndex((n, i) => n !== sorted[i]);
      assert.equal(at, -1, `${file}: '${names[at]}' is out of order, '${sorted[at]}' goes there`);
    }
    const paths = [...text.matchAll(/^import [^;]*? from '(\.\.?\/(?:lib\/|app\/)?[\w-]+\.js)';$/gm)].map((m) => m[1]);
    assert.deepEqual(paths, [...paths].sort(), `${file}: its imports go by path`);
    if (lib.includes(file)) {
      const ns = Object.keys(await import(`../public/${file}`));
      assert.deepEqual(exports, [ns], `${file}: every export is in the one export list`);
    }
  }
});

// --- Each name app.js and app/ import is exported by the file it names. Node
// cannot load them, and in the browser a missing name leaves the page blank.
// An app/ file's names are read off its export list. (Break on purpose: import
// a name that lib/dates.js or app/shell.js does not export.) ---
test('app imports', async () => {
  for (const file of appFiles) {
    const from = new URL(`../public/${file}`, import.meta.url);
    for (const [, list, spec] of fs.readFileSync(from, 'utf8').matchAll(/^import \{([^}]*)\} from '([^']+)';$/gm)) {
      const url = new URL(spec, from);
      const names = /\/public\/app(\/|\.js$)/.test(url.pathname)
        ? (/^export \{([^}]*)\};$/m.exec(fs.readFileSync(url, 'utf8'))?.[1] ?? '').split(/[\s,]+/)
        : Object.keys(await import(url));
      const missing = list.split(/[\s,]+/).filter((n) => n && !names.includes(n));
      assert.deepEqual(missing, [], `${file} imports what ${spec} does not export`);
    }
  }
});

// --- index.html preloads each module the page imports, directly or not, and
// no other file. (Break on purpose: drop a modulepreload line, or add one for
// a file nothing imports.) ---
test('module preloads', () => {
  const root = new URL('../public/', import.meta.url);
  const html = fs.readFileSync(new URL('index.html', root), 'utf8');
  const entry = new URL(`.${/<script type="module" src="([^"]+)"><\/script>/.exec(html)[1]}`, root);
  const visit = (url, imported) => {
    const text = fs.readFileSync(url, 'utf8');
    for (const [, spec] of text.matchAll(/^(?:import|export)\b[^;]*?\bfrom '(\.\.?\/[^']+)';$/gm)) {
      const dep = new URL(spec, url);
      if (!imported.has(dep.href)) {
        imported.add(dep.href);
        visit(dep, imported);
      }
    }
    return imported;
  };
  const imported = visit(entry, new Set());
  const preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)" \/>/g)].map(
    (m) => new URL(`.${m[1]}`, root),
  );
  const paths = (urls) => urls.map((u) => new URL(u).pathname.slice(root.pathname.length)).sort();
  assert.deepEqual(paths(preloaded), paths([...imported]), 'index.html: one modulepreload line a module');

  // A module imported on demand is named by its file: the router's view
  // modules, a view's Juoksut modules, and data.js's demo.js. build.mjs names
  // each one's chunks the same way, and the Worker preloads a route's
  // (routeModules). (Break on purpose: import app/tables.js on demand in
  // app/meet.js, or name a module no file imports in VIEW_MODULES.)
  const lazy = new Set();
  for (const file of appFiles) {
    const from = new URL(file, root);
    for (const [, spec] of fs.readFileSync(from, 'utf8').matchAll(/\bimport\('([^']+)'\)/g)) {
      const name = new URL(spec, from).pathname.split('/').pop().replace(/\.js$/, '');
      lazy.add(name);
      const by = file.replace(/^app\//, '').replace(/\.js$/, '');
      if (file.startsWith('app/') && by !== 'data') {
        assert.ok(JUOKSUT_MODULES[by]?.includes(name), `${file} imports ${name} on demand: JUOKSUT_MODULES.${by}`);
      }
    }
  }
  const main = Object.values(MAIN_MODULES).flat();
  for (const name of [...Object.values(VIEW_MODULES), ...Object.values(JUOKSUT_MODULES).flat(), ...main]) {
    assert.ok(lazy.has(name), `${name} is a module no file imports on demand`);
  }
  const files = { meet: ['/m.js', '/s.js'], hurdles: ['/h.js', '/s.js'], demo: ['/d.js'] };
  assert.deepEqual(routeModules({ view: 'comp', compId: '20224' }, 'kisat', files), ['/m.js', '/s.js']);
  assert.deepEqual(routeModules({ view: 'comp', compId: '20224' }, 'juoksut', files), ['/m.js', '/s.js', '/h.js']);
  assert.deepEqual(routeModules({ view: 'comp', compId: DEMO_ID }, 'kisat', files), ['/m.js', '/s.js', '/d.js']);
  assert.deepEqual(routeModules({ view: 'comp', compId: '20224' }, 'kisat', {}), [], 'the source has no chunks');
});

// --- No module the page loads imports a package. make serve and make dev give
// the page public/ unbundled, where a package's name resolves to nothing.
// (Break on purpose: import parse5 in lib/dates.js.) ---
test('no package in the page', () => {
  const root = new URL('../public/', import.meta.url);
  const seen = new Set();
  const visit = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    for (const [, spec] of fs.readFileSync(url, 'utf8').matchAll(/^(?:import|export)\b[^;]*?\bfrom '([^']+)';$/gm)) {
      assert.match(spec, /^\.\.?\//, `${url.pathname.slice(root.pathname.length)} imports the package ${spec}`);
      visit(new URL(spec, url));
    }
  };
  for (const file of [...appFiles, 'demo.js']) visit(new URL(file, root));
});

// --- No module in public/ imports itself through others. In a cycle, which
// module's top level runs first depends on which file was imported first.
// (Break on purpose: import lib/filter.js from lib/ages.js.) ---
test('no import cycles', () => {
  const root = new URL('../public/', import.meta.url);
  const files = [...appFiles, 'demo.js', ...fs.readdirSync(new URL('lib/', root)).map((f) => `lib/${f}`)];
  const state = new Map();
  const visit = (url, path) => {
    const at = path.indexOf(url.href);
    const short = (href) => href.slice(root.href.length);
    assert.equal(at, -1, `import cycle: ${[...path.slice(at), url.href].map(short).join(' → ')}`);
    if (state.has(url.href)) return;
    state.set(url.href, true);
    const text = fs.readFileSync(url, 'utf8');
    for (const [, spec] of text.matchAll(/^(?:import|export)\b[^;]*?\bfrom '(\.\.?\/[^']+)';$/gm)) {
      visit(new URL(spec, url), [...path, url.href]);
    }
  };
  for (const file of files) visit(new URL(file, root), []);
});

// --- A Preview inherits no binding from wrangler.jsonc's top level, so its
// `previews` block repeats them. It binds both or neither of the namespaces
// of a preview's own data, never production's (previewEnv). (Break on
// purpose: drop a limiter from `previews`, or bind ROSTER_PREVIEW to the id
// of ROSTER.) ---
test('preview bindings', () => {
  const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
  assert.deepEqual(config.previews?.ratelimits, config.ratelimits, 'wrangler.jsonc: previews.ratelimits differs');
  const own = ['ROSTER_PREVIEW', 'WATCHES_PREVIEW'];
  const kv = config.previews?.kv_namespaces || [];
  assert.deepEqual(
    kv.filter((b) => !own.includes(b.binding)),
    config.kv_namespaces,
    'wrangler.jsonc: previews.kv_namespaces differs',
  );
  const ids = own.map((name) => kv.find((b) => b.binding === name)?.id);
  const prod = config.kv_namespaces.map((b) => b.id);
  assert.ok(
    ids.every((id) => !id) || (ids.every((id) => id && !prod.includes(id)) && ids[0] !== ids[1]),
    'wrangler.jsonc: a preview namespace is missing or shares an id',
  );
});

// --- The docs point into the code by name, and nothing else notices when a
// name changes. ---
const repo = new URL('../', import.meta.url);
const readRepo = (file) => fs.readFileSync(new URL(file, repo), 'utf8');
const docFiles = fs.globSync('{*.md,docs/*.md,dev/*.md}', { cwd: repo });
const codeFiles = fs.globSync(
  '{*.js,*.mjs,*.jsonc,Makefile,public/**/*.{js,json,html},test/*.mjs,dev/*.{js,mjs},.github/**/*.yml}',
  { cwd: repo },
);

// A backticked function or constant in a doc exists in the code. (Break on
// purpose: rename a function a doc names.)
test('the names in the docs', () => {
  const words = new Set(codeFiles.flatMap((f) => readRepo(f).match(/[\w$]+/g) || []));
  const missing = docFiles.flatMap((f) =>
    [...readRepo(f).matchAll(/`([a-z]+[A-Z]\w*|[A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)]
      .map(([, name]) => name)
      .filter((name) => !words.has(name))
      .map((name) => `${f}: ${name}`),
  );
  assert.deepEqual(missing, []);
});

// A citation of a doc's heading, or of a bold rule by its opening words, as
// `docs/views.md`, "The day list", finds it, and so does one of a code file's section, as the section
// "The result tables" of `app/event.js`. A citation may wrap across comment
// lines, and its backticks do not count. (Break on purpose: rename a heading
// that a comment cites.)
test('the citations of headings and sections', () => {
  const plain = (text) => text.replaceAll('`', '').trim();
  const targets = new Map();
  const targetsOf = (file) => {
    if (!targets.has(file)) {
      const lines = fs.existsSync(new URL(file, repo)) ? readRepo(file).split('\n') : [];
      targets.set(file, {
        headings: lines.filter((l) => /^#+ /.test(l)).map((l) => plain(l.replace(/^#+ /, ''))),
        bold: lines.flatMap((l) => [...l.matchAll(/\*\*([^*]+)\*\*/g)].map(([, b]) => plain(b).replace(/\.$/, ''))),
        sections: lines
          .filter((l) => /^\s*\/\/ --- /.test(l))
          .map((l) => plain(l.replace(/^\s*\/\/ --- /, '').replace(/\s*-+\s*$/, ''))),
      });
    }
    return targets.get(file);
  };
  const broken = [];
  for (const file of [...docFiles, ...codeFiles]) {
    const text = readRepo(file).replace(/\n\s*(?:\/\/|#|\*)?\s*/g, ' ');
    // A citation can name several targets, joined by a comma, "and" or "or".
    const citeRe = /`?((?:dev\/)?AGENTS\.md|docs\/[\w-]+\.md)`?,\s*("[^"]+"(?:,?\s*(?:,|and|or)\s*"[^"]+")*)/g;
    for (const [, doc, chain] of text.matchAll(citeRe)) {
      const { headings, bold } = targetsOf(doc);
      for (const [, cited] of chain.matchAll(/"([^"]+)"/g)) {
        const want = plain(cited);
        const opens = (b) => b === want || b.startsWith(`${want} `) || b.startsWith(`${want},`);
        if (!headings.includes(want) && !bold.some(opens)) {
          broken.push(`${file}: ${doc}, "${cited}"`);
        }
      }
    }
    for (const [, cited, code] of text.matchAll(/section "([^"]+)" of `([\w/.-]+\.m?js)`/g)) {
      const path = fs.existsSync(new URL(code, repo)) ? code : `public/${code}`;
      if (!targetsOf(path).sections.includes(plain(cited))) broken.push(`${file}: ${code}, section "${cited}"`);
    }
  }
  assert.deepEqual(broken, []);
});
