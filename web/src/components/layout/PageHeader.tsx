import { type ReactNode } from 'react'
import { FadeIn } from '../motion/FadeIn'

/** Standard page header with gradient title, decorative underline, optional subtitle and action buttons. */
export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: string; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <FadeIn>
      <div className="mb-6 sm:mb-8 flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          {icon && <div className="mt-1">{icon}</div>}
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-gray-400 bg-clip-text text-transparent">{title}</h1>
            <div className="mt-1.5 sm:mt-2 h-0.5 w-12 sm:w-16 rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple opacity-60" />
            {subtitle && <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-white/60">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 sm:gap-3">{actions}</div>}
      </div>
    </FadeIn>
  )
}
