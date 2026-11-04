import { useTranslation } from 'react-i18next'
import { GlassPanel, HelperText, IconBox, Text, Toggle } from '@/components/ui'
import { useProductPreferences } from '@/hooks/useProductPreferences'
import { Icons } from '@/lib/icons'

export function ExperimentsSettings() {
  const { t } = useTranslation('settings')
  const { preferences, updatePreferences } = useProductPreferences()

  return (
    <GlassPanel className="flex items-center gap-4 p-6">
      <IconBox color="purple">
        <Icons.experiments className="h-5 w-5" aria-hidden />
      </IconBox>
      <div className="min-w-0 flex-1">
        <Text id="experiments-enabled-label" as="p" variant="body" className="font-medium">
          {t('theme.experiments.show', 'Show experiments')}
        </Text>
        <HelperText id="experiments-enabled-help">
          {t(
            'theme.experiments.help',
            'Show playful, experimental experiences in navigation. Direct links still work when hidden.',
          )}
        </HelperText>
      </div>
      <Toggle
        checked={preferences.showExperiments}
        onChange={showExperiments => updatePreferences({ showExperiments })}
        aria-labelledby="experiments-enabled-label"
        aria-describedby="experiments-enabled-help"
        data-testid="experiments-toggle-enabled"
      />
    </GlassPanel>
  )
}
