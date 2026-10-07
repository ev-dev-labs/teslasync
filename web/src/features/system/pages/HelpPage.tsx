// RAG-backed app help — modern-ui full-width redesign.
//
// HelpPage is the SPA route at /help — the deterministic baseline
// for the N6 RAG-backed app help slice. It MUST render the same
// curated link grid regardless of ai_mode; the AI surface
// (AIRAGHelp) is layered alongside via withAiFeature and only
// mounts when ai_mode != 'off' AND the rag-help toggle is on
// (ADR-015 §I3 baseline-intact + §I5 hidden UI in off mode). Because
// withAiFeature returns null when disabled, <AIRAGHelp/> is rendered
// BARE (no FadeIn/section wrapper) so off-mode emits nothing at all.
//
// Curated links list is intentionally short + stable: the goal of
// the static page is to give every user — including off-mode users
// who never see the AI surface — a single visible jumping-off point
// to the canonical destinations the app already exposes (docs API,
// system status, chatbot, global search, onboarding). The link set
// is duplicated in the off-mode test
// (TestRagHelpAIOffHidesAssistantAndDocsLinksWork) which asserts
// every entry is present with its exact href; updating one MUST
// update the other. The per-link `data-testid` and the container
// `data-testid="help-baseline-links"` are load-bearing.

import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import {
  BookOpen,
  Compass,
  MessagesSquare,
  Rocket,
  Search as SearchIcon,
  ServerCog,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, IconBox, PanelTitle, SectionTitle, Text } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { AIRAGHelp } from '@/components/ai/AIRAGHelp'
import { usePageTitle } from '@/hooks/usePageTitle'
import type { NeonColor } from '@/lib/tokens'
import { HelpLinkCard, type HelpLink } from '../components/HelpLinkCard'
import {
  DashboardPresetPanel,
  GuidedHelpPanel,
  HelpGlossaryPanel,
  HelpSearch,
  ReleaseNotesPanel,
  SupportBundlePanel,
} from '../components/help-index'

/**
 * The curated link palette. Order is intentional: documentation
 * first (most common entry point), then onboarding (for new users),
 * then system status (for operators), then search (for everyone),
 * then chatbot (for those who want to ask a question).
 *
 * Every `to` value MUST point at an existing canonical route already
 * mounted in App.tsx — this page does NOT introduce any new
 * entity-detail surface (ADR-015 §I3 baseline-intact).
 */
const HELP_LINKS: readonly HelpLink[] = [
  {
    id: 'docs-status-api',
    to: '/docs/status-api',
    Icon: BookOpen,
    accent: 'cyan',
    titleKey: 'help.baseline.links.docsStatusApi.title',
    titleFallback: 'Documentation',
    descKey: 'help.baseline.links.docsStatusApi.description',
    descFallback:
      'Browse the public API documentation including endpoints, schemas, and example requests.',
  },
  {
    id: 'onboarding',
    to: '/onboarding',
    Icon: Rocket,
    accent: 'green',
    titleKey: 'help.baseline.links.onboarding.title',
    titleFallback: 'Onboarding',
    descKey: 'help.baseline.links.onboarding.description',
    descFallback:
      'Walk through the first-time setup wizard to connect a Tesla account and configure live telemetry.',
  },
  {
    id: 'system-status',
    to: '/system-status',
    Icon: ServerCog,
    accent: 'amber',
    titleKey: 'help.baseline.links.systemStatus.title',
    titleFallback: 'System status',
    descKey: 'help.baseline.links.systemStatus.description',
    descFallback:
      'Inspect the live health of every backend service: database, MQTT, Redis, and the Tesla API.',
  },
  {
    id: 'search',
    to: '/search',
    Icon: SearchIcon,
    accent: 'blue',
    titleKey: 'help.baseline.links.search.title',
    titleFallback: 'Search',
    descKey: 'help.baseline.links.search.description',
    descFallback:
      'Find drives, charging sessions, alerts, and other records using typed filters.',
  },
  {
    id: 'chatbot',
    to: '/chatbot',
    Icon: MessagesSquare,
    accent: 'purple',
    titleKey: 'help.baseline.links.chatbot.title',
    titleFallback: 'Chatbot',
    descKey: 'help.baseline.links.chatbot.description',
    descFallback:
      'Talk to the in-app assistant. Available in deterministic mode or LLM mode when Helix is enabled.',
  },
]

/** A "way to get help" — honest framing of the surfaces on this page. */
interface HelpChannel {
  readonly id: string
  readonly Icon: LucideIcon
  readonly accent: NeonColor
  readonly titleKey: string
  readonly titleFallback: string
  readonly descKey: string
  readonly descFallback: string
}

const HELP_CHANNELS: readonly HelpChannel[] = [
  {
    id: 'browse',
    Icon: Compass,
    accent: 'cyan',
    titleKey: 'help.channels.browse.title',
    titleFallback: 'Browse the app',
    descKey: 'help.channels.browse.description',
    descFallback: 'Jump straight to the canonical pages using the quick links below.',
  },
  {
    id: 'docs',
    Icon: BookOpen,
    accent: 'blue',
    titleKey: 'help.channels.docs.title',
    titleFallback: 'Read the documentation',
    descKey: 'help.channels.docs.description',
    descFallback:
      'The public API reference covers every endpoint, schema, and example request.',
  },
  {
    id: 'assistant',
    Icon: Sparkles,
    accent: 'purple',
    titleKey: 'help.channels.assistant.title',
    titleFallback: 'Ask the assistant',
    descKey: 'help.channels.assistant.description',
    descFallback:
      'When Helix is enabled, ask a natural-language question and get answers with citations.',
  },
]

/**
 * The deterministic Help page. Renders a welcome hero, the
 * conditional AIRAGHelp assistant, and five curated link cards —
 * full-bleed and mobile-first per the modern-ui design language.
 */
export default function HelpPage() {
  const { t } = useTranslation()
  const location = useLocation()
  usePageTitle(t('help.title', 'Help'))

  return (
    <PageContainer
      title={t('help.title', 'Help')}
      subtitle={t(
        'help.subtitle',
        'Guides, the in-app assistant, and quick links to everything in TeslaSync.',
      )}
    >
      <div className="space-y-6">
        {/* 1 — Welcome hero: framing prose + ways-to-get-help, side-by-side on wide screens */}
        <FadeIn>
          <section
            aria-label={t('help.hero.aria', 'Getting started')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3"
          >
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <SectionTitle>{t('help.welcomeTitle', 'Welcome to TeslaSync')}</SectionTitle>
              <Text as="p" variant="body" className="mt-2 max-w-3xl">
                {t(
                  'help.intro',
                  'Get started with TeslaSync. The links below cover the most common questions; for anything else, ask the in-app assistant or open the documentation.',
                )}
              </Text>
            </GlassPanel>

            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle>{t('help.channelsTitle', 'Ways to get help')}</PanelTitle>
              <ul className="mt-3 space-y-3">
                {HELP_CHANNELS.map((ch) => (
                  <li key={ch.id} className="flex items-start gap-3">
                    <IconBox color={ch.accent} size="sm">
                      <ch.Icon className="h-4 w-4" aria-hidden="true" />
                    </IconBox>
                    <div className="min-w-0 space-y-0.5">
                      <Text as="p" size="sm" weight="medium" color="primary">
                        {t(ch.titleKey, ch.titleFallback)}
                      </Text>
                      <Text as="p" variant="bodySm">
                        {t(ch.descKey, ch.descFallback)}
                      </Text>
                    </div>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </section>
        </FadeIn>

        {/* 2 — Deterministic help index. Static, offline-capable, and
            unaffected by ai_mode: this is the baseline every user gets. */}
        <FadeIn delay={0.05}>
          <GlassPanel className="p-4 sm:p-5">
            <SectionTitle>{t('helpIndex.title', 'Search the help index')}</SectionTitle>
            <Text as="p" variant="bodySm" className="mt-1 max-w-3xl">
              {t(
                'helpIndex.subtitle',
                'Definitions, pages and troubleshooting, indexed by term and route. Results are the same every time — no model, no network.',
              )}
            </Text>
            <HelpSearch pathname={location.pathname} className="mt-4" />
          </GlassPanel>
        </FadeIn>

        {/* 3 — AI assistant. Self-gating: renders nothing when ai_mode='off'. */}
        <AIRAGHelp />

        {/* 4 — Contextual definitions (HELP-03). */}
        <FadeIn delay={0.1}>
          <HelpGlossaryPanel />
        </FadeIn>

        {/* 5 — Explicit entry points for guided help. Opt-in only (HELP-01). */}
        <FadeIn delay={0.11}>
          <GuidedHelpPanel />
        </FadeIn>

        {/* 5 — Release notes derived from the canonical changelog (HELP-07). */}
        <FadeIn delay={0.12}>
          <ReleaseNotesPanel />
        </FadeIn>

        {/* 6 — Support bundle + report a problem (HELP-08, HELP-09). */}
        <FadeIn delay={0.14}>
          <SupportBundlePanel />
        </FadeIn>

        {/* 7 — Curated dashboard presets by role (HELP-11). */}
        <FadeIn delay={0.16}>
          <DashboardPresetPanel />
        </FadeIn>

        {/* 8 — Explore the app: curated links reflow to fill the full width */}
        <FadeIn delay={0.18}>
          <section aria-label={t('help.explore.aria', 'Explore the app')}>
            <div className="mb-3 sm:mb-4">
              <SectionTitle>{t('help.exploreTitle', 'Explore the app')}</SectionTitle>
              <Text as="p" variant="bodySm" className="mt-1">
                {t(
                  'help.exploreSubtitle',
                  'Every card jumps to a canonical destination already built into the app.',
                )}
              </Text>
            </div>
            <div
              className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(17rem,1fr))]"
              data-testid="help-baseline-links"
            >
              {HELP_LINKS.map((link) => (
                <HelpLinkCard key={link.id} link={link} />
              ))}
            </div>
          </section>
        </FadeIn>
      </div>
    </PageContainer>
  )
}
