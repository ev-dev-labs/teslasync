import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChargingSession } from '@/api/types';
import { formatDateShort } from '@/lib/dateFormat';
import {
  ChartContainer,
  ChartTooltip,
  chartGrid,
  axisTickSm,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import { Text } from '@/components/ui';
import { generateChargingCurve, getChargerLabel } from './helpers';

interface SessionComparisonChartProps {
  sessions: ChargingSession[];
}

export default function SessionComparisonChart({ sessions }: SessionComparisonChartProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const modeledContext = t(
    'charging.curve.modernization.modeledCurves',
    'Curves are modeled from session metadata, not sampled charging telemetry.',
  );
  const windowContext = t(
    'charging.curve.modernization.resultScope',
    'Up to 200 returned sessions; not a full-history aggregate.',
  );
  const returnedContext = t(
    'charging.curve.modernization.returnedSessions',
    'Returned sessions in the workspace range',
  );

  const comparisonSessions = useMemo(() => (sessions ?? []).slice(0, 10), [sessions]);

  const comparisonData = useMemo(() => {
    if (!comparisonSessions.length) return [];
    const curves = comparisonSessions.map((s, i) => ({
      curve: generateChargingCurve(s),
      key: `s${i}`,
    }));
    const allSocs = new Set<number>();
    curves.forEach((c) => c.curve.forEach((p) => allSocs.add(p.soc)));
    const socValues = Array.from(allSocs).sort((a, b) => a - b);

    return socValues.map((soc) => {
      const point: Record<string, number> = { soc };
      curves.forEach(({ curve, key }) => {
        const match = curve.find((p) => p.soc === soc);
        if (match) point[key] = Math.round(match.power * 10) / 10;
      });
      return point;
    });
  }, [comparisonSessions]);

  return (
    <ChartContainer
        title={t('charging.curve.sessionComparison', 'Session comparison')}
        subtitle={modeledContext}
        ariaLabel={`${t('charging.curve.sessionComparison', 'Session comparison')} — ${returnedContext}`}
        ariaDescription={`${modeledContext} ${windowContext} ${comparisonSessions.length} / ${(sessions ?? []).length}`}
        metadata={{
          sourceLabel: modeledContext,
          rangeLabel: `${returnedContext}: ${comparisonSessions.length} / ${(sessions ?? []).length}`,
        }}
        height={300}
        data={comparisonData}
        exportData={comparisonData.map((point) => ({
          ...point,
          source_context: modeledContext,
          returned_window: windowContext,
          sessions_shown: comparisonSessions.length,
          sessions_returned: (sessions ?? []).length,
          overlay_limit: 10,
        }))}
        dataColumns={[
          { key: 'soc', label: t('charging.curve.col.soc', 'SOC %') },
          ...comparisonSessions.map((session, index) => ({
            key: `s${index}`,
            label: `${formatDateShort(session.started_at)} (${getChargerLabel(session)})`,
          })),
        ]}
        empty={comparisonSessions.length === 0}
        exportable
        exportFilename="session-comparison"
      >
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={comparisonData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis
              dataKey="soc"
              tick={axisTickSm}
              label={{
                value: t('charging.curve.socPercent', 'SOC (%)'),
                position: 'insideBottomRight',
                offset: -5,
                style: axisTickSm,
              }}
            />
            <YAxis
              tick={axisTickSm}
              label={{
                value: t('charging.curve.powerKw', 'Power (kW)'),
                angle: -90,
                position: 'insideLeft',
                style: axisTickSm,
              }}
            />
            <Tooltip content={<ChartTooltip />} />
            {comparisonSessions.map((s, i) => (
              <Line
                key={s.id}
                {...AREA_DEFAULTS}
                dataKey={`s${i}`}
                name={`${formatDateShort(s.started_at)} (${getChargerLabel(s)})`}
                stroke={palette[i % palette.length]}
                strokeWidth={1.5}
                unit=" kW"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {comparisonSessions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-2">
            {comparisonSessions.map((s, i) => (
              <div key={s.id} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-3 rounded-sm"
                  style={{ backgroundColor: palette[i % palette.length] }}
                />
                <Text variant="bodySm">{formatDateShort(s.started_at)}</Text>
              </div>
            ))}
          </div>
        )}
      </ChartContainer>
  );
}
