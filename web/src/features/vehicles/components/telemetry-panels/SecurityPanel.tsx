import { useTranslation } from 'react-i18next'
import { Shield, ShieldAlert, Eye, DoorClosed, Lock, Unlock, KeyRound, User } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import type { SecurityEvent } from '@/api/types'

interface SecurityPanelProps {
  securityData: SecurityEvent | null | undefined
  remoteStartEnabled?: boolean | null
}

export function SecurityPanel({ securityData, remoteStartEnabled }: SecurityPanelProps) {
  const { t } = useTranslation()

  const hasData = securityData != null || remoteStartEnabled != null

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Shield className="h-4 w-4 text-cyan-300" /> {t('common.security', 'Security')}
      </h3>
      {hasData ? (
        <div className="space-y-4">
          {securityData && (
            <>
              {/* Lock status */}
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    'rounded-xl p-3 border',
                    securityData.locked
                      ? 'border-green-500/30 bg-green-500/10'
                      : 'border-amber-500/30 bg-amber-500/10',
                  )}
                >
                  {securityData.locked ? (
                    <Lock className="h-6 w-6 text-green-400" />
                  ) : (
                    <Unlock className="h-6 w-6 text-amber-400" />
                  )}
                </div>
                <div>
                  <p
                    className={cn(
                      'text-lg font-semibold',
                      securityData.locked ? 'text-green-400' : 'text-amber-400',
                    )}
                  >
                    {securityData.locked
                      ? t('common.locked', 'Locked')
                      : t('common.unlocked', 'Unlocked')}
                  </p>
                  <p className="text-[10px] text-white/40">
                    {t('telemetry.lockStatus', 'Vehicle lock status')}
                  </p>
                </div>
              </div>

              {/* Sentry Mode */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Eye className="h-3 w-3" /> {t('telemetry.sentryMode', 'Sentry Mode')}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                    securityData.sentry_mode
                      ? 'border-red-500/30 bg-red-500/10 text-red-400'
                      : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
                  )}
                >
                  <ShieldAlert className="h-3 w-3" />
                  {securityData.sentry_mode
                    ? t('common.active', 'Active')
                    : t('common.inactive', 'Inactive')}
                </span>
              </div>

              {/* Doors */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <DoorClosed className="h-3 w-3" /> {t('telemetry.doors', 'Doors')}
                </span>
                <span className="text-sm font-mono text-[var(--text-primary)]">
                  {securityData.doors_open ?? t('common.closed', 'Closed')}
                </span>
              </div>

              {/* Windows */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">
                  {t('telemetry.windows', 'Windows')}
                </span>
                <span className="text-sm font-mono text-[var(--text-primary)]">
                  {securityData.windows_open ?? t('common.closed', 'Closed')}
                </span>
              </div>

              {/* User presence */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <User className="h-3 w-3" /> {t('telemetry.userPresent', 'User Present')}
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    securityData.user_present
                      ? 'text-green-400'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {securityData.user_present
                    ? t('common.yes', 'Yes')
                    : t('common.no', 'No')}
                </span>
              </div>

              {securityData.detail && (
                <div className="text-[11px] text-[var(--text-muted)] italic">
                  {securityData.detail}
                </div>
              )}
            </>
          )}

          {/* Remote Start access */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> {t('telemetry.remoteStart', 'Remote Start')}
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                remoteStartEnabled == null
                  ? 'text-[var(--text-muted)]'
                  : remoteStartEnabled
                    ? 'text-green-400'
                    : 'text-[var(--text-muted)]',
              )}
            >
              {remoteStartEnabled == null
                ? '—'
                : remoteStartEnabled
                  ? t('common.enabled', 'Enabled')
                  : t('common.disabled', 'Disabled')}
            </span>
          </div>
        </div>
      ) : (
        <EmptyState message={t('telemetry.noSecurityData', 'No security data available')} />
      )}
    </GlassPanel>
  )
}
