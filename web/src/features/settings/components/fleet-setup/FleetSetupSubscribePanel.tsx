/**
 * Guided fleet_telemetry_config subscribe for one VIN.
 * Host / port / CA stay optional — backend fills FLEET_TELEMETRY_HOST + LE CA.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Power, Radio, Satellite, SlidersHorizontal, Trash2 } from 'lucide-react'
import {
  Accordion,
  Button,
  ConfirmDialog,
  GlassPanel,
  HelperText,
  IconBox,
  Input,
  PanelTitle,
  Select,
  Text,
  Textarea,
} from '@/components/ui'
import SignalConfigModal from '@/components/ui/SignalConfigModal'
import { AlertBanner, EmptyState } from '@/components/feedback'
import { KVList } from '@/components/data-display'
import { useVehicles, useWakeVehicle } from '@/api/hooks/useVehicles'
import {
  telemetryConfigSummary,
  useFleetTelemetryConfig,
  useFleetTelemetryErrors,
  useSubscribeFleetTelemetry,
  useUnsubscribeFleetTelemetry,
} from '@/api/hooks/useFleetSetup'
import { useAuthStatus } from '@/api/hooks/useSettings'
import { useConfirm } from '@/hooks/useConfirm'
import { TELEMETRY_FIELDS } from '@/features/admin/components/devtools/constants'

export function FleetSetupSubscribePanel() {
  const { t } = useTranslation('settings')
  const { data: auth } = useAuthStatus()
  const { data: vehicles } = useVehicles()
  const items = vehicles ?? []
  const [vin, setVin] = useState('')
  const [hostname, setHostname] = useState('')
  const [port, setPort] = useState('')
  const [ca, setCa] = useState('')
  const [signalModalOpen, setSignalModalOpen] = useState(false)
  const [selectedSignals, setSelectedSignals] = useState<{ name: string; interval: number }[]>([])
  const [masterInterval, setMasterInterval] = useState(10)

  const configQuery = useFleetTelemetryConfig(vin)
  const errorsQuery = useFleetTelemetryErrors(vin)
  const subscribe = useSubscribeFleetTelemetry()
  const unsubscribe = useUnsubscribeFleetTelemetry()
  const wake = useWakeVehicle()
  const { confirm: confirmRemove, dialogProps: removeDialogProps } = useConfirm()
  const summary = telemetryConfigSummary(configQuery.data)
  const teslaErrors = errorsQuery.data ?? []
  const connected = auth?.authenticated === true
  const selected = items.find((v) => v.vin === vin)

  const options = useMemo(
    () =>
      items
        .filter((v) => (v.vin ?? '').trim().length > 0)
        .map((v) => ({
          value: v.vin,
          label: `${v.display_name || v.displayName || t('fleetSetup.subscribe.unnamed', 'Vehicle')} · ${v.vin}`,
        })),
    [items, t],
  )

  const busy = subscribe.isPending || unsubscribe.isPending || wake.isPending
  const canSubmit = connected && vin.trim().length > 0 && !busy
  const vehicleId = typeof selected?.id === 'number' ? selected.id : 0

  async function handleRemove() {
    if (!canSubmit || !summary.hostname) return
    const ok = await confirmRemove({
      title: t('fleetSetup.subscribe.removeTitle', 'Remove telemetry config?'),
      message: t(
        'fleetSetup.subscribe.removeBody',
        'Tesla will stop streaming this VIN to TeslaSync until you subscribe again.',
      ),
      variant: 'danger',
      confirmLabel: t('fleetSetup.subscribe.removeConfirm', 'Remove config'),
      cancelLabel: t('common.cancel', 'Cancel'),
    })
    if (!ok) return
    unsubscribe.mutate(vin.trim())
  }

  function handleWake() {
    if (!canSubmit || vehicleId <= 0) return
    wake.mutate(vehicleId)
  }

  function handleSubscribe() {
    if (!canSubmit) return
    const parsedPort = Number.parseInt(port, 10)
    const fieldIntervals =
      selectedSignals.length > 0
        ? Object.fromEntries(
            selectedSignals
              .filter((s) => s.interval !== masterInterval)
              .map((s) => [s.name, s.interval]),
          )
        : undefined
    subscribe.mutate({
      vins: [vin.trim()],
      hostname: hostname.trim() || undefined,
      port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : undefined,
      ca: ca.trim() || undefined,
      fields: selectedSignals.length > 0 ? selectedSignals.map((s) => s.name) : undefined,
      interval_seconds: masterInterval > 0 ? masterInterval : undefined,
      field_intervals:
        fieldIntervals && Object.keys(fieldIntervals).length > 0 ? fieldIntervals : undefined,
    })
  }

  return (
    <GlassPanel id="fleet-setup-subscribe" className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="cyan">
          <Satellite className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div>
          <PanelTitle>{t('fleetSetup.subscribe.title', 'Subscribe telemetry')}</PanelTitle>
          <HelperText>
            {t(
              'fleetSetup.subscribe.subtitle',
              'Pick signals (or a preset), then tell Tesla which VIN should stream to this host.',
            )}
          </HelperText>
        </div>
      </div>

      {!connected ? (
        <EmptyState
          icon={<Radio className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'fleetSetup.subscribe.needAuth',
            'Connect Tesla first. Subscribe uses the stored Fleet token.',
          )}
        />
      ) : options.length === 0 ? (
        <EmptyState
          icon={<Radio className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'fleetSetup.subscribe.needVehicle',
            'No vehicles yet. Sync vehicles after connecting Tesla.',
          )}
        />
      ) : (
        <Select
          id="fleet-setup-vin"
          label={t('fleetSetup.subscribe.vehicle', 'Vehicle')}
          placeholder={t('fleetSetup.subscribe.placeholder', 'Select a vehicle')}
          options={options}
          value={vin}
          onChange={(e) => setVin(e.target.value)}
        />
      )}

      {vin ? (
        <KVList
          emptyMessage={t(
            'fleetSetup.subscribe.configEmpty',
            'No fleet_telemetry_config on this VIN yet.',
          )}
          items={
            summary.hostname
              ? [
                  {
                    label: t('fleetSetup.subscribe.currentHost', 'Configured host'),
                    value: summary.hostname,
                  },
                  {
                    label: t('fleetSetup.subscribe.currentPort', 'Port'),
                    value: summary.port != null ? String(summary.port) : t('common.dash', '—'),
                  },
                  {
                    label: t('fleetSetup.subscribe.fields', 'Fields'),
                    value: String(summary.field_count),
                  },
                ]
              : []
          }
        />
      ) : (
        <Text variant="bodySm" as="p">
          {t(
            'fleetSetup.subscribe.pickHint',
            'Pick a VIN to see whether Tesla already has a telemetry config for it.',
          )}
        </Text>
      )}

      <div className="space-y-2">
        <Button
          variant="secondary"
          icon={<SlidersHorizontal className="h-4 w-4" />}
          onClick={() => setSignalModalOpen(true)}
        >
          {t('fleetSetup.subscribe.configureSignals', 'Configure signals')} ({selectedSignals.length})
        </Button>
        <HelperText>
          {selectedSignals.length > 0
            ? t(
                'fleetSetup.subscribe.signalsPicked',
                '{{count}} signals selected. Presets (Balanced, Low Power, Track Mode, …) set intervals per category.',
                { count: selectedSignals.length },
              )
            : t(
                'fleetSetup.subscribe.signalsHint',
                'Optional. Open the signal picker to choose fields and intervals. Leave empty to use TeslaSync’s default set.',
              )}
        </HelperText>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={<Power className="h-4 w-4" />}
          onClick={handleWake}
          loading={wake.isPending}
          disabled={!canSubmit || vehicleId <= 0}
        >
          {t('fleetSetup.subscribe.wake', 'Wake vehicle')}
        </Button>
        <Button
          variant="primary"
          icon={<Satellite className="h-4 w-4" />}
          onClick={handleSubscribe}
          loading={subscribe.isPending}
          disabled={!canSubmit}
        >
          {selected
            ? t('fleetSetup.subscribe.ctaNamed', 'Subscribe {{name}}', {
                name: selected.display_name || selected.displayName || selected.vin,
              })
            : t('fleetSetup.subscribe.cta', 'Subscribe selected vehicle')}
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 className="h-4 w-4" />}
          onClick={() => void handleRemove()}
          loading={unsubscribe.isPending}
          disabled={!canSubmit || !summary.hostname}
        >
          {t('fleetSetup.subscribe.remove', 'Remove config')}
        </Button>
      </div>
      <HelperText>
        {t(
          'fleetSetup.subscribe.wakeHint',
          'Wake the car so Tesla can apply the config. Asleep vehicles ignore fleet_telemetry_config until the next drive or charge.',
        )}
      </HelperText>

      {vin ? (
        teslaErrors.length > 0 ? (
          <div className="space-y-2">
            {teslaErrors.slice(0, 3).map((err, i) => (
              <AlertBanner
                key={`${err.code}-${err.timestamp}-${i}`}
                variant="warning"
                title={err.code || t('fleetSetup.subscribe.errorUntitled', 'Tesla telemetry error')}
              >
                {[err.message, err.timestamp].filter(Boolean).join(' · ') ||
                  t('fleetSetup.subscribe.errorNoDetail', 'Tesla reported a telemetry error for this VIN.')}
              </AlertBanner>
            ))}
          </div>
        ) : (
          <HelperText>
            {t(
              'fleetSetup.subscribe.errorsEmpty',
              'No Tesla-side telemetry errors for this VIN.',
            )}
          </HelperText>
        )
      ) : null}

      <Accordion title={t('fleetSetup.subscribe.advanced', 'Override host, port, or CA')}>
        <div className="space-y-3">
          <HelperText>
            {t(
              'fleetSetup.subscribe.advancedHint',
              'Leave blank to use FLEET_TELEMETRY_HOST, port 4443, and the Let’s Encrypt root CA.',
            )}
          </HelperText>
          <Input
            label={t('fleetSetup.subscribe.hostname', 'Hostname')}
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="telemetry.example.com"
          />
          <Input
            label={t('fleetSetup.subscribe.port', 'Port')}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="4443"
            inputMode="numeric"
          />
          <Textarea
            label={t('fleetSetup.subscribe.ca', 'CA certificate (PEM)')}
            value={ca}
            onChange={(e) => setCa(e.target.value)}
            rows={4}
          />
        </div>
      </Accordion>

      <SignalConfigModal
        open={signalModalOpen}
        onClose={() => setSignalModalOpen(false)}
        categories={TELEMETRY_FIELDS}
        initialSelected={selectedSignals.map((s) => s.name)}
        initialInterval={masterInterval}
        onSubmit={(signals) => {
          setSelectedSignals(signals)
          if (signals.length > 0) setMasterInterval(signals[0]?.interval ?? 10)
          setSignalModalOpen(false)
        }}
      />
      {removeDialogProps ? <ConfirmDialog {...removeDialogProps} /> : null}
    </GlassPanel>
  )
}

export default FleetSetupSubscribePanel
