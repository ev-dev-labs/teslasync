import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GlassPanel, Badge, Button, Input, Select, Textarea, type Column } from '@/components/ui'
import { Skeleton, AlertBanner } from '@/components/feedback'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import { fmtInt } from '@/lib/numberFormat'
import { getErrorMessage } from '@/lib/errorMessage'
import SignalConfigModal from '@/components/ui/SignalConfigModal'

import { ToolCard } from './ToolCard'
import { CopyButton } from '@/components/ui'
import { ResultPanel } from './ResultPanel'
import { TelemetryErrorsPanel } from './TelemetryErrorsPanel'
import { apiFetch, extractTelemetryErrors, useVehicleOptions } from './helpers'
import type { TelemetryError } from './types'
import { ICON_COLOR_MAP, ONBOARDING_STEPS, TELEMETRY_FIELDS } from './constants'
import { Icons } from '@/lib/icons';

/* ─── Fleet API Config Tool ───────────────────────────────────────────── */

function FleetApiConfigTool() {
  const { t } = useTranslation()
  const { data, isLoading, error: configError } = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
  })

  if (isLoading) return <GlassPanel className="p-5"><Skeleton lines={4} /></GlassPanel>
  if (configError) return <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>{t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(configError)}</AlertBanner>

  const info = data ?? {}
  const baseUrl = (info.baseUrl as string) ?? ''
  const clientId = (info.clientId as string) ?? ''
  const authStatus = info.authenticated === true
  const regions = (info.regions as string[]) ?? []

  return (
    <ToolCard icon={Icons.settings} color="cyan" title={t('Config')} description={t('Config Desc')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <GlassPanel className="p-3">
          <span className="text-xs text-[var(--text-secondary)]">{t('Base Url')}</span>
          <div className="mt-1 flex items-center gap-2">
            <span className="truncate text-sm font-mono text-white">{baseUrl || '—'}</span>
            {baseUrl && <CopyButton text={baseUrl} />}
          </div>
        </GlassPanel>
        <GlassPanel className="p-3">
          <span className="text-xs text-[var(--text-secondary)]">{t('Client Id')}</span>
          <div className="mt-1 flex items-center gap-2">
            <span className="truncate text-sm font-mono text-white">{clientId || '—'}</span>
            {clientId && <CopyButton text={clientId} />}
          </div>
        </GlassPanel>
        <GlassPanel className="p-3">
          <span className="text-xs text-[var(--text-secondary)]">{t('Auth Status')}</span>
          <div className="mt-1 flex items-center gap-2">
            {authStatus ? (
              <Badge variant="success" size="sm" dot>{t('Authenticated')}</Badge>
            ) : (
              <Badge variant="danger" size="sm" dot>{t('Not Authenticated')}</Badge>
            )}
          </div>
        </GlassPanel>
        <GlassPanel className="p-3">
          <span className="text-xs text-[var(--text-secondary)]">{t('Regions')}</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {regions.length > 0
              ? regions.map((r) => <Badge key={r} variant="info" size="sm">{r}</Badge>)
              : <span className="text-sm text-[var(--text-muted)]">—</span>}
          </div>
        </GlassPanel>
      </div>
    </ToolCard>
  )
}

/* ─── Partner Registration Tool ───────────────────────────────────────── */

function PartnerRegistrationTool() {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const mutation = useMutation({
    mutationFn: () => apiFetch('register-partner', 'POST', { domain }),
  })

  const opensslGen = 'openssl ecparam -name prime256v1 -genkey -noout -out private.pem'
  const opensslPub = 'openssl ec -in private.pem -pubout -out public.pem'

  return (
    <ToolCard icon={Icons.globe} color="green" title={t('Partner Reg')} description={t('Partner Reg Desc')}>
      <div className="space-y-3">
        <GlassPanel className="border-neon-amber/20 bg-neon-amber/5 p-3">
          <div className="flex items-start gap-2">
            <Icons.severityWarn className="mt-0.5 h-4 w-4 shrink-0 text-neon-amber" />
            <div className="text-xs text-neon-amber/80">
              <p className="font-semibold">{t('Prerequisites')}</p>
              <p className="mt-1">{t('Prerequisites Desc')}</p>
            </div>
          </div>
        </GlassPanel>

        <div className="space-y-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">{t('Openssl Commands')}</span>
          <div className="space-y-1">
            <div className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-1.5">
              <code className="flex-1 text-xs text-cyan-300">{opensslGen}</code>
              <CopyButton text={opensslGen} />
            </div>
            <div className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-1.5">
              <code className="flex-1 text-xs text-cyan-300">{opensslPub}</code>
              <CopyButton text={opensslPub} />
            </div>
          </div>
        </div>

        <Input
          label={t('Domain')}
          placeholder="yourapp.example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          icon={<Icons.globe className="h-4 w-4" />}
        />
        <Button
          variant="primary"
          size="sm"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          icon={<Icons.play className="h-3.5 w-3.5" />}
        >
          {t('Register')}
        </Button>
        {mutation.data && (
          <ResultPanel
            title={t('Partner Reg')}
            data={mutation.data.error ? undefined : mutation.data}
            error={typeof mutation.data.error === 'string' ? mutation.data.error : undefined}
          />
        )}
      </div>
    </ToolCard>
  )
}

/* ─── Partner Public Key Tool ─────────────────────────────────────────── */

function PartnerPublicKeyTool() {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')

  const mutation = useMutation({
    mutationFn: () => apiFetch(`partner-public-key?domain=${encodeURIComponent(domain)}`),
  })

  const response = mutation.data ?? {}
  const verification = (response.verification ?? {}) as Record<string, unknown>
  const remoteFound = verification.remote_key_found === true
  const matchesLocal = verification.matches_local === true
  const localConfigured = verification.local_key_configured === true
  const publicKey = ((response.response as Record<string, unknown>)?.public_key as string) ?? ''

  return (
    <ToolCard icon={Icons.security} color="cyan" title={t('devtools.partnerKey.title', 'Public Key Verification')} description={t('devtools.partnerKey.desc', 'Verify your registered public key with Tesla')}>
      <div className="space-y-3">
        <Input
          label={t('Domain')}
          placeholder="yourapp.example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          icon={<Icons.globe className="h-4 w-4" />}
        />
        <Button
          variant="primary"
          size="sm"
          loading={mutation.isPending}
          disabled={!domain.trim()}
          onClick={() => mutation.mutate()}
          icon={<Icons.play className="h-3.5 w-3.5" />}
        >
          {t('devtools.partnerKey.verify', 'Verify')}
        </Button>

        {mutation.data && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {remoteFound ? (
                <Badge variant="success" size="sm" dot>{t('devtools.partnerKey.keyRegistered', 'Key Registered')}</Badge>
              ) : (
                <Badge variant="danger" size="sm" dot>{t('devtools.partnerKey.keyNotFound', 'Key Not Found')}</Badge>
              )}
              {remoteFound && localConfigured && (
                matchesLocal ? (
                  <Badge variant="success" size="sm" dot>{t('devtools.partnerKey.matchesLocal', 'Matches Local Key')}</Badge>
                ) : (
                  <Badge variant="warning" size="sm" dot>{t('devtools.partnerKey.mismatch', 'Does Not Match Local Key')}</Badge>
                )
              )}
              {remoteFound && !localConfigured && (
                <Badge variant="neutral" size="sm">{t('devtools.partnerKey.noLocal', 'No Local Key Configured')}</Badge>
              )}
            </div>

            {publicKey && (
              <div className="space-y-1">
                <span className="text-xs font-medium text-[var(--text-secondary)]">{t('devtools.partnerKey.pemLabel', 'Registered PEM')}</span>
                <div className="rounded bg-[var(--surface-overlay)] p-3">
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-[var(--text-primary)]">
                    {publicKey}
                  </pre>
                  <div className="mt-2 flex justify-end">
                    <CopyButton text={publicKey} />
                  </div>
                </div>
              </div>
            )}

            <ResultPanel
              title={t('devtools.partnerKey.rawResponse', 'Raw Response')}
              data={response.error ? undefined : response}
              error={typeof response.error === 'string' ? (response.error as string) : undefined}
              idle={false}
            />
          </>
        )}
      </div>
    </ToolCard>
  )
}

/* ─── Public Key Setup Tool ───────────────────────────────────────────── */

function PublicKeySetupTool() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pemInput, setPemInput] = useState('')

  const { data: status, isLoading, error: keyError } = useQuery({
    queryKey: ['devtools', 'public-key-status'],
    queryFn: () => apiFetch('public-key-status'),
  })

  const generateMut = useMutation({
    mutationFn: () => apiFetch('generate-keypair', 'POST'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devtools', 'public-key-status'] }) },
  })

  const uploadMut = useMutation({
    mutationFn: () => apiFetch('upload-public-key', 'POST', { pem: pemInput }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devtools', 'public-key-status'] }); setPemInput('') },
  })

  const deleteMut = useMutation({
    mutationFn: () => apiFetch('public-key', 'DELETE'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devtools', 'public-key-status'] }) },
  })

  if (isLoading) return <GlassPanel className="p-5"><Skeleton lines={3} /></GlassPanel>
  if (keyError) return <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>{t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(keyError)}</AlertBanner>

  const configured = status?.configured === true
  const fingerprint = (status?.fingerprint as string) ?? ''
  const wellKnownUrl = (status?.wellKnownUrl as string) ?? ''

  return (
    <ToolCard icon={Icons.key} color="purple" title={t('Public Key')} description={t('Public Key Desc')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)]">{t('Status')}:</span>
          {configured ? (
            <Badge variant="success" size="sm" dot>{t('Configured')}</Badge>
          ) : (
            <Badge variant="warning" size="sm" dot>{t('Not Configured')}</Badge>
          )}
        </div>

        {fingerprint && (
          <div className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-1.5">
            <Icons.fingerprint className="h-4 w-4 text-neon-purple" />
            <code className="text-xs text-[var(--text-primary)]">{fingerprint}</code>
            <CopyButton text={fingerprint} />
          </div>
        )}

        {wellKnownUrl && (
          <div className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-1.5">
            <Icons.link className="h-4 w-4 text-neon-cyan" />
            <code className="flex-1 truncate text-xs text-[var(--text-primary)]">{wellKnownUrl}</code>
            <CopyButton text={wellKnownUrl} />
          </div>
        )}

        <GlassPanel className="border-neon-amber/20 bg-neon-amber/5 p-3">
          <div className="flex items-start gap-2">
            <Icons.severityWarn className="mt-0.5 h-4 w-4 shrink-0 text-neon-amber" />
            <span className="text-xs text-neon-amber/80">{t('Private Key Warning')}</span>
          </div>
        </GlassPanel>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={generateMut.isPending} onClick={() => generateMut.mutate()} icon={<Icons.key className="h-3.5 w-3.5" />}>
            {t('Generate Keypair')}
          </Button>
          <Button variant="danger" size="sm" loading={deleteMut.isPending} onClick={() => deleteMut.mutate()} icon={<Icons.delete className="h-3.5 w-3.5" />}>
            {t('Delete Keypair')}
          </Button>
        </div>

        <ResultPanel title={t('Generate Keypair')} data={generateMut.data?.error ? undefined : generateMut.data} error={typeof generateMut.data?.error === 'string' ? generateMut.data.error : undefined} idle={!generateMut.data} idleMessage={t('devtools.keypairIdle', 'Generate or delete a keypair to see results')} />
        <ResultPanel title={t('Delete Keypair')} data={deleteMut.data?.error ? undefined : deleteMut.data} error={typeof deleteMut.data?.error === 'string' ? deleteMut.data.error : undefined} idle={!deleteMut.data} />

        <div className="space-y-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">{t('Upload Pem')}</span>
          <Textarea
            rows={4}
            placeholder={t('Pem Placeholder')}
            value={pemInput}
            onChange={(e) => setPemInput(e.target.value)}
          />
          <Button variant="secondary" size="sm" loading={uploadMut.isPending} onClick={() => uploadMut.mutate()} icon={<Icons.upload className="h-3.5 w-3.5" />}>
            {t('Upload Key')}
          </Button>
          <ResultPanel title={t('Upload Key')} data={uploadMut.data?.error ? undefined : uploadMut.data} error={typeof uploadMut.data?.error === 'string' ? uploadMut.data.error : undefined} idle={!uploadMut.data} idleMessage={t('devtools.uploadIdle', 'Upload a public key to see results')} />
        </div>
      </div>
    </ToolCard>
  )
}

/* ─── Vehicle Key Pairing Tool ────────────────────────────────────────── */

function VehicleKeyPairingTool() {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
  })
  const hostname = (data?.hostname as string) ?? 'yourapp.example.com'
  const pairingUrl = `https://tesla.com/_ak/${hostname}`

  return (
    <ToolCard icon={Icons.vehicle} color="green" title={t('Key Pairing')} description={t('Key Pairing Desc')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-2">
          <Icons.link className="h-4 w-4 text-neon-green" />
          <code className="flex-1 truncate text-sm text-emerald-300">{pairingUrl}</code>
          <CopyButton text={pairingUrl} />
        </div>
        <div className="rounded-lg bg-neon-cyan/5 p-3">
          <p className="text-xs text-[var(--text-secondary)]">{t('Pairing Instructions')}</p>
          <ul className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
            <li className="flex items-start gap-2">
              <Icons.next className="mt-0.5 h-3 w-3 shrink-0 text-neon-cyan" />
              <span>{t('devtools.fleet.pairingStep1', 'Pairing Step1')}</span>
            </li>
            <li className="flex items-start gap-2">
              <Icons.next className="mt-0.5 h-3 w-3 shrink-0 text-neon-cyan" />
              <span>{t('devtools.fleet.pairingStep2', 'Pairing Step2')}</span>
            </li>
            <li className="flex items-start gap-2">
              <Icons.next className="mt-0.5 h-3 w-3 shrink-0 text-neon-cyan" />
              <span>{t('devtools.fleet.pairingStep3', 'Pairing Step3')}</span>
            </li>
          </ul>
        </div>
      </div>
    </ToolCard>
  )
}

/* ─── Fleet Telemetry Subscribe Tool ──────────────────────────────────── */

function FleetTelemetrySubscribeTool() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [vin, setVin] = useState('')
  const [hostname, setHostname] = useState('')
  const [port, setPort] = useState('443')
  const [interval, setInterval_] = useState(30)
  const [caCert, setCaCert] = useState('')
  const [signalModalOpen, setSignalModalOpen] = useState(false)
  const [selectedSignals, setSelectedSignals] = useState<{ name: string; interval: number }[]>([])

  const { options: vehicleOptions } = useVehicleOptions()

  const subscribeMut = useMutation({
    mutationFn: () =>
      apiFetch('fleet-telemetry-subscribe', 'POST', {
        vins: [vin],
        hostname,
        port: parseInt(port, 10),
        ca: caCert || undefined,
        fields: selectedSignals.length > 0 ? selectedSignals.map((s) => s.name) : undefined,
        interval_seconds: interval,
        field_intervals: selectedSignals.length > 0
          ? Object.fromEntries(selectedSignals.filter((s) => s.interval !== interval).map((s) => [s.name, s.interval]))
          : undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devtools'] }) },
  })

  return (
    <ToolCard icon={Icons.radio} color="cyan" title={t('Telemetry Sub')} description={t('Telemetry Sub Desc')}>
      <div className="space-y-3">
        <Select
          label={t('Vehicle')}
          placeholder={t('Select Vehicle')}
          options={vehicleOptions}
          value={vin}
          onChange={(e) => setVin(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t('Hostname')}
            placeholder="telemetry.example.com"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            icon={<Icons.server className="h-4 w-4" />}
          />
          <Input
            label={t('Port')}
            placeholder="443"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            icon={<Icons.network className="h-4 w-4" />}
          />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">{t('Ca Cert')}</span>
          <Textarea
            rows={3}
            placeholder={t('Ca Cert Placeholder')}
            value={caCert}
            onChange={(e) => setCaCert(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSignalModalOpen(true)}
            icon={<Icons.settings className="h-3.5 w-3.5" />}
          >
            {t('Configure Signals')} ({selectedSignals.length})
          </Button>
          <span className="text-xs text-[var(--text-muted)]">
            {t('Interval Label')}: {interval}s
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          loading={subscribeMut.isPending}
          onClick={() => subscribeMut.mutate()}
          icon={<Icons.play className="h-3.5 w-3.5" />}
        >
          {t('Subscribe')}
        </Button>
        {subscribeMut.data && (
          <ResultPanel
            title={t('Telemetry Sub')}
            data={subscribeMut.data.error ? undefined : subscribeMut.data}
            error={typeof subscribeMut.data.error === 'string' ? subscribeMut.data.error : undefined}
          />
        )}
      </div>
      <SignalConfigModal
        open={signalModalOpen}
        onClose={() => setSignalModalOpen(false)}
        categories={TELEMETRY_FIELDS}
        initialSelected={selectedSignals.map((s) => s.name)}
        initialInterval={interval}
        onSubmit={(signals) => {
          setSelectedSignals(signals)
          if (signals.length > 0) setInterval_(signals[0]?.interval ?? 30)
          setSignalModalOpen(false)
        }}
      />
    </ToolCard>
  )
}

/* ─── Fleet Telemetry Config Tool ─────────────────────────────────────── */

function FleetTelemetryConfigTool() {
  const { t } = useTranslation()
  const [vin, setVin] = useState('')

  const { options: vehicleOptions } = useVehicleOptions()

  const configQuery = useMutation({ mutationFn: () => apiFetch(`fleet-telemetry-config?vin=${vin}`) })
  const errorsQuery = useMutation({ mutationFn: () => apiFetch(`fleet-telemetry-errors?vin=${vin}`) })
  const deleteMut = useMutation({ mutationFn: () => apiFetch(`fleet-telemetry-config?vin=${vin}`, 'DELETE') })

  // Defensive extraction: see extractTelemetryErrors godoc above.
  // errorsRaw is the unwrapped Tesla payload (for the "Show raw"
  // disclosure when the table is empty), errorsApiError is the
  // upstream error string returned by apiFetch on non-2xx.
  const errorsApiError =
    typeof errorsQuery.data?.error === 'string' ? (errorsQuery.data.error as string) : undefined
  const { errors: errorData, ok: errorsOk } = useMemo(
    () => (errorsApiError ? { errors: [], ok: false } : extractTelemetryErrors(errorsQuery.data)),
    [errorsQuery.data, errorsApiError],
  )

  const errorColumns: Column<TelemetryError>[] = useMemo(() => [
    {
      key: 'timestamp',
      header: t('Timestamp'),
      render: (r) => (
        <span className="text-xs">{r.timestamp ? formatDateTime(r.timestamp) : '—'}</span>
      ),
    },
    {
      key: 'code',
      header: t('Code'),
      render: (r) => (r.code ? <Badge variant="danger" size="sm">{r.code}</Badge> : <span className="text-xs text-[var(--text-muted)]">—</span>),
    },
    {
      key: 'message',
      header: t('Message'),
      render: (r) => (
        <span className="text-xs text-[var(--text-secondary)]">{r.message || '—'}</span>
      ),
    },
  ], [t])

  const vinSelected = vin !== ''
  const errorsRequested = errorsQuery.data != null || errorsQuery.isPending

  return (
    <ToolCard icon={Icons.satellite} color="purple" title={t('Telemetry Config')} description={t('Telemetry Config Desc')}>
      <div className="space-y-3">
        <Select
          label={t('Vehicle')}
          placeholder={t('Select Vehicle')}
          options={vehicleOptions}
          value={vin}
          onChange={(e) => setVin(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={!vinSelected} loading={configQuery.isPending} onClick={() => configQuery.mutate()} icon={<Icons.show className="h-3.5 w-3.5" />}>
            {t('Get Config')}
          </Button>
          <Button variant="secondary" size="sm" disabled={!vinSelected} loading={errorsQuery.isPending} onClick={() => errorsQuery.mutate()} icon={<Icons.severityWarn className="h-3.5 w-3.5" />}>
            {t('View Errors')}
          </Button>
          <Button variant="danger" size="sm" disabled={!vinSelected} loading={deleteMut.isPending} onClick={() => deleteMut.mutate()} icon={<Icons.delete className="h-3.5 w-3.5" />}>
            {t('Delete Config')}
          </Button>
        </div>
        <ResultPanel title={t('Telemetry Config')} data={configQuery.data?.error ? undefined : configQuery.data} error={typeof configQuery.data?.error === 'string' ? configQuery.data.error : undefined} idle={!configQuery.data} idleMessage={t('devtools.configIdle', 'Fetch config to see results')} />
        <ResultPanel title={t('Delete Config')} data={deleteMut.data?.error ? undefined : deleteMut.data} error={typeof deleteMut.data?.error === 'string' ? deleteMut.data.error : undefined} idle={!deleteMut.data} />
        {/* Errors panel — has FOUR distinct render states; before this
            fix only state (4) rendered, so loading / error / empty all
            looked identical to "button did nothing". */}
        <TelemetryErrorsPanel
          title={t('Telemetry Errors')}
          loading={errorsQuery.isPending}
          error={errorsApiError}
          requested={errorsRequested}
          ok={errorsOk}
          errors={errorData}
          columns={errorColumns}
          vin={vin}
          idleMessage={t('devtools.errorsIdle', 'Click View Errors to fetch recent Fleet Telemetry errors for this vehicle.')}
          emptyMessage={t('devtools.errorsEmpty', 'No Fleet Telemetry errors reported for this vehicle.')}
          rawData={errorsQuery.data}
          rawDisclosureLabel={t('devtools.errorsRaw', 'Show raw Tesla response')}
          downloadLabel={t('Download Errors')}
        />
      </div>
    </ToolCard>
  )
}

/* ─── Fleet Status Tool ───────────────────────────────────────────────── */

function FleetStatusTool() {
  const { t } = useTranslation()
  const { vehicles } = useVehicleOptions()
  const fleetStatusMut = useMutation({
    mutationFn: () => apiFetch('fleet-status', 'POST', { vins: vehicles.map((v) => v.vin) }),
  })

  return (
    <ToolCard icon={Icons.charging} color="green" title={t('Fleet Status')} description={t('Check fleet status for all vehicles')}>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={fleetStatusMut.isPending}
          onClick={() => fleetStatusMut.mutate()}
          disabled={vehicles.length === 0}
          icon={<Icons.play className="h-3.5 w-3.5" />}
        >
          {t('Check Fleet Status')}
        </Button>
      </div>
      {fleetStatusMut.data && (
        <ResultPanel
          title={t('Fleet Status')}
          data={fleetStatusMut.data.error ? undefined : fleetStatusMut.data}
          error={typeof fleetStatusMut.data.error === 'string' ? fleetStatusMut.data.error : undefined}
        />
      )}
    </ToolCard>
  )
}

/* ─── Vehicle Data Tools ──────────────────────────────────────────────── */

function VehicleDataTools() {
  const { t } = useTranslation()
  const [vin, setVin] = useState('')
  const { options: vehicleOptions } = useVehicleOptions()

  const chargingMut = useMutation({ mutationFn: () => apiFetch(`nearby-charging?vin=${vin}`) })
  const releaseNotesMut = useMutation({ mutationFn: () => apiFetch(`release-notes?vin=${vin}`) })
  const alertsMut = useMutation({ mutationFn: () => apiFetch(`recent-alerts?vin=${vin}`) })
  const serviceMut = useMutation({ mutationFn: () => apiFetch(`service-data?vin=${vin}`) })

  const lastResult = chargingMut.data ?? releaseNotesMut.data ?? alertsMut.data ?? serviceMut.data

  return (
    <ToolCard icon={Icons.vehicle} color="cyan" title={t('Vehicle Data')} description={t('Vehicle Data Desc')}>
      <div className="space-y-3">
        <Select
          label={t('Vehicle')}
          placeholder={t('Select Vehicle')}
          options={vehicleOptions}
          value={vin}
          onChange={(e) => setVin(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={chargingMut.isPending} onClick={() => chargingMut.mutate()} icon={<Icons.location className="h-3.5 w-3.5" />}>
            {t('Nearby Charging')}
          </Button>
          <Button variant="secondary" size="sm" loading={releaseNotesMut.isPending} onClick={() => releaseNotesMut.mutate()} icon={<Icons.fileText className="h-3.5 w-3.5" />}>
            {t('Release Notes')}
          </Button>
          <Button variant="secondary" size="sm" loading={alertsMut.isPending} onClick={() => alertsMut.mutate()} icon={<Icons.severityWarn className="h-3.5 w-3.5" />}>
            {t('Recent Alerts')}
          </Button>
          <Button variant="secondary" size="sm" loading={serviceMut.isPending} onClick={() => serviceMut.mutate()} icon={<Icons.maintenance className="h-3.5 w-3.5" />}>
            {t('Service Data')}
          </Button>
        </div>
        {lastResult && (
          <ResultPanel
            title={t('Vehicle Data')}
            data={lastResult.error ? undefined : lastResult}
            error={typeof lastResult.error === 'string' ? lastResult.error : undefined}
          />
        )}
      </div>
    </ToolCard>
  )
}

/* ─── Onboarding Workflow ─────────────────────────────────────────────── */

function OnboardingWorkflow() {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(0)
  const [completed, setCompleted] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('devtools-onboarding')
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    localStorage.setItem('devtools-onboarding', JSON.stringify(completed))
  }, [completed])

  const { data: keyStatus, error: keyStatusError } = useQuery({
    queryKey: ['devtools', 'public-key-status'],
    queryFn: () => apiFetch('public-key-status'),
    refetchInterval: 30000,
  })

  const { data: fleetInfo, error: fleetInfoError } = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
    refetchInterval: 30000,
  })

  useEffect(() => {
    const autoDetected: Record<string, boolean> = { ...completed }
    if (keyStatus?.configured === true) autoDetected.keypair = true
    if (fleetInfo?.authenticated === true) autoDetected.auth = true
    const changed = Object.keys(autoDetected).some((k) => autoDetected[k] !== completed[k])
    if (changed) setCompleted(autoDetected)
  }, [keyStatus, fleetInfo, completed])

  const completedCount = ONBOARDING_STEPS.filter((s) => completed[s.id]).length
  const progressPct = (completedCount / ONBOARDING_STEPS.length) * 100
  const step = ONBOARDING_STEPS[currentStep]
  if (!step) return null
  const StepIcon = step.icon

  const markComplete = () => {
    setCompleted((prev) => ({ ...prev, [step.id]: true }))
    if (currentStep < ONBOARDING_STEPS.length - 1) setCurrentStep(currentStep + 1)
  }

  const onboardingError = [keyStatusError, fleetInfoError].find(Boolean)

  return (
    <div className="space-y-4">
      {onboardingError && (
        <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(onboardingError)}
        </AlertBanner>
      )}

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <span>{t('Progress')}</span>
          <span>{completedCount} / {ONBOARDING_STEPS.length} ({fmtInt(progressPct)}%)</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-glass-border">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-green transition-all duration-slow"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex flex-wrap gap-2">
        {ONBOARDING_STEPS.map((s, i) => (
          <Badge
            key={s.id}
            variant={completed[s.id] ? 'success' : i === currentStep ? 'info' : 'neutral'}
            size="sm"
            dot={i === currentStep}
            onClick={() => setCurrentStep(i)}
            className="cursor-pointer"
          >
            {s.label}
          </Badge>
        ))}
      </div>

      {/* Step content */}
      <GlassPanel className="p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', completed[step.id] ? ICON_COLOR_MAP.green : ICON_COLOR_MAP.cyan)}>
            {completed[step.id] ? <Icons.success className="h-5 w-5" /> : <StepIcon className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {t('devtools.onboarding.stepLabel', 'Step {{step}}', { step: currentStep + 1 })}: {step.label}
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">{step.desc}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={currentStep === 0}
            onClick={() => setCurrentStep(currentStep - 1)}
            icon={<Icons.back className="h-3.5 w-3.5" />}
          >
            {t('Previous')}
          </Button>
          <Button
            variant={completed[step.id] ? 'secondary' : 'primary'}
            size="sm"
            onClick={markComplete}
            icon={<Icons.success className="h-3.5 w-3.5" />}
          >
            {completed[step.id] ? t('Completed') : t('Mark Complete')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={currentStep === ONBOARDING_STEPS.length - 1}
            onClick={() => setCurrentStep(currentStep + 1)}
            icon={<Icons.forward className="h-3.5 w-3.5" />}
          >
            {t('Next')}
          </Button>
        </div>
      </GlassPanel>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Fleet API Section — composed layout
   ═══════════════════════════════════════════════════════════════════════ */

export function FleetApiSection() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      {/* Onboarding wizard */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('devtools.fleet.setupWizard', 'Setup Wizard')}</h2>
        <OnboardingWorkflow />
      </div>

      {/* Fleet API tool grid */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('devtools.fleet.toolsTitle', 'Fleet API Tools')}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <FleetApiConfigTool />
          <PartnerRegistrationTool />
          <PartnerPublicKeyTool />
          <PublicKeySetupTool />
          <VehicleKeyPairingTool />
          <FleetTelemetrySubscribeTool />
          <FleetTelemetryConfigTool />
          <FleetStatusTool />
          <VehicleDataTools />
        </div>
      </div>
    </div>
  )
}
