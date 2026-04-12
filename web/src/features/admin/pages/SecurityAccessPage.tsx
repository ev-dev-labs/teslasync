import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useSecurityEvents } from '@/api/hooks/useAdmin';
import { useVehicles } from '@/api/hooks/useVehicles';

function formatRelative(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export default function SecurityAccessPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? '';

  const { data: events, isLoading, error } = useSecurityEvents(activeId);
  const latest = events?.[0];
  const isSecure = latest?.locked && !latest?.doorState?.includes('open');

  return (
    <PageContainer
      title={t('Security & Access')}
      subtitle={t('Lock status, sentry mode, doors, and windows')}
      loading={isLoading}
      error={error as Error | null}
      empty={!events?.length}
      emptyMessage={t('No security events found.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <select
            className="rounded border px-2 py-1 text-sm"
            value={activeId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.displayName || v.vin}</option>
            ))}
          </select>
        ) : undefined
      }
    >
      {!isSecure && latest && (
        <Card className="border-red-500/30 bg-red-500/5">
          <p className="text-red-400 text-sm font-semibold px-4 py-3">
            {t('⚠ Vehicle may not be secure — check lock and door status.')}
          </p>
        </Card>
      )}

      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Status')} value={isSecure ? t('Secure') : t('Unsecure')} />
        <StatCard label={t('Locked')} value={latest?.locked ? t('Yes') : t('No')} />
        <StatCard label={t('Sentry Mode')} value={latest?.sentryMode ? t('Active') : t('Off')} />
        <StatCard label={t('Total Events')} value={events?.length ?? 0} />
      </Grid>

      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader title={t('Current Status')} />
          <KVList items={[
            { label: t('Lock'), value: <Badge variant={latest?.locked ? 'success' : 'danger'}>{latest?.locked ? t('Locked') : t('Unlocked')}</Badge> },
            { label: t('Sentry'), value: <Badge variant={latest?.sentryMode ? 'success' : 'neutral'}>{latest?.sentryMode ? t('Active') : t('Inactive')}</Badge> },
            { label: t('Doors'), value: latest?.doorState ?? '--' },
            { label: t('HomeLink'), value: latest?.homelinkNearby ? t('Nearby') : t('Away') },
            { label: t('Guest Mode'), value: latest?.guestMode ? t('Enabled') : t('Disabled') },
          ]} />
        </Card>

        <Card>
          <CardHeader title={t('Windows')} />
          <KVList items={[
            { label: t('Front Driver'), value: latest?.fdWindow ?? '--' },
            { label: t('Front Passenger'), value: latest?.fpWindow ?? '--' },
            { label: t('Rear Driver'), value: latest?.rdWindow ?? '--' },
            { label: t('Rear Passenger'), value: latest?.rpWindow ?? '--' },
          ]} />
        </Card>
      </Grid>

      <Card>
        <CardHeader title={t('Recent Security Events')} />
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-800">
          {events?.slice(0, 20).map((ev) => (
            <div key={ev.id} className="flex items-center gap-4 px-3 py-2 text-sm">
              <span className="w-20 text-gray-400 shrink-0">{formatRelative(ev.createdAt)}</span>
              <Badge variant={ev.locked ? 'success' : 'danger'} size="sm">{ev.locked ? 'Yes' : 'No'}</Badge>
              <Badge variant={ev.sentryMode ? 'success' : 'neutral'} size="sm">{ev.sentryMode ? 'On' : 'Off'}</Badge>
              <span>{ev.doorState}</span>
            </div>
          ))}
        </div>
      </Card>
    </PageContainer>
  );
}
