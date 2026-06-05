/**
 * P1/S0-0002 — UI-prompt generator (the prompt factory).
 *
 * Reads the parity manifest (`apps/parity/parity-manifest.json`, emitted by
 * S0-0001) and, for every `kind==="page"` unit, renders ONE fully-specified
 * native-implementation prompt per platform (Windows / Android / Apple) from the
 * per-platform Handlebars templates under `apps/tools/templates/`.
 *
 * Output tree (one prompt per page-unit per platform):
 *   .github/prompts/monorepo/p2-windows/pages/<area>/<PageId>.prompt.md
 *   .github/prompts/monorepo/p3-android/pages/<area>/<PageId>.prompt.md
 *   .github/prompts/monorepo/p4-apple/pages/<area>/<PageId>.prompt.md
 * plus a per-platform `pages/INDEX.md` in dependency order.
 *
 * The generator is THE prompt factory for P2/P3/P4 page prompts — it does not
 * implement any app code. Each generated prompt embeds the unit's exact
 * panels/charts/maps/states/strings/data-sources + the platform template, the
 * 7 required sections, the inlined Honesty Covenant, the `=== PARITY ===` gate
 * (`PARITY_REQUIRED=<requiredCount>`), and a per-item checklist.
 *
 * `handlebars` is already vendored under `web/node_modules`; we load it via
 * createRequire so this tool needs no node_modules of its own (same pattern as
 * gen-parity-manifest.ts).
 *
 * Usage:
 *   npx tsx apps/tools/gen-ui-prompts.ts            # (re)generate all prompts
 *   npx tsx apps/tools/gen-ui-prompts.ts --check    # drift check (CI) — exit 1 on diff
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ── locate repo root and load vendored Handlebars from web/node_modules ─────
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const webDir = path.join(repoRoot, 'web');
const webRequire = createRequire(path.join(webDir, 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Handlebars: any = webRequire('handlebars');

const MANIFEST_FILE = path.join(repoRoot, 'apps', 'parity', 'parity-manifest.json');
const TEMPLATES_DIR = path.join(here, 'templates');
const MONOREPO_DIR = path.join(repoRoot, '.github', 'prompts', 'monorepo');

const CHECK = process.argv.includes('--check');

// ── manifest unit shape (subset we consume) ─────────────────────────────────
interface Unit {
  id: string;
  kind: string;
  title: string;
  sourceFiles: string[];
  route?: string;
  dataSources?: string[];
  panels?: string[];
  charts?: string[];
  maps?: string[];
  states?: string[];
  strings?: string[];
  requiredCount: number;
  notes?: string;
}

interface Platform {
  key: 'windows' | 'android' | 'apple';
  program: string;       // p2-windows
  template: string;      // windows.page.prompt.hbs basename (sans ext)
  label: string;         // human label for INDEX
}

const PLATFORMS: Platform[] = [
  { key: 'windows', program: 'p2-windows', template: 'windows', label: 'WinUI 3 / Fluent' },
  { key: 'android', program: 'p3-android', template: 'android', label: 'Compose / Material 3' },
  { key: 'apple', program: 'p4-apple', template: 'apple', label: 'SwiftUI / HIG' },
];

// ── helpers ─────────────────────────────────────────────────────────────────
Handlebars.registerHelper('inc', (n: number) => Number(n) + 1);

function pascal(area: string): string {
  return area
    .split(/[-_]/g)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function pkg(area: string): string {
  // Kotlin package segment: lowercase, no separators.
  return area.replace(/[-_]/g, '').toLowerCase();
}

/** key shared by a page and its child units, e.g. "admin/APIKeys". */
function unitKey(id: string): string {
  const afterKind = id.slice(id.indexOf(':') + 1);
  const hash = afterKind.indexOf('#');
  return hash >= 0 ? afterKind.slice(0, hash) : afterKind;
}

function basenameNoExt(p: string): string {
  return path.basename(p).replace(/\.[^.]+$/, '');
}

/** Dependency-order bucket: foundational pages first, detail pages last. */
function orderBucket(area: string, pageId: string): { rank: number; label: string } {
  const t = pageId.toLowerCase();
  if (area === 'dashboard' || /dashboard|glance|overview|home/.test(t)) {
    return { rank: 0, label: 'foundational' };
  }
  if (/(list|index)page$/.test(t) || /vehicles|fleet/.test(t)) {
    return { rank: 1, label: 'list' };
  }
  if (/detail/.test(t)) {
    return { rank: 3, label: 'detail' };
  }
  return { rank: 2, label: 'feature' };
}

// ── load + index the manifest ───────────────────────────────────────────────
function loadUnits(): Unit[] {
  const raw = fs.readFileSync(MANIFEST_FILE, 'utf8');
  const units = JSON.parse(raw) as Unit[];
  if (!Array.isArray(units)) throw new Error('parity-manifest.json is not an array');
  return units;
}

interface PageView {
  unit: Unit;
  area: string;
  areaPascal: string;
  areaPkg: string;
  pageId: string;
  relFile: string; // <area>/<PageId>.prompt.md
  bucket: { rank: number; label: string };
  context: Record<string, unknown>;
}

function buildPageViews(units: Unit[]): PageView[] {
  // Group child api hooks by page key.
  const hooksByKey = new Map<string, Set<string>>();
  for (const u of units) {
    if (u.kind !== 'api') continue;
    const key = unitKey(u.id);
    if (!hooksByKey.has(key)) hooksByKey.set(key, new Set());
    hooksByKey.get(key)!.add(u.title);
  }

  const pages = units.filter((u) => u.kind === 'page');
  const views: PageView[] = [];

  for (const unit of pages) {
    const key = unitKey(unit.id);
    const area = key.split('/')[0] || 'misc';
    const sourceFile = unit.sourceFiles[0] ?? '';
    const pageId = basenameNoExt(sourceFile) || unit.title;

    const panels = unit.panels ?? [];
    const charts = unit.charts ?? [];
    const maps = unit.maps ?? [];
    const states = unit.states ?? [];
    const strings = unit.strings ?? [];
    const dataSources = unit.dataSources ?? [];
    const hooks = Array.from(hooksByKey.get(key) ?? []).sort();

    // Per-item parity checklist — exactly requiredCount entries.
    const parityItems: { kind: string; label: string }[] = [];
    for (const p of panels) parityItems.push({ kind: 'panel', label: p });
    for (const c of charts) parityItems.push({ kind: 'chart', label: c });
    for (const m of maps) parityItems.push({ kind: 'map', label: m });
    for (const s of states) parityItems.push({ kind: 'state', label: `${s} data state` });
    for (const s of strings) parityItems.push({ kind: 'string', label: s });

    if (parityItems.length !== unit.requiredCount) {
      // Surface drift between requiredCount and the embedded arrays (non-fatal).
      process.stderr.write(
        `warn: ${unit.id} requiredCount=${unit.requiredCount} but enumerated ${parityItems.length} items\n`,
      );
    }

    const routeDisplay = unit.route && unit.route.trim() ? unit.route : '(unrouted)';

    const context: Record<string, unknown> = {
      unitId: unit.id,
      area,
      areaPascal: pascal(area),
      areaPkg: pkg(area),
      pageId,
      pageTitle: unit.title,
      sourceFile,
      routeDisplay,
      dataSources,
      hooks,
      panels,
      charts,
      maps,
      states,
      statesList: states.length ? states.join(' · ') : '—',
      strings,
      nPanels: panels.length,
      nCharts: charts.length,
      nMaps: maps.length,
      nStates: states.length,
      nStrings: strings.length,
      requiredCount: unit.requiredCount,
      parityItems,
    };

    views.push({
      unit,
      area,
      areaPascal: pascal(area),
      areaPkg: pkg(area),
      pageId,
      relFile: `${area}/${pageId}.prompt.md`,
      bucket: orderBucket(area, pageId),
      context,
    });
  }

  // Deterministic order for generation + indexing.
  views.sort((a, b) => a.unit.id.localeCompare(b.unit.id));
  return views;
}

// ── render every output file into an in-memory map (abs path → content) ─────
function renderAll(): { files: Map<string, string>; pageCount: number } {
  const units = loadUnits();
  const views = buildPageViews(units);
  const files = new Map<string, string>();

  for (const platform of PLATFORMS) {
    const tplPath = path.join(TEMPLATES_DIR, `${platform.template}.page.prompt.hbs`);
    const tpl = Handlebars.compile(fs.readFileSync(tplPath, 'utf8'), { noEscape: false });
    const pagesRoot = path.join(MONOREPO_DIR, platform.program, 'pages');

    for (const view of views) {
      const out = tpl(view.context);
      // Normalize to LF + single trailing newline for deterministic check mode.
      const normalized = out.replace(/\r\n/g, '\n').replace(/\s*$/, '') + '\n';
      files.set(path.join(pagesRoot, view.relFile), normalized);
    }

    files.set(path.join(pagesRoot, 'INDEX.md'), renderIndex(platform, views));
  }

  return { files, pageCount: views.length };
}

function renderIndex(platform: Platform, views: PageView[]): string {
  const ordered = [...views].sort((a, b) => {
    if (a.bucket.rank !== b.bucket.rank) return a.bucket.rank - b.bucket.rank;
    if (a.area !== b.area) return a.area.localeCompare(b.area);
    return a.pageId.localeCompare(b.pageId);
  });

  const lines: string[] = [];
  lines.push(`# ${platform.program} · page prompts — ${platform.label} (GENERATED)`);
  lines.push('');
  lines.push(
    'Generated by `apps/tools/gen-ui-prompts.ts` from `apps/parity/parity-manifest.json` — ' +
      'one prompt per web page unit, in dependency order (foundational pages first, detail pages last). ' +
      'Do not hand-edit; re-run the generator (`--check` enforces no drift).',
  );
  lines.push('');
  lines.push('| # | Order | Area | Page | Parity unit | Required | Prompt |');
  lines.push('|---|---|---|---|---|---|---|');
  ordered.forEach((v, i) => {
    const rel = `${v.area}/${v.pageId}.prompt.md`;
    lines.push(
      `| ${i + 1} | ${v.bucket.label} | ${v.area} | ${v.pageId} | \`${v.unit.id}\` | ${v.unit.requiredCount} | [${v.pageId}](./${rel}) |`,
    );
  });
  lines.push('');
  lines.push(`Total: ${ordered.length} page prompts.`);
  lines.push('');
  return lines.join('\n');
}

// ── write mode: clean the pages trees, then write deterministic output ──────
function listExistingGenerated(): Set<string> {
  const existing = new Set<string>();
  for (const platform of PLATFORMS) {
    const pagesRoot = path.join(MONOREPO_DIR, platform.program, 'pages');
    if (!fs.existsSync(pagesRoot)) continue;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else if (entry.endsWith('.prompt.md') || entry === 'INDEX.md') existing.add(full);
      }
    };
    walk(pagesRoot);
  }
  return existing;
}

function pruneEmptyDirs(root: string): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root)) {
    const full = path.join(root, entry);
    if (fs.statSync(full).isDirectory()) {
      pruneEmptyDirs(full);
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    }
  }
}

function write(files: Map<string, string>): void {
  const desired = new Set(files.keys());
  // Remove stale generated files no longer in the manifest.
  for (const old of listExistingGenerated()) {
    if (!desired.has(old)) fs.rmSync(old);
  }
  for (const [abs, content] of files) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  for (const platform of PLATFORMS) {
    pruneEmptyDirs(path.join(MONOREPO_DIR, platform.program, 'pages'));
  }
}

// ── check mode: fail on any drift (content, missing, or extra files) ────────
function check(files: Map<string, string>): number {
  let drift = 0;
  for (const [abs, want] of files) {
    if (!fs.existsSync(abs)) {
      process.stderr.write(`MISSING: ${path.relative(repoRoot, abs)}\n`);
      drift++;
      continue;
    }
    const got = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    if (got !== want) {
      process.stderr.write(`DRIFT:   ${path.relative(repoRoot, abs)}\n`);
      drift++;
    }
  }
  const desired = new Set(files.keys());
  for (const existing of listExistingGenerated()) {
    if (!desired.has(existing)) {
      process.stderr.write(`EXTRA:   ${path.relative(repoRoot, existing)}\n`);
      drift++;
    }
  }
  return drift;
}

// ── main ────────────────────────────────────────────────────────────────────
function main(): void {
  const { files, pageCount } = renderAll();
  if (CHECK) {
    const drift = check(files);
    if (drift > 0) {
      process.stderr.write(`gen-ui-prompts --check: ${drift} drift(s) detected\n`);
      process.exit(1);
    }
    process.stdout.write(
      `gen-ui-prompts --check: OK — ${pageCount} pages × ${PLATFORMS.length} platforms, no drift\n`,
    );
    return;
  }
  write(files);
  process.stdout.write(
    `gen-ui-prompts: wrote ${files.size} files (${pageCount} pages × ${PLATFORMS.length} platforms + ${PLATFORMS.length} indexes)\n`,
  );
}

main();
