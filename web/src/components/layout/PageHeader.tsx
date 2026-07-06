import { type ReactNode } from 'react'
import { FadeIn } from '../motion/FadeIn'
import { Heading } from '../ui/Typography'
import { CopyLinkButton } from './CopyLinkButton'

/** Standard page header with gradient title, decorative underline, optional subtitle and action buttons. */
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
      <div className="mb-6 sm:mb-8 flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          {icon && <div className="mt-1">{icon}</div>}
          <div>
            <Heading
              level="page"
              className="bg-gradient-to-r from-white via-white to-gray-400 bg-clip-text text-transparent forced-colors:text-[CanvasText]"
            >
              {title}
            </Heading>
            <div
              aria-hidden="true"
              className="mt-1.5 sm:mt-2 h-0.5 w-12 sm:w-16 rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple opacity-60"
            />
            {subtitle && <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-[var(--text-secondary)]">{subtitle}</p>}
          </div>
        </div>
        {(actions || copyLink) && (
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 min-w-0 max-w-full">
            {copyLink && <CopyLinkButton />}
            {actions}
          </div>
        )}
      </div>
    </FadeIn>
  )
}
