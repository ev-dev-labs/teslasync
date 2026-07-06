import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Globe, Radio, Server, Wrench, BookOpen, RefreshCw, AlertCircle,
} from 'lucide-react'
import { PageContainer } from '@/components/layout'
import { TabNav, Button } from '@/components/ui'
import { AlertBanner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUrlEnum } from '@/hooks/useUrlState'
import { useFleetTelemetryErrorVINs } from '@/api/hooks/useTelemetry'
import { useVehicles } from '@/api/hooks/useVehicles'
import { getErrorMessage } from '@/lib/errorMessage'

import {
  DevToolsOverview,
  FleetApiSection,
  FleetTelemetryHealth,
  InfrastructureSection,
  ClientUtilitiesSection,
  ReferenceLinksSection,
} from '../components/devtools'

/* ─── tab definitions ─────────────────────────────────────────────────── */

const TAB_KEY = 'tab'
const DEFAULT_TAB = 'fleet-api'

const TAB_KEYS = ['fleet-api', 'telemetry', 'infrastructure', 'utilities', 'reference'] as const
type TabKey = (typeof TAB_KEYS)[number]

/* ═══════════════════════════════════════════════════════════════════════
   Main DevTools Page — full-width command center: a live KPI cockpit band
   over a tabbed deep-dive into every developer tool area.
   ═══════════════════════════════════════════════════════════════════════ */

export default function DevToolsPage() {
  const { t } = useTranslation()
  usePageTitle(t('devtools.title', 'Developer Tools'))

  const [tab, setTab] = useUrlEnum<TabKey>(TAB_KEY, TAB_KEYS, DEFAULT_TAB)

  const telemetryQuery = useFleetTelemetryErrorVINs()
  const vehiclesQuery = useVehicles()

  const errorVins = telemetryQuery.data ?? []
  const vehicles = vehiclesQuery.data ?? []

  // KPI placeholders track the *initial* load only (`isLoading`) so a manual
  // refresh doesn't blank the last-known counts. The refresh button, by
  // contrast, must reflect *any* fetch in flight (`isFetching`) — otherwise it
  // gives no feedback once data has loaded once and `isLoading` stays false.
  const overviewLoading = telemetryQuery.isLoading || vehiclesQuery.isLoading
  const overviewFetching = telemetryQuery.isFetching || vehiclesQuery.isFetching
  const overviewError = telemetryQuery.error ?? vehiclesQuery.error

  // When a live source fails with no data to fall back on, the KPI band must
  // show "—" rather than a fabricated `0` that reads as a healthy fleet.
  // Stale data from a prior success is still shown (react-query keeps it).
  const overviewErrored =
    Boolean(overviewError) && errorVins.length === 0 && vehicles.length === 0

  const refreshOverview = useCallback(() => {
    void telemetryQuery.refetch()
    void vehiclesQuery.refetch()
  }, [telemetryQuery, vehiclesQuery])

  const tabs = useMemo(
    () => [
      { key: 'fleet-api', label: t('devtools.tab.fleetApi', 'Fleet API'), icon: <Globe className="h-4 w-4" aria-hidden="true" /> },
      { key: 'telemetry', label: t('devtools.tab.telemetry', 'Telemetry'), icon: <Radio className="h-4 w-4" aria-hidden="true" /> },
      { key: 'infrastructure', label: t('devtools.tab.infrastructure', 'Infrastructure'), icon: <Server className="h-4 w-4" aria-hidden="true" /> },
      { key: 'utilities', label: t('devtools.tab.utilities', 'Utilities'), icon: <Wrench className="h-4 w-4" aria-hidden="true" /> },
      { key: 'reference', label: t('devtools.tab.reference', 'Reference'), icon: <BookOpen className="h-4 w-4" aria-hidden="true" /> },
    ],
    [t],
  )

  const actions = (
    <Button
      variant="ghost"
      onClick={refreshOverview}
      loading={overviewFetching}
      aria-label={t('devtools.refreshStatus', 'Refresh developer tools status')}
      icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
    >
      {t('common.refresh', 'Refresh')}
    </Button>
  )

  return (
    <PageContainer
      title={t('devtools.title', 'Developer Tools')}
      subtitle={t('devtools.subtitle', 'Fleet API, telemetry, infrastructure & utilities')}
      actions={actions}
      query={telemetryQuery}
    >
      <div className="space-y-6">
        {overviewError && (
          <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
            {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(overviewError)}
          </AlertBanner>
        )}

        {/* 1 — KPI cockpit band: always-visible live + catalog status */}
        <FadeIn>
          <DevToolsOverview
            errorVinCount={errorVins.length}
            vehicleCount={vehicles.length}
            loading={overviewLoading}
            errored={overviewErrored}
          />
        </FadeIn>

        {/* 2 — Tabbed deep-dive: full-width tool areas, each owns its state */}
        <FadeIn delay={0.1}>
          <section aria-label={t('devtools.tools', 'Developer tool areas')} className="space-y-4">
            <TabNav tabs={tabs} active={tab} onChange={(k) => setTab(k as TabKey)} />

            <FadeIn key={tab}>
              {tab === 'fleet-api' && <FleetApiSection />}
              {tab === 'telemetry' && <FleetTelemetryHealth />}
              {tab === 'infrastructure' && <InfrastructureSection />}
              {tab === 'utilities' && <ClientUtilitiesSection />}
              {tab === 'reference' && <ReferenceLinksSection />}
            </FadeIn>
          </section>
        </FadeIn>
      </div>
    </PageContainer>
  )
}
