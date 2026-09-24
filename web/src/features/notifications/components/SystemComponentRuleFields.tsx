import { useTranslation } from 'react-i18next'
import { Select, HelperText } from '@/components/ui'
import { SYSTEM_COMPONENTS, SYSTEM_TRANSITIONS } from '../schemas/alertRule'

type Component = typeof SYSTEM_COMPONENTS[number]
type Transition = typeof SYSTEM_TRANSITIONS[number]

interface Props {
  component: string
  transition: string
  onChange: (component: Component, transition: Transition) => void
}

export function SystemComponentRuleFields({ component, transition, onChange }: Props) {
  const { t } = useTranslation()
  const componentOptions = SYSTEM_COMPONENTS.map(name => ({
    value: name,
    label: t(`notifications.alertStudio.system.${name}`, name.replace('_', ' ').toUpperCase()),
  }))
  const transitionOptions = SYSTEM_TRANSITIONS.map(value => ({
    value,
    label: value === 'outage'
      ? t('notifications.alertStudio.system.outage', 'Becomes unavailable')
      : t('notifications.alertStudio.system.recovery', 'Recovers'),
  }))

  return (
    <div className="mb-4 space-y-3">
      <HelperText>{t('notifications.alertStudio.system.scope', 'System health rules monitor a service for the entire fleet.')}</HelperText>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="alert-system-component"
          label={t('notifications.alertStudio.system.component', 'Service')}
          value={component}
          placeholder={t('notifications.alertStudio.system.choose', 'Choose a service')}
          options={componentOptions}
          onChange={event => onChange(event.target.value as Component, transition as Transition)}
        />
        <Select
          id="alert-system-transition"
          label={t('notifications.alertStudio.system.transition', 'When')}
          value={transition}
          options={transitionOptions}
          onChange={event => onChange(component as Component, event.target.value as Transition)}
        />
      </div>
    </div>
  )
}
