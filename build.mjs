// Builds dist/, the files the Worker serves. It is public/ with app.js and the
// modules it imports bundled into chunks named by their content, under
// /assets/. wrangler runs it before dev and deploy (wrangler.jsonc).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { JUOKSUT_MODULES, VIEW_MODULES } from './public/lib/routes.js';

const SRC = 'public';
const DIST = 'dist';
// The build writes a directory of its own inside the repo, so a source map
// names only the repo's paths. dist/ then takes only the files that changed,
// and a running wrangler dev never serves a half-built dist/.
const OUT = '.wrangler/build';
fs.rmSync(OUT, { recursive: true, force: true });
// The bundle's sources, which dist/ serves as chunks alone.
const BUNDLED = ['app.js', 'app', 'lib', 'demo.js'].map((name) => `${SRC}/${name}`);

fs.cpSync(SRC, OUT, { recursive: true, filter: (path) => !BUNDLED.includes(path) && !path.endsWith('.DS_Store') });
const { metafile } = await esbuild.build({
  entryPoints: [`${SRC}/app.js`],
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  sourcemap: true,
  outdir: `${OUT}/assets`,
  entryNames: '[name]-[hash]',
  chunkNames: '[name]-[hash]',
  metafile: true,
  logLevel: 'warning',
});
const { outputs } = metafile;

// A chunk loads the chunks it imports statically, and the page's first chunk
// is app.js's. Each other entry is a module app.js imports on demand.
// esbuild names a file relative to the working directory, and its URL is the
// part from /assets/ on.
const url = (file) => {
  const at = file.lastIndexOf('/assets/');
  if (at < 0) throw new Error(`build.mjs: ${file} is outside /assets/`);
  return file.slice(at);
};
const closure = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const i of outputs[file].imports) if (i.kind === 'import-statement') closure(i.path, seen);
  return seen;
};
const entries = new Map(Object.entries(outputs).flatMap(([file, o]) => (o.entryPoint ? [[o.entryPoint, file]] : [])));
const main = entries.get(`${SRC}/app.js`);
const eager = closure(main);
const modules = {};
for (const [source, file] of entries) {
  if (file === main) continue;
  const name = source.split('/').pop().replace(/\.js$/, '');
  modules[name] = [...closure(file)]
    .filter((p) => !eager.has(p))
    .map(url)
    .sort();
}
const named = new Set([...Object.values(VIEW_MODULES), ...Object.values(JUOKSUT_MODULES).flat(), 'demo']);
const missing = [...named].filter((name) => !modules[name]);
if (missing.length) throw new Error(`build.mjs: no chunk for ${missing.join(', ')}`);
fs.writeFileSync(`${OUT}/modules.json`, `${JSON.stringify({ modules })}\n`);

// The document loads the first chunk and preloads the chunks it imports. Its
// CSS is minified like the chunks, and no source comment reaches the browser.
const source = fs.readFileSync(`${SRC}/index.html`, 'utf8');
const style = /(<style>)([\s\S]*?)(<\/style>)/;
if (!style.test(source)) throw new Error('build.mjs: index.html has no <style>');
const css = (await esbuild.transform(source.match(style)[2], { loader: 'css', minify: true })).code;
const html = source
  .replace(style, (_, open, _css, close) => `${open}${css}${close}`)
  .replace(/ *<!--[\s\S]*?-->\n/g, '');
const preloads = [...eager]
  .filter((p) => p !== main)
  .map(url)
  .sort()
  .map((href) => `    <link rel="modulepreload" href="${href}" />\n`)
  .join('');
const lines = /(?: {4}<link rel="modulepreload" href="[^"]+" \/>\n)+/;
const script = '<script type="module" src="/app.js"></script>';
if (!lines.test(html) || !html.includes(script)) throw new Error('build.mjs: index.html has no preloads or no app.js');
fs.writeFileSync(
  `${OUT}/index.html`,
  html.replace(lines, preloads).replace(script, `<script type="module" src="${url(main)}"></script>`),
);

// dist/ gets each new or changed file and loses each one the build left out.
const files = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile());
const built = new Set(files(OUT));
fs.mkdirSync(DIST, { recursive: true });
for (const f of files(DIST)) if (!built.has(f)) fs.rmSync(path.join(DIST, f));
for (const f of built) {
  const from = fs.readFileSync(path.join(OUT, f));
  const to = path.join(DIST, f);
  if (fs.existsSync(to) && fs.readFileSync(to).equals(from)) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, from);
}
fs.rmSync(OUT, { recursive: true, force: true });
console.log(
  `build.mjs: ${Object.keys(outputs).filter((f) => f.endsWith('.js')).length} chunks, ${eager.size} load first`,
);
