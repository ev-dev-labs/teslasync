import { useTranslation } from 'react-i18next'
import { Shield, ShieldAlert, Eye, DoorClosed, Car, Lock, Unlock } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'
import type { SecurityEvent } from '@/api/types'

interface SecurityPanelProps {
  securityData: SecurityEvent | null | undefined
}

export function SecurityPanel({ securityData }: SecurityPanelProps) {
  const { t } = useTranslation()

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Shield className="h-4 w-4 text-neon-cyan" /> {t('common.security', 'Security')}
      </h3>
      {securityData ? (
        <div className="space-y-4">
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
                {securityData.locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked')}
              </p>
              <p className="text-[10px] text-white/40">{t('telemetry.lockStatus', 'Vehicle lock status')}</p>
            </div>
          </div>

          {/* Sentry Mode */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <Eye className="h-3 w-3" /> Sentry Mode
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
              {securityData.sentry_mode ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* Door State */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <DoorClosed className="h-3 w-3" /> Door State
            </span>
            <span className="text-sm font-mono text-[var(--text-primary)]">
              {securityData.door_state ?? '—'}
            </span>
          </div>

          {/* Windows grid */}
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-2">Windows</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['FD', securityData.fd_window],
                  ['FP', securityData.fp_window],
                  ['RD', securityData.rd_window],
                  ['RP', securityData.rp_window],
                ] as const
              ).map(([label, val]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2"
                >
                  <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
                  <span
                    className={cn(
                      'text-[11px] font-semibold',
                      val === 'Closed'
                        ? 'text-green-400'
                        : val
                          ? 'text-amber-400'
                          : 'text-[var(--text-muted)]',
                    )}
                  >
                    {val ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* HomeLink + Guest Mode */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <Car className="h-3 w-3" /> HomeLink
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                securityData.homelink_nearby
                  ? 'text-green-400'
                  : 'text-[var(--text-muted)]',
              )}
            >
              {securityData.homelink_nearby ? 'Nearby' : 'Not detected'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <Shield className="h-3 w-3" /> Guest Mode
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                securityData.guest_mode
                  ? 'text-amber-400'
                  : 'text-[var(--text-muted)]',
              )}
            >
              {securityData.guest_mode ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">
          No security data available
        </p>
      )}
    </GlassPanel>
  )
}
