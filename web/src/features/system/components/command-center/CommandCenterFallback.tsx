import { useTranslation } from 'react-i18next';
import { Car, Gauge, History, LayoutGrid } from 'lucide-react';
import { GlassPanel, Heading } from '@/components/ui';
import { Grid } from '@/components/layout';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { CommandSafetyPanel } from './CommandSafetyPanel';

export type CommandCenterFallbackStatus = 'loading' | 'error' | 'empty';

interface CommandCenterFallbackProps {
  status: CommandCenterFallbackStatus;
  error?: unknown;
  onRetry?: () => void;
}

const LOWER_GRID_COLUMNS = { default: 1, lg: 2 } as const;

export function CommandCenterFallback({
  status,
  error,
  onRetry,
}: CommandCenterFallbackProps) {
  const { t } = useTranslation();
  const loading = status === 'loading';
  const unavailableMessage =
    status === 'error'
      ? t(
          'commands.fallback.unavailable',
          'Vehicle controls are unavailable until fleet data can be loaded.',
        )
      : t(
          'commands.connectFleet',
          'Connect your Tesla account and sync your fleet to start sending commands.',
        );

  return (
    <div className="space-y-4 sm:space-y-5" data-testid="command-center-fallback">
      <GlassPanel className="p-4 sm:p-6">
        <Heading level="section">
          {t('commands.hero.title', 'Selected vehicle')}
        </Heading>
        {loading ? (
          <div
            role="status"
            aria-label={t('commands.fallback.loadingFleet', 'Loading your fleet')}
            className="mt-4 space-y-3"
          >
            <Skeleton height={32} width="45%" />
            <Skeleton height={18} width="70%" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} height={82} />
              ))}
            </div>
          </div>
        ) : status === 'error' && error ? (
          <div className="mt-4">
            <QueryError
              error={error}
              onRetry={onRetry}
              resourceName={t('commands.fallback.fleet', 'Vehicle fleet')}
            />
          </div>
        ) : (
          <EmptyState
            icon={<Car className="h-8 w-8" aria-hidden="true" />}
            title={t('commands.noVehicles', 'No vehicles found')}
            message={unavailableMessage}
            actionTo={{
              label: t('tesla.connect', 'Connect Tesla Account'),
              to: '/tesla-account',
            }}
            className="py-8"
          />
        )}
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5">
        <Heading level="section">
          {t('commands.readiness.title', 'Command readiness')}
        </Heading>
        {loading ? (
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} height={72} />
            ))}
          </div>
        ) : (
          <EmptyState /* no-action: live vehicle state and permissions determine availability in this panel */
            icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
            message={unavailableMessage}
            className="py-6"
          />
        )}
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5">
        <Heading level="section">
          {t('commands.workspace.title', 'Command workspace')}
        </Heading>
        {loading ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} height={112} />
            ))}
          </div>
        ) : (
          <EmptyState /* no-action: live vehicle state and permissions determine availability in this panel */
            icon={<LayoutGrid className="h-8 w-8" aria-hidden="true" />}
            message={unavailableMessage}
            className="py-8"
          />
        )}
      </GlassPanel>

      <Grid cols={LOWER_GRID_COLUMNS} gap={4}>
        <CommandSafetyPanel />
        <GlassPanel className="p-4 sm:p-5">
          <Heading level="section">
            {t('commands.activity.title', 'Recent command activity')}
          </Heading>
          {loading ? (
            <div className="mt-4 space-y-3">
              <Skeleton height={48} />
              <Skeleton height={48} />
              <Skeleton height={48} />
            </div>
          ) : (
            <EmptyState /* no-action: live vehicle state and permissions determine availability in this panel */
              icon={<History className="h-8 w-8" aria-hidden="true" />}
              message={unavailableMessage}
              className="py-8"
            />
          )}
        </GlassPanel>
      </Grid>
    </div>
  );
}
