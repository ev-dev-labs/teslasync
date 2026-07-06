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
        <Shield className="h-4 w-4 text-cyan-300" aria-hidden="true" /> {t('common.security', 'Security')}
      </h3>
      {hasData ? (
        <div className="space-y-4">
          {securityData && (
            <>
              {/* Lock status — `locked` is boolean | null. An unknown (null)
                  lock state must NOT be rendered as a definitive "Unlocked":
                  that is misleading in a security context. Distinguish the
                  three states explicitly. */}
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    'rounded-xl p-3 border',
                    securityData.locked === true
                      ? 'border-green-500/30 bg-green-500/10'
                      : securityData.locked === false
                        ? 'border-amber-500/30 bg-amber-500/10'
                        : 'border-white/[0.06] bg-white/[0.02]',
                  )}
                >
                  {securityData.locked === true ? (
                    <Lock className="h-6 w-6 text-green-400" aria-hidden="true" />
                  ) : securityData.locked === false ? (
                    <Unlock className="h-6 w-6 text-amber-400" aria-hidden="true" />
                  ) : (
                    <Lock className="h-6 w-6 text-[var(--text-muted)]" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <p
                    className={cn(
                      'text-lg font-semibold',
                      securityData.locked === true
                        ? 'text-green-400'
                        : securityData.locked === false
                          ? 'text-amber-400'
                          : 'text-[var(--text-muted)]',
                    )}
                  >
                    {securityData.locked === true
                      ? t('common.locked', 'Locked')
                      : securityData.locked === false
                        ? t('common.unlocked', 'Unlocked')
                        : t('common.unknown', 'Unknown')}
                  </p>
                  <p className="text-2xs text-[var(--text-muted)]">
                    {t('telemetry.lockStatus', 'Vehicle lock status')}
                  </p>
                </div>
              </div>

              {/* Sentry Mode — tri-state: active (true) / inactive (false) /
                  unknown (null). Unknown reads "Unknown", not "Inactive". */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Eye className="h-3 w-3" aria-hidden="true" /> {t('telemetry.sentryMode', 'Sentry Mode')}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border',
                    securityData.sentry_mode === true
                      ? 'border-red-500/30 bg-red-500/10 text-red-400'
                      : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)]',
                  )}
                >
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                  {securityData.sentry_mode === true
                    ? t('common.active', 'Active')
                    : securityData.sentry_mode === false
                      ? t('common.inactive', 'Inactive')
                      : t('common.unknown', 'Unknown')}
                </span>
              </div>

              {/* Doors */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <DoorClosed className="h-3 w-3" aria-hidden="true" /> {t('telemetry.doors', 'Doors')}
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

              {/* User presence — tri-state: yes (true) / no (false) /
                  unknown (null → em-dash). */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <User className="h-3 w-3" aria-hidden="true" /> {t('telemetry.userPresent', 'User Present')}
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    securityData.user_present === true
                      ? 'text-green-400'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {securityData.user_present === true
                    ? t('common.yes', 'Yes')
                    : securityData.user_present === false
                      ? t('common.no', 'No')
                      : '—'}
                </span>
              </div>

              {securityData.detail && (
                <div className="text-xs text-[var(--text-muted)] italic">
                  {securityData.detail}
                </div>
              )}
            </>
          )}

          {/* Remote Start access */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <KeyRound className="h-3 w-3" aria-hidden="true" /> {t('telemetry.remoteStart', 'Remote Start')}
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
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('telemetry.noSecurityData', 'No security data available')} />
      )}
    </GlassPanel>
  )
}
