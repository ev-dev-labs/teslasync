import { useTranslation } from 'react-i18next'
import { NAV_UTILITY_ICONS } from './sidebar/NavIcons'
import { useNavIconMotion } from './sidebar/useNavIconMotion'
import { Button } from '@/components/ui/runtime'
import { PHONE_TAB_SECTIONS, resolveSectionIcon } from './sidebar/sidebarIcons'
import type { SidebarSectionInput } from './sectionGroups'
import { cn } from '@/lib/cn'
import { inlineKeys, menuItems } from './horizontal-nav/navKeyboard'
export const BOTTOM_TAB_PATHS = new Set(['/', '/vehicles', '/drives', '/charging', '/explore'])
export function BottomTabBar({ sections = [], activeSection = 'Home', onChoose, openSection, sheetId }: {
  sections?: readonly SidebarSectionInput[]
  activeSection?: string
  onChoose?: (section: string | null, trigger: HTMLButtonElement) => void
  openSection?: string | null
  sheetId?: string
}) {
  const { t } = useTranslation()
  const motion = useNavIconMotion()
  const tabs = [
    ...PHONE_TAB_SECTIONS.flatMap(title => {
      const section = sections.find(candidate => candidate.title === title)
      return section ? [{ section: title, label: section.titleKey ? t(section.titleKey, title) : title, icon: resolveSectionIcon(title) }] : []
    }),
    { section: null, label: t('nav.mobileMore', 'More'), icon: NAV_UTILITY_ICONS.more },
  ]
  const primary = tabs.some(tab => tab.section === activeSection)
  return <nav {...motion} data-app-part="navigation" aria-label={t('nav.quickNav', 'Quick navigation')} data-role="bottom-tab-bar" className="sidenav-phone-tabs safe-bottom">
    {tabs.map(({ section, label, icon: Icon }) => <Button data-nav-action data-nav-choice data-app-part="nav-item" key={label} variant="ghost" type="button" aria-label={label}
      aria-current={(section === activeSection || (section === null && !primary)) ? 'true' : undefined}
      aria-haspopup="dialog" aria-expanded={section === openSection} aria-controls={section === openSection ? sheetId : undefined}
      className={cn('sidenav-phone-tab', (section === activeSection || (section === null && !primary)) && 'is-selected')}
      onClick={event => onChoose?.(section, event.currentTarget)}
      onKeyDown={event => {
        const trigger = event.currentTarget
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          onChoose?.(section, trigger)
          return
        }
        const { forward, back } = inlineKeys(trigger)
        const delta = event.key === forward ? 1 : event.key === back ? -1 : 0
        if (!delta) return
        const items = menuItems(trigger.parentElement)
        const index = items.indexOf(trigger)
        if (index >= 0) { event.preventDefault(); items[(index + delta + items.length) % items.length]?.focus() }
      }}>
      <span data-nav-motion className="nav-motion-target nav-phone-icon"><Icon className="h-[22px] w-[22px]" aria-hidden /></span><span className="sidenav-tab-label">{label}</span></Button>)}
  </nav>
}
