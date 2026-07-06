import { useTranslation } from 'react-i18next';
import { CircleDot } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useLatestTirePressure } from '@/api/hooks/useVehicles';
import { usePressureFormat } from '@/hooks/usePressureFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { tirePressureVariant } from '@/features/vehicles/components/vehicle-detail/helpers';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

type TireVariant = ReturnType<typeof tirePressureVariant>;

/**
 * Fill + value-text colour per tire-pressure severity variant. The variant is
 * derived from the backend SI value (Pascals) by the shared
 * `tirePressureVariant` helper, keeping this widget consistent with the
 * vehicle-detail tire panels instead of re-deriving thresholds locally. The
 * `neutral` band renders a muted grey for an unknown/missing reading rather
 * than an alarming critical-red.
 */
const VARIANT_STYLE: Record<TireVariant, { fill: string; text: string }> = {
  success: { fill: '#22c55e', text: 'text-emerald-300' },
  warning: { fill: '#f59e0b', text: 'text-amber-300' },
  danger: { fill: '#ef4444', text: 'text-rose-300' },
  neutral: { fill: '#6b7280', text: 'text-[var(--text-muted)]' },
};

interface TireInfo {
  label: string;
  value: number | null;
  variant: TireVariant;
}

/**
 * Top-down car silhouette with four tire indicators.
 * Each tire is a rounded rect colored by pressure status.
 */
function CarDiagram({ tires }: { tires: [TireInfo, TireInfo, TireInfo, TireInfo] }) {
  const [fl, fr, rl, rr] = tires;

  // Tire positions (x, y) for top-down SVG — viewBox 0 0 120 180
  const tirePositions = [
    { tire: fl, x: 14, y: 28 },   // front-left
    { tire: fr, x: 90, y: 28 },   // front-right
    { tire: rl, x: 14, y: 126 },  // rear-left
    { tire: rr, x: 90, y: 126 },  // rear-right
  ];

  return (
    <svg viewBox="0 0 120 180" className="w-full h-full max-h-[140px]" aria-hidden="true">
      {/* Car body outline */}
      <rect x="30" y="16" width="60" height="148" rx="16" ry="16"
        fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
      {/* Windshield hint */}
      <line x1="36" y1="52" x2="84" y2="52"
        stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      {/* Rear window hint */}
      <line x1="36" y1="132" x2="84" y2="132"
        stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

      {/* Tires */}
      {tirePositions.map(({ tire, x, y }) => (
        <rect
          key={tire.label}
          x={x} y={y} width="16" height="26" rx="4" ry="4"
          fill={VARIANT_STYLE[tire.variant].fill}
          fillOpacity={0.85}
        />
      ))}
    </svg>
  );
}

function formatTimestamp(iso: string | undefined, t: (k: string, fb: string) => string): string {
  if (!iso) return t('widget.tireNoReading', 'No reading');
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    const now = Date.now();
    const diffMin = Math.round((now - date.getTime()) / 60_000);
    if (diffMin < 1) return t('widget.tireJustNow', 'Just now');
    if (diffMin < 60) return `${diffMin}m ${t('widget.ago', 'ago')}`;
    const diffHrs = Math.round(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ${t('widget.ago', 'ago')}`;
    return `${Math.round(diffHrs / 24)}d ${t('widget.ago', 'ago')}`;
  } catch {
    return '—';
  }
}

export default function TirePressureVisualWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: tireData, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useLatestTirePressure(id, 10_000);
  const { pressureUnit, toPressureValue } = usePressureFormat();

  const isCompact = size.cols <= 1;

  const tires: [TireInfo, TireInfo, TireInfo, TireInfo] = [
    { label: 'FL', value: tireData?.front_left ?? null, variant: tirePressureVariant(tireData?.front_left) },
    { label: 'FR', value: tireData?.front_right ?? null, variant: tirePressureVariant(tireData?.front_right) },
    { label: 'RL', value: tireData?.rear_left ?? null, variant: tirePressureVariant(tireData?.rear_left) },
    { label: 'RR', value: tireData?.rear_right ?? null, variant: tirePressureVariant(tireData?.rear_right) },
  ];

  const allNormal = tires.every((tire) => tire.variant === 'success');
  const hasWarning = tires.some((tire) => tire.variant !== 'success');

  const formatPressure = (val: number | null): string => {
    const v = toPressureValue(val);
    return v != null ? `${fmtNumber(v, 1)}` : '—';
  };

  // Most recent reading time across all tires
  const latestReading = tireData
    ? [tireData.last_seen_time_fl, tireData.last_seen_time_fr, tireData.last_seen_time_rl, tireData.last_seen_time_rr]
        .filter(Boolean)
        .sort()
        .pop()
    : undefined;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.tirePressure', 'Tire Pressure')}
      icon={<CircleDot className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {tireData ? (
        <div className="h-full flex flex-col gap-2">
          {/* Car diagram + pressure values */}
          <div className="flex-1 flex items-center gap-3 min-h-0">
            {/* Left column: FL / RL values */}
            <div className="flex flex-col justify-between h-full py-2 text-right min-w-[50px]">
              <div>
                <p className="text-2xs text-[var(--text-muted)] uppercase">{t('widget.tireFL', 'FL')}</p>
                <p className={`text-sm font-bold ${VARIANT_STYLE[tires[0].variant].text}`}>
                  {formatPressure(tires[0].value)}
                </p>
              </div>
              <div>
                <p className="text-2xs text-[var(--text-muted)] uppercase">{t('widget.tireRL', 'RL')}</p>
                <p className={`text-sm font-bold ${VARIANT_STYLE[tires[2].variant].text}`}>
                  {formatPressure(tires[2].value)}
                </p>
              </div>
            </div>

            {/* Center: car diagram */}
            <div className="flex-1 flex items-center justify-center">
              <CarDiagram tires={tires} />
            </div>

            {/* Right column: FR / RR values */}
            <div className="flex flex-col justify-between h-full py-2 text-left min-w-[50px]">
              <div>
                <p className="text-2xs text-[var(--text-muted)] uppercase">{t('widget.tireFR', 'FR')}</p>
                <p className={`text-sm font-bold ${VARIANT_STYLE[tires[1].variant].text}`}>
                  {formatPressure(tires[1].value)}
                </p>
              </div>
              <div>
                <p className="text-2xs text-[var(--text-muted)] uppercase">{t('widget.tireRR', 'RR')}</p>
                <p className={`text-sm font-bold ${VARIANT_STYLE[tires[3].variant].text}`}>
                  {formatPressure(tires[3].value)}
                </p>
              </div>
            </div>
          </div>

          {/* Footer: status badge + unit + reading time */}
          <div className="flex-shrink-0 flex items-center justify-between">
            <Badge variant={allNormal ? 'success' : hasWarning ? 'warning' : 'danger'}>
              {allNormal
                ? t('widget.tireAllNormal', 'All Normal')
                : t('widget.tireWarning', 'Check Pressure')}
            </Badge>
            <span className="text-2xs text-[var(--text-muted)]">
              {pressureUnit} · {formatTimestamp(latestReading, t)}
            </span>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<CircleDot className="h-5 w-5" />}
          message={t('widget.noTireData', 'No tire pressure data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
