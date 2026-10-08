import { type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { FadeIn } from '../motion/FadeIn'
import { Heading, Text } from '../ui/Typography'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { Icon } from '../ui/Icon'
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
          'relative mb-6 flex flex-col gap-4 overflow-hidden rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] p-4 shadow-e1 sm:p-6 xl:flex-row xl:items-center xl:justify-between',
          compactHeader && 'mb-3 gap-2 overflow-visible rounded-none border-0 bg-transparent px-0 py-1 shadow-none sm:px-0 xl:gap-3',
        )}
        data-role="page-header"
      >
        <div className={cn('flex min-w-0 max-w-4xl gap-4', compactHeader && 'gap-3 xl:flex-1')}>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              {icon && (
                <div className={cn(
                  'shrink-0 rounded-shape-sm bg-[var(--surface-2)] p-2 text-[var(--text-secondary)]',
                  compactHeader && 'rounded-none bg-transparent p-0',
                )}>
                  {icon}
                </div>
              )}
              <Heading
                level="page"
                className="min-w-0 break-words outline-none"
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
                    className="h-11 w-11 shrink-0 text-[var(--text-secondary)] sm:h-9 sm:w-9"
                  >
                    <Icon icon={Info} />
                  </Button>
                </Tooltip>
              )}
            </div>
            {subtitle && !compactHeader && (
              <Text as="p" variant="bodySm" className="mt-2 max-w-3xl break-words text-[var(--text-secondary)]">
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
