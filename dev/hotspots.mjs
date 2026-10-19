// node dev/hotspots.mjs [N] prints the code's size per area, then the N
// functions with the most decisions (default 40), with ESLint's complexity,
// their code lines and the commits that changed them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { ESLint } from 'eslint';

const TOP = Number(process.argv[2]) || 40;
// An area's second pattern counts its commits, so it also matches the paths
// its files had in older commits.
const AREAS = [
  ['page', /^public\/(app\.js|app\/|lib\/)/, /^(public\/)?(app\.js|app\/|lib\.js|lib\/)/],
  ['worker', /^worker\.js$/, /^worker\.js$/],
  ['fixture', /^public\/demo\.js$/, /^(public\/)?demo\.js$/],
  ['build', /^build\.mjs$/, /^build\.mjs$/],
  ['tests', /^(test\/|test-[\w-]+\.mjs$)/, /^(test\/|test[\w-]*\.mjs$)/],
  ['dev', /^dev\//, /^dev\//],
];
const areaOf = (file) => AREAS.find(([, re]) => re.test(file))?.[0];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
const files = git('ls-files', '*.js', '*.mjs')
  .split('\n')
  .filter((f) => f && areaOf(f));

// --- Each function, named and measured ---

// ESLint's complexity also counts each `?.`, `||`, `??` and default value, so
// a function full of null guards scores high. The decisions are the if, ?:,
// loop, case and catch nodes of the function itself, and not of the
// functions written in it. A callback is named after its function.
const DECISIONS = [
  'IfStatement',
  'ConditionalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchCase[test]',
  'CatchClause',
];
const functions = [];
const collector = {
  create(context) {
    const named = (node) => {
      const p = node.parent;
      if (node.id) return node.id.name;
      if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
      if ((p.type === 'Property' || p.type === 'MethodDefinition') && p.key.type === 'Identifier') return p.key.name;
      return null;
    };
    const stack = [];
    const enter = (node) => {
      const name = named(node) ?? `${stack.at(-1)?.name ?? 'top'}/callback`;
      const head = node.parent.type === 'Property' || node.parent.type === 'MethodDefinition' ? node.parent : node;
      const fn = { file: context.filename, name, node, head, decisions: 0, outer: stack[0] };
      functions.push(fn);
      stack.push(fn);
    };
    const leave = () => stack.pop();
    const decide = () => {
      if (stack.length) stack.at(-1).decisions++;
    };
    return {
      FunctionDeclaration: enter,
      FunctionExpression: enter,
      ArrowFunctionExpression: enter,
      'FunctionDeclaration:exit': leave,
      'FunctionExpression:exit': leave,
      'ArrowFunctionExpression:exit': leave,
      ...Object.fromEntries(DECISIONS.map((d) => [d, decide])),
    };
  },
};

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins: { hot: { rules: { collect: collector } } },
    rules: { complexity: ['warn', 0], 'hot/collect': 'warn' },
  },
});
const results = await eslint.lintFiles(files);

// complexity reports at a function's head, so the innermost function whose
// head starts at or before the report and that contains it is the one.
const cwd = `${process.cwd()}/`;
const at = (loc) => loc.line * 1e5 + loc.column;
for (const r of results) {
  const mine = functions.filter((f) => f.file === r.filePath);
  for (const m of r.messages) {
    if (m.ruleId !== 'complexity') continue;
    const pos = m.line * 1e5 + m.column - 1;
    const fn = mine
      .filter((f) => at(f.head.loc.start) <= pos && pos <= at(f.node.loc.end))
      .sort((a, b) => at(b.head.loc.start) - at(a.head.loc.start))[0];
    fn.complexity = Number(/complexity of (\d+)/.exec(m.message)[1]);
  }
}

// --- The commits that changed each function ---

// git names the top-level function a hunk falls in, and a hunk that edits a
// definition line names it too. So one pass over every patch counts the
// commits per function, across every move between files. A commit that
// moves a definition to another file is not counted.
// A name that several files define, such as each probe's, counts per file.
const TOP_DEF = /^(?:export )?(?:async )?(?:function\*? ?(\w+)\(|(?:const|let) (\w+) = )/;
const byName = new Map();
const byFile = new Map();
{
  const log = git('log', '-p', '-U0', '--no-renames', '--format=%x00%H', '--', '*.js', '*.mjs');
  for (const patch of log.split('\0').slice(1)) {
    const commit = patch.slice(0, 40);
    const touched = new Map();
    const defs = new Map();
    let from = null;
    let to = null;
    for (const line of patch.split('\n')) {
      if (line.startsWith('--- ')) from = line.slice(6);
      else if (line.startsWith('+++ ')) to = line.slice(6);
      else if (line.startsWith('@@')) {
        const m = TOP_DEF.exec(line.replace(/^@@ [^@]* @@ ?/, ''));
        if (m) touched.set(`${to}\0${m[1] ?? m[2]}`, m[1] ?? m[2]);
      } else if (/^[-+]/.test(line)) {
        const m = TOP_DEF.exec(line.slice(1));
        if (!m) continue;
        const name = m[1] ?? m[2];
        const file = line[0] === '-' ? from : to;
        touched.set(`${to === '/dev/null' ? from : to}\0${name}`, name);
        const d = defs.get(name) ?? { '-': new Set(), '+': new Set() };
        d[line[0]].add(file);
        defs.set(name, d);
      }
    }
    for (const [key, name] of touched) {
      const d = defs.get(name);
      const moved = d && [...d['-']].some((f) => !d['+'].has(f)) && [...d['+']].some((f) => !d['-'].has(f));
      if (moved) continue;
      for (const [map, k] of [
        [byName, name],
        [byFile, key],
      ]) {
        if (!map.has(k)) map.set(k, new Set());
        map.get(k).add(commit);
      }
    }
  }
}
const defined = new Map();
for (const f of functions) if (!f.outer) defined.set(f.name, (defined.get(f.name) ?? 0) + 1);
// A nested function takes the commits of the top-level function it is in.
// A method, such as the Worker's fetch, is not at the left margin, so git log
// -L follows its lines instead.
function commitsOf(f, file) {
  const top = f.outer ?? f;
  const set = defined.get(top.name) === 1 ? byName.get(top.name) : byFile.get(`${file}\0${top.name}`);
  if (set) return set.size;
  const { start, end } = top.node.loc;
  return git('log', '-s', '--format=%H', `-L${start.line},${end.line}:${file}`).split('\n').filter(Boolean).length;
}

// --- The report ---

const touched = new Map(AREAS.map(([a]) => [a, 0]));
for (const commit of git('log', '--format=%x00', '--name-only').split('\0').slice(1)) {
  const paths = commit.split('\n');
  for (const [a, , re] of AREAS) if (paths.some((p) => re.test(p))) touched.set(a, touched.get(a) + 1);
}
const codeLines = (text) => text.split('\n').filter((l) => l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l)).length;
const source = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const pad = (v, n) => String(v).padStart(n);

console.log('area       files   lines    code  commits');
for (const [area] of AREAS) {
  const mine = files.filter((f) => areaOf(f) === area);
  const all = mine.map((f) => source.get(f)).join('\n');
  console.log(
    `${area.padEnd(9)}${pad(mine.length, 6)}${pad(all.split('\n').length, 8)}${pad(codeLines(all), 8)}${pad(touched.get(area), 9)}`,
  );
}

console.log('\ndecisions  complexity   code  commits  function');
const ranked = functions.sort((a, b) => b.decisions - a.decisions || (b.complexity ?? 0) - (a.complexity ?? 0));
for (const f of ranked.slice(0, TOP)) {
  const file = f.file.replace(cwd, '');
  const { start, end } = f.node.loc;
  const body = source
    .get(file)
    .split('\n')
    .slice(start.line - 1, end.line)
    .join('\n');
  console.log(
    `${pad(f.decisions, 9)}${pad(f.complexity ?? 1, 12)}${pad(codeLines(body), 7)}${pad(commitsOf(f, file), 9)}  ${file}:${start.line} ${f.name}`,
  );
}
