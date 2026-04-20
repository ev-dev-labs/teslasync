import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { RadialGauge } from '@/components/charts';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useDriveScore } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const SCORE_COLORS = {
  excellent: '#10b981',
  good: '#22d3ee',
  fair: '#f59e0b',
  poor: '#ef4444',
} as const;

function scoreColor(score: number): string {
  if (score >= 80) return SCORE_COLORS.excellent;
  if (score >= 60) return SCORE_COLORS.good;
  if (score >= 40) return SCORE_COLORS.fair;
  return SCORE_COLORS.poor;
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (trend === 'down') return <TrendingDown className="h-3 w-3 text-red-400" />;
  return <Minus className="h-3 w-3 text-white/30" />;
}

export default function DriveScoreGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const { data: score, isLoading, error } = useDriveScore(vehicleIdStr);

  const overall = score?.overall ?? 0;
  const color = useMemo(() => scoreColor(overall), [overall]);

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  const subScores = useMemo(() => {
    if (!score) return [];
    return [
      { key: 'efficiency', label: t('widget.driveScoreGauge.efficiency', 'Efficiency'), value: score.efficiency },
      { key: 'smoothness', label: t('widget.driveScoreGauge.smoothness', 'Smoothness'), value: score.smoothness },
      { key: 'speed', label: t('widget.driveScoreGauge.speed', 'Speed Discipline'), value: score.speedDiscipline },
    ];
  }, [score, t]);

  // Compact: radial gauge only
  if (isCompact) {
    return (
      <WidgetShell loading={isLoading} error={error ? String(error) : null}>
        <div className="h-full flex flex-col items-center justify-center">
          {score ? (
            <RadialGauge
              value={overall}
              max={100}
              label={score.grade ?? '—'}
              color={color}
              size={72}
            />
          ) : (
            <EmptyState
              icon={<Gauge className="h-5 w-5" />}
              message={t('widget.driveScoreGauge.noData', 'No score yet')}
              className="py-2"
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  // Expanded view
  return (
    <WidgetShell
      title={t('widget.driveScoreGauge.title', 'Drive Score')}
      icon={<Gauge className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
    >
      {score ? (
        <div className="h-full flex flex-col gap-3">
          {/* Gauge + summary */}
          <div className="flex items-center gap-4">
            <RadialGauge
              value={overall}
              max={100}
              label={score.grade ?? '—'}
              color={color}
              size={isTall ? 96 : 80}
            />
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <TrendIcon trend={score.trend} />
                <span className="text-[10px] text-white/40">
                  {t('widget.driveScoreGauge.drives', '{{count}} drives', {
                    count: score.totalDrives ?? 0,
                  })}
                </span>
              </div>
              <span className="text-[10px] text-white/40">
                {t('widget.driveScoreGauge.weekly', 'Weekly score')}
              </span>
            </div>
          </div>

          {/* Sub-score breakdown */}
          {isTall && (
            <div className="flex flex-col gap-2">
              {subScores.map((s) => (
                <MetricBar
                  key={s.key}
                  value={s.value ?? 0}
                  max={100}
                  color={scoreColor(s.value ?? 0)}
                  label={s.label}
                  sublabel={`${s.value ?? 0}`}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Gauge className="h-5 w-5" />}
          message={t('widget.driveScoreGauge.noData', 'No score yet')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
