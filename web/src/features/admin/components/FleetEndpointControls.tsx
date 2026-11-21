import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';

export function FleetEndpointControls({ access, autoPoll, smart }: {
  access: ReactNode; autoPoll?: ReactNode; smart?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex w-28 flex-col items-end gap-1 py-1">
      {access}
      {[
        { key: 'auto', label: t('fleetApi.controls.autoPoll', 'Auto-poll'), control: autoPoll },
        { key: 'smart', label: t('fleetApi.controls.smart', 'Smart Features'), control: smart },
      ].map(({ key, label, control }) => control && (
        <div key={key} className="flex items-center gap-2">
          <Text size="xs" color="secondary" className="text-right">{label}</Text>
          {control}
        </div>
      ))}
    </div>
  );
}
