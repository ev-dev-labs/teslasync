import { type ReactNode, useId } from 'react'
import { cn } from '@/lib/cn'

export interface FormSectionProps {
  /** Visible heading, rendered as an `<h3>` and used as the group's
   * accessible name via `aria-labelledby`. */
  title: string
  /** Optional supporting copy shown under the title and wired to the group
   * via `aria-describedby`. An empty string is treated as absent. */
  description?: string
  /** The grouped form controls. */
  children: ReactNode
  /** Extra classes merged onto the wrapping panel. */
  className?: string
}

/** Labeled fieldset for grouping form controls with consistent spacing. */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  const headingId = useId()
  const descriptionId = useId()
  const hasDescription = Boolean(description)

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      className={cn('glass-panel p-5 sm:p-6 space-y-4', className)}
    >
      <div>
        <h3 id={headingId} className="section-title">{title}</h3>
        {hasDescription && (
          <p id={descriptionId} className="mt-1 text-xs text-[var(--text-muted)]">
            {description}
          </p>
        )}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  )
}
