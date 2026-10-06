import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Globe, Radio, Server, Wrench, BookOpen, RefreshCw, AlertCircle,
} from 'lucide-react'
import { PageLayout } from '@/components/layout'
import { TabNav, Button } from '@/components/ui'
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDataState } from '@/hooks/useDataState'
import { useUrlEnum } from '@/hooks/useUrlState'
import { useFleetTelemetryErrorVINs } from '@/api/hooks/useTelemetry'
import { useVehicles } from '@/api/hooks/useVehicles'
import { getErrorMessage } from '@/lib/errorMessage'

import {
  FleetApiSection,
  FleetTelemetryHealth,
  InfrastructureSection,
  ClientUtilitiesSection,
  ReferenceLinksSection,
} from '../components/devtools'
import { DevToolsBrief } from '../components/operationalbrief-a-g/DevToolsBrief'

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
  usePageTitle(t('devtools.title', 'Developer tools'))

  const [tab, setTab] = useUrlEnum<TabKey>(TAB_KEY, TAB_KEYS, DEFAULT_TAB)

  const telemetryQuery = useFleetTelemetryErrorVINs()
  const vehiclesQuery = useVehicles()
  const telemetryState = useDataState(telemetryQuery)
  const vehiclesState = useDataState(vehiclesQuery)

  const errorVins = telemetryQuery.data ?? []
  const vehicles = vehiclesQuery.data ?? []

  const overviewFetching = telemetryQuery.isFetching || vehiclesQuery.isFetching
  const overviewError = telemetryState.fatalError ?? vehiclesState.fatalError

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
    <PageLayout
      title={t('devtools.title', 'Developer tools')}
      subtitle={t('devtools.subtitle', 'Fleet API, telemetry, infrastructure & utilities')}
      secondaryActions={actions}
      query={telemetryQuery}
    >
      <div className="space-y-6">
        {overviewError && (
          <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
            {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(overviewError)}
          </AlertBanner>
        )}
        <StaleRefreshWarning
          state={telemetryState}
          label={t('devtools.overview.telemetryErrors', 'Telemetry errors')}
          hideRetry
          message={telemetryState.refreshError
            ? `${t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.')} ${getErrorMessage(telemetryState.refreshError)}`
            : undefined}
        />
        <StaleRefreshWarning
          state={vehiclesState}
          label={t('devtools.overview.vehicles', 'Vehicles')}
          hideRetry
          message={vehiclesState.refreshError
            ? `${t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.')} ${getErrorMessage(vehiclesState.refreshError)}`
            : undefined}
        />

        {/* 1 — KPI cockpit band: always-visible live + catalog status */}
        <FadeIn>
          <DevToolsBrief
            errorVinCount={errorVins.length}
            vehicleCount={vehicles.length}
            telemetryUnknown={!telemetryState.hasData}
            vehiclesUnknown={!vehiclesState.hasData}
            loading={(telemetryQuery.isLoading && !telemetryState.hasData) || (vehiclesQuery.isLoading && !vehiclesState.hasData)}
            retained={telemetryState.status === 'stale' || vehiclesState.status === 'stale'}
            refreshing={telemetryState.isRefreshing || vehiclesState.isRefreshing}
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
    </PageLayout>
  )
}
