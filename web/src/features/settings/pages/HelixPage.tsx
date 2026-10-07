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
 * Loading is owned by AISettings, not this page
 * ─────────────────────────────────────────────
 * This page does NOT gate its body behind a page-level
 * `<PageContainer loading>` spinner. `AISettings` reads `useSettings()`
 * itself and always renders its stable opt-in surface (KPI strip + mode
 * picker) with a safe `off` default while the settings query is still in
 * flight — that IS the ADR-015 §I7 "always rendered" contract. Wrapping
 * it in a page-level spinner would blank that surface during the exact
 * first-load window the contract exists to protect, so this page stays
 * pure chrome (see the App.tsx route comment) and delegates all
 * data / loading / empty / error handling to `AISettings`.
 *
 * Layout (modern-ui full-width bento)
 * ───────────────────────────────────
 *   <PageContainer title="Helix">       page-level h1 + subtitle + breadcrumbs
 *     <AISettings />                     full-width responsive bento controller:
 *       ├── HelixStatusStrip             KPI band (mode / features / provider / spend)
 *       ├── mode picker (RadioCard ×3)   hero control — off / local / cloud
 *       ├── AIRestorePanel               explicit archive restore (conditional)
 *       ├── config bento                 AIProviderSection (2-col hero) + rail:
 *       │     ├── AIUsageCard             today's tokens / cost
 *       │     └── AICostCapSpendBar       cloud cap progress (conditional)
 *       └── AIFeatureToggleList          per-feature opt-ins (multi-column)
 *
 * `AISettings` owns the whole bento and stays a single self-contained
 * controller so its ADR-015 contract tests keep exercising the full
 * surface in isolation (`components/__tests__/AISettings.test.tsx`). The
 * page frame is full-bleed — no `max-w mx-auto` cap — so the grid reflows
 * into more columns on wide monitors instead of a centered strip.
 */

import { useTranslation } from 'react-i18next'
import { PageContainer } from '@/components/layout'
import { usePageTitle } from '@/hooks/usePageTitle'
import { AISettings } from '../components'

export default function HelixPage() {
  const { t } = useTranslation()
  usePageTitle(t('helix.page.title', 'Helix'))

  // No page-level `loading` gate: AISettings owns its own settings query
  // and must stay mounted so the opt-in surface is always rendered
  // (ADR-015 §I7). See the module docstring for the full rationale.
  return (
    <PageContainer
      title={t('helix.page.title', 'Helix')}
      subtitle={t(
        'helix.page.subtitle',
        'Optional AI integration. Off by default — nothing runs until you opt in here.',
      )}
      breadcrumbLabels={{
        integrations: t('helix.breadcrumb.integrations', 'Integrations'),
        helix: t('helix.page.title', 'Helix'),
      }}
    >
      <AISettings />
    </PageContainer>
  )
}
