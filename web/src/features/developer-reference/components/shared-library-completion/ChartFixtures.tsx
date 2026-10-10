import { useState } from 'react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  useThemeChartPalette,
} from '@/components/charts';
import { ChartCard, type SourceState } from '@/components/layout/layout-reference';
import { Button, Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FixtureSection } from './FixtureSection';
import { FixtureStateControls } from './FixtureStateControls';
import { completeChartRows, plottedChartRows } from './fixtureData';
import { useCompletionLabels } from './useCompletionLabels';

export function ChartFixtures() {
  const c = useCompletionLabels();
  const palette = useThemeChartPalette();
  const { fmtNumber } = useNumberFormatting();
  const [state, setState] = useState<SourceState>('ready');
  const [inspected, setInspected] = useState(false);
  const rows = state === 'empty' ? [] : completeChartRows;
  const score = (value: unknown) => typeof value === 'number' ? fmtNumber(value, 0) : c.unknown;
  return (
    <FixtureSection id="charts" contract="chart-card" title={c.chartTitle} description={c.chartDescription}>
      <FixtureStateControls state={state} onChange={setState} label={c.chartName} />
      {state === 'retained' && <div className="space-y-2">
        <Text as="p" variant="bodySm" role="status">{c.sourceRetained}</Text>
        <Button wrapLabel type="button" variant="secondary" onClick={() => setState('ready')}>{c.chartRetry}</Button>
      </div>}
      <ChartCard title={c.chartName} subtitle={c.chartLongDescription}
        ariaLabel={c.chartName} ariaDescription={c.chartLongDescription}
        size="standard" fluid={false} height={280} mobileHeight={220}
        toolbar exportable fullscreen exportFilename="shared-completion-prepared-evidence"
        exportData={rows} data={rows} dataColumns={[
          { key: 'date', label: c.chartDate },
          { key: 'score', label: c.chartValue, format: score },
        ]}
        metadata={{
          sourceLabel: c.chartSource, rangeLabel: c.chartRange, freshnessLabel: c.chartFreshness,
          freshness: state === 'retained' ? 'stale' : 'unknown', unitLabel: c.scoreUnit,
          sampling: {
            sampled: rows.length > 0, sourceCount: rows.length,
            renderedCount: rows.length > 0 ? plottedChartRows.length : 0, strategy: rows.length > 0 ? 'stride' : 'none',
          },
        }}
        loading={state === 'loading'} empty={state === 'empty'}
        error={state === 'error' ? new Error(c.chartError) : undefined}
        onRetry={() => setState('ready')} emptyMessage={c.chartEmpty}
        emptyDescription={c.chartEmptyDescription}
        emptyAction={{ label: c.chartRetry, onClick: () => setState('ready') }}
        action={<Button wrapLabel type="button" variant="secondary"
          onClick={() => setInspected(true)}>{c.chartAction}</Button>}
        footer={<Text as="p" variant="bodySm">{c.chartFooter}</Text>}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={plottedChartRows} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={value => String(value).slice(-2)} />
            <YAxis width={40} domain={[0, 12]} tickFormatter={value => fmtNumber(value, 0)} />
            <Tooltip formatter={value => [score(value), c.chartValue]} />
            <Line dataKey="score" name={c.chartValue} stroke={palette.series[0]} strokeWidth={2}
              dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <Text as="p" variant="bodySm" role="status" aria-live="polite">{inspected ? c.chartActionResult : c.chartIdle}</Text>
    </FixtureSection>
  );
}
