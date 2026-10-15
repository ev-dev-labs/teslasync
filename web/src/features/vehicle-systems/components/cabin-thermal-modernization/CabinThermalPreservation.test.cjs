/* Pure/fake-presenter checks only. No DOM, network, QueryClient or Vitest runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../../../../..');
const baseline = process.env.TESLASYNC_CABIN_BASELINE;
if (!baseline) throw new Error('TESLASYNC_CABIN_BASELINE must point at captured live originals');
const pagePath = 'web/src/features/vehicle-systems/pages/CabinThermalPage.tsx';
const privatePath = 'web/src/features/vehicle-systems/components/cabin-thermal-modernization';

function load(relative, mocks = {}, sourceRoot = root, cache = new Map()) {
  const filename = path.join(sourceRoot, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  cache.set(filename, mod);
  mod.require = spec => {
    if (Object.hasOwn(mocks, spec)) return mocks[spec];
    const base = spec.startsWith('@/') ? path.join(sourceRoot, 'web/src', spec.slice(2))
      : spec.startsWith('.') ? path.resolve(path.dirname(filename), spec) : null;
    if (!base) return require(spec);
    const found = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
      .map(ext => base + ext).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (!found) throw new Error(`Unresolved ${spec} from ${relative}`);
    return load(path.relative(sourceRoot, found), mocks, sourceRoot, cache);
  };
  mod._compile(`const React = require('react');\n${compiled}`, filename);
  return mod.exports;
}

const { deriveDataState } = load('web/src/api/dataState.ts');
const { cabinThermalSourceState } = load(`${privatePath}/sourceState.ts`);
const { presentCabinThermalLedger } = load(`${privatePath}/ledgerPresenter.ts`);
const { summarizeCabinThermal } = load('web/src/features/vehicle-systems/lib/cabinThermal.ts');
const conversions = load('web/src/lib/unitConversion.ts');
const emptySummary = () => summarizeCabinThermal([]);
const error = new Error('refresh fixture');
const retry = () => undefined;
const coolingRows = [0, 15, 30, 45].map(minutes => ({
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString(),
  insideTemp: 22 + 23 * Math.exp(-minutes / 60), outsideTemp: 22, isAcOn: false,
}));
const warmingRows = [0, 15, 30, 45].map(minutes => ({
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString(),
  insideTemp: 22 - 17 * Math.exp(-minutes / 60), outsideTemp: 22, isAcOn: false,
}));

function adapt(source, selected = true) {
  return cabinThermalSourceState(deriveDataState(source, { provenance: 'historical' }), {
    isLoading: Boolean(source.isLoading), isSuccess: Boolean(source.isSuccess),
  }, selected, retry);
}

test('source trust keeps successful rows, including an empty response, on refresh failure', () => {
  for (const data of [[], [{ insideTemp: 0, outsideTemp: 0 }]]) {
    const trust = deriveDataState({ data, error, isError: true, isFetching: false });
    const state = cabinThermalSourceState(trust, { isLoading: false, isSuccess: false }, true, retry);
    assert.equal(trust.data, data);
    assert.equal(state.isResolved, true);
    assert.equal(state.error, null);
    assert.equal(state.refreshError, error);
    assert.equal(state.isLoading, false);
    assert.equal(state.onRetry, retry);
  }
});

test('initial loading, failure, paused and no-vehicle gates remain distinct', () => {
  assert.equal(adapt({ isLoading: true, isPending: true }).isLoading, true);
  assert.equal(adapt({ error, isError: true }).error, error);
  assert.equal(adapt({ error, isError: true }).refreshError, null);
  assert.equal(adapt({ fetchStatus: 'paused', isLoading: false }).isLoading, false);
  assert.equal(adapt({ data: [], fetchStatus: 'paused' }).isResolved, true);
  assert.equal(adapt({ data: [], isSuccess: true }, false).isResolved, false);
  assert.equal(adapt({ isLoading: true }, false).isLoading, false);
});

test('ledger preserves legitimate zero and withholds unresolved/null/missing/nonfinite values', () => {
  const summary = emptySummary();
  const display = presentCabinThermalLedger(summary, true, String, String);
  assert.deepEqual(display.slice(0, 5).map(f => f.value), ['0', '0', '0', '0', '0']);
  assert.equal(display[5].value, null);
  assert.ok(presentCabinThermalLedger(summary, false, String, String).every(f => f.value === null));
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    const fake = { ...summary, accounting: { ...summary.accounting, returnedRows: value }, tauMin: value };
    const facts = presentCabinThermalLedger(fake, true, String, String);
    assert.equal(facts[0].value, null);
    assert.equal(facts[5].value, null);
    assert.equal(facts[5].raw, null);
  }
  const zeroTau = presentCabinThermalLedger({ ...summary, tauMin: 0 }, true, String, String)[5];
  assert.deepEqual(zeroTau, { id: 'tau', raw: 0, value: '0' });
});

test('duration keeps seconds input and the actual units/locale/precision formatter contract', () => {
  for (const duration of ['h', 'min', 's']) {
    for (const locale of ['en-US', 'de-DE']) {
      const prefs = { duration, locale, precision: 2 };
      const summary = { ...emptySummary(), tauMin: 37.5 };
      const calls = [];
      const format = seconds => { calls.push(seconds); return conversions.formatDuration(seconds, prefs); };
      const fact = presentCabinThermalLedger(summary, true, String, format)[5];
      assert.equal(fact.raw, 2250);
      assert.deepEqual(calls, [2250]);
      assert.equal(fact.value, conversions.formatDuration(2250, prefs));
    }
  }
});

test('actual analysis distinguishes zero temperatures from missing/unknown/nonfinite rows and accepts both directions', () => {
  const rows = [
    { timestamp: '2026-01-01T00:00:00Z', insideTemp: 0, outsideTemp: 0, isAcOn: false },
    { timestamp: '2026-01-01T00:01:00Z', insideTemp: null, outsideTemp: 0 },
    { timestamp: '2026-01-01T00:02:00Z', outsideTemp: 0 },
    { timestamp: '2026-01-01T00:03:00Z', insideTemp: NaN, outsideTemp: 0 },
    { timestamp: '2026-01-01T00:04:00Z', insideTemp: 0, outsideTemp: Infinity },
    { timestamp: '2026-01-01T00:05:00Z', insideTemp: 0, outsideTemp: 0 },
  ];
  const summary = summarizeCabinThermal(rows);
  assert.equal(summary.accounting.returnedRows, 6);
  assert.equal(summary.accounting.normalizedRows, 2);
  assert.equal(summary.rowExclusions.missing_inside_temperature, 2);
  assert.equal(summary.rowExclusions.nonfinite_inside_temperature, 1);
  assert.equal(summary.rowExclusions.nonfinite_outside_temperature, 1);
  assert.equal(summary.coverage.hvacUnknownSamples, 1);
  assert.equal(summary.tauMin, null);
  for (const samples of [coolingRows, warmingRows]) {
    const accepted = summarizeCabinThermal(samples);
    assert.equal(accepted.accounting.acceptedFits, 1);
    assert.ok(Math.abs(accepted.tauMin - 60) < 1e-8);
    assert.equal(accepted.events[0].cooling, samples === coolingRows);
  }
});

function syntax(text, name) {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function jsxSections(source) {
  const sections = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source).startsWith('CabinThermal')
      && !['CabinThermalGrid', 'CabinThermalEvidenceStats', 'CabinThermalEvidenceKpiBand'].includes(node.tagName.getText(source))) {
      sections.push(node.getText(source).replace(/\s/g, ''));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return sections;
}

test('all thirteen specialist sections retain exact props and source order', () => {
  const before = syntax(fs.readFileSync(path.join(baseline, pagePath), 'utf8'), pagePath);
  const after = syntax(fs.readFileSync(path.join(root, pagePath), 'utf8'), pagePath);
  assert.equal(jsxSections(before).length, 13);
  assert.deepEqual(jsxSections(after), jsxSections(before));
});

test('unchanged feature closure preserves every series, derivation, threshold, cap, action and preference identity', () => {
  const feature = 'web/src/features/vehicle-systems';
  const names = fs.readdirSync(path.join(baseline, feature, 'components/cabin-thermal'));
  const files = names.map(name => `${feature}/components/cabin-thermal/${name}`);
  files.push(`${feature}/lib/cabinThermal.ts`, 'web/src/api/hooks/useVehicleSystems.ts',
    'web/src/hooks/useUnits.ts', 'web/src/hooks/useSelectedVehicle.ts', 'web/src/lib/workspaceScope.ts');
  for (const file of files) {
    assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(baseline, file)), file);
  }
});

const react = {
  useMemo: fn => fn(),
  createElement: (type, props, ...children) => typeof type === 'function'
    ? type({ ...props, children }) : { type, props: { ...props, children } },
};
const sectionNames = [
  'CabinThermalEvidenceKpiBand', 'CabinThermalSourceCoverage', 'CabinThermalSegmentationDiagnostics',
  'CabinThermalCandidateDisposition', 'CabinThermalRejectionReasons', 'CabinThermalAcceptanceFunnel',
  'CabinThermalThresholdMatrix', 'CabinThermalCandidateDirectory', 'CabinThermalFitQuality',
  'CabinThermalDirectionProfile', 'CabinThermalAcceptedDirectory', 'CabinThermalPredictionScenario',
  'CabinThermalAccountingMatrix', 'CabinThermalMethodology',
];
function fakePage(sourceRoot, vehicleId, query, units) {
  const queries = [];
  const sections = Object.fromEntries(sectionNames.map(name => [
    name, props => ({ section: name === 'CabinThermalEvidenceKpiBand' ? 'evidence' : name, props }),
  ]));
  const mocks = {
    react,
    'react-i18next': { useTranslation: () => ({ t: (_key, fallback) => fallback, i18n: { language: 'de' } }) },
    '@/api/hooks/useVehicleSystems': { useClimateHistory: id => { queries.push(id); return query; } },
    '@/hooks/usePageTitle': { usePageTitle: () => undefined },
    '@/hooks/useSelectedVehicle': { useSelectedVehicle: () => ({ vehicleId }) },
    '@/hooks/useUnits': { useUnits: () => units },
    '@/hooks/useDataState': { useDataState: source => deriveDataState(source, { provenance: 'historical' }) },
    '@/components/layout': {
      PageContainer: props => props,
      Grid: props => props.children,
    },
    '@/components/layout/layout-reference': { PageLayout: props => props },
    '@/components/motion': { FadeIn: props => props.children },
    '../components/cabin-thermal': sections,
    '../components/cabin-thermal-modernization': {
      cabinThermalSourceState,
      CabinThermalGrid: props => props.items.map(item => item.content),
      CabinThermalEvidenceStats: props => ({ section: 'evidence', props }),
    },
    '../lib/cabinThermal': { summarizeCabinThermal },
  };
  const result = load(pagePath, mocks, sourceRoot).default();
  const all = result.children.flat(Infinity).filter(value => value && value.section);
  return { result, all, queries };
}
function comparable(sections) {
  return sections.map(({ section, props }) => {
    const { children, state, ...rest } = props;
    if (!state) return { section, props: rest };
    const { onRetry, ...status } = state;
    return { section, props: { ...rest, state: status } };
  });
}

test('fake page parity: vehicle 0/no vehicle, load/empty/failure/retained, temperature units and neighbors', () => {
  const data = [
    { timestamp: '2026-01-01T00:00:00Z', insideTemp: 0, outsideTemp: 0, isAcOn: false },
    { timestamp: '2026-01-01T00:15:00Z', insideTemp: null, outsideTemp: 4, isAcOn: false },
  ];
  for (const vehicle of [null, 0, 42]) {
    for (const temperature of ['°C', '°F']) {
      for (const query of [
        { isLoading: true },
        { data: [], isSuccess: true },
        { isError: true, error },
        { data, isSuccess: true },
        { data, isError: true, error },
        { data, isFetching: true },
        { data: coolingRows, isSuccess: true },
        { data: warmingRows, isError: true, error },
      ]) {
        const units = { unitPrefs: { temperature, duration: 'h' }, formatTemperature: String, formatDuration: String };
        const source = { ...query, refetch: retry };
        const before = fakePage(baseline, vehicle, source, units);
        const after = fakePage(root, vehicle, source, units);
        assert.deepEqual(after.queries, before.queries);
        assert.deepEqual(after.queries, [vehicle == null ? '' : String(vehicle)]);
        assert.equal(after.all.length, 14);
        assert.deepEqual(comparable(after.all), comparable(before.all));
        assert.equal(after.result.query, source);
        assert.equal(after.result.title, before.result.title);
        assert.equal(after.result.subtitle, before.result.subtitle);
        assert.equal(after.all[7].props.formatTemperature, units.formatTemperature);
        assert.equal(after.all[11].props.durationUnit, 'h');
      }
    }
  }
});

test('shared mobile/container packing keeps all fourteen items and stable source order at every requested width', () => {
  const captured = [];
  const fake = {
    react,
    '@/lib/cn': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '@/components/layout/layout-reference': {
      CardGrid: props => { captured.push(props); return props; },
      useCardPlacement: () => ({ className: 'col-span-6' }),
    },
  };
  const render = load(`${privatePath}/CabinThermalGrid.tsx`, fake).CabinThermalGrid;
  const { packCardRows, containerPolicy } = load('web/src/components/layout/layout-reference/layoutPolicy.ts');
  const sizes = ['full', 'half', 'half', 'half', 'half', 'half', 'half', 'full',
    'half', 'half', 'full', 'full', 'full', 'full'];
  const items = sizes.map((size, index) => ({ id: String(index), size, content: `section-${index}` }));
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]) {
    const spans = packCardRows(sizes, width);
    const result = render({ items, label: 'fixture' });
    assert.equal(result.label, 'fixture');
    assert.equal(result.items.length, 14);
    assert.deepEqual(result.items.map(item => item.id), items.map(item => item.id));
    assert.deepEqual(result.items.map(item => item.content.props.children.flat(Infinity)[0]), items.map(item => item.content));
    assert.ok(spans.every(span => span >= 1 && span <= containerPolicy(width).columns));
    assert.equal(items[0].content, 'section-0');
  }
  assert.equal(captured.length, 10);
});

test('fake stat presenter renders six facts, original hints, single status owner and retained warning', () => {
  const fake = {
    react,
    'react-i18next': { useTranslation: () => ({
      t: (_key, fallback, vars) => vars ? fallback.replace('{{count}}', String(vars.count)) : fallback,
    }) },
    '@/hooks/useNumberFormatting': { useNumberFormatting: () => ({ fmtInt: String }) },
    '@/components/data-display/stat-reference': { StatStrip: props => ({ stats: props }) },
    '@/components/ui': { GlassPanel: props => ({ panel: props }) },
    '../cabin-thermal': { CabinThermalQueryStatus: props => ({ status: props }) },
  };
  const render = load(`${privatePath}/CabinThermalEvidenceStats.tsx`, fake).CabinThermalEvidenceStats;
  const summary = emptySummary();
  for (const source of [{ isLoading: true }, { data: [], isSuccess: true }, { data: [], error, isError: true }]) {
    const state = adapt(source);
    const output = render({ summary, state, formatDuration: String });
    const [strip, status] = output.props.children[0].panel.children;
    assert.equal(strip.stats.metrics.length, 6);
    assert.equal(strip.stats.period.kind, 'unknown');
    assert.equal(strip.stats.retained, Boolean(state.refreshError));
    assert.equal(status.status.state, state);
    assert.equal(strip.stats.metrics[0].rawValue, state.isResolved ? '0' : null);
    assert.equal(strip.stats.metrics[5].rawValue, null);
    assert.equal(strip.stats.metrics[1].context, state.isResolved ? '0 rows excluded' : 'Waiting for climate history…');
  }
});

test('query bounds/defaults and preference ownership are not introduced or rewritten', () => {
  const text = fs.readFileSync(path.join(root, pagePath), 'utf8');
  assert.match(text, /useClimateHistory\(vehicleIdStr\)/);
  assert.doesNotMatch(text, /useRangeState|RangePicker|DateRangeFilter|VehicleSelect|startInstant|endInstantExclusive/);
  assert.doesNotMatch(text, /queryKey:|staleTime:|retry:|enabled:|refetchInterval:|localStorage|setItem|\bfetch\(/);
  const oldHook = fs.readFileSync(path.join(baseline, 'web/src/api/hooks/useVehicleSystems.ts'), 'utf8');
  assert.match(oldHook, /request<ClimateState\[\]>\(`\/climate\?vehicle_id=\$\{vehicleId\}`, \{ signal \}\)/);
  assert.match(fs.readFileSync(path.join(root, 'internal/api/router.go'), 'utf8'), /r\.Route\("\/climate"[\s\S]*?r\.Get\("\/", climateHandler\.List\)/);
});
