import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  BUTTON_BASE,
  BUTTON_VARIANTS,
  Drawer,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui'
import { cn } from '@/lib/cn'
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

export interface EntityPreviewRelatedAction {
  key: string
  label: string
  to: string
  icon?: ReactNode
  onNavigate?: () => void
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
  relatedActions?: readonly EntityPreviewRelatedAction[]
  children?: ReactNode
}

/** Consistent quick-inspection drawer for operational entities and events. */
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
  relatedActions = [],
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
      eyebrow={eyebrow}
      description={description}
      headerMeta={
        statusLabel ? (
          <Badge variant={statusTone} size="sm" dot>
            {statusLabel}
          </Badge>
        ) : undefined
      }
      size="lg"
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

        {relatedActions.length > 0 && (
          <div>
            <PanelTitle>{t('entityContext.title', 'Related context')}</PanelTitle>
            <nav
              aria-label={t('entityContext.title', 'Related context')}
              className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {relatedActions.map((action) => (
                <Link
                  key={action.key}
                  to={action.to}
                  className={cn(
                    BUTTON_BASE,
                    BUTTON_VARIANTS.outline,
                    'h-10 justify-start px-3 text-sm',
                  )}
                  onClick={() => {
                    action.onNavigate?.()
                    onClose()
                  }}
                >
                  {action.icon ?? (
                    <Icons.forward className="h-4 w-4" aria-hidden="true" />
                  )}
                  {action.label}
                </Link>
              ))}
            </nav>
          </div>
        )}

        {children}
      </div>
    </Drawer>
  )
}
