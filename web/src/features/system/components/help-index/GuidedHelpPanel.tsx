import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Compass } from 'lucide-react'

import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui'
import OnboardingWizard from '@/components/feedback/OnboardingWizard'
import { dispatchTourLauncherOpen } from '@/lib/tourRegistry'

/**
 * The explicit entry points for guided help.
 *
 * Both surfaces here are opt-in by construction: nothing on this panel runs
 * unless the user presses it. That is the whole reason the introduction is
 * reachable from here at all — HELP-01 removed its self-opening timer, and a
 * modal with no entry point is a dead export waiting to rot.
 */
export function GuidedHelpPanel() {
  const { t } = useTranslation()
  const [introOpen, setIntroOpen] = useState(false)

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="guided-help-panel">
      <PanelTitle>{t('help.guided.title', 'Show me around')}</PanelTitle>
      <Text as="p" variant="bodySm" className="mt-1 max-w-2xl">
        {t(
          'help.guided.subtitle',
          'Walkthroughs run only when you ask for them — nothing here starts on its own.',
        )}
      </Text>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setIntroOpen(true)}
          data-testid="open-product-intro"
        >
          <Compass className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t('help.guided.intro', 'Replay the product introduction')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => dispatchTourLauncherOpen()}
          data-testid="open-tour-launcher"
        >
          {t('help.guided.tours', 'Browse guided tours')}
        </Button>
      </div>

      {/* Mounted only while open: an always-mounted modal would be one more
          thing competing for focus on a page that currently steals none. */}
      {introOpen && <OnboardingWizard open onClose={() => setIntroOpen(false)} />}
    </GlassPanel>
  )
}
