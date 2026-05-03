import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import {
  Lock,
  Unlock,
  ShieldCheck,
  ShieldAlert,
  DoorClosed,
  DoorOpen,
  Home,
  UserCheck,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import type { SecurityEvent } from '@/types/admin';
import { doorClosed, allWindowsClosed, windowSummary } from './helpers';

interface SecurityStatusCardsProps {
  latest: SecurityEvent | undefined;
  isLoading: boolean;
}

export function SecurityStatusCards({ latest, isLoading }: SecurityStatusCardsProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={120} />
        ))}
      </div>
    );
  }

  return (
    <FadeIn delay={0.1}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* Lock Status */}
        <GlassPanel className="p-4">
          <div className="flex items-center gap-3 mb-2">
            {latest?.locked ? (
              <Lock className="h-6 w-6 text-green-400" />
            ) : (
              <Unlock className="h-6 w-6 text-red-400" />
            )}
            <h3 className="text-sm font-semibold text-gray-200">
              {t('admin.security.card.lockStatus', 'Lock Status')}
            </h3>
          </div>
          <p
            className={cn(
              'text-2xl font-bold',
              latest?.locked ? 'text-green-400' : 'text-red-400',
            )}
          >
            {latest?.locked
              ? t('admin.security.locked', 'Locked')
              : t('admin.security.unlocked', 'Unlocked')}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('admin.security.card.lockDesc', 'Vehicle lock state')}
          </p>
        </GlassPanel>

        {/* Sentry Mode */}
        <GlassPanel className="p-4">
          <div className="flex items-center gap-3 mb-2">
            {latest?.sentryMode ? (
              <ShieldCheck className="h-6 w-6 text-blue-400" />
            ) : (
              <ShieldAlert className="h-6 w-6 text-[var(--text-muted)]" />
            )}
            <h3 className="text-sm font-semibold text-gray-200">
              {t('admin.security.card.sentryMode', 'Sentry Mode')}
            </h3>
          </div>
          <p
            className={cn(
              'text-2xl font-bold',
              latest?.sentryMode ? 'text-blue-400' : 'text-[var(--text-muted)]',
            )}
          >
            {latest?.sentryMode
              ? t('admin.security.active', 'Active')
              : t('admin.security.inactive', 'Inactive')}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('admin.security.card.sentryDesc', 'Camera surveillance system')}
          </p>
        </GlassPanel>

        {/* Doors */}
        <GlassPanel className="p-4">
          <div className="flex items-center gap-3 mb-2">
            {doorClosed(latest?.doorState) ? (
              <DoorClosed className="h-6 w-6 text-green-400" />
            ) : (
              <DoorOpen className="h-6 w-6 text-amber-400" />
            )}
            <h3 className="text-sm font-semibold text-gray-200">
              {t('admin.security.card.doors', 'Doors')}
            </h3>
          </div>
          <p
            className={cn(
              'text-2xl font-bold',
              doorClosed(latest?.doorState) ? 'text-green-400' : 'text-amber-400',
            )}
          >
            {doorClosed(latest?.doorState)
              ? t('admin.security.closed', 'Closed')
              : (latest?.doorState ?? '—')}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('admin.security.card.doorsDesc', 'All vehicle doors')}
          </p>
        </GlassPanel>

        {/* Windows */}
        <GlassPanel className="p-4">
          <div className="flex items-center gap-3 mb-2">
            <DoorClosed
              className={cn(
                'h-6 w-6',
                allWindowsClosed(latest) ? 'text-green-400' : 'text-amber-400',
              )}
            />
            <h3 className="text-sm font-semibold text-gray-200">
              {t('admin.security.card.windows', 'Windows')}
            </h3>
          </div>
          <p
            className={cn(
              'text-2xl font-bold',
              allWindowsClosed(latest) ? 'text-green-400' : 'text-amber-400',
            )}
          >
            {windowSummary(latest)}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('admin.security.card.windowsDesc', 'Window positions')}
          </p>
        </GlassPanel>

        {/* HomeLink */}
        <GlassPanel className="p-4">
          <div className="flex items-center gap-3 mb-2">
            <Home
              className={cn(
                'h-6 w-6',
                latest?.homelinkNearby ? 'text-purple-400' : 'text-[var(--text-muted)]',
              )}
            />
            <h3 className="text-sm font-semibold text-gray-200">
              {t('admin.security.card.homelink', 'HomeLink')}
            </h3>
          </div>
          <p
            className={cn(
              'text-2xl font-bold',
              latest?.homelinkNearby ? 'text-purple-400' : 'text-[var(--text-muted)]',
            )}
          >
            {latest?.homelinkNearby
              ? t('admin.security.nearby', 'Nearby')
              : t('admin.security.away', 'Away')}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('admin.security.card.homelinkDesc', 'Garage door opener')}
          </p>
        </GlassPanel>

        {/* Guest Mode */}
        <GlassPanel className="p-4">
          <div className="flex items-center gap-3 mb-2">
            <UserCheck
              className={cn(
                'h-6 w-6',
                latest?.guestMode ? 'text-amber-400' : 'text-[var(--text-muted)]',
              )}
            />
            <h3 className="text-sm font-semibold text-gray-200">
              {t('admin.security.card.guestMode', 'Guest Mode')}
            </h3>
          </div>
          <p
            className={cn(
              'text-2xl font-bold',
              latest?.guestMode ? 'text-amber-400' : 'text-[var(--text-muted)]',
            )}
          >
            {latest?.guestMode
              ? t('admin.security.enabled', 'Enabled')
              : t('admin.security.disabled', 'Disabled')}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('admin.security.card.guestDesc', 'Temporary access mode')}
          </p>
        </GlassPanel>
      </div>
    </FadeIn>
  );
}
