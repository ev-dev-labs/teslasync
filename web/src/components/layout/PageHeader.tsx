import { type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { FadeIn } from '../motion/FadeIn'
import { Heading, Text } from '../ui/Typography'
import { Button, Tooltip } from '@/components/ui'
import { CopyLinkButton } from './CopyLinkButton'
import { PageActions } from './PageActions'

/** Standard page header with optional subtitle and action buttons. */
export function PageHeader({
  title,
  subtitle,
  compactHeader = true,
  actions,
  contextActions,
  metadataActions,
  secondaryActions,
  destructiveActions,
  overflowActions,
  primaryAction,
  icon,
  copyLink,
}: {
  title: string
  subtitle?: string
  compactHeader?: boolean
  /** @deprecated Use the semantic action slots below for new or touched pages. */
  actions?: ReactNode
  contextActions?: ReactNode
  metadataActions?: ReactNode
  secondaryActions?: ReactNode
  destructiveActions?: ReactNode
  overflowActions?: ReactNode
  primaryAction?: ReactNode
  icon?: ReactNode
  /**
   * Show a "Copy link" button that copies the current URL (with all query
   * params baked in). Use on pages where users would reasonably share a
   * filtered view — Notifications with severity=critical, a specific
   * Drives date range, etc.
   */
  copyLink?: boolean
}) {
  const { t } = useTranslation()
  return (
    <FadeIn>
      <header
        className={cn(
          'relative mb-6 flex flex-col gap-5 overflow-hidden rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] px-5 py-5 shadow-e1 sm:px-6 xl:flex-row xl:items-center xl:justify-between',
          compactHeader && 'mb-3 gap-2 overflow-visible rounded-none border-0 bg-transparent px-0 py-1 shadow-none sm:px-0 xl:gap-3',
        )}
        data-role="page-header"
      >
        <div className={cn('flex min-w-0 max-w-4xl gap-4', compactHeader && 'gap-3 xl:flex-1')}>
          <span
            className="w-1 shrink-0 self-stretch rounded-pill bg-[var(--theme-primary)]"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-3.5">
              {icon && (
                <div className={cn(
                  'shrink-0 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-2.5 text-[var(--theme-primary)] shadow-e1',
                  compactHeader && 'rounded-none border-0 bg-transparent p-0 shadow-none',
                )}>
                  {icon}
                </div>
              )}
              <Heading
                level="page"
                className="font-bold tracking-[-0.025em] outline-none"
                tabIndex={-1}
                data-route-focus-target="true"
              >
                {title}
              </Heading>
              {compactHeader && subtitle && (
                <Tooltip content={subtitle} side="bottom" multiline>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('help.tooltip.iconLabel', 'More info')}: ${title}`}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-primary)] sm:h-9 sm:w-9"
                  >
                    <Info className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
              )}
            </div>
            {subtitle && !compactHeader && (
              <Text as="p" size="sm" color="secondary" className="mt-1.5 max-w-3xl leading-relaxed">
                {subtitle}
              </Text>
            )}
          </div>
        </div>
        <PageActions
          className={compactHeader ? 'border-0 bg-transparent p-0' : undefined}
          metadata={metadataActions}
          context={contextActions}
          secondary={
            actions || secondaryActions
              ? <>{actions}{secondaryActions}</>
              : undefined
          }
          destructive={destructiveActions}
          overflow={
            copyLink || overflowActions
              ? <>{overflowActions}{copyLink && <CopyLinkButton iconOnly />}</>
              : undefined
          }
          primary={primaryAction}
        />
      </header>
    </FadeIn>
  )
}
