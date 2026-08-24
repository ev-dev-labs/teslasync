import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Drawer,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui'
import { Icons } from '@/lib/icons'

export type EntityPreviewTone =
  | 'success'
  | 'info'
  | 'warning'
  | 'danger'
  | 'neutral'

export interface EntityPreviewField {
  key: string
  label: string
  value: ReactNode
  detail?: string
}

export interface EntityPreviewDrawerProps {
  open: boolean
  onClose: () => void
  eyebrow: string
  title: string
  description?: string
  statusLabel?: string
  statusTone?: EntityPreviewTone
  fields: readonly EntityPreviewField[]
  primaryAction?: {
    label: string
    onClick: () => void
  }
  children?: ReactNode
}

/** Consistent quick-inspection drawer for fleet, drive, and charging entities. */
export function EntityPreviewDrawer({
  open,
  onClose,
  eyebrow,
  title,
  description,
  statusLabel,
  statusTone = 'neutral',
  fields,
  primaryAction,
  children,
}: EntityPreviewDrawerProps) {
  const { t } = useTranslation()

  const handlePrimaryAction = () => {
    onClose()
    primaryAction?.onClick()
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.close', 'Close')}
          </Button>
          {primaryAction && (
            <Button
              type="button"
              icon={<Icons.forward className="h-4 w-4" aria-hidden="true" />}
              onClick={handlePrimaryAction}
            >
              {primaryAction.label}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Text
              as="span"
              size="2xs"
              weight="semibold"
              color="muted"
              className="uppercase tracking-[0.12em]"
            >
              {eyebrow}
            </Text>
            {statusLabel && (
              <Badge variant={statusTone} size="sm" dot>
                {statusLabel}
              </Badge>
            )}
          </div>
          {description && (
            <Text as="p" variant="bodySm" className="mt-2">
              {description}
            </Text>
          )}
        </div>

        <div>
          <PanelTitle>{t('operations.evidence', 'Evidence')}</PanelTitle>
          <dl className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-shape-md border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key} className="min-w-0 bg-[var(--surface-2)] p-3">
                <dt>
                  <MetricLabel>{field.label}</MetricLabel>
                </dt>
                <Text
                  as="dd"
                  size="sm"
                  weight="semibold"
                  color="primary"
                  className="mt-1 break-words tabular-nums"
                >
                  {field.value}
                </Text>
                {field.detail && (
                  <Text as="p" size="2xs" color="muted" className="mt-1">
                    {field.detail}
                  </Text>
                )}
              </div>
            ))}
          </dl>
        </div>

        {children}
      </div>
    </Drawer>
  )
}
