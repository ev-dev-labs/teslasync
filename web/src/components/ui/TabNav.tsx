import { type ReactNode } from 'react'
import clsx from 'clsx'

/** Horizontal tab navigation bar with icon support. */
export function TabNav({ tabs, active, onChange }: { tabs: { key: string; label: string; icon?: ReactNode }[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-white/[0.02] p-1 border border-white/[0.06] overflow-x-auto scrollbar-thin">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            'flex items-center gap-1.5 sm:gap-2 rounded-lg px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap shrink-0',
            active === t.key
              ? 'bg-white/[0.08] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-gray-300'
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}
