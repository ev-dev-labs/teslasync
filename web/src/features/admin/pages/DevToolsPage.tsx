import { useTranslation } from 'react-i18next'
import {
  Globe, Radio, Server, Wrench, BookOpen,
} from 'lucide-react'
import { PageContainer } from '@/components/layout'
import { TabNav } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUrlEnum } from '@/hooks/useUrlState'

import {
  FleetApiSection,
  FleetTelemetryHealth,
  InfrastructureSection,
  ClientUtilitiesSection,
  ReferenceLinksSection,
} from '../components/devtools'

/* ─── tab definitions ─────────────────────────────────────────────────── */

const TAB_KEY = 'tab'
const DEFAULT_TAB = 'fleet-api'

const TABS = [
  { key: 'fleet-api', label: 'Fleet API', icon: <Globe className="h-4 w-4" /> },
  { key: 'telemetry', label: 'Telemetry', icon: <Radio className="h-4 w-4" /> },
  { key: 'infrastructure', label: 'Infrastructure', icon: <Server className="h-4 w-4" /> },
  { key: 'utilities', label: 'Utilities', icon: <Wrench className="h-4 w-4" /> },
  { key: 'reference', label: 'Reference', icon: <BookOpen className="h-4 w-4" /> },
]

const TAB_KEYS = ['fleet-api', 'telemetry', 'infrastructure', 'utilities', 'reference'] as const
type TabKey = (typeof TAB_KEYS)[number]

/* ═══════════════════════════════════════════════════════════════════════
   Main DevTools Page — thin shell with tabbed layout
   ═══════════════════════════════════════════════════════════════════════ */

export default function DevToolsPage() {
  const { t } = useTranslation()
  usePageTitle(t('devtools.title', 'Developer Tools'))

  const [tab, setTab] = useUrlEnum<TabKey>(TAB_KEY, TAB_KEYS, DEFAULT_TAB)

  return (
    <PageContainer
      title={t('devtools.title', 'Developer Tools')}
      subtitle={t('devtools.subtitle', 'Fleet API, telemetry, infrastructure & utilities')}
    >
      <div className="space-y-6">
        <TabNav tabs={TABS} active={tab} onChange={(k) => setTab(k as TabKey)} />

        <FadeIn key={tab}>
          {tab === 'fleet-api' && <FleetApiSection />}
          {tab === 'telemetry' && <FleetTelemetryHealth />}
          {tab === 'infrastructure' && <InfrastructureSection />}
          {tab === 'utilities' && <ClientUtilitiesSection />}
          {tab === 'reference' && <ReferenceLinksSection />}
        </FadeIn>
      </div>
    </PageContainer>
  )
}
