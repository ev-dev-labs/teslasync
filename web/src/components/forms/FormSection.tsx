import { type AriaAttributes, type ReactNode, useId } from 'react'
import { HelperText, PanelTitle } from '@/components/ui/Typography'
import { cn } from '@/lib/cn'

export interface FormSectionProps extends Pick<AriaAttributes, 'aria-invalid' | 'aria-describedby'> {
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

/** Accessible group for form controls with consistent spacing. */
export function FormSection({ title, description, children, className, 'aria-invalid': invalid, 'aria-describedby': describedBy }: FormSectionProps) {
  const headingId = useId()
  const descriptionId = useId()
  const hasDescription = Boolean(description)

  return (
    <fieldset
      aria-labelledby={headingId}
      aria-describedby={[hasDescription ? descriptionId : undefined, describedBy].filter(Boolean).join(' ') || undefined}
      aria-invalid={invalid}
      className={cn('glass-panel min-w-0 overflow-visible p-4 sm:p-6 space-y-4', className)}
    >
      <div>
        <PanelTitle id={headingId} className="break-words">{title}</PanelTitle>
        {hasDescription && (
          <HelperText id={descriptionId} className="mt-1 break-words">
            {description}
          </HelperText>
        )}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </fieldset>
  )
}
