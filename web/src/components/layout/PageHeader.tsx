import { type ReactNode } from 'react'
import { FadeIn } from '../motion/FadeIn'
import { Heading, Text } from '../ui/Typography'
import { CopyLinkButton } from './CopyLinkButton'
import { PageActions } from './PageActions'

/** Standard page header with optional subtitle and action buttons. */
export function PageHeader({
  title,
  subtitle,
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
  return (
    <FadeIn>
      <header
        className="relative mb-6 flex flex-col gap-5 overflow-hidden rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] px-5 py-5 shadow-e1 sm:px-6 xl:flex-row xl:items-center xl:justify-between"
        data-role="page-header"
      >
        <div className="flex min-w-0 max-w-4xl gap-4">
          <span
            className="w-1 shrink-0 self-stretch rounded-pill bg-[var(--theme-primary)]"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-3.5">
              {icon && (
                <div className="shrink-0 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-2.5 text-[var(--theme-primary)] shadow-e1">
                  {icon}
                </div>
              )}
              <Heading
                level="page"
                className="font-bold tracking-[-0.025em]"
              >
                {title}
              </Heading>
            </div>
            {subtitle && (
              <Text as="p" size="sm" color="secondary" className="mt-1.5 max-w-3xl leading-relaxed">
                {subtitle}
              </Text>
            )}
          </div>
        </div>
        <PageActions
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
              ? <>{overflowActions}{copyLink && <CopyLinkButton />}</>
              : undefined
          }
          primary={primaryAction}
        />
      </header>
    </FadeIn>
  )
}
