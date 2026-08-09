import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Text } from '@/components/ui'
import { isSensitiveManagementKey } from './managementJson'
import { humanizeManagementLabel } from './managementData'

interface StructuredDataViewProps {
  value: unknown
}

interface RendererLabels {
  redacted: string
  emptyObject: string
  emptyArray: string
  noData: string
  trueValue: string
  falseValue: string
  maxDepth: string
  item: (index: number) => string
}

const MAX_RENDER_DEPTH = 8

function renderScalar(value: string | number | boolean | null, labels: RendererLabels): ReactNode {
  if (value === null) {
    return <Text variant="bodySm">{labels.noData}</Text>
  }
  if (typeof value === 'boolean') {
    return (
      <Badge variant={value ? 'success' : 'neutral'}>
        {value ? labels.trueValue : labels.falseValue}
      </Badge>
    )
  }
  return (
    <Text
      variant="bodySm"
      mono={typeof value === 'number'}
      className="break-words whitespace-pre-wrap"
    >
      {String(value)}
    </Text>
  )
}

function renderNode(value: unknown, depth: number, labels: RendererLabels): ReactNode {
  if (depth >= MAX_RENDER_DEPTH) {
    return <Text variant="helper">{labels.maxDepth}</Text>
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return renderScalar(value, labels)
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <Text variant="helper">{labels.emptyArray}</Text>
    }
    return (
      <div className="grid gap-2">
        {value.map((item, index) => (
          <div
            key={index}
            className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
          >
            <Text variant="label">{labels.item(index + 1)}</Text>
            {renderNode(item, depth + 1, labels)}
          </div>
        ))}
      </div>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return <Text variant="helper">{labels.emptyObject}</Text>
    }
    return (
      <dl className="grid gap-2">
        {entries.map(([key, nested]) => (
          <div
            key={key}
            className="grid gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 sm:grid-cols-[minmax(9rem,0.35fr)_minmax(0,1fr)]"
          >
            <dt className="min-w-0">
              <Text variant="label" title={key}>
                {humanizeManagementLabel(key)}
              </Text>
            </dt>
            <dd className="min-w-0">
              {isSensitiveManagementKey(key)
                ? <Text variant="helper">{labels.redacted}</Text>
                : renderNode(nested, depth + 1, labels)}
            </dd>
          </div>
        ))}
      </dl>
    )
  }

  return <Text variant="helper">{labels.noData}</Text>
}

export function StructuredDataView({ value }: StructuredDataViewProps) {
  const { t } = useTranslation()
  const labels: RendererLabels = {
    redacted: t('vehicleManagement.data.redacted', 'Redacted'),
    emptyObject: t('vehicleManagement.data.emptyObject', 'Empty object'),
    emptyArray: t('vehicleManagement.data.emptyArray', 'Empty list'),
    noData: t('vehicleManagement.data.noData', 'No value'),
    trueValue: t('vehicleManagement.data.true', 'Yes'),
    falseValue: t('vehicleManagement.data.false', 'No'),
    maxDepth: t('vehicleManagement.data.maxDepth', 'Additional nested data'),
    item: (index) =>
      t('vehicleManagement.data.item', 'Item {{index}}', { index }),
  }

  return (
    <div data-testid="management-structured-data">
      {renderNode(value, 0, labels)}
    </div>
  )
}
