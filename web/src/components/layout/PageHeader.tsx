import { type ReactNode } from 'react'
import { FadeIn } from '../motion/FadeIn'
import { Heading, Text } from '../ui/Typography'
import { CopyLinkButton } from './CopyLinkButton'

/** Standard page header with optional subtitle and action buttons. */
export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  copyLink,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
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
        className="mb-8 flex flex-col gap-5 border-b border-[var(--border-default)] pb-6 lg:flex-row lg:items-center lg:justify-between"
        data-role="page-header"
      >
        <div className="min-w-0 max-w-4xl">
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
        {(actions || copyLink) && (
          <div
            className="flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-1)] p-1.5 shadow-e1 lg:justify-end"
            data-role="page-actions"
          >
            {copyLink && <CopyLinkButton />}
            {actions}
          </div>
        )}
      </header>
    </FadeIn>
  )
}
