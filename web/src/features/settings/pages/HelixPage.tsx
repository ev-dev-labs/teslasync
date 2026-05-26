/**
 * HelixPage — dedicated home for the Helix AI integration.
 *
 * Why this page exists
 * ────────────────────
 * Helix is TeslaSync's optional AI integration. It connects to an external
 * LLM provider, requires credentials, enforces a daily cost cap, and
 * exposes ~60 per-feature opt-in toggles. That makes it a *service
 * connection*, not a "preference" — so it lives under the **Integrations**
 * side-nav group next to Tesla Account, Fleet API, MQTT, etc., rather
 * than buried inside `/settings`.
 *
 * Historically the configuration UI lived as the `<section id="ai">`
 * block on the main `/settings` page. That page was a 600+ line wall and
 * Helix accounted for most of it. The Tesla integration cluster (Tesla
 * Account, Feature Flags, Region & API, Active Orders, Gas Price
 * Auto-Poll) was promoted out of `/settings` in an earlier phase for the
 * same IA reason — this is the next step in the same direction.
 *
 * ADR-015 §I7 ("the Settings page itself MUST always render this
 * component so the user has a stable opt-in surface") is satisfied as
 * long as the surface is **stable, discoverable, and always rendered**.
 * The constraint is not specifically that it lives at `/settings`. The
 * sidebar Integrations group surfaces `/integrations/helix` with a
 * permanent HelixMark icon, and `/settings` itself retains a one-line
 * breadcrumb card that links here.
 *
 * Layout
 * ──────
 *   <PageContainer title="Helix">       page-level chrome / breadcrumbs
 *     <AISettings />                    unchanged — owns its own panels:
 *       ├── AIProviderSection            provider, key, model, validate
 *       ├── AIFeatureToggleList          per-feature opt-ins
 *       ├── AIRestorePanel               restore from archive
 *       └── AIUsageCard                  today's spend / cap
 *
 * The `AISettings` component is unchanged — its internal panels remain
 * the canonical configuration surface and continue to be unit-tested in
 * isolation under `components/__tests__/AISettings.test.tsx`.
 */

import { useTranslation } from 'react-i18next'
import { PageContainer } from '@/components/layout'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSettings } from '@/api/hooks/useSettings'
import { AISettings } from '../components'

export default function HelixPage() {
  const { t } = useTranslation()
  usePageTitle(t('helix.page.title', 'Helix'))
  const { isLoading } = useSettings()

  return (
    <PageContainer
      title={t('helix.page.title', 'Helix')}
      subtitle={t(
        'helix.page.subtitle',
        'Optional AI integration. Off by default — nothing runs until you opt in here.',
      )}
      loading={isLoading}
      breadcrumbLabels={{
        integrations: t('helix.breadcrumb.integrations', 'Integrations'),
        helix: t('helix.page.title', 'Helix'),
      }}
    >
      <AISettings />
    </PageContainer>
  )
}
