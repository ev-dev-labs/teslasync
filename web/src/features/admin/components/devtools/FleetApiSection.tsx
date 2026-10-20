import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GlassPanel, Badge, Button, Input, Select, Textarea, ConfirmDialog, SignalConfigModal, Caption, Code, HelperText, PanelTitle, SectionTitle, Text, type Column } from '@/components/ui'
import { Skeleton, AlertBanner } from '@/components/feedback'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'
import { formatDateTime } from '@/lib/dateFormat'

import { getErrorMessage } from '@/lib/errorMessage'

import { ToolCard } from './ToolCard'
import { CopyButton } from '@/components/ui'
import { ResultPanel } from './ResultPanel'
import { TelemetryErrorsPanel } from './TelemetryErrorsPanel'
import { apiFetch, extractTelemetryErrors, useVehicleOptions } from './helpers'
import type { TelemetryError } from './types'
import { ICON_COLOR_MAP, ONBOARDING_STEPS, TELEMETRY_FIELDS } from './constants'
import { Icons } from '@/lib/icons';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

function resultError(error: unknown, data?: Record<string, unknown>): string | undefined {
  return error ? getErrorMessage(error) : typeof data?.error === 'string' ? data.error : undefined
}

/* ─── Fleet API Config Tool ───────────────────────────────────────────── */

function FleetApiConfigTool() {
  const { t } = useTranslation()
  const { data, isLoading, error: configError } = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
  })

  if (isLoading) return <GlassPanel className="p-5"><Skeleton lines={4} /></GlassPanel>
  if (configError && !data) return <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>{t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(configError)}</AlertBanner>

  const info = data ?? {}
  const apiError = typeof info.error === 'string' ? info.error : undefined
  if (apiError) return <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>{t('error.loadFailed', 'Failed to load data')}: {apiError}</AlertBanner>

  const baseUrl = typeof info.base_url === 'string' ? info.base_url : ''
  const clientId = typeof info.client_id === 'string' ? info.client_id : ''
  const authStatus = typeof info.has_valid_token === 'boolean' ? info.has_valid_token : undefined
  const regions = info.regions && typeof info.regions === 'object' && !Array.isArray(info.regions)
    ? Object.entries(info.regions).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    : []

  return (
    <ToolCard icon={Icons.settings} color="cyan" title={t('devtools.fleet.config', 'Config')} description={t('devtools.fleet.configDesc', 'Config desc')}>
      {configError && <AlertBanner variant="warning">{t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(configError)}</AlertBanner>}
      <div className="grid gap-3 sm:grid-cols-2">
        <GlassPanel className="p-3">
          <Caption>{t('devtools.fleet.baseUrl', 'Base URL')}</Caption>
          <div className="mt-1 flex items-center gap-2">
            <Code className="break-all">{baseUrl || '—'}</Code>
            {baseUrl && <CopyButton text={baseUrl} />}
          </div>
        </GlassPanel>
        <GlassPanel className="p-3">
          <Caption>{t('devtools.fleet.clientId', 'Client ID')}</Caption>
          <div className="mt-1 flex items-center gap-2">
            <Code className="break-all">{clientId || '—'}</Code>
            {clientId && <CopyButton text={clientId} />}
          </div>
        </GlassPanel>
        <GlassPanel className="p-3">
          <Caption>{t('devtools.fleet.authStatus', 'Auth status')}</Caption>
          <div className="mt-1 flex items-center gap-2">
            {authStatus === true ? (
              <Badge variant="success" size="sm" dot>{t('devtools.fleet.authenticated', 'Authenticated')}</Badge>
            ) : authStatus === false ? (
              <Badge variant="danger" size="sm" dot>{t('devtools.fleet.notAuthenticated', 'Not authenticated')}</Badge>
            ) : (
              <Badge variant="neutral" size="sm">{t('common.unknown', 'Unknown')}</Badge>
            )}
          </div>
        </GlassPanel>
        <GlassPanel className="p-3">
          <Caption>{t('devtools.fleet.regions', 'Regions')}</Caption>
          <div className="mt-1 flex flex-wrap gap-1">
            {regions.length > 0
              ? regions.map(([region, url]) => <div key={region} className="min-w-0"><Badge variant="neutral" size="sm">{region}</Badge><Code className="ml-2 break-all">{url}</Code></div>)
              : <Caption>—</Caption>}
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
    networkMode: 'always',
    mutationFn: (submittedDomain: string) => apiFetch('register-partner', 'POST', { domain: submittedDomain }),
  })

  const opensslGen = 'openssl ecparam -name prime256v1 -genkey -noout -out private.pem'
  const opensslPub = 'openssl ec -in private.pem -pubout -out public.pem'

  return (
    <ToolCard icon={Icons.globe} color="green" title={t('devtools.fleet.partnerReg', 'Partner reg')} description={t('devtools.fleet.partnerRegDesc', 'Partner reg desc')}>
      <div className="space-y-3">
        <GlassPanel className="border-[var(--semantic-warning-border)] bg-[var(--semantic-warning-bg)] p-3">
          <div className="flex items-start gap-2">
            <Icons.severityWarn className="mt-0.5 h-4 w-4 shrink-0 text-[var(--semantic-warning)]" />
            <div>
              <Caption>{t('devtools.fleet.prerequisites', 'Prerequisites')}</Caption>
              <HelperText className="mt-1">{t('devtools.fleet.prerequisitesDesc', 'Prerequisites desc')}</HelperText>
            </div>
          </div>
        </GlassPanel>

        <div className="space-y-2">
          <Caption>{t('devtools.fleet.opensslCommands', 'OpenSSL commands')}</Caption>
          <div className="space-y-1">
            <div className="flex items-center gap-2 rounded bg-[var(--surface-2)] px-3 py-1.5">
              <Code className="min-w-0 flex-1 break-all">{opensslGen}</Code>
              <CopyButton text={opensslGen} />
            </div>
            <div className="flex items-center gap-2 rounded bg-[var(--surface-2)] px-3 py-1.5">
              <Code className="min-w-0 flex-1 break-all">{opensslPub}</Code>
              <CopyButton text={opensslPub} />
            </div>
          </div>
        </div>

        <Input
          label={t('devtools.fleet.domain', 'Domain')}
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
          onClick={() => mutation.mutate(domain.trim())}
          icon={<Icons.play className="h-3.5 w-3.5" />}
        >
          {t('devtools.fleet.register', 'Register')}
        </Button>
        {(mutation.data || mutation.error) && (
          <ResultPanel
            title={t('devtools.fleet.partnerReg', 'Partner reg')}
            context={mutation.variables}
            data={mutation.data}
            error={resultError(mutation.error, mutation.data)}
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
    mutationFn: (submittedDomain: string) => apiFetch(`partner-public-key?domain=${encodeURIComponent(submittedDomain)}`),
  })

  const response = mutation.data ?? {}
  const verification = (response.verification ?? {}) as Record<string, unknown>
  const remoteFound = verification.remote_key_found === true
  const matchesLocal = verification.matches_local === true
  const localConfigured = verification.local_key_configured === true
  const publicKey = ((response.response as Record<string, unknown>)?.public_key as string) ?? ''

  return (
    <ToolCard icon={Icons.security} color="cyan" title={t('devtools.partnerKey.title', 'Public key verification')} description={t('devtools.partnerKey.desc', 'Verify your registered public key with Tesla')}>
      <div className="space-y-3">
        <Input
          label={t('devtools.fleet.domain', 'Domain')}
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
          onClick={() => mutation.mutate(domain.trim())}
          icon={<Icons.play className="h-3.5 w-3.5" />}
        >
          {t('devtools.partnerKey.verify', 'Verify')}
        </Button>

        {(mutation.data || mutation.error) && (
          <>
            {!resultError(mutation.error, mutation.data) && <div className="flex flex-wrap items-center gap-2">
              {remoteFound ? (
                <Badge variant="success" size="sm" dot>{t('devtools.partnerKey.keyRegistered', 'Key registered')}</Badge>
              ) : (
                <Badge variant="danger" size="sm" dot>{t('devtools.partnerKey.keyNotFound', 'Key not found')}</Badge>
              )}
              {remoteFound && localConfigured && (
                matchesLocal ? (
                  <Badge variant="success" size="sm" dot>{t('devtools.partnerKey.matchesLocal', 'Matches local key')}</Badge>
                ) : (
                  <Badge variant="warning" size="sm" dot>{t('devtools.partnerKey.mismatch', 'Does not match local key')}</Badge>
                )
              )}
              {remoteFound && !localConfigured && (
                <Badge variant="neutral" size="sm">{t('devtools.partnerKey.noLocal', 'No local key configured')}</Badge>
              )}
            </div>}

            {publicKey && (
              <div className="space-y-1">
                <Caption>{t('devtools.partnerKey.pemLabel', 'Registered PEM')}</Caption>
                <div className="rounded bg-[var(--surface-2)] p-3">
                  <Text as="pre" variant="code" className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                    {publicKey}
                  </Text>
                  <div className="mt-2 flex justify-end">
                    <CopyButton text={publicKey} />
                  </div>
                </div>
              </div>
            )}

            <ResultPanel
              title={t('devtools.partnerKey.rawResponse', 'Raw response')}
              context={mutation.variables}
              data={mutation.data}
              error={resultError(mutation.error, mutation.data)}
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
  const [confirmation, setConfirmation] = useState<'generate' | 'delete' | { pem: string } | null>(null)

  const { data: status, isLoading, error: keyError } = useQuery({
    queryKey: ['devtools', 'public-key-status'],
    queryFn: () => apiFetch('public-key-status'),
  })

  const generateMut = useMutation({
    networkMode: 'always',
    mutationFn: () => apiFetch('generate-keypair', 'POST'),
    onSuccess: (data) => { if (!data.error) queryClient.invalidateQueries({ queryKey: ['devtools', 'public-key-status'] }) },
  })

  const uploadMut = useMutation({
    networkMode: 'always',
    mutationFn: (submittedPem: string) => apiFetch('upload-public-key', 'POST', { public_key_pem: submittedPem }),
    onSuccess: (data, submittedPem) => {
      if (data.error) return
      queryClient.invalidateQueries({ queryKey: ['devtools', 'public-key-status'] })
      setPemInput((current) => current === submittedPem ? '' : current)
    },
  })

  const deleteMut = useMutation({
    networkMode: 'always',
    mutationFn: () => apiFetch('public-key', 'DELETE'),
    onSuccess: (data) => { if (!data.error) queryClient.invalidateQueries({ queryKey: ['devtools', 'public-key-status'] }) },
  })

  if (isLoading) return <GlassPanel className="p-5"><Skeleton lines={3} /></GlassPanel>
  if (keyError && !status) return <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>{t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(keyError)}</AlertBanner>

  const statusApiError = typeof status?.error === 'string' ? status.error : undefined
  if (statusApiError) return <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>{t('error.loadFailed', 'Failed to load data')}: {statusApiError}</AlertBanner>

  const configured = status?.configured === true
  const fingerprint = (status?.fingerprint as string) ?? ''
  const wellKnownPath = typeof status?.well_known_path === 'string' ? status.well_known_path : ''
  const keyWritePending = generateMut.isPending || deleteMut.isPending || uploadMut.isPending

  return (
    <ToolCard icon={Icons.key} color="purple" title={t('devtools.fleet.publicKey', 'Public key')} description={t('devtools.fleet.publicKeyDesc', 'Public key desc')}>
      {keyError && <AlertBanner variant="warning">{t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(keyError)}</AlertBanner>}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Caption>{t('common.status', 'Status')}:</Caption>
          {configured ? (
            <Badge variant="success" size="sm" dot>{t('devtools.fleet.configured', 'Configured')}</Badge>
          ) : (
            <Badge variant="warning" size="sm" dot>{t('devtools.fleet.notConfigured', 'Not configured')}</Badge>
          )}
        </div>

        {fingerprint && (
          <div className="flex items-center gap-2 rounded bg-[var(--surface-2)] px-3 py-1.5">
            <Icons.fingerprint className="h-4 w-4 text-[var(--text-secondary)]" />
            <Code className="break-all">{fingerprint}</Code>
            <CopyButton text={fingerprint} />
          </div>
        )}

        {wellKnownPath && (
          <div className="flex items-center gap-2 rounded bg-[var(--surface-2)] px-3 py-1.5">
            <Icons.link className="h-4 w-4 text-[var(--text-secondary)]" />
            <Code className="flex-1 break-all">{wellKnownPath}</Code>
            <CopyButton text={wellKnownPath} />
          </div>
        )}

        <GlassPanel className="border-[var(--semantic-warning-border)] bg-[var(--semantic-warning-bg)] p-3">
          <div className="flex items-start gap-2">
            <Icons.severityWarn className="mt-0.5 h-4 w-4 shrink-0 text-[var(--semantic-warning)]" />
            <Caption>{t('devtools.fleet.privateKeyWarning', 'Private key warning')}</Caption>
          </div>
        </GlassPanel>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={generateMut.isPending} disabled={keyWritePending} onClick={() => status?.configured === false ? generateMut.mutate() : setConfirmation('generate')} icon={<Icons.key className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.generateKeypair', 'Generate keypair')}
          </Button>
          <Button variant="danger" size="sm" loading={deleteMut.isPending} disabled={keyWritePending || !configured} onClick={() => setConfirmation('delete')} icon={<Icons.delete className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.deleteKeypair', 'Delete keypair')}
          </Button>
        </div>

        <ResultPanel title={t('devtools.fleet.generateKeypair', 'Generate keypair')} data={generateMut.data} error={resultError(generateMut.error, generateMut.data)} idle={!generateMut.data} idleMessage={t('devtools.keypairIdle', 'Generate or delete a keypair to see results')} />
        <ResultPanel title={t('devtools.fleet.deleteKeypair', 'Delete keypair')} data={deleteMut.data} error={resultError(deleteMut.error, deleteMut.data)} idle={!deleteMut.data} />

        <div className="space-y-2">
          <Textarea
            label={t('devtools.fleet.uploadPem', 'Upload PEM')}
            rows={4}
            placeholder={t('devtools.fleet.pemPlaceholder', "PEM placeholder")}
            value={pemInput}
            onChange={(e) => setPemInput(e.target.value)}
          />
          <Button variant="secondary" size="sm" loading={uploadMut.isPending} disabled={keyWritePending || !pemInput.trim()} onClick={() => status?.configured === false ? uploadMut.mutate(pemInput) : setConfirmation({ pem: pemInput })} icon={<Icons.upload className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.uploadKey', 'Upload key')}
          </Button>
          <ResultPanel title={t('devtools.fleet.uploadKey', 'Upload key')} data={uploadMut.data} error={resultError(uploadMut.error, uploadMut.data)} idle={!uploadMut.data} idleMessage={t('devtools.uploadIdle', 'Upload a public key to see results')} />
        </div>
        <ConfirmDialog
          open={confirmation !== null}
          title={confirmation === 'delete' ? t('devtools.fleet.deleteKeypair', 'Delete keypair') : confirmation === 'generate' ? t('devtools.fleet.generateKeypair', 'Generate keypair') : t('devtools.fleet.uploadKey', 'Upload key')}
          message={confirmation === 'delete' ? t('devtools.fleet.confirmDeleteKey', 'Delete the configured public key for this TeslaSync installation? Existing vehicle key pairing may stop working.') : t('devtools.fleet.confirmReplaceKey', 'Replace the configured public key for this TeslaSync installation? Existing vehicle key pairing may need to be repeated.')}
          details={fingerprint ? <Code>{fingerprint}</Code> : undefined}
          confirmLabel={t('common.confirm', 'Confirm')}
          cancelLabel={t('common.cancel', 'Cancel')}
          confirmDisabled={keyWritePending}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            if (keyWritePending) return
            if (confirmation === 'delete') deleteMut.mutate()
            else if (confirmation === 'generate') generateMut.mutate()
            else if (confirmation) uploadMut.mutate(confirmation.pem)
            setConfirmation(null)
          }}
        />
      </div>
    </ToolCard>
  )
}

/* ─── Vehicle Key Pairing Tool ────────────────────────────────────────── */

function VehicleKeyPairingTool() {
  const { t } = useTranslation()
  const { isPending, error } = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
  })

  return (
    <ToolCard icon={Icons.vehicle} color="green" title={t('devtools.fleet.keyPairing', 'Key pairing')} description={t('devtools.fleet.keyPairingDesc', 'Key pairing desc')}>
      <div className="space-y-3">
        <HelperText>{isPending ? t('common.loading', 'Loading...') : t('devtools.fleet.pairingHostUnknown', 'Pairing link unavailable: the configured application hostname is not provided by Fleet API info.')}</HelperText>
        {error && <AlertBanner variant="danger">{getErrorMessage(error)}</AlertBanner>}
        <div className="rounded-lg bg-[var(--surface-2)] p-3">
          <HelperText>{t('devtools.fleet.pairingInstructions', 'Pairing instructions')}</HelperText>
          <ul className={cn('mt-2 space-y-1', typography.role.helper)}>
            <li className="flex items-start gap-2">
              <Icons.next className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-secondary)]" />
              <span>{t('devtools.fleet.pairingStep1', "Pairing Step1")}</span>
            </li>
            <li className="flex items-start gap-2">
              <Icons.next className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-secondary)]" />
              <span>{t('devtools.fleet.pairingStep2', "Pairing Step2")}</span>
            </li>
            <li className="flex items-start gap-2">
              <Icons.next className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-secondary)]" />
              <span>{t('devtools.fleet.pairingStep3', "Pairing Step3")}</span>
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
  const selectedVehicle = vehicleOptions.some((option) => option.value === vin)
  const validPort = port.trim() === '' || (/^\d+$/.test(port) && Number(port) >= 0 && Number(port) <= 65535)
  const validInterval = Number.isInteger(interval) && interval >= 0 && interval <= 86400

  const subscribeMut = useMutation({
    networkMode: 'always',
    mutationFn: (submission: { vin: string; hostname: string; port: number; ca: string; signals: typeof selectedSignals; interval: number }) =>
      apiFetch('fleet-telemetry-subscribe', 'POST', {
        vins: [submission.vin],
        hostname: submission.hostname,
        port: submission.port,
        ca: submission.ca || undefined,
        fields: submission.signals.length > 0 ? submission.signals.map((s) => s.name) : undefined,
        interval_seconds: submission.interval,
        field_intervals: submission.signals.length > 0
          ? Object.fromEntries(submission.signals.filter((s) => s.interval !== submission.interval).map((s) => [s.name, s.interval]))
          : undefined,
      }),
    onSuccess: (data) => { if (!data.error) queryClient.invalidateQueries({ queryKey: ['devtools'] }) },
  })

  return (
    <ToolCard icon={Icons.radio} color="cyan" title={t('devtools.fleet.telemetrySub', 'Telemetry sub')} description={t('devtools.fleet.telemetrySubDesc', 'Telemetry sub desc')}>
      <div className="space-y-3">
        <Select
          label={t('common.vehicle', 'Vehicle')}
          placeholder={t('timeline.selectVehicle', 'Select vehicle')}
          options={vehicleOptions}
          value={vin}
          onChange={(e) => setVin(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t('devtools.fleet.hostname', 'Hostname')}
            placeholder="telemetry.example.com"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            icon={<Icons.server className="h-4 w-4" />}
          />
          <Input
            label={t('devtools.fleet.port', 'Port')}
            placeholder="443"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            error={!validPort ? t('devtools.fleet.portInvalid', 'Use an integer port from 1 to 65535, or leave it blank or 0 for the server default.') : undefined}
            icon={<Icons.network className="h-4 w-4" />}
          />
        </div>
        <div>
          <Textarea
            label={t('devtools.fleet.caCert', 'CA cert')}
            rows={3}
            placeholder={t('devtools.fleet.caCertPlaceholder', "CA cert placeholder")}
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
            {t('devtools.fleet.configureSignals', 'Configure signals')} ({selectedSignals.length})
          </Button>
          <Caption>
            {t('devtools.fleet.intervalLabel', 'Interval label')}: {interval}s
          </Caption>
        </div>
        <HelperText>{t('devtools.fleet.serverDefaults', 'A blank hostname or blank/0 port uses the server configuration; the configured hostname is not available in this view.')}</HelperText>
        {!selectedVehicle && <HelperText>{t('timeline.selectVehicle', 'Select vehicle')}</HelperText>}
        <Button
          variant="primary"
          size="sm"
          loading={subscribeMut.isPending}
          disabled={!selectedVehicle || !validPort || !validInterval}
          onClick={() => {
            if (!selectedVehicle || !validPort || !validInterval) return
            subscribeMut.mutate({ vin, hostname: hostname.trim(), port: Number(port), ca: caCert, signals: selectedSignals, interval })
          }}
          icon={<Icons.play className="h-3.5 w-3.5" />}
        >
          {t('devtools.fleet.subscribe', 'Subscribe')}
        </Button>
        {(subscribeMut.data || subscribeMut.error) && (
          <ResultPanel
            title={t('devtools.fleet.telemetrySub', 'Telemetry sub')}
            context={subscribeMut.variables?.vin}
            data={subscribeMut.data}
            error={resultError(subscribeMut.error, subscribeMut.data)}
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
  const [deleteVin, setDeleteVin] = useState<string | null>(null)

  const { options: vehicleOptions } = useVehicleOptions()

  const configQuery = useMutation({ mutationFn: (submittedVin: string) => apiFetch(`fleet-telemetry-config?vin=${encodeURIComponent(submittedVin)}`) })
  const errorsQuery = useMutation({ mutationFn: (submittedVin: string) => apiFetch(`fleet-telemetry-errors?vin=${encodeURIComponent(submittedVin)}`) })
  const deleteMut = useMutation({ networkMode: 'always', mutationFn: (submittedVin: string) => apiFetch(`fleet-telemetry-config?vin=${encodeURIComponent(submittedVin)}`, 'DELETE') })

  // Keep rejected transport failures separate from unrecognized Tesla payloads.
  const errorsApiError = resultError(errorsQuery.error, errorsQuery.data)
  const { errors: errorData, ok: errorsOk } = useMemo(
    () => (errorsApiError ? { errors: [], ok: false } : extractTelemetryErrors(errorsQuery.data)),
    [errorsQuery.data, errorsApiError],
  )

  const errorColumns: Column<TelemetryError>[] = useMemo(() => [
    {
      key: 'timestamp',
      filterValue: (r) => r.timestamp ?? null,
      filterValueLabel: (_value, r) => r.timestamp ? formatDateTime(r.timestamp) : '—',
      header: t('common.timestamp', 'Timestamp'),
      render: (r) => (
        <Caption>{r.timestamp ? formatDateTime(r.timestamp) : '—'}</Caption>
      ),
    },
    {
      key: 'code',
      filterValue: (r) => r.code || null,
      header: t('devtools.fleet.code', 'Code'),
      render: (r) => (r.code ? <Badge variant="danger" size="sm">{r.code}</Badge> : <Caption>—</Caption>),
    },
    {
      key: 'message',
      filterValue: (r) => r.message || null,
      header: t('devtools.fleet.message', 'Message'),
      render: (r) => (
        <Caption>{r.message || '—'}</Caption>
      ),
    },
  ], [t])

  const vinSelected = vehicleOptions.some((option) => option.value === vin)
  const errorsRequested = errorsQuery.status !== 'idle'
  const resetSelection = (nextVin: string) => {
    if (deleteMut.isPending) return
    configQuery.reset()
    errorsQuery.reset()
    deleteMut.reset()
    setDeleteVin(null)
    setVin(nextVin)
  }

  return (
    <ToolCard icon={Icons.satellite} color="purple" title={t('devtools.fleet.telemetryConfig', 'Telemetry config')} description={t('devtools.fleet.telemetryConfigDesc', 'Telemetry config desc')}>
      <div className="space-y-3">
        <Select
          label={t('common.vehicle', 'Vehicle')}
          placeholder={t('timeline.selectVehicle', 'Select vehicle')}
          options={vehicleOptions}
          value={vin}
          onChange={(e) => resetSelection(e.target.value)}
          disabled={deleteMut.isPending}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={!vinSelected} loading={configQuery.isPending} onClick={() => configQuery.mutate(vin)} icon={<Icons.show className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.getConfig', 'Get config')}
          </Button>
          <Button variant="secondary" size="sm" disabled={!vinSelected} loading={errorsQuery.isPending} onClick={() => errorsQuery.mutate(vin)} icon={<Icons.severityWarn className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.viewErrors', 'View errors')}
          </Button>
          <Button variant="danger" size="sm" disabled={!vinSelected} loading={deleteMut.isPending} onClick={() => setDeleteVin(vin)} icon={<Icons.delete className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.deleteConfig', 'Delete config')}
          </Button>
        </div>
        <ResultPanel title={t('devtools.fleet.telemetryConfig', 'Telemetry config')} context={configQuery.variables} data={configQuery.data} error={resultError(configQuery.error, configQuery.data)} idle={!configQuery.data} idleMessage={t('devtools.configIdle', 'Fetch config to see results')} />
        <ResultPanel title={t('devtools.fleet.deleteConfig', 'Delete config')} context={deleteMut.variables} data={deleteMut.data} error={resultError(deleteMut.error, deleteMut.data)} idle={!deleteMut.data} />
        {/* Errors panel — has FOUR distinct render states; before this
            fix only state (4) rendered, so loading / error / empty all
            looked identical to "button did nothing". */}
        <TelemetryErrorsPanel
          title={errorsQuery.variables ? `${t('devtools.fleet.telemetryErrors', 'Telemetry errors')} · ${errorsQuery.variables}` : t('devtools.fleet.telemetryErrors', 'Telemetry errors')}
          loading={errorsQuery.isPending}
          error={errorsApiError}
          requested={errorsRequested}
          ok={errorsOk}
          errors={errorData}
          columns={errorColumns}
          vin={errorsQuery.variables ?? ''}
          idleMessage={t('devtools.errorsIdle', 'Click View Errors to fetch recent Fleet Telemetry errors for this vehicle.')}
          emptyMessage={t('devtools.errorsEmpty', 'No Fleet Telemetry errors reported for this vehicle.')}
          rawData={errorsQuery.data}
          rawDisclosureLabel={t('devtools.errorsRaw', 'Show raw Tesla response')}
          downloadLabel={t('devtools.fleet.downloadErrors', 'Download errors')}
        />
        <ConfirmDialog
          open={deleteVin !== null}
          title={t('devtools.fleet.deleteConfig', 'Delete config')}
          message={t('devtools.fleet.confirmDeleteConfig', 'Delete Fleet Telemetry configuration for {{vin}}? This stops its telemetry subscription.', { vin: deleteVin })}
          confirmLabel={t('common.confirm', 'Confirm')}
          cancelLabel={t('common.cancel', 'Cancel')}
          confirmDisabled={deleteMut.isPending || deleteVin !== vin || !vinSelected}
          onCancel={() => setDeleteVin(null)}
          onConfirm={() => {
            if (deleteVin && deleteVin === vin && vinSelected && !deleteMut.isPending) deleteMut.mutate(deleteVin)
            setDeleteVin(null)
          }}
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
    networkMode: 'always',
    mutationFn: (submittedVins: string[]) => apiFetch('fleet-status', 'POST', { vins: submittedVins }),
  })

  return (
    <ToolCard icon={Icons.charging} color="green" title={t('devtools.fleet.fleetStatus', 'Fleet status')} description={t('devtools.fleet.fleetStatusDesc', 'Check fleet status for all vehicles')}>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={fleetStatusMut.isPending}
          onClick={() => fleetStatusMut.mutate(vehicles.map((v) => v.vin))}
          disabled={vehicles.length === 0}
          icon={<Icons.play className="h-3.5 w-3.5" />}
        >
          {t('devtools.fleet.checkFleetStatus', 'Check fleet status')}
        </Button>
      </div>
      {(fleetStatusMut.data || fleetStatusMut.error) && (
        <ResultPanel
          title={t('devtools.fleet.fleetStatus', 'Fleet status')}
          context={fleetStatusMut.variables?.join(', ')}
          data={fleetStatusMut.data}
          error={resultError(fleetStatusMut.error, fleetStatusMut.data)}
        />
      )}
    </ToolCard>
  )
}

/* ─── Vehicle Data Tools ──────────────────────────────────────────────── */

type VehicleDataAction = 'charging' | 'releaseNotes' | 'alerts' | 'service'

function VehicleDataTools() {
  const { t } = useTranslation()
  const [vin, setVin] = useState('')
  // Track the last-invoked action so the result panel reflects the most
  // recent click. The previous `charging ?? releaseNotes ?? …` chain always
  // surfaced the first-populated mutation, so once any button had run a later
  // action's result was silently swallowed.
  const [activeAction, setActiveAction] = useState<VehicleDataAction | null>(null)
  const { options: vehicleOptions } = useVehicleOptions()

  const chargingMut = useMutation({ mutationFn: (submittedVin: string) => apiFetch(`nearby-charging?vin=${encodeURIComponent(submittedVin)}`) })
  const releaseNotesMut = useMutation({ mutationFn: (submittedVin: string) => apiFetch(`release-notes?vin=${encodeURIComponent(submittedVin)}`) })
  const alertsMut = useMutation({ mutationFn: (submittedVin: string) => apiFetch(`recent-alerts?vin=${encodeURIComponent(submittedVin)}`) })
  const serviceMut = useMutation({ mutationFn: (submittedVin: string) => apiFetch(`service-data?vin=${encodeURIComponent(submittedVin)}`) })
  const vinSelected = vehicleOptions.some((option) => option.value === vin)
  const resetSelection = (nextVin: string) => {
    chargingMut.reset()
    releaseNotesMut.reset()
    alertsMut.reset()
    serviceMut.reset()
    setActiveAction(null)
    setVin(nextVin)
  }

  const activeMutation =
    activeAction === 'charging' ? chargingMut
      : activeAction === 'releaseNotes' ? releaseNotesMut
        : activeAction === 'alerts' ? alertsMut
          : activeAction === 'service' ? serviceMut
            : null
  const lastResult = activeMutation?.data
  const actionError = resultError(activeMutation?.error, lastResult)
  const actionLabel = activeAction === 'charging' ? t('devtools.fleet.nearbyCharging', 'Nearby charging')
    : activeAction === 'releaseNotes' ? t('devtools.fleet.releaseNotes', 'Release notes')
      : activeAction === 'alerts' ? t('devtools.fleet.recentAlerts', 'Recent alerts')
        : activeAction === 'service' ? t('devtools.fleet.serviceData', 'Service data') : ''

  return (
    <ToolCard icon={Icons.vehicle} color="cyan" title={t('devtools.fleet.vehicleData', 'Vehicle data')} description={t('devtools.fleet.vehicleDataDesc', 'Vehicle data desc')}>
      <div className="space-y-3">
        <Select
          label={t('common.vehicle', 'Vehicle')}
          placeholder={t('timeline.selectVehicle', 'Select vehicle')}
          options={vehicleOptions}
          value={vin}
          onChange={(e) => resetSelection(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={!vinSelected} loading={chargingMut.isPending} onClick={() => { setActiveAction('charging'); chargingMut.mutate(vin) }} icon={<Icons.location className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.nearbyCharging', 'Nearby charging')}
          </Button>
          <Button variant="secondary" size="sm" disabled={!vinSelected} loading={releaseNotesMut.isPending} onClick={() => { setActiveAction('releaseNotes'); releaseNotesMut.mutate(vin) }} icon={<Icons.fileText className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.releaseNotes', 'Release notes')}
          </Button>
          <Button variant="secondary" size="sm" disabled={!vinSelected} loading={alertsMut.isPending} onClick={() => { setActiveAction('alerts'); alertsMut.mutate(vin) }} icon={<Icons.severityWarn className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.recentAlerts', 'Recent alerts')}
          </Button>
          <Button variant="secondary" size="sm" disabled={!vinSelected} loading={serviceMut.isPending} onClick={() => { setActiveAction('service'); serviceMut.mutate(vin) }} icon={<Icons.maintenance className="h-3.5 w-3.5" />}>
            {t('devtools.fleet.serviceData', 'Service data')}
          </Button>
        </div>
        <ResultPanel
          title={actionLabel || t('devtools.fleet.vehicleData', 'Vehicle data')}
          context={activeMutation?.variables}
          data={lastResult}
          error={actionError}
          idle={!lastResult}
          idleMessage={t('devtools.vehicleDataIdle', 'Choose a vehicle and an action to see results.')}
        />
      </div>
    </ToolCard>
  )
}

/* ─── Onboarding Workflow ─────────────────────────────────────────────── */

function OnboardingWorkflow() {
  const { fmtInt } = useNumberFormatting();
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
    if (fleetInfo?.has_valid_token === true) autoDetected.auth = true
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

  const keyStatusApiError = typeof keyStatus?.error === 'string' ? keyStatus.error : undefined
  const fleetInfoApiError = typeof fleetInfo?.error === 'string' ? fleetInfo.error : undefined
  const onboardingError = [keyStatusError, fleetInfoError, keyStatusApiError, fleetInfoApiError].find(Boolean)

  return (
    <div className="space-y-4">
      {onboardingError && (
        <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(onboardingError)}
        </AlertBanner>
      )}

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Caption>{t('devtools.fleet.progress', 'Progress')}</Caption>
          <Caption>{fmtInt(completedCount)} / {fmtInt(ONBOARDING_STEPS.length)} ({fmtInt(progressPct)}%)</Caption>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-glass-border">
          <div
            className="h-full rounded-full bg-[var(--semantic-info)] transition-all duration-slow motion-reduce:transition-none"
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
            role="button"
            tabIndex={0}
            aria-current={i === currentStep ? 'step' : undefined}
            aria-label={t('devtools.onboarding.goToStep', 'Go to step {{step}}: {{label}}', { step: i + 1, label: t(s.labelKey, s.label) })}
            onClick={() => setCurrentStep(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setCurrentStep(i)
              }
            }}
            className="cursor-pointer"
          >
            {t(s.labelKey, s.label)}
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
            <PanelTitle>
              {t('devtools.onboarding.stepLabel', 'Step {{step}}', { step: currentStep + 1 })}: {t(step.labelKey, step.label)}
            </PanelTitle>
            <HelperText>{t(step.descKey, step.desc)}</HelperText>
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
            {t('common.previous', 'Previous')}
          </Button>
          <Button
            variant={completed[step.id] ? 'secondary' : 'primary'}
            size="sm"
            onClick={markComplete}
            icon={<Icons.success className="h-3.5 w-3.5" />}
          >
            {completed[step.id] ? t('devtools.fleet.completed', 'Completed') : t('devtools.fleet.markComplete', 'Mark complete')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={currentStep === ONBOARDING_STEPS.length - 1}
            onClick={() => setCurrentStep(currentStep + 1)}
            icon={<Icons.forward className="h-3.5 w-3.5" />}
          >
            {t('common.next', 'Next')}
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
        <SectionTitle>{t('devtools.fleet.setupWizard', 'Setup wizard')}</SectionTitle>
        <OnboardingWorkflow />
      </div>

      {/* Fleet API tool grid */}
      <div className="space-y-2">
        <SectionTitle>{t('devtools.fleet.toolsTitle', 'Fleet API tools')}</SectionTitle>
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
