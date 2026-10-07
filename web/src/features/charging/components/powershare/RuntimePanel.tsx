import { useTranslation } from 'react-i18next';
import { Zap, Home } from 'lucide-react';

import { GlassPanel, PanelTitle, StatusPill, Caption, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';

import { POWERSHARE_SIGNALS, POWER_COLOR, HOURS_COLOR } from './constants';
import { humanizeEnum, statusDotClass } from './helpers';

interface RuntimePanelProps {
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

/** Live-session side panel — current status, destination, and output/runtime
 *  bars scaled against the observed peak. */
export function RuntimePanel({
  status, shareType, powerKw, hoursLeft, powerPeak, hoursPeak, isLoading, error, onRetry,
}: RuntimePanelProps) {
  const { t } = useTranslation();
  const destination = humanizeEnum(shareType, POWERSHARE_SIGNALS.type);

  // A non-finite numeric signal (NaN / ±Infinity from a malformed observation)
  // still satisfies `!= null`, so it would otherwise reach MetricBar and render
  // `width: NaN%`. Narrow to a finite value here and treat everything else as
  // "no reading" so the bar is simply omitted rather than painted broken.
  const power = powerKw != null && Number.isFinite(powerKw) ? powerKw : null;
  const hours = hoursLeft != null && Number.isFinite(hoursLeft) ? hoursLeft : null;

  const hasData =
    status != null || shareType != null || power != null || hours != null;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('powershare.runtime.title', 'Live Session')}
      </PanelTitle>
      {isLoading ? (
        <Skeleton height={220} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : !hasData ? (
        <EmptyState /* no-action: transient — session details appear when sharing starts */
          icon={<Zap className="h-8 w-8" />}
          message={t(
            'powershare.runtime.noData',
            'No live Powershare session. Details appear when your vehicle starts sharing power.',
          )}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Caption>{t('powershare.runtime.statusLabel', 'Status')}</Caption>
            <StatusPill color={statusDotClass(status)}>
              {humanizeEnum(status, POWERSHARE_SIGNALS.status) ??
                t('powershare.runtime.statusUnknown', 'Unknown')}
            </StatusPill>
          </div>

          {destination && (
            <div className="flex items-center justify-between gap-3">
              <Caption>{t('powershare.runtime.typeLabel', 'Destination')}</Caption>
              <Text variant="bodySm" className="inline-flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                {destination}
              </Text>
            </div>
          )}

          {power != null && (
            <MetricBar
              label={t('powershare.runtime.outputPower', 'Output Power')}
              value={power}
              max={Math.max(Number.isFinite(powerPeak) ? powerPeak : 0, power, 1)}
              color={POWER_COLOR}
              sublabel={`${fmtNumber(power, 2)} kW`}
            />
          )}

          {hours != null && (
            <MetricBar
              label={t('powershare.runtime.hoursRemaining', 'Hours Remaining')}
              value={hours}
              max={Math.max(Number.isFinite(hoursPeak) ? hoursPeak : 0, hours, 1)}
              color={HOURS_COLOR}
              sublabel={`${fmtNumber(hours, 1)} h`}
            />
          )}
        </div>
      )}
    </GlassPanel>
  );
}
