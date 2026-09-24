import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { PrefetchNavLink } from './PrefetchLink'
import { findSectionGroup, type SectionGroup } from './sectionGroups'

interface GroupedSectionNavigationProps {
  groups: readonly SectionGroup[]
  sectionsLabelKey: string
}

export function GroupedSectionNavigation({ groups, sectionsLabelKey }: GroupedSectionNavigationProps) {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const group = findSectionGroup(groups, pathname)
  if (!group) return null

  const groupLabel = t(group.labelKey, group.label)
  return (
    <nav
      aria-label={t(sectionsLabelKey, '{{group}} sections', { group: groupLabel })}
      className="mb-4 flex items-center gap-1 overflow-x-auto rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-1)] p-1 scrollbar-thin"
    >
      {group.pages.map(page => (
        <PrefetchNavLink
          key={page.to}
          to={page.to}
          end
          className={({ isActive }) => cn(
            'shrink-0 whitespace-nowrap rounded-shape-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-fast sm:px-4 sm:py-2 sm:text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
            isActive
              ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]',
          )}
        >
          {t(page.labelKey, page.label)}
        </PrefetchNavLink>
      ))}
    </nav>
  )
}
