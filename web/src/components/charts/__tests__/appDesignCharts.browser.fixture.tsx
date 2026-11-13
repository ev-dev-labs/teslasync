import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import {
  Area, AreaChartWrapper, Bar, BipolarBar, Brush, CartesianGrid, Cell, ChartContainer,
  ChartLegend, ChartTooltip, ComposedChart, HeatmapCell, HeatmapLegend, Line,
  LinearGauge, MiniChart, Pie, PieChart, PolarAngleAxis, PolarGrid, Radar, RadarChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, SmallMultiplesChart,
  Sparkline, ThresholdBar, Tooltip, XAxis, YAxis,
} from '../index';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '../../ui/app-designs/designs';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';
import '../../../index.css';
import '../../ui/appDesignPacks.css';

// Browser-only preservation fixture; it is not registered as an application
// route or imported by the production barrel.
const observations = [
  { sample: 0, power: -25, energy: 0, timestamp: '2026-01-01T00:00:00Z' },
  { sample: 1, power: 0, energy: 8, timestamp: '2026-01-01T00:01:00Z' },
  { sample: 2, power: null, energy: 16, timestamp: '2026-01-01T00:02:00Z' },
  { sample: 3, power: 75, energy: 24, timestamp: '2026-01-01T00:03:00Z' },
  { sample: 4, power: 25, energy: 32, timestamp: '2026-01-01T00:04:00Z' },
];
const colors = { power: '#d4664a', energy: '#63a6b0', reference: '#caad7d' };
const columns = [
  { key: 'sample', label: 'Observation' },
  { key: 'power', label: 'Power (W)' },
  { key: 'energy', label: 'Energy (Wh)' },
];
const sectors = [{ name: 'A', value: 25 }, { name: 'B', value: 75 }];
const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
client.setQueryData(['settings'], { locale: 'en-US', tz_display_default: 'utc', chart_palette: 'cb_safe' });
const i18n = createInstance();
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {} });

function ChartDesignFixture() {
  const [range, setRange] = useState('0–4');
  useLayoutEffect(() => observeAppDesignScopes(document.documentElement), []);

  return (
    <main id="chart-design-fixture" className="grid min-w-0 gap-6 p-4">
      <ChartContainer title="Signed observations and retained gaps" ariaLabel="Signed power and energy with an unknown power observation"
        ariaDescription="Original signed measurements; the missing power sample is not zero."
        chartKey="coverage-power" height={360} mobileHeight={360} fullscreen
        data={observations} dataColumns={columns} exportData={observations}
        summary={<span>Original source · <span data-brush-range>{range}</span></span>}
        caption={<span>Complete source scope, W and Wh, including zero and missing values</span>}
        metadata={{ rangeLabel: '00:00–00:04 UTC', unitLabel: 'W · Wh', sourceLabel: 'Original observations' }}>
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={observations} margin={{ top: 24, right: 12, bottom: 8, left: 4 }}>
              <CartesianGrid />
              <XAxis dataKey="sample" type="number" domain={[0, 4]} />
              <YAxis domain={[-50, 100]} />
              <Area dataKey="energy" type="stepAfter" fill={colors.energy} fillOpacity={0.08} stroke={colors.energy} isAnimationActive={false} />
              <Bar dataKey="energy" fill={colors.energy} isAnimationActive={false} />
              <Line dataKey="power" name="Signed power" type="linear" connectNulls={false} stroke={colors.power}
                hide={hiddenSeries?.isHidden('power')} isAnimationActive={false} />
              <ReferenceLine y={0} label="Zero power" stroke={colors.reference} />
              <Brush dataKey="sample" height={28} onChange={next => setRange(`${next.startIndex}–${next.endIndex}`)} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
      <ChartContainer title="Original ring proportions" ariaLabel="A is one quarter; B is three quarters"
        data={sectors} dataColumns={[{ key: 'name', label: 'Series' }, { key: 'value', label: 'Value' }]}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={sectors} dataKey="value" innerRadius={45} outerRadius={80} label isAnimationActive={false}>
              <Cell fill={colors.power} /><Cell fill={colors.energy} />
            </Pie>
            <Tooltip content={<ChartTooltip />} /><ChartLegend />
          </PieChart>
        </ResponsiveContainer>
      </ChartContainer>
      <ChartContainer title="Original scatter coordinates" ariaLabel="Signed power at observed coordinates"
        data={observations} dataColumns={columns}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 12, bottom: 8, left: 4 }}>
            <CartesianGrid /><XAxis dataKey="sample" type="number" domain={[0, 4]} />
            <YAxis dataKey="power" type="number" domain={[-50, 100]} />
            <Scatter data={observations.filter(point => point.power != null)} fill={colors.power} isAnimationActive={false} />
            <Tooltip content={<ChartTooltip />} />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartContainer>
      <ChartContainer title="Original polar values" ariaLabel="Recorded polar observations"
        data={observations} dataColumns={columns}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={observations}>
            <PolarGrid /><PolarAngleAxis dataKey="sample" />
            <Radar dataKey="energy" fill={colors.energy} fillOpacity={0.08} stroke={colors.energy} isAnimationActive={false} />
            <Tooltip content={<ChartTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </ChartContainer>
      <ChartContainer variant="embedded" title="Shared area wrapper" ariaLabel="Retained area observations"
        height={300} mobileHeight={300} data={observations} dataColumns={columns}>
        <AreaChartWrapper data={observations} xKey="sample" height={300}
          series={[{ key: 'power', label: 'Power', color: colors.power }, { key: 'energy', label: 'Energy', color: colors.energy }]} />
      </ChartContainer>
      <SmallMultiplesChart data={observations} series={['power', 'energy', 'missing']}
        seriesLabel={key => key === 'power' ? 'Signed power — original retained observations' : key}
        maxPointsPerCell={100} onCellClick={() => undefined} />
      <section aria-label="Original gauge readings" className="grid min-w-0 gap-6">
        <LinearGauge label="Battery" value={25} min={0} max={100} unit="%" marker={80} markerLabel="Target" color={colors.power} />
        <LinearGauge label="Unknown battery" value={null} min={0} max={100} unit="%" />
        <BipolarBar label="Signed net power" value={-25} min={50} max={100} unit="W"
          positiveColor={colors.power} negativeColor={colors.energy} negativeLabel="Negative" positiveLabel="Positive" />
        <ThresholdBar label="Temperature" value={20} min={-10} max={50} unit="°C" target={25}
          bands={[{ from: -10, to: 10, color: colors.energy, label: 'Low' }, { from: 10, to: 50, color: colors.power, label: 'Normal' }]} />
      </section>
      <section aria-label="Original heatmap levels">
        <div className="flex flex-wrap gap-2">
          {([null, 0, 1, 2, 3, 4] as const).map(level =>
            <HeatmapCell key={String(level)} level={level} label={`Level ${level}`} className="h-8 w-8" />)}
        </div>
        <HeatmapLegend label="Heatmap key" less="Less" more="More" unavailable="Unknown" />
      </section>
      <Sparkline samples={observations.map(point => ({ timestamp: point.sample, value: point.power }))} color={colors.power}
        width={500} height={40} ariaLabel="Original signed sparkline with a gap" />
      <MiniChart data={[-25, 0, 75, 25]} color={colors.energy} width={500} height={40} label="Original compact trend" />
      <ChartTooltip active label="Original hovered sample" payload={[
        { name: 'Signed power', value: -25, unit: 'W', color: colors.power },
        { name: 'Unknown', value: null, unit: 'Wh', color: colors.energy },
      ]} />
      {(['loading', 'empty', 'error'] as const).map(state => (
        // chart-a11y:no-table State-only feedback fixtures do not render quantitative observations.
        <ChartContainer key={state} title={`${state} source`} ariaLabel={`${state} source state`} exportable={false}
          ariaDescription="No quantitative plot is displayed in this source-state fixture."
          loading={state === 'loading'} empty={state === 'empty'} error={state === 'error' ? new Error('Unavailable') : undefined}>
          <span>Source content must not render until ready</span>
        </ChartContainer>
      ))}
      <section data-app-design-preview {...getAppDesignAttributes('quiet')}>
        <ChartTooltip active label="Isolated editorial preview" payload={[{ name: 'Power', value: 25, unit: 'W', color: colors.power }]} />
      </section>
    </main>
  );
}

function clearDesign() {
  for (const name of Object.keys(getAppDesignAttributes('classic'))) document.documentElement.removeAttribute(name);
}

const root = document.createElement('div');
document.body.replaceChildren(root);
const fixtureRoot = createRoot(root);
let disposed = false;
function disposeFixture() {
  if (disposed) return;
  disposed = true;
  fixtureRoot.unmount();
  client.clear();
  clearDesign();
  window.removeEventListener('pagehide', disposeFixture);
}
window.addEventListener('pagehide', disposeFixture, { once: true });

Object.assign(window, {
  chartDesignCoverage: {
    packs: Object.keys(APPLICATION_DESIGNS),
    apply(pack: PackId) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) {
        document.documentElement.setAttribute(name, value);
      }
    },
    clear: clearDesign,
    dispose: disposeFixture,
  },
});
fixtureRoot.render(
  <QueryClientProvider client={client}><MemoryRouter><I18nextProvider i18n={i18n}>
    <ChartDesignFixture />
  </I18nextProvider></MemoryRouter></QueryClientProvider>,
);
