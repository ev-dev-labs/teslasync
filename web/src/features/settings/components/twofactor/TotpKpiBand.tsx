/**
 * Two-factor KPI band.
 *
 * Full-width metric strip summarising the credential at a glance:
 * protection status, last verification, remaining backup codes, and
 * the method. Self-sufficient — owns its loading and open-mode
 * (unavailable) states and is null-safe on every field.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, ShieldAlert, ShieldQuestion, Clock, KeyRound, Smartphone } from 'lucide-react'
import type { StatMetric } from '@/components/data-display'
import { SettingsSummaryBrief } from '../operationalbrief-all/SettingsSummaryBrief'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { NeonColor } from '@/lib/tokens'
import type { TOTPStatus } from '@/api/types'
import { knownNumber } from '@/api/dataState'

interface TotpKpiBandProps {
  data: TOTPStatus | undefined
  isLoading: boolean
  retained?: boolean
}

interface KpiCell {
  key: string
  label: string
  value: string | number
  subtitle?: string
  color: NeonColor
  icon: ReactNode
}

export function TotpKpiBand({ data, isLoading, retained = false }: TotpKpiBandProps) {
  const { t } = useTranslation('settings')
  const { formatDateTime } = useDateFormat()

  const session = data && data.mode === 'session' ? data : null
  const isOpen = !data || data.mode === 'open'
  const activated = session?.activated === true
  const backupRemaining = knownNumber(session?.backup_codes_remaining)
  const lastUsedAt = session?.last_used_at
  const dash = t('common.dash', '—')

  const statusCell: KpiCell = isOpen
    ? {
        key: 'status',
        label: t('totp.kpi.protection', 'Protection'),
        value: t('totp.kpi.unavailable', 'Unavailable'),
        color: 'red',
        icon: <ShieldAlert className="h-5 w-5" aria-hidden="true" />,
      }
    : activated
      ? {
          key: 'status',
          label: t('totp.kpi.protection', 'Protection'),
          value: t('totp.status.active', 'Active'),
          color: 'green',
          icon: <ShieldCheck className="h-5 w-5" aria-hidden="true" />,
        }
      : {
          key: 'status',
          label: t('totp.kpi.protection', 'Protection'),
          value: t('totp.status.notEnrolled', 'Not enrolled'),
          color: 'amber',
          icon: <ShieldQuestion className="h-5 w-5" aria-hidden="true" />,
        }

  const lastUsedValue = activated
    ? lastUsedAt
      ? formatDateTime(lastUsedAt)
      : t('totp.lastUsed.never', 'Never')
    : dash

  const cells: KpiCell[] = [
    statusCell,
    {
      key: 'lastUsed',
      label: t('totp.kpi.lastVerified', 'Last verified'),
      value: lastUsedValue,
      color: 'cyan',
      icon: <Clock className="h-5 w-5" aria-hidden="true" />,
    },
    {
      key: 'backup',
      label: t('totp.backupCodesRemaining.label', 'Backup codes remaining'),
      value: activated ? backupRemaining ?? dash : dash,
      color: 'purple',
      icon: <KeyRound className="h-5 w-5" aria-hidden="true" />,
    },
    {
      key: 'method',
      label: t('totp.kpi.method', 'Method'),
      value: t('totp.kpi.methodValue', 'TOTP'),
      subtitle: t('totp.kpi.methodStandard', 'RFC 6238'),
      color: 'blue',
      icon: <Smartphone className="h-5 w-5" aria-hidden="true" />,
    },
  ]
  const metrics: readonly StatMetric[] = cells.map(cell => ({
    metricId: cell.key === 'backup' ? 'count' : cell.key === 'status' ? 'status' : 'text',
    occurrenceId: `totp-${cell.key}`,
    label: cell.label,
    rawValue: isLoading ? null : cell.key === 'backup'
      ? activated ? session?.backup_codes_remaining : null
      : cell.value === dash ? null : cell.value,
    context: <>{cell.icon}{cell.subtitle}</>,
  }))

  return (
    <section
      aria-label={t('totp.kpi.aria', 'Two-factor status summary')}
      aria-busy={isLoading}
    >
      <SettingsSummaryBrief title={t('totp.brief.title', 'Two-factor overview')}
        description={t('totp.brief.description', 'Protection status, last verification and remaining recovery codes for this account. Enrollment and recovery controls remain unchanged.')}
        source={t('totp.brief.source', 'Account two-factor status')}
        scope={t('totp.brief.scope', 'Latest credential status · last verification is a recorded event, not a date-range total')}
        metrics={metrics} loading={isLoading} retained={retained}
        unavailable={!session} testId="totp-summary" />
    </section>
  )
}

export default TotpKpiBand
