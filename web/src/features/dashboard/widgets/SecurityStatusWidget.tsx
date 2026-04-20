import { useTranslation } from 'react-i18next';
import { Shield } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useSecurityLatest } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-white/50">{label}</span>
      {children}
    </div>
  );
}

export default function SecurityStatusWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: securityData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useSecurityLatest(id, 5_000);

  const doorStates = (securityData?.door_state ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const openDoors = doorStates.filter((s) => s.toLowerCase().includes('open'));
  const windows = [
    { val: securityData?.fd_window },
    { val: securityData?.fp_window },
    { val: securityData?.rd_window },
    { val: securityData?.rp_window },
  ];
  const openWindows = windows.filter((w) => w.val && w.val.toLowerCase() !== 'closed');

  return (
    <WidgetShell
      title={t('widget.security', 'Security')}
      icon={<Shield className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {securityData ? (
        <div className="space-y-2.5">
          <Row label={t('widget.lock', 'Lock')}>
            <span
              className={`text-sm font-bold flex items-center gap-1 ${securityData.locked ? 'text-neon-green' : 'text-neon-red'}`}
            >
              {securityData.locked ? '🔒' : '🔓'}{' '}
              {securityData.locked
                ? t('widget.locked', 'Locked')
                : t('widget.unlocked', 'Unlocked')}
            </span>
          </Row>
          <Row label={t('widget.sentry', 'Sentry')}>
            <span
              className={`text-sm font-bold ${securityData.sentry_mode ? 'text-neon-cyan' : 'text-white/30'}`}
            >
              🛡️{' '}
              {securityData.sentry_mode ? t('widget.active', 'Active') : t('widget.off', 'Off')}
            </span>
          </Row>
          <Row label={t('widget.doors', 'Doors')}>
            <Badge variant={openDoors.length === 0 ? 'success' : 'warning'}>
              {openDoors.length === 0
                ? t('widget.allClosed', 'All Closed')
                : `${openDoors.length} ${t('widget.open', 'Open')}`}
            </Badge>
          </Row>
          <Row label={t('widget.windows', 'Windows')}>
            <Badge variant={openWindows.length === 0 ? 'success' : 'warning'}>
              {openWindows.length === 0
                ? t('widget.allClosed', 'All Closed')
                : `${openWindows.length} ${t('widget.open', 'Open')}`}
            </Badge>
          </Row>
        </div>
      ) : (
        <EmptyState
          icon={<Shield className="h-5 w-5" />}
          message={t('widget.noSecurity', 'No security data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
