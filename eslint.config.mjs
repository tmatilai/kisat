// ESLint is the lint's only package (package.json), so the rules and the
// globals are listed here by hand.

const browser = [
  'AbortController',
  'AbortSignal',
  'Node',
  'URL',
  'URLSearchParams',
  'addEventListener',
  'clearInterval',
  'clearTimeout',
  'console',
  'document',
  'fetch',
  'getComputedStyle',
  'history',
  'localStorage',
  'location',
  'navigator',
  'performance',
  'queueMicrotask',
  'removeEventListener',
  'sessionStorage',
  'setInterval',
  'setTimeout',
  'window',
];
const worker = [
  'AbortSignal',
  'HTMLRewriter',
  'Request',
  'Response',
  'TextEncoder',
  'URL',
  'caches',
  'console',
  'crypto',
  'fetch',
];
const node = ['Blob', 'Buffer', 'URL', 'clearTimeout', 'console', 'fetch', 'process', 'setTimeout'];

const globals = (names, value = 'readonly') => Object.fromEntries(names.map((n) => [n, value]));

export default [
  { ignores: ['.wrangler/', 'dist/'] },
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
      'no-import-assign': 'error',
      'no-duplicate-case': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-unreachable': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
  { files: ['public/app.js', 'public/app/*.js', 'dev/**'], languageOptions: { globals: globals(browser) } },
  {
    files: ['public/lib/*.js', 'public/demo.js'],
    languageOptions: { globals: globals(['TextDecoder', 'URLSearchParams']) },
  },
  { files: ['worker.js'], languageOptions: { globals: globals(worker) } },
  { files: ['*.mjs', 'dev/*.mjs', 'test/*.mjs'], languageOptions: { globals: globals(node) } },
];
