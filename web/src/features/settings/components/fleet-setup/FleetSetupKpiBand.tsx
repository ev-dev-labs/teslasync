/**
 * Fleet Setup KPI band — account, token, domain key, and stream health.
 *
 * Always renders four cards. Loading uses StatSkeleton; missing data
 * degrades to em-dashes instead of hiding the strip.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Radio, ShieldCheck, ShieldAlert, Wifi, WifiOff } from 'lucide-react'
import { MetricCard } from '@/components/data-display'
import { StatSkeleton } from '@/components/feedback'
import type { NeonColor } from '@/lib/tokens'
import type { FleetApiInfo, PublicKeyStatus } from '@/api/hooks/useFleetSetup'
import type { OnboardingStatus } from '@/api/hooks/useOnboarding'

interface FleetSetupKpiBandProps {
  authenticated: boolean | undefined
  apiInfo: FleetApiInfo | undefined
  publicKey: PublicKeyStatus | undefined
  onboarding: OnboardingStatus | undefined
  isLoading: boolean
}

interface KpiCell {
  key: string
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
}: FleetSetupKpiBandProps) {
  const { t } = useTranslation('settings')

  if (isLoading) {
    return (
      <section aria-label={t('fleetSetup.kpi.aria', 'Fleet setup status summary')}>
        <StatSkeleton count={4} />
      </section>
    )
  }

  const dash = t('common.dash', '—')
  const connected = authenticated === true || apiInfo?.has_valid_token === true
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
        value: t('fleetSetup.kpi.notConnected', 'Not connected'),
        color: 'amber',
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
        value: t('fleetSetup.kpi.tokenMissing', 'Missing'),
        subtitle: t('fleetSetup.kpi.tokenMissingHint', 'Connect Tesla to store a refreshable Fleet token.'),
        color: 'amber',
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
        value: t('fleetSetup.kpi.keyMissing', 'Not published'),
        subtitle: t(
          'fleetSetup.kpi.keyMissingHint',
          'Tesla fetches this PEM from your domain during partner registration.',
        ),
        color: 'amber',
        icon: <Radio className="h-5 w-5" aria-hidden="true" />,
      }

  const streamValue =
    health === 'healthy'
      ? t('fleetSetup.kpi.streamHealthy', 'Streaming')
      : health === 'stale'
        ? t('fleetSetup.kpi.streamStale', 'Stale')
        : t('fleetSetup.kpi.streamUnknown', 'Waiting')

  const streamCell: KpiCell = {
    key: 'stream',
    label: t('fleetSetup.kpi.stream', 'Telemetry'),
    value: streamValue,
    subtitle:
      health === 'healthy'
        ? t('fleetSetup.kpi.streamHealthyHint', 'Packets arrived in the last 24 hours.')
        : health === 'stale'
          ? t('fleetSetup.kpi.streamStaleHint', 'Wake the vehicle or take a short drive.')
          : t('fleetSetup.kpi.streamUnknownHint', 'Subscribe a VIN, then wait for the car to wake.'),
    color: health === 'healthy' ? 'green' : health === 'stale' ? 'amber' : 'cyan',
    icon:
      health === 'healthy' ? (
        <Wifi className="h-5 w-5" aria-hidden="true" />
      ) : (
        <WifiOff className="h-5 w-5" aria-hidden="true" />
      ),
  }

  const cells = [accountCell, tokenCell, keyCell, streamCell]

  return (
    <section
      aria-label={t('fleetSetup.kpi.aria', 'Fleet setup status summary')}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {cells.map((cell) => (
        <MetricCard
          key={cell.key}
          label={cell.label}
          value={cell.value}
          subtitle={cell.subtitle}
          color={cell.color}
          icon={cell.icon}
        />
      ))}
    </section>
  )
}

export default FleetSetupKpiBand
