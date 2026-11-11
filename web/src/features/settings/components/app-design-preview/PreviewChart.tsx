import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, ChartContainer, ChartLegend, ChartTooltip, Line, LineChart, LinearGauge, ResponsiveContainer, Tooltip, XAxis, YAxis, useThemeChartPalette } from '@/components/charts';
import { CHART_PALETTES } from '@/hooks/useChartPalette';
import { useSettings } from '@/hooks/useSettings';
import { PREVIEW_CHART } from './fixtures';

export default function PreviewChart() {
  const { t } = useTranslation('settings');
  const { settings } = useSettings();
  const instanceId = useId();
  const chartKey = `app-design-preview-battery-${instanceId}`;
  const navigate = useNavigate();
  useEffect(() => () => {
    // Read the current URL so closing concurrent previews preserves every other chart and workspace parameter.
    const params = new URLSearchParams(window.location.search);
    const parameter = `hidden_${chartKey}`;
    if (!params.has(parameter)) return;
    params.delete(parameter);
    navigate({ pathname: window.location.pathname, search: params.toString(), hash: window.location.hash }, { replace: true });
  }, [chartKey, navigate]);
  const themed = useThemeChartPalette();
  // Both saved palettes use the same hue identities in different orders.
  // Keep the active mode's accessible colors without adding a settings query.
  const palette = settings.chart_palette === 'neon'
    ? CHART_PALETTES.neon.map(color => themed.series[CHART_PALETTES.cb_safe.indexOf(color)] ?? themed.primary)
    : themed.series;
  const battery = t('theme.appDesignPreview.batterySeries', 'Sample battery (%)');
  const reference = t('theme.appDesignPreview.referenceSeries', 'Sample reference (%)');
  return (
    <section data-preview-section="chart" className="min-w-0 space-y-4">
      <ChartContainer chartKey={chartKey} title={t('theme.appDesignPreview.chart', 'Sample battery trace')}
        ariaLabel={t('theme.appDesignPreview.chart', 'Sample battery trace')}
        subtitle={t('theme.appDesignPreview.chartHelp', 'A real SVG plot with a deliberate observation gap. Hover for values; use the legend to hide a series.')}
        height={260} mobileHeight={240}
        dataColumns={[{ key: 'minute', label: t('theme.appDesignPreview.elapsed', 'Elapsed minutes') },
          { key: 'battery', label: battery }, { key: 'reference', label: reference }]}
        data={PREVIEW_CHART}
        caption={<LinearGauge value={72} max={100} unit="%" marker={80}
          label={t('theme.widgetDesignPacks.sampleBattery', 'Sample battery level')}
          markerLabel={t('theme.widgetDesignPacks.sampleLimit', 'Sample charge limit: 80%')} />}>
        {({ hiddenSeries }) => <ResponsiveContainer width="100%" height="100%">
          <LineChart data={PREVIEW_CHART} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="minute" name={t('theme.appDesignPreview.elapsed', 'Elapsed minutes')} />
            <YAxis domain={[60, 85]} unit="%" width={44} />
            <Tooltip content={<ChartTooltip />} />
            <ChartLegend />
            <Line dataKey="battery" name={battery} stroke={palette[0]} strokeWidth={2}
              dot={{ r: 3 }} connectNulls={false} hide={hiddenSeries?.isHidden('battery')} isAnimationActive={false} />
            <Line dataKey="reference" name={reference} stroke={palette[1]} strokeWidth={1}
              strokeDasharray="4 4" dot={false} hide={hiddenSeries?.isHidden('reference')} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>}
      </ChartContainer>
    </section>
  );
}
