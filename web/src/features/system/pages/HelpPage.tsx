// Phase-50 / 0020 — N6 RAG-backed app help.
//
// HelpPage is the SPA route at /help — the deterministic baseline
// for the N6 RAG-backed app help slice. It MUST render the same
// curated link grid + tooltip palette regardless of ai_mode; the
// AI surface (AIRAGHelp) is layered alongside via withAiFeature
// and only mounts when ai_mode != 'off' AND the rag-help toggle
// is on (ADR-015 §I3 baseline-intact + §I5 hidden UI in off mode).
//
// Curated links list is intentionally short + stable: the goal of
// the static page is to give every user — including off-mode
// users who never see the AI surface — a single visible jumping-
// off point to the canonical destinations the app already exposes
// (the docs API page, the system status page, the chatbot page,
// the global search page, and the onboarding page). The link set
// is duplicated in the off-mode test
// (TestRagHelpAIOffHidesAssistantAndDocsLinksWork) which asserts
// every entry is present; updating one MUST update the other.

import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  MessagesSquare,
  Rocket,
  Search as SearchIcon,
  ServerCog,
  type LucideIcon,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel } from '@/components/ui'
import { AIRAGHelp } from '@/components/ai/AIRAGHelp'
import { usePageTitle } from '@/hooks/usePageTitle'

interface HelpLink {
  /** stable id used as React key + test marker */
  readonly id: string
  /** target SPA route (existing canonical destinations only) */
  readonly to: string
  /** Lucide icon component reference */
  readonly Icon: LucideIcon
  /** i18n key for the link's display title */
  readonly titleKey: string
  /** fallback English display title (used if translation is missing) */
  readonly titleFallback: string
  /** i18n key for the one-line link description */
  readonly descKey: string
  /** fallback English description */
  readonly descFallback: string
}

/**
 * The curated link palette. Order is intentional: documentation
 * first (most common entry point), then onboarding (for new
 * users), then system status (for operators), then search (for
 * everyone), then chatbot (for those who want to ask a question).
 *
 * Every `to` value MUST point at an existing canonical route
 * already mounted in App.tsx — this page does NOT introduce any
 * new entity-detail surface (ADR-015 §I3 baseline-intact).
 */
const HELP_LINKS: readonly HelpLink[] = [
  {
    id: 'docs-status-api',
    to: '/docs/status-api',
    Icon: BookOpen,
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
    titleKey: 'help.baseline.links.chatbot.title',
    titleFallback: 'Chatbot',
    descKey: 'help.baseline.links.chatbot.description',
    descFallback:
      'Talk to the in-app assistant. Available in deterministic mode or LLM mode when Helix is enabled.',
  },
]

/**
 * The deterministic Help page. Renders five curated link cards
 * unconditionally + the conditional AIRAGHelp section.
 *
 * Visual contract:
 *   - PageContainer with page title (mirrors every other system
 *     page: SearchPage, SystemStatusPage, etc.).
 *   - One GlassPanel introduces the page with a brief framing
 *     paragraph + the AIRAGHelp section is rendered below it (off
 *     mode renders nothing for that section).
 *   - One GlassPanel per curated link, arranged in a responsive
 *     grid. Every card is a Link to an existing canonical route.
 *   - HelpCircle icon in the page header for visual continuity
 *     with the rest of the app.
 */
export default function HelpPage() {
  const { t } = useTranslation()
  usePageTitle(t('help.title', 'Help'))

  return (
    <PageContainer title={t('help.title', 'Help')}>
      <div className="space-y-6">
        <GlassPanel>
          <p className="text-sm text-[var(--text-secondary)]">
            {t(
              'help.intro',
              'Get started with TeslaSync. The links below cover the most common questions; for anything else, ask the in-app assistant or open the documentation.',
            )}
          </p>
        </GlassPanel>

        <AIRAGHelp />

        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="help-baseline-links"
        >
          {HELP_LINKS.map((link) => (
            <Link
              key={link.id}
              to={link.to}
              data-testid={`help-baseline-link-${link.id}`}
              className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 rounded-2xl"
            >
              <GlassPanel>
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-300 ring-1 ring-cyan-300/20">
                    <link.Icon className="h-5 w-5" aria-hidden={true} />
                  </span>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-[var(--text-primary)]">
                        {t(link.titleKey, link.titleFallback)}
                      </h3>
                      <ArrowRight
                        className="h-4 w-4 text-[var(--text-muted)] transition group-hover:translate-x-0.5 group-hover:text-cyan-300"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="text-sm text-[var(--text-secondary)]">
                      {t(link.descKey, link.descFallback)}
                    </p>
                  </div>
                </div>
              </GlassPanel>
            </Link>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
