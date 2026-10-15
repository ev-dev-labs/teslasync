/**
 * Offline presenter/adapter checks. JSX is inspected as plain objects, not
 * mounted. Uses the real SI and number formatters; no requests or artifacts.
 * Run alongside preservation.check.mjs, not instead of its original cases.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../../../..');
const require = createRequire(path.join(root, 'web/package.json'));
const ts = require('typescript');
const jsx = (type, props) => ({ type, props });
const load = (file, dependencies = {}) => {
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics.length, 0, `${file}: syntax diagnostics`);
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, {
    module, exports: module.exports,
    require: id => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
  }, { filename: file });
  return module.exports;
};
const units = load(path.join(root, 'web/src/lib/unitConversion.ts'));
const numbers = load(path.join(root, 'web/src/lib/numberFormat.ts'));
const trust = load(path.join(root, 'web/src/api/dataState.ts'));
const charts = Object.fromEntries([
  'ChartContainer', 'ChartLegend', 'ChartTooltip', 'ChartGradient', 'LineChart',
  'Line', 'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'ResponsiveContainer',
  'ReferenceLine', 'Legend', 'AreaChart', 'Area',
].map(name => [name, name]));
charts.AREA_DEFAULTS = {};
charts.areaGradient = () => null;
const frame = load(path.join(directory, 'PreservedChartFrame.tsx'), {
  '@/components/charts': charts,
  '@/components/feedback': { StaleRefreshWarning: 'StaleRefreshWarning' },
  '@/components/layout/layout-reference': {
    useCardPlacement: () => ({ width: 375, className: 'col-span-1' }),
    containerPolicy: () => ({ chartHeight: 240 }),
  },
  '@/lib/cn': { cn: (...classes) => classes.filter(Boolean).join(' ') },
}).PreservedChartFrame;
let preferences;
const components = Object.fromEntries([
  'StatorHistory', 'TorqueHistory', 'TemperatureHistory', 'PowerHistory',
].map(name => [name, load(path.join(directory, `${name}.tsx`), {
  '@/components/charts': charts,
  'react-i18next': {
    useTranslation: () => ({ t: (_key, fallback) => `Localized: ${fallback}` }),
  },
  '@/hooks/useUnits': {
    useUnits: () => ({
      unitPrefs: preferences,
      formatTemperature: value => units.formatTemperature(value, preferences),
      formatPower: value => units.formatPower(value, preferences),
    }),
  },
  '@/hooks/useNumberFormatting': {
    useNumberFormatting: () => ({ fmtNumber: numbers.fmtNumber }),
  },
  '@/hooks/useHiddenSeries': {
    // Hiding a visual series must not delete its measured table/export data.
    useHiddenSeries: () => ({ isHidden: () => true }),
  },
  './PreservedChartFrame': { PreservedChartFrame: frame },
})[name]]));
const find = (node, type) => {
  if (!node) return undefined;
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  return node.type === type ? node : find(node.props?.children, type);
};
let count = 0;
const check = (name, run) => { run(); count++; console.log(`PASS ${name}`); };
const motorRows = Array.from({ length: 200 }, (_, index) => ({
  time: `snapshot-${index}`, stator: index === 0 ? 0 : index,
  statorRel: index % 2 ? null : -10, statorRer: 45,
  torque: index % 2 ? null : index, speed: null, axle: index,
}));
const driveRows = Array.from({ length: 30 }, (_, index) => ({
  date: `drive-${index}`, powerMax: index === 0 ? 0 : index * 1000,
  powerMin: null, outsideTemp: index % 2 ? null : index, distance: index,
}));
const ready = trust.deriveDataState({ data: motorRows });
for (const [temperature, precision] of [['°C', 2], ['°F', 1]]) {
  preferences = { temperature, power: 'kW', locale: 'en-US', precision };
  numbers.setGlobalPrecision(precision);
  for (const [name, rows, plot, specs] of [
    ['StatorHistory', motorRows, 'LineChart', [
      ['stator', 'stator', value => units.formatTemperature(value, preferences)],
      ['statorRel', 'statorRel', value => units.formatTemperature(value, preferences)],
      ['statorRer', 'statorRer', value => units.formatTemperature(value, preferences)],
    ]],
    ['TorqueHistory', motorRows, 'AreaChart', [
      ['torque', 'torque', value => value == null ? '—' : `${numbers.fmtNumber(value)} Nm`],
    ]],
    ['TemperatureHistory', driveRows, 'LineChart', [
      ['outsideTemp', 'outsideTemp', value => units.formatTemperature(value, preferences)],
    ]],
    ['PowerHistory', driveRows, 'AreaChart', [
      ['power_max_kw', 'powerMax', value => units.formatPower(value, preferences)],
      ['power_min_kw', 'powerMin', value => units.formatPower(value, preferences)],
    ]],
  ]) {
    check(`${name}: complete displayed table/export matches plotted SI (${temperature}, precision ${precision})`, () => {
      const inputBefore = JSON.stringify(rows);
      const presenter = components[name]({ rows, state: ready, loading: false });
      const forwarded = find(frame(presenter.props), 'ChartContainer').props;
      assert.ok(forwarded.ariaLabel.startsWith('Localized: '));
      assert.equal(forwarded.ariaLabel, presenter.props.ariaLabel);
      assert.equal(forwarded.ariaDescription, presenter.props.ariaDescription);
      assert.equal(forwarded.data, presenter.props.data);
      assert.equal(forwarded.dataColumns, presenter.props.dataColumns);
      assert.equal(forwarded.exportData, forwarded.data);
      const plotted = find(forwarded.children, plot).props.data;
      const expectedRows = name === 'TemperatureHistory'
        ? rows.filter(row => row.outsideTemp != null) : rows;
      assert.equal(plotted.length, expectedRows.length);
      assert.equal(forwarded.data.length, plotted.length);
      assert.deepEqual(Array.from(forwarded.dataColumns, col => col.key),
        [name === 'StatorHistory' || name === 'TorqueHistory' ? 'time' : 'date', ...specs.map(([key]) => key)]);
      for (let index = 0; index < plotted.length; index++) {
        assert.equal(JSON.stringify(plotted[index]), JSON.stringify(expectedRows[index]));
        const timeKey = Object.hasOwn(plotted[index], 'time') ? 'time' : 'date';
        assert.equal(forwarded.data[index][timeKey], plotted[index][timeKey]);
        for (const [key, sourceKey, format] of specs) {
          assert.equal(forwarded.data[index][key], format(plotted[index][sourceKey]));
        }
      }
      if (name === 'StatorHistory') {
        const headers = forwarded.dataColumns.map(col => col.label).join(' ');
        for (const label of ['Front Motor', 'Rear Motor', 'Inverter', temperature]) assert.ok(headers.includes(label));
      }
      if (name === 'TemperatureHistory') assert.ok(forwarded.dataColumns[1].label.includes(temperature));
      if (name === 'PowerHistory') {
        assert.ok(forwarded.dataColumns[1].label.includes('average drive power'));
        assert.ok(forwarded.data.every(row => row.power_min_kw === '—'));
      }
      assert.equal(JSON.stringify(rows), inputBefore);
      assert.equal(forwarded.height, presenter.props.height);
      assert.equal(forwarded.chartKey, presenter.props.chartKey);
    });
  }
}
check('wrapper preserves fatal/retained/recovery/loading/empty independently', () => {
  for (const state of [
    trust.deriveDataState({ error: new Error('fatal') }),
    trust.deriveDataState({ data: motorRows, error: new Error('refresh') }),
    ready,
    trust.deriveDataState({ isLoading: true, isPending: true }),
    trust.deriveDataState({ data: [] }),
  ]) {
    for (const [name, component] of Object.entries(components)) {
      const rows = state.hasData ? name === 'TemperatureHistory' || name === 'PowerHistory' ? driveRows : motorRows : [];
      const presenter = component({ rows, state, loading: state.status === 'loading' });
      const forwarded = find(frame(presenter.props), 'ChartContainer').props;
      assert.equal(forwarded.error, state.fatalError ?? undefined);
      assert.equal(forwarded.onRetry, state.retry ?? undefined);
      assert.equal(forwarded.loading, presenter.props.loading);
      assert.equal(forwarded.empty, presenter.props.empty);
      assert.equal(forwarded.data, presenter.props.data);
    }
  }
});
console.log(`Offline accessibility checks: ${count} passed. Mounted/runtime checks are NOTRUN.`);
