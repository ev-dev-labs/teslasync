/**
 * ActionItemsPanel — operator task list.
 *
 * NEVER hides — when no actions exist renders an explicit
 * "Nothing right now ✅" empty state so the operator can
 * distinguish "healthy" from "broken".
 */

import { type ReactNode, Children } from 'react'
import { CheckCircle } from 'lucide-react'
import { GlassPanel } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface ActionItemsPanelProps {
  /** Title shown at the top. Defaults to "Needs your attention". */
  title?: string
  /** Action items rendered as children. Empty array / no children → empty state. */
  children: ReactNode
  /** Force the empty state regardless of children. Useful for storybook / tests. */
  forceEmpty?: boolean
  /** Override empty-state text. */
  emptyText?: string
  id?: string
  className?: string
}

export function ActionItemsPanel({
  title = 'Needs your attention',
  children,
  forceEmpty = false,
  emptyText = 'Nothing right now',
  id,
  className,
}: ActionItemsPanelProps) {
  const childArray = Children.toArray(children).filter(Boolean)
  const hasChildren = !forceEmpty && childArray.length > 0

  return (
    <GlassPanel id={id} className={cn('p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>

      {hasChildren ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg p-3 ring-1 ring-green-400/20 bg-green-500/10">
          <CheckCircle className="h-5 w-5 shrink-0 text-green-400" aria-hidden />
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {emptyText}
          </div>
        </div>
      )}
    </GlassPanel>
  )
}
