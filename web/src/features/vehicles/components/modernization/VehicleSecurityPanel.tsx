import { useTranslation } from 'react-i18next';
import { Shield, Lock, Unlock, Eye, Car, DoorClosed } from 'lucide-react';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type { SecurityEvent, VehicleState } from '@/api/types';
import { VehiclePanelGrid } from './VehiclePanelGrid';
import { normalizeDoorState, windowOpenCount } from './vehicleSecurity';

/** Preserve the four security fields when the independent security source
 * resolves before live state. Absent live lock/sentry flags are unknown,
 * never an invented unlocked/off state or a fabricated VehicleState. */
export function VehicleSecurityPanel({ securityData, state }: {
  securityData: SecurityEvent | null | undefined;
  state: VehicleState | undefined;
}) {
  const { t } = useTranslation();
  const windowsOpen = securityData ? windowOpenCount(securityData) : 0;
  const doorState = securityData
    ? normalizeDoorState(securityData.door_state, t('common.open', 'Open'))
    : null;
  const unknown = t('common.unknownValue', '—');
  return (
    <GlassPanel className="h-full p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Shield className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {t('vehicles.detail.security', 'Security')}
      </PanelTitle>
      {securityData ? (
        <VehiclePanelGrid label={t('vehicles.detail.security', 'Security')} items={[
          { id: 'security-lock', size: 'quarter', content: <MetricCard
            label={t('common.locked', 'Locked')}
            value={state?.is_locked != null
              ? state.is_locked ? t('common.yes', 'Yes') : t('common.no', 'No')
              : unknown}
            icon={state?.is_locked != null
              ? state.is_locked ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Unlock className="h-4 w-4" aria-hidden="true" />
              : <Shield className="h-4 w-4" aria-hidden="true" />}
            color={state?.is_locked ? 'green' : 'cyan'}
          /> },
          { id: 'security-sentry', size: 'quarter', content: <MetricCard
            label={t('common.sentry', 'Sentry')}
            value={state?.sentry_mode != null
              ? state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')
              : unknown}
            icon={<Eye className="h-4 w-4" aria-hidden="true" />}
            color={state?.sentry_mode ? 'green' : 'cyan'}
          /> },
          { id: 'security-doors', size: 'quarter', content: <MetricCard
            label={t('vehicles.detail.doors', 'Doors')}
            value={doorState ?? t('common.closed', 'Closed')}
            icon={<DoorClosed className="h-4 w-4" aria-hidden="true" />}
            color={doorState ? 'cyan' : 'green'}
          /> },
          { id: 'security-windows', size: 'quarter', content: <MetricCard
            label={t('vehicles.detail.windows', 'Windows')}
            value={windowsOpen > 0
              ? t('vehicles.detail.windowsOpen', '{{count}} open', { count: windowsOpen })
              : t('common.closed', 'Closed')}
            icon={<Car className="h-4 w-4" aria-hidden="true" />}
            color={windowsOpen > 0 ? 'cyan' : 'green'}
          /> },
        ]} />
      ) : (
        // no-action: Successful empty security telemetry awaits vehicle reporting; the source wrapper owns failure retry.
        <EmptyState message={t('vehicles.detail.noSecurityData', 'No security data available')} />
      )}
    </GlassPanel>
  );
}
