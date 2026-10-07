import { useTranslation } from 'react-i18next'
import { Shield, Lock, Unlock, Eye, Car, DoorClosed } from 'lucide-react'

import { GlassPanel, PanelTitle } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import type { SecurityEvent, VehicleState } from '@/api/types'

interface SecuritySectionProps {
  securityData: SecurityEvent | null | undefined
  state: VehicleState
}

// windowOpenCount counts the number of windows reading > 0 (percent open).
// Backend `*_window` fields land as strings (snake_case JSON projection of
// the codec FdWindow/FpWindow/RdWindow/RpWindow signals) per
// internal/api/security_handler.go securityMappings; coerce defensively.
function windowOpenCount(s: SecurityEvent): number {
  const fields = [s.fd_window, s.fp_window, s.rd_window, s.rp_window]
  let open = 0
  for (const v of fields) {
    if (v == null) continue
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n) && n > 0) open += 1
  }
  return open
}

// normalizeDoorState coerces the raw door_state signal into a display string
// (or null → the card's "Closed" fallback). The backend serializes a raw
// signal.SignalValue, so door_state can arrive as a native boolean
// (true = a door is open) or a string enum — a boolean must map to Open/Closed
// semantics rather than stringify to the literal "true"/"false".
function normalizeDoorState(
  v: SecurityEvent['door_state'],
  openLabel: string,
): string | null {
  if (v == null) return null
  if (typeof v === 'boolean') return v ? openLabel : null
  const s = String(v).trim()
  return s === '' ? null : s
}

export function SecuritySection({ securityData, state }: SecuritySectionProps) {
  const { t } = useTranslation()

  const windowsOpen = securityData ? windowOpenCount(securityData) : 0
  const doorState = securityData
    ? normalizeDoorState(securityData.door_state, t('common.open', 'Open'))
    : null

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Shield className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicles.detail.security', 'Security')}
      </PanelTitle>
      {securityData ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard
            label={t('common.locked', 'Locked')}
            value={state.is_locked ? t('common.yes', 'Yes') : t('common.no', 'No')}
            icon={
              state.is_locked ? (
                <Lock className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Unlock className="h-4 w-4" aria-hidden="true" />
              )
            }
            color={state.is_locked ? 'green' : 'cyan'}
          />
          <MetricCard
            label={t('common.sentry', 'Sentry')}
            value={state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')}
            icon={<Eye className="h-4 w-4" aria-hidden="true" />}
            color={state.sentry_mode ? 'green' : 'cyan'}
          />
          <MetricCard
            label={t('vehicles.detail.doors', 'Doors')}
            value={doorState ?? t('common.closed', 'Closed')}
            icon={<DoorClosed className="h-4 w-4" aria-hidden="true" />}
            color={doorState ? 'cyan' : 'green'}
          />
          <MetricCard
            label={t('vehicles.detail.windows', 'Windows')}
            value={
              windowsOpen > 0
                ? t('vehicles.detail.windowsOpen', '{{count}} open', { count: windowsOpen })
                : t('common.closed', 'Closed')
            }
            icon={<Car className="h-4 w-4" aria-hidden="true" />}
            color={windowsOpen > 0 ? 'cyan' : 'green'}
          />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('vehicles.detail.noSecurityData', 'No security data available')} />
      )}
    </GlassPanel>
  )
}
