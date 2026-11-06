import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';

export function FleetEndpointControls({ access, autoPoll }: { access: ReactNode; autoPoll?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex w-28 flex-col items-end gap-1 py-1">
      {access}
      {autoPoll && <div className="flex items-center gap-2">
        <Text size="xs" color="secondary" className="whitespace-nowrap">{t('fleetApi.controls.autoPoll', 'Auto-poll')}</Text>
        {autoPoll}
      </div>}
    </div>
  );
}
