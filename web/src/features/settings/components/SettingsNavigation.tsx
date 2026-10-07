import { useTranslation } from 'react-i18next'
import { Button, Select, Text } from '@/components/ui'

export interface SettingsSection {
  id: string
  title: string
  description: string
}

interface Props {
  sections: SettingsSection[]
  activeSection: string
  onSelect: (id: string) => void
}

export function SettingsNavigation({ sections, activeSection, onSelect }: Props) {
  const { t } = useTranslation('settings')
  const label = t('settings.organization.navigation', 'Settings categories')
  return (
    <div className="lg:sticky lg:top-4 lg:self-start">
      <div className="lg:hidden">
        <Select label={label} value={activeSection} onChange={event => onSelect(event.target.value)}
          options={sections.map(section => ({ value: section.id, label: section.title }))} />
      </div>
      <nav aria-label={label} className="hidden space-y-1 lg:block">
        {sections.map(section => (
          <Button key={section.id} variant={activeSection === section.id ? 'secondary' : 'ghost'}
            aria-current={activeSection === section.id ? 'page' : undefined}
            aria-controls={`settings-category-${section.id}`}
            className="h-auto w-full justify-start whitespace-normal px-3 py-3 text-left"
            onClick={() => onSelect(section.id)}>
            <span className="min-w-0 space-y-1">
              <Text as="span" variant="body" weight="medium" className="block">{section.title}</Text>
              <Text as="span" variant="caption" className="block">{section.description}</Text>
            </span>
          </Button>
        ))}
      </nav>
    </div>
  )
}
