import { useTranslation } from 'react-i18next';
import { Zap, Home } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { StatusPill, Caption, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useChartPalette } from '@/hooks/useChartPalette';
import { knownNumber } from '@/api/dataState';
import { POWERSHARE_SIGNALS, humanizeEnum } from '../powershare';
import { statusDotClass } from '../powershare/helpers';

interface RuntimeCardProps {
  status: string | null;
  shareType: string | null;
  powerKw: number | null;
  hoursLeft: number | null;
  powerPeak: number;
  hoursPeak: number;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function RuntimeCard({
  status, shareType, powerKw, hoursLeft, powerPeak, hoursPeak, isLoading, error, onRetry,
}: RuntimeCardProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const palette = useChartPalette();
  const destination = humanizeEnum(shareType, POWERSHARE_SIGNALS.type);
  const power = knownNumber(powerKw);
  const hours = knownNumber(hoursLeft);
  const hasData = status != null || shareType != null || power != null || hours != null;

  return (
    <LayoutCard title={t('powershare.runtime.title', 'Live Session')}>
      {isLoading ? <Skeleton height={220} /> : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : !hasData ? (
        <EmptyState /* no-action: session telemetry has not been reported */
          icon={<Zap className="h-8 w-8" aria-hidden="true" />}
          message={t('powershare.runtime.noData', 'No live Powershare session. Details appear when your vehicle starts sharing power.')}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Caption>{t('powershare.runtime.statusLabel', 'Status')}</Caption>
            <StatusPill color={statusDotClass(status)}>
              {humanizeEnum(status, POWERSHARE_SIGNALS.status) ?? t('powershare.runtime.statusUnknown', 'Unknown')}
            </StatusPill>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Caption>{t('powershare.runtime.typeLabel', 'Destination')}</Caption>
            <Text variant="bodySm" className="inline-flex min-w-0 items-center gap-1.5 break-words">
              <Home className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
              {destination ?? '—'}
            </Text>
          </div>
          {power != null ? (
            <MetricBar label={t('powershare.runtime.outputPower', 'Output Power')}
              value={power} max={Math.max(Number.isFinite(powerPeak) ? powerPeak : 0, power, 1)}
              color={palette[0]} sublabel={`${fmtNumber(power)} kW`} />
          ) : <Caption>{t('powershare.kpi.outputPower', 'Output Power')}: —</Caption>}
          {hours != null ? (
            <MetricBar label={t('powershare.runtime.hoursRemaining', 'Hours Remaining')}
              value={hours} max={Math.max(Number.isFinite(hoursPeak) ? hoursPeak : 0, hours, 1)}
              color={palette[1]} sublabel={`${fmtNumber(hours)} h`} />
          ) : <Caption>{t('powershare.kpi.hoursRemaining', 'Hours Remaining')}: —</Caption>}
        </div>
      )}
    </LayoutCard>
  );
}
