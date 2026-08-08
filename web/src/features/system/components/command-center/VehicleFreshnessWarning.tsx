import { useTranslation } from 'react-i18next';
import { Clock3 } from 'lucide-react';
import { useIsStale } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';

interface VehicleFreshnessWarningProps {
  timestamp: string | null | undefined;
}

/**
 * The command center's single canonical stale-telemetry warning.
 * Keep freshness warning copy here so no vehicle/domain section can create a
 * second rendering path.
 */
export function VehicleFreshnessWarning({
  timestamp,
}: VehicleFreshnessWarningProps) {
  const { t } = useTranslation();
  const { isStale, ageLabel } = useIsStale(timestamp);

  if (!isStale) return null;

  return (
    <AlertBanner
      variant="warning"
      icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
      title={t('commands.freshness.title', 'Telemetry may be outdated')}
      data-testid="command-freshness-warning"
      role="status"
    >
      {t(
        'commands.freshness.message',
        'Last vehicle update: {{age}}. Verify the car is awake and reachable before sending a safety-sensitive command.',
        { age: ageLabel },
      )}
    </AlertBanner>
  );
}
