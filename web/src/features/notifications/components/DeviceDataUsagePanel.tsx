import { useTranslation } from 'react-i18next';
import { Signal } from 'lucide-react';
import { GlassPanel, IconBox, PanelTitle } from '@/components/ui';
import { LowBandwidthControl } from '@/components/feedback';
import { cn } from '@/lib/cn';

/**
 * Device-scoped data-usage panel (PWA-07).
 *
 * Lives on the Browser notifications page because that page is the device
 * control centre — everything on it (OS permission, tab signals, per-device
 * notification rules) is scoped to THIS browser rather than to the install.
 * Low-bandwidth mode belongs to the same family: it is persisted per device
 * and enforced by this device's service worker.
 *
 * The control itself is a shared component so a future Settings surface can
 * mount it without duplicating the store wiring.
 */

export interface DeviceDataUsagePanelProps {
  className?: string;
}

export function DeviceDataUsagePanel({ className }: DeviceDataUsagePanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <IconBox color="green">
            <Signal className="h-5 w-5" aria-hidden="true" />
          </IconBox>
          <PanelTitle>
            {t('notifications.device.dataUsageHeading', 'Data usage on this device')}
          </PanelTitle>
        </div>
        <LowBandwidthControl />
      </div>
    </GlassPanel>
  );
}

export default DeviceDataUsagePanel;
