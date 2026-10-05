/**
 * Small isolated Node suite: TS syntax transpilation + fake presentation SSR.
 * No project build, Vitest configuration, network, query client or command hooks.
 * Shared controls are captured, NOT a claim of real mobile/keyboard acceptance.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const require = createRequire(path.join(repo, 'web/package.json'));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const privateRoot = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(repo, 'web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx');
const artifactRoot = 'C:/Users/AtulM/.copilot/session-state/bba4960d-f516-4831-bda3-877640f907ce/files/parallel-media-player-page-live';
const acquired = fs.readFileSync(`${artifactRoot}/original.MediaPlayerPage.tsx`, 'utf8');
const current = fs.readFileSync(pagePath, 'utf8');
const h = React.createElement;
const translate = (_key, fallback, operands = {}) => fallback.replace(/\{\{(\w+)\}\}/g, (_, key) => operands[key] ?? '');

function compile(file, resolve) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.deepEqual((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error), [], `Syntax: ${file}`);
  const module = { exports: {} };
  const execute = vm.runInThisContext(`(function(require, module, exports) {\n${result.outputText}\n})`, { filename: file });
  execute(resolve, module, module.exports);
  return module.exports;
}
const pure = compile(path.join(privateRoot, 'mediaPresentation.ts'), name => { throw Error(`Unexpected pure import ${name}`); });
const snapshot = (overrides = {}) => ({
  id: 17, vehicle_id: 3, created_at: '2026-10-03T12:00:00Z',
  now_playing_title: 'Track original', now_playing_artist: 'Artist original',
  now_playing_album: 'Album original', now_playing_station: 'Station original',
  now_playing_duration: 180000, now_playing_elapsed: 60000,
  playback_status: 'playing', playback_source: 'Spotify',
  audio_volume: 0, audio_volume_max: 11, audio_volume_increment: 0.5,
  ...overrides,
});

function render({ media, history, mediaLoading = false, historyLoading = false,
  mediaError = null, historyError = null, vehicleId = 3, precision = 2 } = {}) {
  const captured = { panels: [], grids: [], strips: [], tables: [], gauges: [], charts: [], axes: [], errors: [], hookCalls: [], retry: { media: 0, history: 0 } };
  const shell = tag => ({ children }) => h(tag, null, children);
  const fmtNumber = value => value == null ? '—' : Number(value).toFixed(precision);
  const fmtInt = value => Number(value).toFixed(0);
  const mediaQuery = { data: media, isLoading: mediaLoading, error: mediaError, isFetching: mediaLoading, refetch: () => { captured.retry.media++; } };
  const historyQuery = { data: history, isLoading: historyLoading, error: historyError, isFetching: historyLoading, refetch: () => { captured.retry.history++; } };
  const modules = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '@/lib/cn': { cn: (...classes) => classes.filter(Boolean).join(' ') },
    '@/lib/tokens': { typography: { size: { xs: '' }, color: { secondary: '' } } },
    '@/lib/numberFormat': { fmtNumber },
    '@/lib/dateFormat': { formatDateTime: value => `date:${value}` },
    '@/lib/errorMessage': { getErrorMessage: error => error.message },
    '@/hooks/useNumberFormatting': { useNumberFormatting: () => ({ fmtNumber, fmtInt, precision, locale: 'en' }) },
    '@/hooks/useSelectedVehicle': { useSelectedVehicle: () => ({ vehicleId }) },
    '@/hooks/useRangeState': { useRangeState: options => {
      captured.rangeOptions = options;
      return { start: '2026-10-01', end: '2026-10-04' };
    } },
    '@/hooks/usePageTitle': { usePageTitle: title => { captured.title = title; } },
    '@/api/hooks/useVehicleSystems': {
      useMedia: id => { captured.hookCalls.push(['media', id]); return mediaQuery; },
      useMediaHistory: (id, range) => { captured.hookCalls.push(['history', id, range]); return historyQuery; },
    },
    '@/components/layout/layout-reference': {
      PageLayout: ({ children, title, query }) => { captured.pageQueries = query; return h('main', { 'aria-label': title }, children); },
      useCardPlacement: () => ({ className: 'col-span-6', size: 'half', span: 6 }),
      CardGrid: ({ items, label }) => { captured.grids.push({ items, label }); return h('section', { 'aria-label': label }, items.map(item => h(React.Fragment, { key: item.id }, item.content))); },
    },
    '@/components/ui': {
      GlassPanel: props => { captured.panels.push(props); return h('section', null, props.children); },
      Badge: shell('span'), Text: ({ children, as = 'span' }) => h(as, null, children),
      Caption: ({ children, role }) => h('span', { role }, children), PanelTitle: shell('h2'),
      DataTable: props => { captured.tables.push(props); return h('section', { 'aria-label': props.caption }, props.data.map(row => h('div', { key: row.id }, props.columns.map(col => h('div', { key: col.key }, col.render(row)))))); },
    },
    '@/components/data-display': { TimeStamp: ({ value }) => h('time', null, value) },
    '@/components/feedback': {
      EmptyState: ({ message }) => h('p', null, message),
      Skeleton: () => h('span', { 'data-loading': true }, 'Loading fake source'),
      AlertBanner: shell('aside'),
      QueryError: props => { captured.errors.push(props); return h('div', { role: 'alert' }, props.error.message); },
    },
    '@/components/motion': { FadeIn: shell('div') },
    '@/components/data-display/stat-reference': {
      StatStrip: props => { captured.strips.push(props); return h('section', { 'aria-label': props.title }, props.metrics.map(metric => h('div', { key: metric.occurrenceId, 'aria-label': metric.label }, metric.rawValue == null ? '—' : String(metric.rawValue)))); },
    },
    '@/components/charts': {
      LinearGauge: props => { captured.gauges.push(props); return h('div', { 'aria-label': props.label }, props.value == null || !Number.isFinite(props.value) ? '—' : String(props.value)); },
      CHART_COLORS: ['source-one', 'source-two'], chartGrid: {}, axisTickSm: {},
      ChartGradient: () => null, ChartTooltip: () => null, CartesianGrid: () => null,
      XAxis: () => null, YAxis: props => { captured.axes.push(props); return null; },
      Area: () => null, Tooltip: () => null, Cell: () => null,
      AreaChart: props => { captured.charts.push({ kind: 'area', ...props }); return h('div', null, props.children); },
      Pie: props => { captured.charts.push({ kind: 'pie', ...props }); return h('div', null, props.children); },
      PieChart: shell('div'), ResponsiveContainer: shell('div'),
      EmbeddedChart: ({ children, ariaLabel }) => h('section', { 'aria-label': ariaLabel }, children),
    },
  };
  const cache = { mediaPresentation: pure };
  const resolve = name => {
    if (modules[name]) return modules[name];
    if (name === '../components/media-player-modernization') return { ...pure, MediaSlot: load('MediaSlot').MediaSlot, MediaStats: load('MediaStats').MediaStats };
    if (name.startsWith('./')) return load(name.slice(2));
    throw Error(`Unapproved fake dependency ${name}`);
  };
  const load = name => cache[name] ??= compile(path.join(privateRoot, `${name}.tsx`), resolve);
  const Page = compile(pagePath, resolve).default;
  captured.html = renderToStaticMarkup(h(Page));
  return captured;
}

test('all original property fields survive live metadata, charts and table mappings', () => {
  const row = snapshot();
  const result = render({ media: row, history: [row] });
  for (const value of [row.now_playing_title, row.now_playing_artist, row.now_playing_album, row.now_playing_station, row.playback_source]) assert.ok(result.html.includes(value), value);
  assert.equal(result.panels.length, 5);
  assert.equal(result.strips[0].metrics.length, 4);
  assert.deepEqual(result.grids.flatMap(grid => grid.items.map(item => item.id)),
    ['media-now-playing', 'media-volume', 'media-volume-history', 'media-source-distribution']);
  assert.equal(result.tables[0].tableId, 'vehicle-systems:media-history');
  assert.equal(result.tables[0].keyExtractor(row), row.id);
  assert.deepEqual(result.tables[0].columns.map(col => col.key),
    ['created_at', 'now_playing_title', 'now_playing_artist', 'playback_source', 'audio_volume', 'playback_status']);
  assert.equal(result.tables[0].columns.find(col => col.key === 'audio_volume').filterValue(row), '0:11');
  assert.equal(result.tables[0].mobilePresentation.displayValue(row, 'audio_volume'), '0.00/11.00');
  assert.equal(result.tables[0].mobilePresentation.displayValue(row, 'now_playing_artist'), row.now_playing_artist);
  assert.equal(result.tables[0].mobilePresentation.displayValue(row, 'playback_status'), 'Playing');
  assert.deepEqual(result.hookCalls, [['media', '3'], ['history', '3', { start: '2026-10-01', end: '2026-10-04' }]]);
  assert.deepEqual(result.rangeOptions, { persistKey: 'media-player.range', defaultPresetId: '7d' });
  assert.equal(result.pageQueries[0].data, row);
  assert.equal(typeof result.tables[0].onSort, 'function');
  assert.equal(result.tables[0].enableValueFilters, true);
  assert.equal(result.tables[0].pagination, true);
  assert.equal(result.tables[0].compact, true);
  assert.equal(result.tables[0].sortKey, 'created_at');
  assert.equal(result.tables[0].sortDir, 'desc');
});

test('unknown/null/nonfinite values never become silence or stopped; legitimate zeros remain', () => {
  for (const absent of [undefined, null, NaN, Infinity]) {
    const row = snapshot({ audio_volume: absent, audio_volume_increment: absent, playback_status: undefined });
    const result = render({ media: row, history: [row] });
    assert.equal(result.strips[0].metrics[2].rawValue, null);
    assert.equal(result.strips[0].metrics[3].rawValue, null);
    assert.equal(result.charts.filter(chart => chart.kind === 'area').length, 0);
    assert.equal(result.tables[0].mobilePresentation.displayValue(row, 'playback_status'), 'Unknown status');
    assert.match(result.tables[0].mobilePresentation.displayValue(row, 'audio_volume'), /^—\//);
  }
  const row = snapshot({ audio_volume: 0, audio_volume_increment: 0, audio_volume_max: 0 });
  const result = render({ media: row, history: [row] });
  assert.equal(result.gauges[0].value, 0);
  assert.equal(result.gauges[0].max, 11);
  assert.equal(result.strips[0].metrics[2].rawValue, '0');
  assert.equal(result.strips[0].metrics[3].rawValue, '0.00');
  assert.ok(result.html.includes('Reported maximum'));
  assert.ok(result.html.includes('0.00'));
  assert.equal(result.charts.find(chart => chart.kind === 'area').data[0].volume, 0);
  assert.match(render({ media: snapshot({ playback_status: undefined }), history: [] }).html, /Unknown status/);
  assert.match(render({ media: snapshot({ playback_status: 'source-specific status' }), history: [] }).html, /source-specific status/);
});

test('missing snapshot, initial loading and no vehicle keep all five shells and four metrics', () => {
  for (const options of [{}, { media: null, history: null }, { mediaLoading: true, historyLoading: true }, { vehicleId: null }]) {
    const result = render(options);
    assert.equal(result.panels.length, 5);
    assert.equal(result.strips[0].metrics.length, 4);
    assert.equal(result.gauges.length, 0);
    assert.equal(result.tables.length, 0);
    assert.ok(result.strips[0].metrics.every(metric => metric.rawValue == null));
  }
  assert.match(render({ mediaLoading: true, historyLoading: true }).html, /Loading fake source/);
  assert.match(render({}).html, /No media snapshot available/);
  assert.match(render({ vehicleId: null }).html, /Select a vehicle/);
  const empty = render({ history: [] });
  assert.equal(empty.strips[0].metrics[0].rawValue, 0);
  assert.equal(empty.strips[0].metrics[2].rawValue, null);
});

test('refresh failures retain every usable source and wire only fake retry callbacks', () => {
  const row = snapshot();
  const error = new Error('Fake refresh failure');
  const result = render({ media: row, history: [row], mediaError: error, historyError: error });
  assert.equal(result.gauges.length, 1);
  assert.equal(result.tables.length, 1);
  assert.equal(result.charts.filter(chart => chart.kind === 'area' || chart.kind === 'pie').length, 2);
  assert.equal(result.strips[0].retained, true);
  assert.equal(result.errors.length, 5);
  assert.match(result.html, /role="status"/);
  assert.match(result.html, /previously loaded data remains visible/);
  result.errors.forEach(control => {
    assert.equal(control.error, error);
    assert.equal(typeof control.onRetry, 'function');
    control.onRetry();
  });
  assert.deepEqual(result.retry, { media: 2, history: 3 });
  const mediaOnlyFailed = render({ mediaError: error, history: [row] });
  assert.equal(mediaOnlyFailed.tables.length, 1);
  assert.equal(mediaOnlyFailed.gauges.length, 0);
  assert.equal(mediaOnlyFailed.strips[0].metrics[0].rawValue, 1);
  const historyOnlyFailed = render({ media: row, historyError: error });
  assert.equal(historyOnlyFailed.gauges.length, 1);
  assert.equal(historyOnlyFailed.tables.length, 0);
  assert.equal(historyOnlyFailed.strips[0].metrics[0].rawValue, null);
  assert.equal(historyOnlyFailed.strips[0].metrics[3].rawValue, '0.50');
});

test('progress accessibility clamps malformed bounds and never invents unknown elapsed zero', () => {
  for (const [elapsed, expected] of [[0, 0], [-1000, 0], [60000, 60], [999000, 180]]) {
    const row = snapshot({ now_playing_elapsed: elapsed });
    const result = render({ media: row, history: [] });
    assert.match(result.html, /role="progressbar"/);
    assert.match(result.html, /aria-label="Playback progress"/);
    assert.match(result.html, new RegExp(`aria-valuenow="${expected}"`));
    assert.match(result.html, /aria-valuemax="180"/);
    const progress = pure.playbackProgress(row);
    assert.ok(progress.percent >= 0 && progress.percent <= 100);
  }
  for (const overrides of [{ now_playing_elapsed: null }, { now_playing_elapsed: undefined }, { now_playing_duration: 0 }, { now_playing_duration: -1000 }, { now_playing_duration: NaN }]) {
    const row = snapshot(overrides);
    const result = render({ media: row, history: [] });
    assert.equal(pure.playbackProgress(row), null);
    assert.doesNotMatch(result.html, /role="progressbar"/);
    assert.match(result.html, /Playback progress is unavailable/);
  }
});

test('calculation, chronological history, range guard and source frequency preserve original operands', () => {
  const rows = [
    snapshot({ id: 1, created_at: '2026-10-02T12:00:00Z', audio_volume: 0, playback_source: 'Bluetooth' }),
    snapshot({ id: 2, created_at: '2026-10-03T12:00:00Z', audio_volume: 6 }),
    snapshot({ id: 3, created_at: '2026-10-04T12:00:00Z', audio_volume: undefined, now_playing_title: 'Track second' }),
    snapshot({ id: 4, created_at: '2026-09-01T12:00:00Z', audio_volume: 99 }),
  ];
  const result = render({ media: snapshot({ audio_volume_max: 2 }), history: rows });
  assert.deepEqual(result.tables[0].data.map(row => row.id), [3, 2, 1]);
  assert.equal(result.tables[0].filterData, rows);
  assert.deepEqual(result.charts.find(chart => chart.kind === 'area').data.map(point => point.volume), [0, 6]);
  assert.equal(result.axes[0].domain[1], 6);
  assert.equal(result.strips[0].metrics[0].rawValue, 2);
  assert.equal(result.strips[0].metrics[1].rawValue, 'Spotify');
  assert.equal(result.strips[0].metrics[2].rawValue, '3');
  assert.deepEqual(result.charts.find(chart => chart.kind === 'pie').data.map(slice => [slice.name, slice.value]), [['Spotify', 2], ['Bluetooth', 1]]);
  assert.equal(render({ media: snapshot(), history: [snapshot()], precision: 3 }).strips[0].metrics[3].rawValue, '0.500');
  assert.equal(pure.listeningStats([snapshot({ audio_volume: undefined })]).avgVolume, null);
  assert.equal(pure.listeningStats([snapshot({ audio_volume: 0 })]).avgVolume, 0);
});

function nodes(text, predicate) {
  const source = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const results = [];
  function walk(node) {
    if (predicate(node)) results.push(node.getText(source));
    ts.forEachChild(node, walk);
  }
  walk(source);
  return results;
}
test('original hook calls, range policy, sorting, IDs and section/formatter contracts are pinned', () => {
  for (const name of ['useMedia', 'useMediaHistory', 'useRangeState', 'useSelectedVehicle']) {
    const predicate = node => ts.isCallExpression(node) && node.expression.getText() === name;
    assert.deepEqual(nodes(current, predicate), nodes(acquired, predicate), name);
  }
  const sortDeclaration = node => ts.isVariableDeclaration(node) && ['handleSort', 'sortedHistory', 'filtered', 'volumeChartData', 'sourceData'].includes(node.name.getText());
  assert.deepEqual(nodes(current, sortDeclaration), nodes(acquired, sortDeclaration));
  for (const contract of ['vehicle-systems:media-history', 'volGrad', 'url(#volGrad)', 'formatVolumeLevel', 'fmtPlayTime']) assert.ok(current.includes(contract), contract);
  const translations = text => nodes(text, node => ts.isCallExpression(node) && node.expression.getText() === 't').map(call => call.match(/^t\('([^']+)'/)?.[1]).filter(Boolean);
  const shipping = current + fs.readFileSync(path.join(privateRoot, 'MediaStats.tsx'), 'utf8');
  const newKeys = new Set(translations(shipping));
  for (const key of translations(acquired)) assert.ok(newKeys.has(key), `Preserved label ${key}`);
  assert.doesNotMatch(shipping, /from ['"](?:recharts|react-leaflet|framer-motion)['"]|<button\b|<input\b|<textarea\b|<select\b|\buseMutation\b|\bfetch\(/);
  assert.equal((current.match(/<GlassPanel\b/g) ?? []).length, (acquired.match(/<GlassPanel\b/g) ?? []).length);
  assert.ok(shipping.split('\n').length >= acquired.split('\n').length * 0.7);
});
