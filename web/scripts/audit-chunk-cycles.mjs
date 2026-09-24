#!/usr/bin/env node
/**
 * Chunk-cycle audit (BUILD).
 *
 * Fails when a file in the static shell closure (main.tsx + App.tsx +
 * NotFound + their static transitive imports, barrel re-exports included)
 * imports a category barrel (`@/components/<name>`) while sitting on an
 * import cycle with that barrel. That shape is exactly what Rollup
 * escalates to CYCLIC_CROSS_CHUNK_REEXPORT once chunk assignment splits
 * the pair — the production build breaks for an import that looks
 * innocent in review (a typography entry-chunk addition exposed two of
 * these in `forms` and `feedback`).
 *
 * Only shell-closure legs fail: lazy routes co-locate their own cycles
 * safely, and rewriting all 70+ non-shell legs is churn without safety
 * gain. Fix by importing the concrete module instead of the barrel.
 *
 * Run via `npm run audit:chunk-cycles` (chained from `npm run lint`).
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx'];
const IMPORT_RE = /from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const SHARED_DIRS = ['src/components/', 'src/api/', 'src/hooks/', 'src/lib/'];

function resolveImport(baseFile, spec) {
  let p;
  if (spec.startsWith('@/')) p = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) p = join(dirname(join(ROOT, baseFile)), spec);
  else return null;
  p = normalize(p);
  let isDir = false;
  try {
    isDir = statSync(p).isDirectory();
  } catch {
    isDir = false; // Missing as-is: fall through to extension probing.
  }
  if (isDir) {
    for (const idx of ['index.ts', 'index.tsx']) {
      if (existsSync(join(p, idx))) return rel(join(p, idx));
    }
    return null;
  }
  for (const e of EXTS) {
    if (existsSync(p + e)) return rel(p + e);
  }
  if (existsSync(p)) return rel(p);
  return null;
}

function rel(abs) {
  return abs.slice(ROOT.length + 1).split(sep).join('/');
}

function collectFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['__snapshots__', '__tests__'].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        /\.(m|c)?(t|j)sx?$/.test(entry.name) &&
        !/\.test\.|\.spec\.|\.stories\./.test(entry.name)
      ) {
        out.push(rel(full));
      }
    }
  };
  walk(SRC);
  return out;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'A-Za-z0-9_$])\/\/.*$/gm, '$1');
}

function buildGraph() {
  const graph = new Map();
  for (const file of collectFiles()) {
    const text = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    const edges = new Set();
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(text)) !== null) {
      if (m[0].startsWith('import(')) continue; // lazy import: chunk split point
      const r = resolveImport(file, m[1] ?? m[2]);
      if (r && r.startsWith('src/')) edges.add(r);
    }
    graph.set(file, edges);
  }
  return graph;
}

function shellClosure(graph) {
  const roots = [...graph.keys()].filter(
    (f) => f === 'src/main.tsx' || f === 'src/App.tsx' || f.includes('NotFound'),
  );
  const seen = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const u = stack.pop();
    if (seen.has(u)) continue;
    seen.add(u);
    for (const v of graph.get(u) ?? []) stack.push(v);
  }
  return seen;
}

function cyclicNodes(graph) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map([...graph.keys()].map((k) => [k, WHITE]));
  const onCycle = new Set();
  const stack = [];
  const visit = (start) => {
    const work = [[start, [...(graph.get(start) ?? [])].values()]];
    color.set(start, GRAY);
    stack.push(start);
    while (work.length > 0) {
      const [, it] = work[work.length - 1];
      const next = it.next();
      if (next.done) {
        color.set(stack.pop(), BLACK);
        work.pop();
        continue;
      }
      const v = next.value;
      if (!color.has(v)) continue;
      if (color.get(v) === GRAY) {
        for (let i = stack.indexOf(v); i < stack.length; i++) onCycle.add(stack[i]);
      } else if (color.get(v) === WHITE) {
        color.set(v, GRAY);
        stack.push(v);
        work.push([v, [...(graph.get(v) ?? [])].values()]);
      }
    }
  };
  for (const n of graph.keys()) {
    if (color.get(n) === WHITE) visit(n);
  }
  return onCycle;
}

function isBarrel(file) {
  return file.endsWith('/index.ts') || file.endsWith('/index.tsx');
}

function isShared(file) {
  return SHARED_DIRS.some((d) => file.startsWith(d));
}

const graph = buildGraph();
const shell = shellClosure(graph);
const cyclic = cyclicNodes(graph);
const offenders = [];
for (const u of cyclic) {
  if (!isShared(u) || isBarrel(u) || !shell.has(u)) continue;
  for (const v of graph.get(u) ?? []) {
    if (cyclic.has(v) && isBarrel(v)) offenders.push(`${u}  ->  ${v}`);
  }
}

if (offenders.length > 0) {
  console.error(
    'FAIL: shell-closure files import a category barrel they cycle with.\n' +
      'Each leg below can surface as CYCLIC_CROSS_CHUNK_REEXPORT the next time\n' +
      'chunk assignment shifts. Import the concrete module instead of the barrel:\n',
  );
  for (const o of offenders.sort()) console.error(`  ${o}`);
  process.exit(1);
}
console.log(
  `OK — no cycle-participating barrel imports in the shell closure (${shell.size} files scanned).`,
);
