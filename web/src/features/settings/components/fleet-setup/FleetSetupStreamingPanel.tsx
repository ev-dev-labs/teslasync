/**
 * Streaming confirmation — live telemetry health from onboarding status.
 * Never hidden: waiting / stale / healthy all render in the same panel.
 */
import { Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge, GlassPanel, HelperText, IconBox, PanelTitle, Text } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { KVList } from '@/components/data-display'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { OnboardingStatus } from '@/api/hooks/useOnboarding'

interface FleetSetupStreamingPanelProps {
  onboarding: OnboardingStatus | undefined
}

export function FleetSetupStreamingPanel({ onboarding }: FleetSetupStreamingPanelProps) {
  const { t } = useTranslation('settings')
  const { formatDateTime } = useDateFormat()
  const health = onboarding?.telemetry_health
  const dash = t('common.dash', '—')
  const lastAt = onboarding?.last_telemetry_at
    ? formatDateTime(onboarding.last_telemetry_at)
    : dash

  const badge =
    health === 'healthy' ? (
      <Badge variant="success" size="sm" dot>
        {t('fleetSetup.stream.healthy', 'Healthy')}
      </Badge>
    ) : health === 'stale' ? (
      <Badge variant="warning" size="sm" dot>
        {t('fleetSetup.stream.stale', 'Stale')}
      </Badge>
    ) : (
      <Badge variant="info" size="sm" dot>
        {t('fleetSetup.stream.unknown', 'Waiting')}
      </Badge>
    )

  return (
    <GlassPanel id="fleet-setup-stream" className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="green">
          <Wifi className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div>
          <PanelTitle>{t('fleetSetup.stream.title', 'Streaming')}</PanelTitle>
          <HelperText>
            {t(
              'fleetSetup.stream.subtitle',
              'Fleet Telemetry only flows while the vehicle is awake.',
            )}
          </HelperText>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">{badge}</div>

      {health === 'healthy' ? (
        <KVList
          items={[
            {
              label: t('fleetSetup.stream.lastPacket', 'Last telemetry'),
              value: lastAt,
            },
            {
              label: t('fleetSetup.stream.vehicles', 'Vehicles seen'),
              value: String(onboarding?.vehicle_count ?? 0),
            },
          ]}
        />
      ) : (
        <EmptyState
          icon={<Wifi className="h-8 w-8" aria-hidden="true" />}
          message={
            health === 'stale'
              ? t(
                  'fleetSetup.stream.staleMessage',
                  'Telemetry was seen before, but nothing arrived in the last 24 hours. Wake the car or start a drive.',
                )
              : t(
                  'fleetSetup.stream.waitingMessage',
                  'No stream yet. After subscribe, Tesla delivers the first batch when the vehicle next wakes.',
                )
          }
          actionTo={{
            label: t('fleetSetup.stream.openSignals', 'Open live signals'),
            to: '/signals',
          }}
        />
      )}

      <Text variant="bodySm" as="p">
        {t(
          'fleetSetup.stream.note',
          'Virtual key pairing is not part of this step. Use it later if you want TeslaSync to send commands.',
        )}
      </Text>
    </GlassPanel>
  )
}

export default FleetSetupStreamingPanel
