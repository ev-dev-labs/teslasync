/**
 * Fleet Setup KPI band — account, token, domain key, and stream health.
 *
 * Independent setup sources retain their own loading/unknown distinctions in
 * the compact Brief; a slow domain check never hides a resolved token check.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Radio, ShieldCheck, ShieldAlert, Wifi, WifiOff } from 'lucide-react'
import type { StatMetric } from '@/components/data-display'
import { SettingsSummaryBrief } from '../operationalbrief-all/SettingsSummaryBrief'
import type { NeonColor } from '@/lib/tokens'
import type { FleetApiInfo, PublicKeyStatus } from '@/api/hooks/useFleetSetup'
import type { OnboardingStatus } from '@/api/hooks/useOnboarding'

interface FleetSetupKpiBandProps {
  authenticated: boolean | undefined
  apiInfo: FleetApiInfo | undefined
  publicKey: PublicKeyStatus | undefined
  onboarding: OnboardingStatus | undefined
  isLoading: boolean
  sourceLoading?: Partial<Record<KpiCell['key'], boolean>>
  retained?: boolean
}

interface KpiCell {
  key: 'account' | 'token' | 'domain' | 'stream'
  label: string
  value: string
  subtitle?: string
  color: NeonColor
  icon: ReactNode
}

export function FleetSetupKpiBand({
  authenticated,
  apiInfo,
  publicKey,
  onboarding,
  isLoading,
  sourceLoading,
  retained = false,
}: FleetSetupKpiBandProps) {
  const { t } = useTranslation('settings')

  const dash = t('common.dash', '—')
  const connected = authenticated === true || apiInfo?.has_valid_token === true
  const connectionKnown = connected || (authenticated === false && apiInfo?.has_valid_token === false)
  const tokenValid = apiInfo?.has_valid_token === true
  const keyConfigured = publicKey?.configured === true
  const health = onboarding?.telemetry_health

  const accountCell: KpiCell = connected
    ? {
        key: 'account',
        label: t('fleetSetup.kpi.account', 'Tesla account'),
        value: t('fleetSetup.kpi.connected', 'Connected'),
        color: 'green',
        icon: <ShieldCheck className="h-5 w-5" aria-hidden="true" />,
      }
    : {
        key: 'account',
        label: t('fleetSetup.kpi.account', 'Tesla account'),
        value: connectionKnown ? t('fleetSetup.kpi.notConnected', 'Not connected') : dash,
        color: connectionKnown ? 'amber' : 'cyan',
        icon: <ShieldAlert className="h-5 w-5" aria-hidden="true" />,
      }

  const tokenCell: KpiCell = tokenValid
    ? {
        key: 'token',
        label: t('fleetSetup.kpi.token', 'Access token'),
        value: t('fleetSetup.kpi.tokenFresh', 'Auto-refresh on'),
        subtitle: t('fleetSetup.kpi.tokenHint', 'TeslaSync refreshes the Fleet token before it expires.'),
        color: 'cyan',
        icon: <KeyRound className="h-5 w-5" aria-hidden="true" />,
      }
    : {
        key: 'token',
        label: t('fleetSetup.kpi.token', 'Access token'),
        value: apiInfo?.has_valid_token === false ? t('fleetSetup.kpi.tokenMissing', 'Missing') : dash,
        subtitle: apiInfo?.has_valid_token === false
          ? t('fleetSetup.kpi.tokenMissingHint', 'Connect Tesla to store a refreshable Fleet token.')
          : undefined,
        color: apiInfo?.has_valid_token === false ? 'amber' : 'cyan',
        icon: <KeyRound className="h-5 w-5" aria-hidden="true" />,
      }

  const keyCell: KpiCell = keyConfigured
    ? {
        key: 'domain',
        label: t('fleetSetup.kpi.domainKey', 'Partner public key'),
        value: t('fleetSetup.kpi.keyReady', 'Published'),
        subtitle: publicKey?.fingerprint || dash,
        color: 'purple',
        icon: <Radio className="h-5 w-5" aria-hidden="true" />,
      }
    : {
        key: 'domain',
        label: t('fleetSetup.kpi.domainKey', 'Partner public key'),
        value: publicKey?.configured === false ? t('fleetSetup.kpi.keyMissing', 'Not published') : dash,
        subtitle: publicKey?.configured === false ? t(
          'fleetSetup.kpi.keyMissingHint',
          'Tesla fetches this PEM from your domain during partner registration.',
        ) : undefined,
        color: publicKey?.configured === false ? 'amber' : 'cyan',
        icon: <Radio className="h-5 w-5" aria-hidden="true" />,
      }

  const streamValue =
    health === 'healthy'
      ? t('fleetSetup.kpi.streamHealthy', 'Streaming')
      : health === 'stale'
        ? t('fleetSetup.kpi.streamStale', 'Stale')
        : health != null ? t('fleetSetup.kpi.streamUnknown', 'Waiting') : dash

  const streamCell: KpiCell = {
    key: 'stream',
    label: t('fleetSetup.kpi.stream', 'Telemetry'),
    value: streamValue,
    subtitle:
      health === 'healthy'
        ? t('fleetSetup.kpi.streamHealthyHint', 'Packets arrived in the last 24 hours.')
        : health === 'stale'
          ? t('fleetSetup.kpi.streamStaleHint', 'Wake the vehicle or take a short drive.')
          : health != null ? t('fleetSetup.kpi.streamUnknownHint', 'Subscribe a VIN, then wait for the car to wake.') : undefined,
    color: health === 'healthy' ? 'green' : health === 'stale' ? 'amber' : 'cyan',
    icon:
      health === 'healthy' ? (
        <Wifi className="h-5 w-5" aria-hidden="true" />
      ) : (
        <WifiOff className="h-5 w-5" aria-hidden="true" />
      ),
  }

  const cells = [accountCell, tokenCell, keyCell, streamCell]
  const metrics: readonly StatMetric[] = cells.map(cell => ({
    metricId: 'status',
    occurrenceId: `fleet-setup-${cell.key}`,
    label: cell.label,
    rawValue: (isLoading && !sourceLoading) || sourceLoading?.[cell.key] || cell.value === dash ? null : cell.value,
    missingReason: sourceLoading?.[cell.key]
      ? t('summaryBrief.loading', 'Loading source')
      : undefined,
    context: <>{cell.icon}{cell.subtitle}</>,
  }))

  return (
    <section
      aria-label={t('fleetSetup.kpi.aria', 'Fleet setup status summary')}
      aria-busy={isLoading}
    >
      <SettingsSummaryBrief title={t('fleetSetup.brief.title', 'Fleet setup overview')}
        description={t('fleetSetup.brief.description', 'Account connection, token refresh, domain publication and telemetry readiness come from independent setup checks.')}
        source={t('fleetSetup.brief.source', 'Fleet setup checks')}
        scope={t('fleetSetup.brief.scope', 'Latest account, token and domain checks · telemetry packets in the last 24 hours')}
        metrics={metrics} loading={isLoading && !sourceLoading} retained={retained}
        unavailable={cells.some(cell => cell.value === dash) && !isLoading}
        testId="fleet-setup-summary" />
    </section>
  )
}

export default FleetSetupKpiBand
