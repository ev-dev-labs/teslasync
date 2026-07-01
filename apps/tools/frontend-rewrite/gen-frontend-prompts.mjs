#!/usr/bin/env node
/*
 * gen-frontend-prompts.mjs — generate the full prompt set for the TeslaSync
 * frontend "gold standard" rewrite (branch refactor/frontend-gold-standard-rewrite).
 *
 * Scope (per user mandate: mobile-friendly, best UI on the internet, long-term
 * support, true gold standard — FULL coverage, NO partial migration):
 *   p0-foundation          — React 19 + Compiler, React Router v7, Tailwind v4
 *   p1-tooling             — Storybook+Chromatic scaffold, Playwright scaffold, PWA
 *   p2-radix-primitives    — one prompt per interactive components/ui/* primitive
 *   p3-charts-shared       — one prompt per shared components/charts/* building block
 *   p4-charts-pages        — one prompt per page file consuming charts (verification)
 *   p5-maps-shared         — one prompt per shared components/maps/* building block
 *   p6-maps-pages          — one prompt per page file consuming maps (verification)
 *   p7-storybook-stories   — one prompt per shared component across all 9 categories
 *   p8-e2e-pages           — one Playwright E2E prompt per page (mobile+desktop)
 *
 * Every prompt bakes in TWO personas (Implementer + Gold-Standard Reviewer) so a
 * single agent invocation still gets an internal adversarial review pass before
 * committing. Every prompt is gated by web/scripts/frontend-gate.sh and MUST NOT
 * be marked done on red. The runner (run-prompts.sh, copied+adapted from the RN
 * conversion) executes prompts in parallel git worktrees — this is the "fleet of
 * agents" mechanism. frontend-loop.sh drives all programs to completion in
 * dependency order, and is meant to be launched detached and left running.
 *
 * Idempotent: rewrites the program dirs from scratch each run. Re-run freely.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const WEB = path.join(REPO, 'web', 'src');
const PROMPTS = path.join(REPO, '.github', 'prompts', 'frontend-gold-standard');

const SKIP = /(\.test\.|\.spec\.|\.stories\.|\.d\.ts$|__tests__|__mocks__|index\.ts$)/;
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !SKIP.test(p.replace(/\\/g, '/'))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(REPO, p).replace(/\\/g, '/');
const webRel = (p) => path.relative(path.join(REPO, 'web'), p).replace(/\\/g, '/'); // relative to web/
const slugify = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

function fileMentionsAny(file, needles) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return needles.some((n) => txt.includes(n));
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------
const PERSONAS = [
  '### Personas (both required — this is not optional)',
  '',
  '**Persona 1 — Senior Frontend Engineer (implementer).** Do the migration work',
  'described below completely. No partial coverage, no "simplified" version, no',
  'deferring part of this unit to "a follow-up".',
  '',
  '**Persona 2 — Staff UI/UX Reviewer (gold-standard bar).** Before committing,',
  'switch hats and critique the Persona-1 output as a skeptical senior reviewer',
  'whose job is literally to block anything that is not gold-standard. Check',
  'explicitly against ALL FOUR program requirements:',
  '  1. **Mobile-friendly** — touch targets ≥44px, responsive at 375px width, no',
  '     hover-only affordances, gestures work (swipe/pinch where relevant).',
  '  2. **Best UI on the internet** — matches the polish bar of Linear/Vercel/Stripe:',
  '     correct focus states, smooth motion, no layout shift, no jank.',
  '  3. **Long-term support** — no experimental/unmaintained deps, no version pins',
  '     that fight peer deps, no APIs marked deprecated in current docs.',
  '  4. **True gold standard, no partial** — every branch/state/variant of the',
  "     original is preserved (loading/error/empty), nothing silently dropped.",
  'If Persona 2 finds a gap, go back to Persona 1 and fix it BEFORE running the',
  'gate. Do not commit anything Persona 2 would not personally approve.',
].join('\n');

const NO_PARTIAL = [
  '### Non-negotiable ground rules',
  '- **No partial work.** Every file/component in this unit\'s scope must be fully',
  '  migrated — not "the common case" or "the main path". If something is hard,',
  '  do the hard part; do not silently narrow scope.',
  '- Preserve the **existing external prop API** of shared components so the 268+',
  '  call-sites across 20 feature domains do not need to change.',
  '- Preserve **every** `t(\'key\',\'default\')` i18n call verbatim. Zero hardcoded',
  '  user-facing strings.',
  '- Preserve **loading / error / empty** states exactly as they exist today.',
  '- **Null safety**: `value ?? 0`, `label ?? \'—\'`, `items ?? []` — never call',
  '  `.map`/`.filter`/`.length` on possibly-undefined data.',
  '- **No `any`** (mark unavoidable casts `// ok-any` + reason). No',
  '  `dangerouslySetInnerHTML`. No TODO/FIXME/placeholder/stub/"Coming soon" as',
  '  final output.',
  '- Touch ONLY the files this unit names. Read anything else in `web/src/**`',
  '  freely for context.',
].join('\n');

function gate(targets) {
  const list = targets.map((t) => `'${t}'`).join(' ');
  return [
    '## Gate (run exactly; commit only if GATE=PASS)',
    '',
    '```bash',
    'cd web',
    'bash scripts/frontend-gate.sh ' + list,
    'echo "GATE_EXIT=$?"',
    '```',
    '',
    '- `GATE=PASS` ⇒ commit, print `EXIT=0` / `STATUS=DONE`.',
    '- `GATE=FAIL` ⇒ fix and re-run (Persona 2 should have caught most of these',
    '  before you even got here). If truly blocked by a missing sibling this unit',
    '  depends on, print `EXIT=1` / `STATUS=BLOCKED` naming the missing module —',
    '  the driver re-runs pending units after siblings land. Never commit on red.',
  ].join('\n');
}

function commitBlock(targets, msg) {
  return [
    '## Commit (only after GATE=PASS)',
    '',
    '```bash',
    'git add ' + targets.map((t) => 'web/' + t).join(' '),
    `git commit -m "${msg}`,
    '',
    'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"',
    '```',
    '',
    '```',
    'EXIT=0',
    'STATUS=DONE',
    '```',
  ].join('\n');
}

function header(title) {
  return ['---', `description: "Frontend gold-standard rewrite — ${title}"`, '---', ''].join('\n');
}

function writePrompt(programDir, seq, slug, body) {
  const dir = path.join(PROMPTS, programDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(seq).padStart(4, '0')}-${slug}.prompt.md`);
  fs.writeFileSync(file, body, 'utf8');
}

function clearProgram(programDir) {
  const dir = path.join(PROMPTS, programDir);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.prompt.md')) fs.rmSync(path.join(dir, f));
    }
  }
}

let totalPrompts = 0;
function report(programDir, n) {
  totalPrompts += n;
  console.log(`  ${programDir}: ${n} prompts`);
}

// ---------------------------------------------------------------------------
// p0 — foundation (fixed, ordered list — everything else depends on this)
// ---------------------------------------------------------------------------
function genFoundation() {
  clearProgram('p0-foundation');
  const targets = ['package.json', 'vite.config.ts'];
  const units = [
    {
      slug: 'react-19-upgrade',
      title: 'React 18 → React 19 upgrade',
      body: [
        'Upgrade `react` + `react-dom` to v19 in `web/package.json` (and matching',
        '`@types/react` / `@types/react-dom`). Run `npm install` in `web/`. Fix any',
        'breaking changes surfaced by `npx tsc --noEmit` across the WHOLE app (ref',
        'cleanup, removed deprecated APIs, `useFormStatus`/`useOptimistic` are NOT',
        'required to adopt, only fix what actually breaks). Do not skip files —',
        'if tsc reports errors in 40 files, fix all 40.',
      ].join('\n'),
    },
    {
      slug: 'react-compiler-setup',
      title: 'React Compiler (babel-plugin-react-compiler) integration',
      body: [
        'Add the React Compiler Vite plugin so components are auto-memoized.',
        'Configure it in `web/vite.config.ts`. Do NOT bulk-delete existing',
        '`useMemo`/`useCallback` calls in this unit (that is a separate, later',
        'cleanup pass) — just get the compiler running in build+dev with zero',
        'new warnings/errors.',
      ].join('\n'),
    },
    {
      slug: 'react-router-v7-upgrade',
      title: 'react-router-dom v6 → React Router v7 upgrade',
      body: [
        'Upgrade `react-router-dom` to v7 (package name may change to `react-router`',
        '— follow the official v7 migration guide). Update every import across',
        '`web/src/**` (routes, `useNavigate`, `useParams`, `useSearchParams`,',
        '`Link`, lazy route definitions for all 164 pages). Verify every route',
        'still resolves — do not skip any of the 20 feature domains.',
      ].join('\n'),
    },
    {
      slug: 'tailwind-v4-upgrade',
      title: 'Tailwind CSS v3 → v4 upgrade',
      body: [
        'Upgrade Tailwind to v4 (new Oxide engine). Migrate `tailwind.config.js` to',
        'the v4 CSS-first config where applicable, update PostCSS config, and drop',
        '`@tailwindcss/container-queries` (native in v4) while preserving identical',
        'behavior. Re-run and fix ALL ~28 custom `audit:*` scripts in',
        '`web/package.json` — they inspect Tailwind class strings/tokens and may',
        'need updates for v4 syntax. Every audit script must still pass.',
      ].join('\n'),
    },
  ];
  units.forEach((u, i) => {
    const body = [
      header(u.title),
      `# ${u.title}`,
      '',
      PERSONAS,
      '',
      NO_PARTIAL,
      '',
      '## Task',
      u.body,
      '',
      gate(targets),
      '',
      commitBlock(targets, `chore(web): ${u.title}`),
    ].join('\n');
    writePrompt('p0-foundation', i + 1, u.slug, body);
  });
  report('p0-foundation', units.length);
}

// ---------------------------------------------------------------------------
// p1 — tooling (fixed list)
// ---------------------------------------------------------------------------
function genTooling() {
  clearProgram('p1-tooling');
  const units = [
    {
      slug: 'storybook-scaffold',
      title: 'Storybook 8 scaffold (Vite builder + Tailwind wired)',
      body: [
        'Install and configure Storybook 8 with the Vite builder in `web/`.',
        'Wire Tailwind so stories render with full design-system styling. Add an',
        '`npm run storybook` script. This unit only needs the scaffold + ONE',
        'smoke-test story (Button) — the full story set is generated by the',
        '`p7-storybook-stories` program.',
      ].join('\n'),
    },
    {
      slug: 'chromatic-ci-wiring',
      title: 'Chromatic visual regression CI wiring',
      body: [
        'Add a Chromatic GitHub Actions workflow that runs on PRs touching',
        '`web/src/components/**`, publishing Storybook and flagging visual diffs.',
        'Document the required `CHROMATIC_PROJECT_TOKEN` secret in the workflow',
        'comments (do not hardcode a token).',
      ].join('\n'),
    },
    {
      slug: 'playwright-scaffold',
      title: 'Playwright E2E scaffold (mobile + desktop projects)',
      body: [
        'Install Playwright in `web/`. Add `playwright.config.ts` with at least',
        'two projects: `desktop-chrome` (1280x800) and `mobile-safari` (iPhone 14',
        'viewport via `devices[\'iPhone 14\']`). Add an `npm run test:e2e` script',
        'and a CI workflow. This unit only needs the scaffold + one smoke test',
        '(app boots, dashboard renders) — the full per-page suite is generated by',
        'the `p8-e2e-pages` program.',
      ].join('\n'),
    },
    {
      slug: 'pwa-full-config',
      title: 'Complete vite-plugin-pwa configuration (already installed)',
      body: [
        '`vite-plugin-pwa` is already a devDependency but may not be fully',
        'configured. Verify/complete: full manifest (name, icons at all required',
        'sizes, theme_color, display:standalone), a real offline-capable service',
        'worker (precache app shell, runtime-cache API GETs with a sane strategy),',
        'and an in-app "install app" / "update available" prompt using the',
        'existing `components/feedback/InstallPrompt.tsx` and',
        '`ReloadPrompt.tsx` if present (extend them if not fully wired — do not',
        'duplicate).',
      ].join('\n'),
    },
  ];
  units.forEach((u, i) => {
    const targets = ['package.json'];
    const body = [
      header(u.title),
      `# ${u.title}`,
      '',
      PERSONAS,
      '',
      NO_PARTIAL,
      '',
      '## Task',
      u.body,
      '',
      gate(targets),
      '',
      commitBlock(targets, `chore(web): ${u.title}`),
    ].join('\n');
    writePrompt('p1-tooling', i + 1, u.slug, body);
  });
  report('p1-tooling', units.length);
}

// ---------------------------------------------------------------------------
// p2 — Radix/Base UI primitives (curated list of interactive components)
// ---------------------------------------------------------------------------
const RADIX_TARGETS = [
  ['Modal', 'Dialog (modal, focus trap, escape-to-close)'],
  ['ConfirmDialog', 'AlertDialog'],
  ['Popover', 'Popover'],
  ['Select', 'Select'],
  ['Tabs', 'Tabs'],
  ['TabNav', 'Tabs (navigation variant)'],
  ['Toggle', 'Switch'],
  ['Slider', 'Slider'],
  ['RangeSlider', 'Slider (range mode)'],
  ['Tooltip', 'Tooltip'],
  ['HelpTooltip', 'Tooltip (info variant)'],
  ['Accordion', 'Accordion'],
  ['Drawer', 'Dialog (side-sheet variant) or Vaul'],
  ['CommandPalette', 'Dialog + cmdk (already Radix-adjacent — verify)'],
  ['Checkbox', 'Checkbox'],
];
function genRadixPrimitives() {
  clearProgram('p2-radix-primitives');
  RADIX_TARGETS.forEach(([comp, radixPrim], i) => {
    const file = `src/components/ui/${comp}.tsx`;
    const targets = [file];
    const body = [
      header(`Radix/Base UI under ${comp}`),
      `# Rebuild components/ui/${comp}.tsx on Radix UI primitives`,
      '',
      PERSONAS,
      '',
      NO_PARTIAL,
      '',
      '## Task',
      `Rewrite \`web/${file}\` to use the Radix UI **${radixPrim}** primitive`,
      'internally (`@radix-ui/react-*`, add the exact package to',
      '`web/package.json` if missing) instead of the current hand-rolled',
      'implementation. Requirements:',
      '- The **external prop API must not change** — every existing call-site',
      '  across the app must keep working with zero edits.',
      '- Keep the exact current visual design (glassmorphism, Tailwind classes,',
      '  motion) — Radix primitives are unstyled, so port the existing classes',
      '  onto the Radix parts.',
      '- Gain correct focus-trap, keyboard nav (Tab/Shift+Tab/Escape/Arrow keys',
      '  as appropriate for this primitive), and ARIA roles from Radix — verify',
      '  these actually work, don\'t just assume.',
      '- Preserve/improve mobile touch behavior (tap targets, swipe-to-dismiss',
      '  for sheet-like components where natural).',
      '- Grep the codebase for every import of this component',
      `  (\`grep -rl "${comp}" web/src --include=*.tsx\`) and spot-check at least`,
      '  3 real call-sites across different feature domains still render/behave',
      '  correctly after the change (describe what you checked).',
      '',
      gate(targets),
      '',
      commitBlock(targets, `refactor(web): rebuild ${comp} on Radix UI ${radixPrim}`),
    ].join('\n');
    writePrompt('p2-radix-primitives', i + 1, slugify(`radix-${comp}`), body);
  });
  report('p2-radix-primitives', RADIX_TARGETS.length);
}

// ---------------------------------------------------------------------------
// p3 — charts shared building blocks (curated list, off recharts internals)
// ---------------------------------------------------------------------------
const CHART_SHARED_TARGETS = [
  ['ChartContainer', 'the core responsive container + axes/grid/legend host — this is the highest-leverage unit, do it first'],
  ['RadialGauge', 'gauge/dial visualization (battery %, efficiency score, etc.)'],
  ['Sparkline', 'tiny inline trend chart'],
  ['MiniChart', 'small compact chart used in cards'],
  ['SmallMultiplesChart', 'grid of small repeated charts'],
  ['AreaChartWrapper', 'area/line chart wrapper (the most-used chart type)'],
  ['ChartTooltip', 'hover tooltip'],
  ['ChartGradient', 'gradient fill defs'],
  ['ChartBrush', 'zoom/pan brush control'],
  ['ChartLegend', 'legend with series toggle'],
  ['ElevationProfile', 'route elevation chart (used on trip/drive maps)'],
  ['chartUtils', 'shared scales/formatters/margins/colors — port to visx scale helpers'],
];
function genChartsShared() {
  clearProgram('p3-charts-shared');
  CHART_SHARED_TARGETS.forEach(([comp, desc], i) => {
    const file = `src/components/charts/${comp}.tsx`;
    const targets = [file, 'src/components/charts/index.ts'];
    const isHighFreq = comp === 'ChartContainer' || comp === 'AreaChartWrapper' || comp === 'ElevationProfile';
    const engine = isHighFreq
      ? 'uPlot (canvas-based) — this component renders high-frequency live SSE telemetry data and must not re-render-thrash on every tick'
      : 'visx (SVG/D3-based) — this component is lower-frequency/bespoke and benefits from visx\'s full styling control';
    const body = [
      header(`Migrate ${comp} off recharts`),
      `# Rewrite components/charts/${comp}.tsx off recharts onto ${isHighFreq ? 'uPlot' : 'visx'}`,
      '',
      PERSONAS,
      '',
      NO_PARTIAL,
      '',
      '## Task',
      `Reimplement \`web/${file}\` (${desc}) using **${engine}**, replacing its`,
      'current recharts-based internals. Requirements:',
      '- **External prop API must not change** — every page consuming this',
      '  component (verified in the later `p4-charts-pages` program) keeps',
      '  working with zero edits to call-sites.',
      '- Match current visual design: same color tokens (`CHART_COLORS`,',
      '  `NEON_COLORS` from `chartUtils`), same gradients, same responsive',
      '  behavior, same tooltip content/format, same legend toggle behavior.',
      '- **Mobile**: touch-based tooltip activation (tap, not just hover), and',
      '  the chart must reflow correctly at 375px width — verify, don\'t assume.',
      '- If this is the shared `chartUtils`/`ChartContainer`/`ChartGradient`',
      '  base that other chart components depend on, do this FIRST and make sure',
      '  its exported shape (colors, formatters, margin constants) is unchanged',
      '  so dependent components in this same program keep compiling.',
      '- Do NOT remove the component from `components/charts/index.ts` — only',
      '  change its internal implementation.',
      '',
      gate(targets),
      '',
      commitBlock(targets, `refactor(web): migrate ${comp} off recharts to ${isHighFreq ? 'uPlot' : 'visx'}`),
    ].join('\n');
    writePrompt('p3-charts-shared', i + 1, slugify(`chart-shared-${comp}`), body);
  });
  report('p3-charts-shared', CHART_SHARED_TARGETS.length);
}

// ---------------------------------------------------------------------------
// p4 — charts consuming pages (scanned — every file that imports chart pieces)
// ---------------------------------------------------------------------------
function genChartsPages() {
  clearProgram('p4-charts-pages');
  const files = walk(path.join(WEB, 'features')).filter((f) =>
    fileMentionsAny(f, ['recharts', 'ChartContainer', 'LineChart', 'AreaChart', 'BarChart', 'RadialGauge', 'Sparkline', 'components/charts'])
  );
  files.forEach((f, i) => {
    const wr = webRel(f);
    const targets = [wr];
    const body = [
      header(`Verify chart migration — ${wr}`),
      `# Verify ${wr} against the migrated (visx/uPlot) chart components`,
      '',
      PERSONAS,
      '',
      NO_PARTIAL,
      '',
      '## Task',
      `File \`web/${wr}\` consumes shared chart components that were migrated`,
      'off recharts in the `p3-charts-shared` program. Verify and fix:',
      '- All chart props still match the new component signatures (they should',
      '  be unchanged, but confirm — do not assume).',
      '- The chart renders correctly: correct data, correct colors/gradients,',
      '  tooltip works on both hover (desktop) AND tap (mobile).',
      '- Loading/empty/error states around the chart are intact.',
      '- No direct `from \'recharts\'` import remains in this file (it must only',
      '  use `@/components/charts`).',
      '- If this file has a Vitest test, run it and fix any breakage; if it has',
      '  no test, do not add one here (covered by `p8-e2e-pages`).',
      '',
      gate(targets),
      '',
      commitBlock(targets, `fix(web): verify ${path.basename(wr)} against migrated chart components`),
    ].join('\n');
    writePrompt('p4-charts-pages', i + 1, slugify(wr.replace(/\.tsx?$/, '')), body);
  });
  report('p4-charts-pages', files.length);
}

// ---------------------------------------------------------------------------
// p5 — maps shared building blocks (curated list, off react-leaflet internals)
// ---------------------------------------------------------------------------
const MAPS_SHARED_TARGETS = [
  ['MapTileLayer', 'base tile layer + style switching (this is the core — do first)'],
  ['MapLayerSwitcher', 'UI control to switch map styles/layers'],
  ['AnimatedMarker', 'smoothly-animated vehicle position marker'],
  ['vehicleIcon', 'vehicle marker icon factory'],
  ['MapInvalidator', 'handles container resize/invalidation'],
];
function genMapsShared() {
  clearProgram('p5-maps-shared');
  MAPS_SHARED_TARGETS.forEach(([comp, desc], i) => {
    const file = `src/components/maps/${comp}.tsx`;
    const targets = [file, 'src/components/maps/index.ts'];
    const body = [
      header(`Migrate ${comp} off react-leaflet`),
      `# Rewrite components/maps/${comp}.tsx off react-leaflet onto MapLibre GL`,
      '',
      PERSONAS,
      '',
      NO_PARTIAL,
      '',
      '## Task',
      `Reimplement \`web/${file}\` (${desc}) using **MapLibre GL JS** (via`,
      '`react-map-gl` with the maplibre adapter, or `maplibre-gl` directly),',
      'replacing react-leaflet/leaflet. Requirements:',
      '- Also port whichever of these plugin behaviors this component relies on:',
      '  marker clustering (leaflet.markercluster → MapLibre GL',
      '  `cluster`/`cluster-count` layers), heatmap (leaflet.heat → MapLibre',
      '  `heatmap` layer type), draw tools (leaflet-draw → `@mapbox/mapbox-gl-draw`',
      '  built against the MapLibre GL instance).',
      '- **External prop API must not change** — consuming pages (verified in',
      '  `p6-maps-pages`) keep working with zero edits.',
      '- **Mobile**: native pinch-zoom/pan/rotate gestures must work — this is a',
      '  primary reason for choosing WebGL vector tiles, verify it actually works',
      '  in a touch-emulated browser context, don\'t assume.',
      '- Match current visual design (marker icons, colors, popups/tooltips).',
      '',
      gate(targets),
      '',
      commitBlock(targets, `refactor(web): migrate ${comp} off react-leaflet to MapLibre GL`),
    ].join('\n');
    writePrompt('p5-maps-shared', i + 1, slugify(`map-shared-${comp}`), body);
  });
  report('p5-maps-shared', MAPS_SHARED_TARGETS.length);
}

// ---------------------------------------------------------------------------
// p6 — maps consuming pages (scanned)
// ---------------------------------------------------------------------------
function genMapsPages() {
  clearProgram('p6-maps-pages');
  const files = walk(path.join(WEB, 'features')).filter((f) =>
    fileMentionsAny(f, ['react-leaflet', 'MapContainer', 'components/maps', 'leaflet'])
  );
  files.forEach((f, i) => {
    const wr = webRel(f);
    const targets = [wr];
    const body = [
      header(`Verify map migration — ${wr}`),
      `# Verify ${wr} against the migrated (MapLibre GL) map components`,
      '',
      PERSONAS,
      '',
      NO_PARTIAL,
      '',
      '## Task',
      `File \`web/${wr}\` consumes shared map components that were migrated to`,
      'MapLibre GL in the `p5-maps-shared` program. Verify and fix:',
      '- All map props (markers, polylines/routes, clustering, heatmap, draw',
      '  tools) still match the new component signatures.',
      '- No direct `from \'react-leaflet\'` / `from \'leaflet\'` import remains in',
      '  this file — it must only use `@/components/maps`.',
      '- Pinch/pan/zoom gesture behavior works correctly on mobile viewport.',
      '- Loading/empty/error states around the map are intact.',
      '',
      gate(targets),
      '',
      commitBlock(targets, `fix(web): verify ${path.basename(wr)} against migrated map components`),
    ].join('\n');
    writePrompt('p6-maps-pages', i + 1, slugify(wr.replace(/\.tsx?$/, '')), body);
  });
  report('p6-maps-pages', files.length);
}

// ---------------------------------------------------------------------------
// p7 — Storybook stories for every shared component (scanned, all categories)
// ---------------------------------------------------------------------------
function genStorybookStories() {
  clearProgram('p7-storybook-stories');
  const categories = ['ui', 'charts', 'data-display', 'layout', 'feedback', 'forms', 'maps', 'motion', 'vehicles'];
  let seq = 0;
  const all = [];
  for (const cat of categories) {
    const dir = path.join(WEB, 'components', cat);
    const files = walk(dir).filter((f) => !/\.stories\.tsx$/.test(f));
    for (const f of files) all.push({ cat, f });
  }
  all.forEach(({ cat, f }) => {
    seq += 1;
    const wr = webRel(f);
    const compName = path.basename(f).replace(/\.tsx?$/, '');
    const storyFile = wr.replace(/\.tsx?$/, '.stories.tsx');
    const targets = [storyFile];
    const body = [
      header(`Storybook story — ${compName}`),
      `# Write Storybook stories for components/${cat}/${compName}`,
      '',
      PERSONAS,
      '',
      NO_PARTIAL,
      '',
      '## Task',
      `Create \`web/${storyFile}\` (CSF3 format) covering \`${compName}\` from`,
      `\`web/${wr}\`. Requirements:`,
      '- A story for **every visually distinct state**: default, loading, error,',
      '  empty, disabled (if applicable), and at least one story at mobile',
      '  viewport width (375px) using Storybook viewport params.',
      '- Use realistic mock data/args, not empty placeholders.',
      '- Add `autodocs` tag so props are documented automatically.',
      '- If the component requires app context (TanStack Query, i18n, Router),',
      '  wrap it in the appropriate decorator (check `.storybook/preview.tsx`',
      '  for existing global decorators before adding new ones).',
      '',
      gate(targets),
      '',
      commitBlock(targets, `test(web): add Storybook stories for ${compName}`),
    ].join('\n');
    writePrompt('p7-storybook-stories', seq, slugify(`story-${cat}-${compName}`), body);
  });
  report('p7-storybook-stories', all.length);
}

// ---------------------------------------------------------------------------
// p8 — Playwright E2E, one per page (scanned, all 164 pages)
// ---------------------------------------------------------------------------
function genE2EPages() {
  clearProgram('p8-e2e-pages');
  const files = walk(path.join(WEB, 'features')).filter((f) => f.includes(`${path.sep}pages${path.sep}`));
  files.forEach((f, i) => {
    const wr = webRel(f);
    const pageName = path.basename(f).replace(/\.tsx?$/, '');
    const domain = wr.split('/')[2] || 'misc'; // features/<domain>/pages/X.tsx
    const specFile = `e2e/${domain}/${slugify(pageName)}.spec.ts`;
    const targets = [specFile];
    const body = [
      header(`Playwright E2E — ${pageName}`),
      `# Write Playwright E2E test for ${wr}`,
      '',
      PERSONAS,
      '',
      NO_PARTIAL,
      '',
      '## Task',
      `Create \`web/${specFile}\` covering the \`${pageName}\` page. Read`,
      `\`web/${wr}\` to understand what it renders and requires. Requirements:`,
      '- Run the spec against **both** Playwright projects configured in',
      '  `playwright.config.ts` (`desktop-chrome` and `mobile-safari`) — do not',
      '  restrict `test.describe` to a single project unless the page is',
      '  genuinely desktop-only (rare; justify if so).',
      '- Cover: page loads without console errors, primary content renders',
      '  (assert on a key heading/data element, not just "no crash"), at least',
      '  one interactive element works (click/tap a button, open a filter, etc.',
      '  — pick whatever is most central to this page), and the loading/empty',
      '  states are reachable and assertable (mock the API response via',
      '  `page.route` if needed to force each state).',
      '- Use accessible role-based locators (`getByRole`, `getByLabel`) over CSS',
      '  selectors, matching Testing-Library conventions already used in this',
      '  repo\'s Vitest suite.',
      '- Do not skip this page because it looks simple — every page gets a real',
      '  test, per program mandate (no partial coverage).',
      '',
      gate(targets),
      '',
      commitBlock(targets, `test(web): add Playwright E2E coverage for ${pageName}`),
    ].join('\n');
    writePrompt('p8-e2e-pages', i + 1, slugify(`e2e-${domain}-${pageName}`), body);
  });
  report('p8-e2e-pages', files.length);
}

// ---------------------------------------------------------------------------
console.log('Generating frontend gold-standard rewrite prompts...');
fs.mkdirSync(PROMPTS, { recursive: true });
genFoundation();
genTooling();
genRadixPrimitives();
genChartsShared();
genChartsPages();
genMapsShared();
genMapsPages();
genStorybookStories();
genE2EPages();
console.log(`TOTAL: ${totalPrompts} prompts written under ${rel(PROMPTS)}/`);
