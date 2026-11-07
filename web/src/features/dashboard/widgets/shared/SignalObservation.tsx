import { useTranslation } from 'react-i18next';
import { Caption } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';

interface SignalObservationProps {
  observedAt: number | null;
  source?: string | null;
  unknown: boolean;
  stale: boolean;
  retained: boolean;
}

export function SignalObservation({ observedAt, source, unknown, stale, retained }: SignalObservationProps) {
  const { t } = useTranslation('dashboard');
  const { formatTime } = useDateFormat();
  return (
    <div className="min-w-0 break-words">
      <Caption as="p">
        {unknown ? t('dashboardWidgets.telemetry.signalObservation.unknown', 'Unknown observation')
          : retained ? t('dashboardWidgets.telemetry.signalObservation.retained', 'Retained observation')
            : stale ? t('dashboardWidgets.telemetry.signalObservation.stale', 'Stale observation')
              : t('dashboardWidgets.telemetry.signalObservation.fresh', 'Fresh observation')}
      </Caption>
      <Caption as="p">
        {observedAt != null
          ? <time dateTime={new Date(observedAt).toISOString()}>{formatTime(new Date(observedAt))}</time>
          : t('dashboardWidgets.telemetry.signalObservation.noTime', 'Observation time unknown')}
        {source != null && <> / {source}</>}
      </Caption>
    </div>
  );
}
