import { type ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface FormSectionProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

/** Labeled fieldset for grouping form controls with consistent spacing. */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <div className={cn('glass-panel p-5 sm:p-6 space-y-4', className)}>
      <div>
        <h3 className="section-title">{title}</h3>
        {description && <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  )
}
