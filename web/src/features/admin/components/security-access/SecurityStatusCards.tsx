import { useTranslation } from 'react-i18next';
import { Lock, Unlock, ShieldCheck, ShieldAlert, DoorClosed, DoorOpen, Home, UserCheck, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/cn';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import type { SecurityEvent } from '@/types/admin';
import { asNonEmptyString } from '@/lib/typeGuards';
import { doorClosed, allWindowsClosed, windowSummary, isSentryActive } from './helpers';
import { StatusTile } from './StatusTile';

interface SecurityStatusCardsProps {
  latest: SecurityEvent | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/** Security posture — six always-visible status tiles (lock, sentry, doors,
 *  windows, homelink, guest). Each tile conveys state via icon + text, never
 *  color alone. */
export function SecurityStatusCards({ latest, isLoading, error, onRetry, className }: SecurityStatusCardsProps) {
  const { t } = useTranslation();

  const doorsClosed = doorClosed(latest?.doorState);
  const windowsClosed = allWindowsClosed(latest);
  const sentryOn = isSentryActive(latest?.sentryMode);

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3">{t('admin.security.statusTitle', 'Security Status')}</PanelTitle>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading && !latest ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('common.loading', 'Loading…')}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 3xl:grid-cols-3"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={104} />
          ))}
        </div>
      ) : !latest ? (
        // no-action: same 5s-poll latest-state query as the sibling security
        // panels — resolves once the vehicle reports in; no retry needed.
        <EmptyState
          icon={<ShieldQuestion className="h-8 w-8" aria-hidden="true" />}
          message={t('admin.security.status.noData', 'No security state available for this vehicle yet')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 3xl:grid-cols-3">
          <StatusTile
            icon={
              latest.locked == null ? (
                <ShieldQuestion className="h-5 w-5" />
              ) : latest.locked ? (
                <Lock className="h-5 w-5" />
              ) : (
                <Unlock className="h-5 w-5" />
              )
            }
            tone={latest.locked == null ? 'muted' : latest.locked ? 'green' : 'red'}
            label={t('admin.security.card.lockStatus', 'Lock Status')}
            value={
              latest.locked == null
                ? t('admin.security.unknown', 'Unknown')
                : latest.locked
                  ? t('admin.security.locked', 'Locked')
                  : t('admin.security.unlocked', 'Unlocked')
            }
            description={t('admin.security.card.lockDesc', 'Vehicle lock state')}
          />
          <StatusTile
            icon={sentryOn ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
            tone={sentryOn ? 'blue' : 'muted'}
            label={t('admin.security.card.sentryMode', 'Sentry Mode')}
            value={sentryOn ? t('admin.security.active', 'Active') : t('admin.security.inactive', 'Inactive')}
            description={t('admin.security.card.sentryDesc', 'Camera surveillance system')}
          />
          <StatusTile
            icon={doorsClosed ? <DoorClosed className="h-5 w-5" /> : <DoorOpen className="h-5 w-5" />}
            tone={doorsClosed ? 'green' : 'amber'}
            label={t('admin.security.card.doors', 'Doors')}
            value={
              doorsClosed
                ? t('admin.security.closed', 'Closed')
                : (asNonEmptyString(latest.doorState) ?? t('admin.security.open', 'Open'))
            }
            description={t('admin.security.card.doorsDesc', 'All vehicle doors')}
          />
          <StatusTile
            icon={windowsClosed ? <DoorClosed className="h-5 w-5" /> : <DoorOpen className="h-5 w-5" />}
            tone={windowsClosed ? 'green' : 'amber'}
            label={t('admin.security.card.windows', 'Windows')}
            value={windowSummary(latest, t)}
            description={t('admin.security.card.windowsDesc', 'Window positions')}
          />
          <StatusTile
            icon={<Home className="h-5 w-5" />}
            tone={latest.homelinkNearby ? 'purple' : 'muted'}
            label={t('admin.security.card.homelink', 'HomeLink')}
            value={latest.homelinkNearby ? t('admin.security.nearby', 'Nearby') : t('admin.security.away', 'Away')}
            description={t('admin.security.card.homelinkDesc', 'Garage door opener')}
          />
          <StatusTile
            icon={<UserCheck className="h-5 w-5" />}
            tone={latest.guestMode ? 'amber' : 'muted'}
            label={t('admin.security.card.guestMode', 'Guest Mode')}
            value={latest.guestMode ? t('admin.security.enabled', 'Enabled') : t('admin.security.disabled', 'Disabled')}
            description={t('admin.security.card.guestDesc', 'Temporary access mode')}
          />
        </div>
      )}
    </GlassPanel>
  );
}
