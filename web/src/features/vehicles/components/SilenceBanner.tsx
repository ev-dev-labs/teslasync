import { useTranslation } from 'react-i18next';
import { RadioTower } from 'lucide-react';

import { Text } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
import { useVehicleSilence } from '@/api/hooks/useVehicles';

interface SilenceBannerProps {
  vehicleId?: number;
}

/**
 * Telemetry silence watchdog banner for the vehicle detail page. Silent
 * while telemetry is fresh — only quiet/silent/never statuses surface.
 */
export function SilenceBanner({ vehicleId }: SilenceBannerProps) {
  const { t } = useTranslation();
  const { data } = useVehicleSilence(vehicleId);

  if (!data || data.status === 'ok') return null;

  return (
    <AlertBanner
      variant={data.status === 'silent' || data.status === 'never' ? 'warning' : 'info'}
      icon={<RadioTower className="h-5 w-5" aria-hidden="true" />}
      title={
        data.status === 'never'
          ? t('vehicles.silence.never', 'No telemetry yet')
          : data.status === 'silent'
            ? t('vehicles.silence.silent', 'Vehicle silent')
            : t('vehicles.silence.quiet', 'Vehicle quiet')
      }
    >
      <Text as="p" variant="bodySm">{data.explanation}</Text>
    </AlertBanner>
  );
}
