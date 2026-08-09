import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Code,
  GlassPanel,
  PanelTitle,
  Text,
} from '@/components/ui'
import { AlertBanner } from '@/components/feedback'
import { Icons } from '@/lib/icons'
import type { ManagementEndpointKind } from './managementJson'
import { ManagementEndpointBody } from './ManagementEndpointBody'

type Prerequisite = 'user' | 'partner' | 'enterprise'

interface ManagementEndpointCardProps {
  endpointId: string
  title: string
  description: string
  endpoint: string
  prerequisite: Prerequisite
  data: unknown
  fetchedAt?: string | null
  loading?: boolean
  error?: unknown
  refreshPending?: boolean
  operationSucceeded?: boolean
  refreshDisabled?: boolean
  unavailable?: boolean
  kind?: ManagementEndpointKind
  warning?: ReactNode
  actionLabel?: string
  emptyTitle?: string
  emptyMessage?: string
  onRefresh?: () => void
}

const prerequisiteVariant = {
  user: 'info',
  partner: 'warning',
  enterprise: 'danger',
} as const

export function ManagementEndpointCard({
  endpointId,
  title,
  description,
  endpoint,
  prerequisite,
  data,
  fetchedAt,
  loading = false,
  error,
  refreshPending = false,
  operationSucceeded = false,
  refreshDisabled = false,
  unavailable = false,
  kind = 'generic',
  warning,
  actionLabel,
  emptyTitle,
  emptyMessage,
  onRefresh,
}: ManagementEndpointCardProps) {
  const { t } = useTranslation()
  const prerequisiteLabel = {
    user: t('vehicleManagement.prerequisite.user', 'User access'),
    partner: t('vehicleManagement.prerequisite.partner', 'Partner token'),
    enterprise: t('vehicleManagement.prerequisite.enterprise', 'Enterprise'),
  }[prerequisite]

  return (
    <GlassPanel
      className="flex min-h-72 flex-col gap-3 p-4"
      data-management-endpoint={endpointId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <PanelTitle>{title}</PanelTitle>
          <Text variant="bodySm" as="p">{description}</Text>
        </div>
        <Badge variant={prerequisiteVariant[prerequisite]}>
          {prerequisiteLabel}
        </Badge>
      </div>

      <Code className="break-all text-[var(--text-secondary)]">{endpoint}</Code>
      {warning}
      {operationSucceeded && !error && (
        <AlertBanner
          variant="success"
          title={t('vehicleManagement.state.success', 'Request completed')}
        >
          {t(
            'vehicleManagement.state.successDetail',
            'Tesla accepted the request. Any returned data is shown below.',
          )}
        </AlertBanner>
      )}

      <div className="min-h-24 flex-1">
        <ManagementEndpointBody
          data={data}
          loading={loading}
          error={error}
          unavailable={unavailable}
          kind={kind}
          emptyTitle={emptyTitle}
          emptyMessage={emptyMessage}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-3">
        <Text variant="caption">
          {fetchedAt
            ? t('vehicleManagement.state.fetchedAt', 'Cached {{time}}', { time: fetchedAt })
            : t('vehicleManagement.state.notFetched', 'Not cached')}
        </Text>
        {onRefresh && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={refreshPending}
            disabled={refreshDisabled || unavailable}
            icon={<Icons.refresh className="h-4 w-4" aria-hidden="true" />}
            onClick={onRefresh}
          >
            {actionLabel ?? t('vehicleManagement.action.refresh', 'Refresh from Tesla')}
          </Button>
        )}
      </div>
    </GlassPanel>
  )
}
