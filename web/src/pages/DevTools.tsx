import { useState, useMemo, useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Wrench, Globe, KeyRound, CheckCircle, XCircle, AlertTriangle,
  Loader2, Copy, ExternalLink, Server, Shield, Database, GitBranch,
  Radio, Settings, Cpu, Car, Key, Clock, FileCode, Link, Braces,
  Fingerprint, Hash, HardDrive, Palette, Timer, Network, BookOpen,
  Regex, Lock, ChevronDown, ChevronRight, Play, RefreshCw,
  Download, Upload, Trash2, Satellite, Eye, Zap, ListChecks, ArrowRight, ArrowLeft,
  MapPin, FileText,
} from 'lucide-react'
import { PageHeader, GlassPanel, Badge, Button, Input, Select, DataTable, type Column } from '../components/ui'
import { getApiBase } from '../lib/resilience'
import clsx from 'clsx'
import { formatDate, formatDateTime } from '../lib/dateFormat'
import SignalConfigModal from '../components/SignalConfigModal'
import { motion } from 'framer-motion'
import { usePageTitle } from '../hooks/usePageTitle'

// ─── Shared helpers ──────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} aria-label="Copy to clipboard" title="Copy" className="!p-1 !rounded">
      {copied ? <CheckCircle className="h-3.5 w-3.5 text-neon-green" /> : <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
    </Button>
  )
}

function ResultPanel({ title, data, error }: { title: string; data: unknown; error?: string }) {
  const isError = error || (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>))
  return (
    <div className={clsx('mt-4 p-4 rounded-xl border', isError ? 'bg-neon-red/5 border-neon-red/20' : 'bg-neon-green/5 border-neon-green/20')}>
      <div className="flex items-center gap-2 mb-2">
        {isError ? <XCircle className="h-4 w-4 text-neon-red" /> : <CheckCircle className="h-4 w-4 text-neon-green" />}
        <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      </div>
      <pre className="text-xs font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap break-all">
        {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

/** Collapsible accordion section matching System Status style. */
function AccordionSection({ icon, title, description, badges, children, isOpen, onToggle }: {
  icon: React.ReactNode
  title: string
  description: string
  badges?: React.ReactNode
  children: React.ReactNode
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 pt-6 pb-2 group cursor-pointer select-none"
      >
        <div className="flex items-center gap-2.5 shrink-0">
          {icon}
          <h2 className="text-base font-bold text-[var(--text-primary)]">{title}</h2>
        </div>
        {!isOpen && badges && <div className="flex items-center gap-2 shrink-0">{badges}</div>}
        <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider shrink-0 hidden sm:block">{description}</p>
        <ChevronDown className={clsx('h-4 w-4 text-[var(--text-muted)] transition-transform duration-200 shrink-0', isOpen && 'rotate-180')} />
      </button>
      <motion.div
        initial={false}
        animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
        className="overflow-hidden"
      >
        <div className="space-y-4 pb-2">
          {children}
        </div>
      </motion.div>
    </div>
  )
}

function StatusBadge({ color, label }: { color: 'green' | 'amber' | 'red' | 'gray' | 'cyan' | 'purple'; label: string }) {
  const badgeColor = color === 'gray' ? 'neutral' as const : color
  return <Badge color={badgeColor}>{label}</Badge>
}

function ToolCard({
  icon: Icon,
  color,
  title,
  description,
  children,
}: {
  icon: React.ElementType
  color: string
  title: string
  description: string
  children: React.ReactNode
}) {
  const colorMap: Record<string, string> = {
    cyan: 'bg-neon-cyan/10 text-neon-cyan ring-1 ring-neon-cyan/20',
    green: 'bg-neon-green/10 text-neon-green ring-1 ring-neon-green/20',
    purple: 'bg-neon-purple/10 text-neon-purple ring-1 ring-neon-purple/20',
    amber: 'bg-neon-amber/10 text-neon-amber ring-1 ring-neon-amber/20',
    red: 'bg-neon-red/10 text-neon-red ring-1 ring-neon-red/20',
  }
  return (
    <GlassPanel className="p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={clsx('flex h-8 w-8 items-center justify-center rounded-lg shrink-0', colorMap[color] || colorMap.cyan)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="text-[10px] text-[var(--text-muted)]">{description}</p>
        </div>
      </div>
      {children}
    </GlassPanel>
  )
}

const textareaClasses= 'w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-neon-cyan/40 font-mono resize-y min-h-[80px]'

// ─── Backend API helpers ─────────────────────────────────────────

async function apiFetch(endpoint: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${getApiBase()}/api/v1/dev-tools/${endpoint}`, opts)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: `Unexpected response (HTTP ${res.status})`, details: text.substring(0, 500) }
  }
}

// ─── Backend tool: generic "Run" button pattern ──────────────────

function BackendTool({
  icon,
  color,
  title,
  description,
  endpoint,
  method = 'GET',
  bodyBuilder,
  children,
}: {
  icon: React.ElementType
  color: string
  title: string
  description: string
  endpoint: string
  method?: 'GET' | 'POST' | 'DELETE'
  bodyBuilder?: () => unknown
  children?: React.ReactNode
}) {
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const mut = useMutation({
    mutationFn: () => apiFetch(endpoint, method, bodyBuilder?.()),
    onSuccess: (data: Record<string, unknown>) => setResult(data),
    onError: (err) => setResult({ error: (err as Error).message }),
  })
  return (
    <ToolCard icon={icon} color={color} title={title} description={description}>
      {children}
      <Button variant="secondary" size="sm" onClick={() => mut.mutate()} loading={mut.isPending} icon={<Play className="h-3.5 w-3.5" />} className="mt-3">
        Run
      </Button>
      {result !== null && <ResultPanel title={`${title} Result`} data={result} />}
    </ToolCard>
  )
}

// ─── Section 1: Tesla Fleet API ──────────────────────────────────

function FleetApiConfigTool() {
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const run = async () => {
    setLoading(true)
    try {
      const data = await apiFetch('fleet-api-info')
      setResult(data)
    } catch (e) {
      setResult({ error: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }
  return (
    <ToolCard icon={Server} color="cyan" title="Fleet API Configuration" description="Current Tesla Fleet API setup — base URL, client ID, auth status, active region">
      <Button variant="secondary" size="sm" onClick={run} loading={loading} icon={<Play className="h-3.5 w-3.5" />}>
        Load Config
      </Button>
      {result && !('error' in result) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {[
            { label: 'Base URL', value: result.base_url as string },
            { label: 'Client ID', value: (result.client_id as string) || '(not set)' },
          ].map(({ label, value }) => (
            <GlassPanel key={label} className="p-3">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">{label}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs font-mono text-[var(--text-primary)] truncate flex-1">{value}</p>
                {value !== '(not set)' && <CopyButton text={value} />}
              </div>
            </GlassPanel>
          ))}
          <GlassPanel className="p-3">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Auth Status</p>
            <div className="flex items-center gap-2">
              {result.has_valid_token ? (
                <><CheckCircle className="h-4 w-4 text-neon-green" /><span className="text-xs text-neon-green">Authenticated</span></>
              ) : (
                <><AlertTriangle className="h-4 w-4 text-neon-amber" /><span className="text-xs text-neon-amber">Not Connected</span></>
              )}
            </div>
          </GlassPanel>
          {typeof result.regions === 'object' && result.regions !== null && (
            <GlassPanel className="p-3">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Regions</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {Object.entries(result.regions as Record<string, string>).map(([key, url]) => (
                  <span key={key} className={clsx(
                    'px-2 py-0.5 text-[10px] font-semibold rounded uppercase',
                    result.base_url === url ? 'bg-neon-green/10 text-neon-green ring-1 ring-neon-green/20' : 'bg-white/[0.05] text-[var(--text-muted)]'
                  )}>
                    {key}{result.base_url === url ? ' ✓' : ''}
                  </span>
                ))}
              </div>
            </GlassPanel>
          )}
        </div>
      ) : result ? (
        <ResultPanel title="Fleet API Configuration" data={result} />
      ) : null}
    </ToolCard>
  )
}

function PartnerRegistrationTool() {
  const [domain, setDomain] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const mut = useMutation({
    mutationFn: () => apiFetch('register-partner', 'POST', { domain }),
    onSuccess: (data: Record<string, unknown>) => setResult(data),
    onError: (err) => setResult({ error: (err as Error).message }),
  })
  return (
    <ToolCard icon={Shield} color="purple" title="Partner Registration" description="Register your app domain as a Tesla partner">
      <div className="p-3 rounded-xl bg-neon-amber/5 border border-neon-amber/20 mb-3">
        <p className="text-xs text-neon-amber font-semibold mb-1.5 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> Prerequisites
        </p>
        <ul className="text-[10px] text-[var(--text-secondary)] space-y-1 ml-4 list-disc">
          <li>Tesla Developer account with Client ID &amp; Secret</li>
          <li>Public key at <code className="text-neon-cyan">https://DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem</code></li>
        </ul>
      </div>
        <GlassPanel className="p-3 mb-3">
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Generate Key Pair</p>
        {[
          'openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem',
          'openssl ec -in private-key.pem -pubout -out public-key.pem',
        ].map(cmd => (
          <div key={cmd} className="flex items-center gap-2 mt-1.5">
            <code className="text-[10px] text-[var(--text-secondary)] bg-white/[0.03] px-2 py-1 rounded flex-1 font-mono">{cmd}</code>
            <CopyButton text={cmd} />
          </div>
        ))}
      </GlassPanel>
      <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">Your Domain</label>
      <div className="flex gap-3">
        <Input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="teslasync.yourdomain.com" className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => mut.mutate()} disabled={!domain} loading={mut.isPending} icon={<KeyRound className="h-3.5 w-3.5" />} className="shrink-0">
          Register
        </Button>
      </div>
      {result !== null && <ResultPanel title="Partner Registration Result" data={result} />}
    </ToolCard>
  )
}

function PublicKeySetupTool() {
  const queryClient = useQueryClient()
  const [uploadPem, setUploadPem] = useState('')
  const [showPrivateKey, setShowPrivateKey] = useState<string | null>(null)
  const [showPublicKeyPem, setShowPublicKeyPem] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ ok: boolean; message: string } | null>(null)

  const wellKnownUrl = `${window.location.origin}/.well-known/appspecific/com.tesla.3p.public-key.pem`

  const { data: status, isLoading } = useQuery<{
    configured: boolean
    fingerprint?: string
    created_at?: string
    well_known_path: string
    public_key_pem?: string
  }>({
    queryKey: ['public-key-status'],
    queryFn: () => apiFetch('public-key-status'),
  })

  const generateMut = useMutation({
    mutationFn: () => apiFetch('generate-keypair', 'POST'),
    onSuccess: (data: { private_key_pem: string }) => {
      setShowPrivateKey(data.private_key_pem)
      queryClient.invalidateQueries({ queryKey: ['public-key-status'] })
    },
  })

  const uploadMut = useMutation({
    mutationFn: () => apiFetch('upload-public-key', 'POST', { public_key_pem: uploadPem }),
    onSuccess: (data: Record<string, unknown>) => {
      if (data.error) {
        setUploadResult({ ok: false, message: data.error as string })
      } else {
        setUploadResult({ ok: true, message: 'Public key uploaded successfully' })
        setUploadPem('')
        queryClient.invalidateQueries({ queryKey: ['public-key-status'] })
      }
    },
    onError: (err) => setUploadResult({ ok: false, message: (err as Error).message }),
  })

  const deleteMut = useMutation({
    mutationFn: () => apiFetch('public-key', 'DELETE'),
    onSuccess: () => {
      setConfirmDelete(false)
      setShowPrivateKey(null)
      queryClient.invalidateQueries({ queryKey: ['public-key-status'] })
    },
  })

  const downloadPrivateKey = (pem: string) => {
    const blob = new Blob([pem], { type: 'application/x-pem-file' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tesla-private-key.pem'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <ToolCard icon={Shield} color="green" title="Public Key Setup" description="Configure the EC public key required for Tesla partner registration">
      {/* Status */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading key status…
        </div>
      ) : status?.configured ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-neon-green/10 text-neon-green ring-1 ring-neon-green/20">
              <CheckCircle className="h-3 w-3" /> Configured
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {status.fingerprint && (
              <GlassPanel className="p-2.5">
                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Fingerprint</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xs font-mono text-[var(--text-primary)] truncate">{status.fingerprint.substring(0, 24)}…</p>
                  <CopyButton text={status.fingerprint} />
                </div>
              </GlassPanel>
            )}
            {status.created_at && (
              <GlassPanel className="p-2.5">
                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Created</p>
                <p className="text-xs font-mono text-[var(--text-primary)] mt-0.5">{formatDate(status.created_at)}</p>
              </GlassPanel>
            )}
          </div>

          {/* Well-Known URL */}
          <GlassPanel className="p-2.5">
            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Well-Known URL</p>
            <div className="flex items-center gap-2">
              <code className="text-[10px] text-neon-cyan font-mono truncate flex-1">{wellKnownUrl}</code>
              <CopyButton text={wellKnownUrl} />
              <a href={wellKnownUrl} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-white/10 transition-colors" title="Test URL">
                <ExternalLink className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              </a>
            </div>
          </GlassPanel>

          {/* Collapsible Public Key PEM */}
          {status.public_key_pem && (
            <div>
              <Button variant="ghost" size="sm" icon={showPublicKeyPem ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} onClick={() => setShowPublicKeyPem(!showPublicKeyPem)}>
                {showPublicKeyPem ? 'Hide' : 'Show'} Public Key PEM
              </Button>
              {showPublicKeyPem && (
                <GlassPanel className="mt-2 p-3 relative">
                  <div className="absolute top-2 right-2"><CopyButton text={status.public_key_pem} /></div>
                  <pre className="text-[10px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all">{status.public_key_pem}</pre>
                </GlassPanel>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-neon-amber/5 border border-neon-amber/20">
          <p className="text-xs text-neon-amber font-semibold mb-1.5 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> No Public Key Configured
          </p>
          <p className="text-[10px] text-[var(--text-secondary)]">
            Tesla requires a public key for partner registration. Generate a new keypair below, or upload an existing public key.
          </p>
        </div>
      )}

      {/* Private Key Warning (after generation) */}
      {showPrivateKey && (
        <div className="mt-4 p-4 rounded-xl bg-neon-red/10 border-2 border-neon-red/40">
          <p className="text-sm font-bold text-neon-red flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5" /> Save This Now — It Won't Be Shown Again
          </p>
          <pre className="text-[10px] font-mono text-[var(--text-primary)] bg-black/30 p-3 rounded-lg whitespace-pre-wrap break-all mb-3">{showPrivateKey}</pre>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadPrivateKey(showPrivateKey)}
              className="bg-neon-green/20 text-neon-green ring-1 ring-neon-green/30 hover:bg-neon-green/30"
              icon={<Download className="h-4 w-4" />}
            >
              Download Private Key
            </Button>
            <CopyButton text={showPrivateKey} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-4">
        <Button variant="secondary" size="sm" onClick={() => generateMut.mutate()} loading={generateMut.isPending} icon={<KeyRound className="h-3.5 w-3.5" />}>
          Generate Keypair
        </Button>

        {status?.configured && !confirmDelete && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            icon={<Trash2 className="h-3.5 w-3.5" />}
          >
            Delete Key
          </Button>
        )}
        {confirmDelete && (
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => deleteMut.mutate()}
              loading={deleteMut.isPending}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Confirm Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </div>
        )}
      </div>

      {generateMut.isError && (
        <ResultPanel title="Generation Error" data={{ error: (generateMut.error as Error).message }} error={(generateMut.error as Error).message} />
      )}

      {/* Upload existing key */}
      <div className="mt-4 pt-4 border-t border-white/[0.06]">
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">Upload Existing Public Key</p>
        <textarea
          value={uploadPem}
          onChange={e => setUploadPem(e.target.value)}
          placeholder="-----BEGIN PUBLIC KEY-----&#10;MFkwEwYHKoZIzj0C...&#10;-----END PUBLIC KEY-----"
          className={textareaClasses}
          rows={4}
        />
        <Button variant="secondary" size="sm" onClick={() => uploadMut.mutate()} disabled={!uploadPem.trim()} loading={uploadMut.isPending} icon={<Upload className="h-3.5 w-3.5" />} className="mt-2">
          Upload Public Key
        </Button>
        {uploadResult && (
          <div className={clsx('mt-2 p-3 rounded-xl border text-xs', uploadResult.ok ? 'bg-neon-green/5 border-neon-green/20 text-neon-green' : 'bg-neon-red/5 border-neon-red/20 text-neon-red')}>
            <div className="flex items-center gap-1.5">
              {uploadResult.ok ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {uploadResult.message}
            </div>
          </div>
        )}
      </div>
    </ToolCard>
  )
}

function VehicleKeyPairingTool() {
  const akUrl = `https://tesla.com/_ak/${window.location.hostname}`
  return (
    <ToolCard icon={Car} color="green" title="Pair Key to Vehicle" description="Pair your public key with a vehicle for commands and fleet telemetry">
      <div className="p-3 rounded-lg bg-neon-cyan/5 border border-neon-cyan/20 mb-3">
        <p className="text-xs text-[var(--text-primary)] mb-2 font-medium">Open this link on your phone to pair the key with your vehicle:</p>
        <a href={akUrl} target="_blank" rel="noopener noreferrer" className="text-neon-cyan text-sm font-mono hover:underline break-all flex items-center gap-2">
          <ExternalLink className="h-4 w-4 shrink-0" />
          {akUrl}
        </a>
      </div>
      <div className="p-3 rounded-lg bg-neon-amber/5 border border-neon-amber/20 mb-3">
        <p className="text-[10px] text-neon-amber flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> After opening the link, go to your vehicle and tap your key card on the center console to approve.</p>
      </div>
      <div className="space-y-2 text-xs text-[var(--text-secondary)]">
        <p className="font-medium text-[var(--text-primary)]">Steps:</p>
        <ol className="list-decimal list-inside space-y-1 text-[var(--text-muted)]">
          <li>Open the link above on your phone (logged into your Tesla account)</li>
          <li>Tesla will send a key-pairing request to your vehicle</li>
          <li>Go to your vehicle and tap your key card on the center console</li>
          <li>Once approved, commands and fleet telemetry will work</li>
        </ol>
      </div>
    </ToolCard>
  )
}

// ─── Fleet Telemetry Tools ──────────────────────────────────────

const TELEMETRY_FIELDS = [
  { category: 'Location', fields: ['Location', 'GpsHeading', 'GpsState', 'DestinationLocation', 'DestinationName', 'MilesToArrival', 'MinutesToArrival', 'RouteLine', 'RouteLastUpdated', 'OriginLocation', 'LocatedAtHome', 'LocatedAtWork', 'LocatedAtFavorite'] },
  { category: 'Driving', fields: ['VehicleSpeed', 'Gear', 'CruiseSetSpeed', 'BrakePedal', 'BrakePedalPos', 'PedalPosition', 'DriveRail', 'LateralAcceleration', 'LongitudinalAcceleration', 'RouteTrafficMinutesDelay', 'LifetimeEnergyGainedRegen', 'LifetimeEnergyUsedDrive'] },
  { category: 'Charging', fields: ['BatteryLevel', 'Soc', 'ChargeState', 'DetailedChargeState', 'ChargeLimitSoc', 'ChargeAmps', 'ChargeCurrentRequest', 'ChargeCurrentRequestMax', 'ChargeEnableRequest', 'ChargerVoltage', 'ChargerPhases', 'ChargeRateMilePerHour', 'DCChargingPower', 'DCChargingEnergyIn', 'ACChargingPower', 'ACChargingEnergyIn', 'EnergyRemaining', 'EstBatteryRange', 'IdealBatteryRange', 'RatedRange', 'PackVoltage', 'PackCurrent', 'ChargePortDoorOpen', 'ChargePortLatch', 'ChargePortColdWeatherMode', 'ChargingCableType', 'FastChargerPresent', 'FastChargerType', 'TimeToFullCharge', 'EstimatedHoursToChargeTermination', 'ExpectedEnergyPercentAtTripArrival', 'SuperchargerSessionTripPlanner', 'ScheduledChargingMode', 'ScheduledChargingPending', 'ScheduledChargingStartTime', 'ScheduledDepartureTime', 'PreconditioningEnabled', 'BrickVoltageMax', 'BrickVoltageMin', 'NumBrickVoltageMax', 'NumBrickVoltageMin', 'ModuleTempMax', 'ModuleTempMin', 'NumModuleTempMax', 'NumModuleTempMin', 'BatteryHeaterOn', 'NotEnoughPowerToHeat', 'BMSState', 'BmsFullchargecomplete', 'DCDCEnable', 'IsolationResistance', 'LifetimeEnergyUsed'] },
  { category: 'Powershare', fields: ['PowershareStatus', 'PowershareType', 'PowershareStopReason', 'PowershareHoursLeft', 'PowershareInstantaneousPowerKW'] },
  { category: 'Climate', fields: ['InsideTemp', 'OutsideTemp', 'HvacFanSpeed', 'HvacFanStatus', 'HvacPower', 'HvacACEnabled', 'HvacAutoMode', 'HvacLeftTemperatureRequest', 'HvacRightTemperatureRequest', 'HvacSteeringWheelHeatAuto', 'HvacSteeringWheelHeatLevel', 'ClimateKeeperMode', 'DefrostMode', 'DefrostForPreconditioning', 'CabinOverheatProtectionMode', 'CabinOverheatProtectionTemperatureLimit', 'SeatHeaterLeft', 'SeatHeaterRight', 'SeatHeaterRearLeft', 'SeatHeaterRearCenter', 'SeatHeaterRearRight', 'SeatVentEnabled', 'ClimateSeatCoolingFrontLeft', 'ClimateSeatCoolingFrontRight', 'AutoSeatClimateLeft', 'AutoSeatClimateRight', 'RearDefrostEnabled', 'RearDisplayHvacEnabled', 'WiperHeatEnabled'] },
  { category: 'Vehicle State', fields: ['Locked', 'SentryMode', 'DoorState', 'FdWindow', 'FpWindow', 'RdWindow', 'RpWindow', 'Odometer', 'HomelinkNearby', 'HomelinkDeviceCount', 'GuestModeEnabled', 'GuestModeMobileAccessState', 'DriverSeatOccupied', 'CenterDisplay', 'CurrentLimitMph', 'SpeedLimitMode', 'ValetModeEnabled', 'ServiceMode', 'PairedPhoneKeyAndKeyFobQty', 'LightsHazardsActive', 'LightsHighBeams', 'LightsTurnSignal', 'TonneauPosition', 'TonneauOpenPercent', 'TonneauTentMode'] },
  { category: 'Safety', fields: ['DriverSeatBelt', 'PassengerSeatBelt', 'AutomaticEmergencyBrakingOff', 'AutomaticBlindSpotCamera', 'BlindSpotCollisionWarningChime', 'CruiseFollowDistance', 'EmergencyLaneDepartureAvoidance', 'ForwardCollisionWarning', 'LaneDepartureAvoidance', 'SpeedLimitWarning', 'PinToDriveEnabled', 'MilesSinceReset', 'SelfDrivingMilesSinceReset'] },
  { category: 'Powertrain', fields: ['DiTorquemotor', 'DiTorqueActualR', 'DiTorqueActualF', 'DiTorqueActualREL', 'DiTorqueActualRER', 'DiSlaveTorqueCmd', 'DiAxleSpeedF', 'DiAxleSpeedR', 'DiAxleSpeedREL', 'DiAxleSpeedRER', 'DiStateR', 'DiStateF', 'DiStateREL', 'DiStateRER', 'DiStatorTempR', 'DiStatorTempF', 'DiStatorTempREL', 'DiStatorTempRER', 'DiHeatsinkTR', 'DiHeatsinkTF', 'DiHeatsinkTREL', 'DiHeatsinkTRER', 'DiInverterTR', 'DiInverterTF', 'DiInverterTREL', 'DiInverterTRER', 'DiMotorCurrentR', 'DiMotorCurrentF', 'DiMotorCurrentREL', 'DiMotorCurrentRER', 'DiVBatR', 'DiVBatF', 'DiVBatREL', 'DiVBatRER', 'Hvil'] },
  { category: 'Tires & Service', fields: ['TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr', 'TpmsHardWarnings', 'TpmsSoftWarnings', 'TpmsLastSeenPressureTimeFl', 'TpmsLastSeenPressureTimeFr', 'TpmsLastSeenPressureTimeRl', 'TpmsLastSeenPressureTimeRr'] },
  { category: 'Media', fields: ['MediaNowPlayingTitle', 'MediaNowPlayingArtist', 'MediaNowPlayingAlbum', 'MediaNowPlayingStation', 'MediaNowPlayingDuration', 'MediaNowPlayingElapsed', 'MediaPlaybackStatus', 'MediaPlaybackSource', 'MediaAudioVolume', 'MediaAudioVolumeIncrement', 'MediaAudioVolumeMax'] },
  { category: 'User Preference', fields: ['Setting24HourTime', 'SettingChargeUnit', 'SettingDistanceUnit', 'SettingTemperatureUnit', 'SettingTirePressureUnit'] },
  { category: 'Vehicle Config', fields: ['CarType', 'Trim', 'ExteriorColor', 'RoofColor', 'WheelType', 'VehicleName', 'Version', 'RearSeatHeaters', 'SunroofInstalled', 'EfficiencyPackage', 'EuropeVehicle', 'RightHandDrive', 'RemoteStartEnabled', 'ChargePort', 'OffroadLightbarPresent', 'SoftwareUpdateVersion', 'SoftwareUpdateDownloadPercentComplete', 'SoftwareUpdateInstallationPercentComplete', 'SoftwareUpdateExpectedDurationMinutes', 'SoftwareUpdateScheduledStartTime'] },
]

function FleetTelemetrySubscribeTool() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: async () => {
    const res = await fetch(`${getApiBase()}/api/v1/vehicles`)
    if (!res.ok) return []
    return res.json() as Promise<{ id: number; vehicle_id: number; display_name: string; vin: string }[]>
  }})
  const [selectedVins, setSelectedVins] = useState<string[]>([])
  const [hostname, setHostname] = useState('')
  const [port, setPort] = useState('4443')
  const [interval, setInterval] = useState('10')
  const [ca, setCa] = useState('')
  const [selectedFields, setSelectedFields] = useState<string[]>([
    'VehicleSpeed', 'Odometer', 'BatteryLevel', 'Location', 'GpsHeading',
    'ChargeState', 'ChargeLimitSoc', 'InsideTemp', 'OutsideTemp', 'Locked', 'SentryMode',
  ])
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [showSignalModal, setShowSignalModal] = useState(false)
  // Per-signal intervals (set via modal)
  const [signalIntervals, setSignalIntervals] = useState<Map<string, number>>(new Map())

  const toggleVin = (vin: string) => {
    setSelectedVins(prev => prev.includes(vin) ? prev.filter(v => v !== vin) : [...prev, vin])
  }

  const mut = useMutation({
    mutationFn: () => apiFetch('fleet-telemetry-subscribe', 'POST', {
      vins: selectedVins,
      hostname,
      port: parseInt(port) || 4443,
      ca: ca || undefined,
      fields: selectedFields,
      interval_seconds: parseInt(interval) || 10,
      // Per-signal intervals from the modal (overrides interval_seconds)
      field_intervals: Object.fromEntries(signalIntervals),
    }),
    onSuccess: (data: Record<string, unknown>) => setResult(data),
    onError: (err) => setResult({ error: (err as Error).message }),
  })

  return (
    <ToolCard icon={Satellite} color="cyan" title="Fleet Telemetry Subscription" description="Configure vehicles to stream real-time telemetry data to your server">
      {/* Vehicle Selection */}
      <div className="mb-3">
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">Vehicles</label>
        {vehicles && vehicles.length > 0 ? (
          <div className="grid grid-cols-1 gap-1.5">
            {vehicles.map((v: { id: number; vehicle_id: number; display_name: string; vin: string }) => (
              <label key={v.vin} className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors text-xs',
                selectedVins.includes(v.vin)
                  ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                  : 'bg-white/[0.02] border-white/[0.06] text-[var(--text-secondary)] hover:border-white/[0.12]'
              )}>
                <input type="checkbox" checked={selectedVins.includes(v.vin)} onChange={() => toggleVin(v.vin)} className="sr-only" />
                <div className={clsx('h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0', selectedVins.includes(v.vin) ? 'bg-neon-cyan border-neon-cyan' : 'border-white/20')}>
                  {selectedVins.includes(v.vin) && <CheckCircle className="h-2.5 w-2.5 text-black" />}
                </div>
                <span className="font-medium">{v.display_name}</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)] ml-auto">{v.vin}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">No vehicles found. Sync vehicles in Settings first.</p>
        )}
      </div>

      {/* Server Configuration */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">Hostname</label>
          <Input type="text" value={hostname} onChange={e => setHostname(e.target.value)} placeholder="telemetry.yourdomain.com" />
        </div>
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">Port</label>
          <Input type="text" value={port} onChange={e => setPort(e.target.value)} placeholder="4443" />
        </div>
      </div>

      <div className="mb-3">
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">Interval (seconds)</label>
        <Input type="text" value={interval} onChange={e => setInterval(e.target.value)} placeholder="10" className="w-24" />
      </div>

      <div className="mb-3">
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">CA Certificate (optional)</label>
        <textarea value={ca} onChange={e => setCa(e.target.value)} placeholder="Paste PEM-encoded CA certificate..." className={clsx(textareaClasses, 'h-16 text-[10px]')} />
      </div>

      {/* Signal Configuration */}
      <div className="mb-3">
        <Button variant="ghost" size="sm" onClick={() => setShowSignalModal(true)} className="w-full !justify-start border border-white/[0.06] hover:border-neon-cyan/30 bg-white/[0.02] hover:text-neon-cyan" icon={<Settings className="h-3.5 w-3.5" />}>
          <span className="font-medium">Configure Signals</span>
          <span className="text-[10px] text-[var(--text-muted)] ml-auto">{selectedFields.length} selected</span>
        </Button>
      </div>

      <SignalConfigModal
        open={showSignalModal}
        onClose={() => setShowSignalModal(false)}
        categories={TELEMETRY_FIELDS}
        initialSelected={selectedFields}
        initialInterval={parseInt(interval) || 10}
        onSubmit={(signals) => {
          setSelectedFields(signals.map(s => s.name))
          const intervals = new Map<string, number>()
          signals.forEach(s => intervals.set(s.name, s.interval))
          setSignalIntervals(intervals)
        }}
      />

      <Button variant="secondary" size="sm" onClick={() => mut.mutate()} disabled={selectedVins.length === 0 || !hostname} loading={mut.isPending} icon={<Satellite className="h-3.5 w-3.5" />}>
        Subscribe to Telemetry
      </Button>
      {result !== null && <ResultPanel title="Fleet Telemetry Subscription Result" data={result} />}
    </ToolCard>
  )
}

function FleetTelemetryConfigTool() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: async () => {
    const res = await fetch(`${getApiBase()}/api/v1/vehicles`)
    if (!res.ok) return []
    return res.json() as Promise<{ id: number; vehicle_id: number; display_name: string; vin: string }[]>
  }})
  const [selectedVin, setSelectedVin] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [errorsResult, setErrorsResult] = useState<Record<string, unknown> | null>(null)
  const [configExists, setConfigExists] = useState(false)
  const [errorsLoaded, setErrorsLoaded] = useState(false)

  const getConfig = useMutation({
    mutationFn: () => apiFetch(`fleet-telemetry-config?vin=${selectedVin}`),
    onSuccess: (data: Record<string, unknown>) => {
      setResult(data)
      const resp = data?.response as Record<string, unknown> | null | undefined
      setConfigExists(resp != null && Object.keys(resp).length > 0)
    },
    onError: (err) => {
      setResult({ error: (err as Error).message })
      setConfigExists(false)
    },
  })
  const deleteConfig = useMutation({
    mutationFn: () => apiFetch(`fleet-telemetry-config?vin=${selectedVin}`, 'DELETE'),
    onSuccess: (data: Record<string, unknown>) => {
      setResult(data)
      setConfigExists(false)
    },
    onError: (err) => setResult({ error: (err as Error).message }),
  })
  const getErrors = useMutation({
    mutationFn: () => apiFetch(`fleet-telemetry-errors?vin=${selectedVin}`),
    onSuccess: (data: Record<string, unknown>) => {
      setErrorsResult(data)
      setErrorsLoaded(true)
    },
    onError: (err) => {
      setErrorsResult({ error: (err as Error).message })
      setErrorsLoaded(true)
    },
  })

  const handleVinChange = (vin: string) => {
    setSelectedVin(vin)
    setResult(null)
    setErrorsResult(null)
    setConfigExists(false)
    setErrorsLoaded(false)
  }

  const downloadErrors = () => {
    if (!errorsResult) return
    const blob = new Blob([JSON.stringify(errorsResult, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet-telemetry-errors-${selectedVin}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Extract errors array for table display
  const errorsList = (() => {
    if (!errorsResult) return []
    const resp = errorsResult.response as Record<string, unknown>[] | Record<string, unknown> | null
    if (Array.isArray(resp)) return resp
    if (resp && typeof resp === 'object' && 'errors' in resp) {
      const errs = (resp as Record<string, unknown>).errors
      if (Array.isArray(errs)) return errs as Record<string, unknown>[]
    }
    return []
  })()

  const errorColumns: Column<Record<string, unknown>>[] = [
    {
      key: 'time',
      header: 'Time',
      render: (err) => (
        <span className="text-[var(--text-secondary)] whitespace-nowrap font-mono">
          {err.created_at ? formatDateTime(err.created_at as string) : err.timestamp ? formatDateTime(err.timestamp as string) : '—'}
        </span>
      ),
    },
    {
      key: 'error',
      header: 'Error',
      render: (err) => (
        <span className="text-neon-red font-medium">
          {(err.name || err.error || err.code || '—') as string}
        </span>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      render: (err) => (
        <span className="text-[var(--text-muted)] max-w-xs truncate block">
          {(err.body || err.message || err.description || JSON.stringify(err)) as string}
        </span>
      ),
    },
  ]

  return (
    <ToolCard icon={Eye} color="green" title="Fleet Telemetry Status" description="View, manage, and debug fleet telemetry configuration per vehicle">
      <div className="mb-3">
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">Vehicle</label>
        {vehicles && vehicles.length > 0 ? (
          <Select value={selectedVin} onChange={e => handleVinChange(e.target.value)} options={[{ value: '', label: 'Select a vehicle...' }, ...vehicles.map((v: { id: number; vehicle_id: number; display_name: string; vin: string }) => ({ value: v.vin, label: `${v.display_name} (${v.vin})` }))]} />
        ) : (
          <p className="text-xs text-[var(--text-muted)]">No vehicles found.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Button variant="secondary" size="sm" onClick={() => getConfig.mutate()} disabled={!selectedVin} loading={getConfig.isPending} icon={<Eye className="h-3 w-3" />}>
          Get Config
        </Button>
        <Button variant="secondary" size="sm" onClick={() => getErrors.mutate()} disabled={!selectedVin} loading={getErrors.isPending} icon={<AlertTriangle className="h-3 w-3" />} className="text-neon-amber" title="Fetch recent fleet telemetry errors for this vehicle">
          View Errors
        </Button>
        <Button variant="secondary" size="sm" onClick={() => { if (confirm('Remove fleet telemetry config for this vehicle? The vehicle will stop streaming telemetry data.')) deleteConfig.mutate() }} disabled={!selectedVin} loading={deleteConfig.isPending} icon={<Trash2 className="h-3 w-3" />} className="text-neon-red" title="Remove fleet telemetry config from this vehicle">
          Delete Config
        </Button>
      </div>

      {!configExists && result === null && selectedVin && (
        <p className="text-[10px] text-[var(--text-muted)] mb-2">Click "Get Config" to check the current fleet telemetry configuration for this vehicle.</p>
      )}

      {result !== null && <ResultPanel title="Fleet Telemetry Config" data={result} />}

      {errorsLoaded && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Fleet Telemetry Errors {errorsList.length > 0 && <span className="text-neon-amber">({errorsList.length})</span>}
            </h4>
            {errorsList.length > 0 && (
              <Button variant="ghost" size="sm" icon={<Download className="h-3 w-3" />} onClick={downloadErrors}>Download JSON</Button>
            )}
          </div>
          {errorsList.length > 0 ? (
            <div className="glass-panel rounded-lg overflow-hidden max-h-64 overflow-y-auto">
              <DataTable<Record<string, unknown>>
                columns={errorColumns}
                data={errorsList}
                keyExtractor={(err) => `${String(err.created_at ?? err.timestamp ?? '')}-${String(err.name ?? err.error ?? '')}`}
                compact
              />
            </div>
          ) : (
            <div className="glass-panel rounded-lg p-4 text-center">
              <CheckCircle className="h-5 w-5 text-neon-green mx-auto mb-1" />
              <p className="text-xs text-neon-green">No telemetry errors found</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">The vehicle is streaming without issues</p>
            </div>
          )}
          {errorsResult && !Array.isArray(errorsResult.response) && typeof errorsResult.error === 'string' && (
            <ResultPanel title="Error Response" data={errorsResult} />
          )}
        </div>
      )}
    </ToolCard>
  )
}

function FleetStatusTool() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: async () => {
    const res = await fetch(`${getApiBase()}/api/v1/vehicles`)
    if (!res.ok) return []
    return res.json() as Promise<{ id: number; vehicle_id: number; display_name: string; vin: string }[]>
  }})
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  const mut = useMutation({
    mutationFn: () => apiFetch('fleet-status', 'POST', { vins: vehicles?.map((v: { vin: string }) => v.vin) ?? [] }),
    onSuccess: (data: Record<string, unknown>) => setResult(data),
    onError: (err) => setResult({ error: (err as Error).message }),
  })

  return (
    <ToolCard icon={Zap} color="amber" title="Fleet Status" description="Check firmware version, telemetry version, command protocol, and key count for all vehicles">
      <Button variant="secondary" size="sm" onClick={() => mut.mutate()} disabled={!vehicles?.length} loading={mut.isPending} icon={<Zap className="h-3.5 w-3.5" />}>
        Check Fleet Status
      </Button>
      {result !== null && <ResultPanel title="Fleet Status" data={result} />}
    </ToolCard>
  )
}

function VehicleDataTools() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: async () => {
    const res = await fetch(`${getApiBase()}/api/v1/vehicles`)
    if (!res.ok) return []
    return res.json() as Promise<{ id: number; vehicle_id: number; display_name: string; vin: string }[]>
  }})
  const [selectedVin, setSelectedVin] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [activeQuery, setActiveQuery] = useState('')

  const fetchData = useMutation({
    mutationFn: (endpoint: string) => apiFetch(`${endpoint}?vin=${selectedVin}`),
    onSuccess: (data: Record<string, unknown>) => setResult(data),
    onError: (err) => setResult({ error: (err as Error).message }),
  })

  const handleFetch = (endpoint: string, label: string) => {
    setActiveQuery(label)
    setResult(null)
    fetchData.mutate(endpoint)
  }

  return (
    <ToolCard icon={Database} color="purple" title="Vehicle Data Queries" description="Query Tesla Fleet API for vehicle-specific data — charging sites, release notes, alerts, and service history">
      <div className="mb-3">
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">Vehicle</label>
        {vehicles && vehicles.length > 0 ? (
          <Select value={selectedVin} onChange={e => { setSelectedVin(e.target.value); setResult(null) }} options={[{ value: '', label: 'Select a vehicle...' }, ...vehicles.map((v: { id: number; vehicle_id: number; display_name: string; vin: string }) => ({ value: v.vin, label: `${v.display_name} (${v.vin})` }))]} />
        ) : (
          <p className="text-xs text-[var(--text-muted)]">No vehicles found.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Button variant="secondary" size="sm" onClick={() => handleFetch('nearby-charging', 'Nearby Chargers')} disabled={fetchData.isPending || !selectedVin} loading={fetchData.isPending && activeQuery === 'Nearby Chargers'} icon={<MapPin className="h-3 w-3" />}>
          Nearby Chargers
        </Button>
        <Button variant="secondary" size="sm" onClick={() => handleFetch('release-notes', 'Release Notes')} disabled={fetchData.isPending || !selectedVin} loading={fetchData.isPending && activeQuery === 'Release Notes'} icon={<FileText className="h-3 w-3" />}>
          Release Notes
        </Button>
        <Button variant="secondary" size="sm" onClick={() => handleFetch('recent-alerts', 'Recent Alerts')} disabled={fetchData.isPending || !selectedVin} loading={fetchData.isPending && activeQuery === 'Recent Alerts'} icon={<AlertTriangle className="h-3 w-3" />} className="text-neon-amber">
          Recent Alerts
        </Button>
        <Button variant="secondary" size="sm" onClick={() => handleFetch('service-data', 'Service Data')} disabled={fetchData.isPending || !selectedVin} loading={fetchData.isPending && activeQuery === 'Service Data'} icon={<Wrench className="h-3 w-3" />}>
          Service Data
        </Button>
      </div>

      {result !== null && <ResultPanel title={activeQuery} data={result} />}
    </ToolCard>
  )
}

// ─── Guided Onboarding Workflow ──────────────────────────────────

interface OnboardingStep {
  id: string
  title: string
  description: string
  external?: boolean
  link?: string
  linkLabel?: string
  note?: string
  toolId?: 'keypair' | 'register' | 'auth' | 'pair' | 'telemetry'
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'account',
    title: 'Create Tesla Account',
    description: 'Create a Tesla account and ensure it has a verified email and multi-factor authentication enabled.',
    external: true,
    link: 'https://developer.tesla.com/teslaaccount',
    linkLabel: 'Create Account',
  },
  {
    id: 'application',
    title: 'Create Application',
    description: 'Request app access on the Tesla Developer Dashboard. Provide business details, application name, description, and purpose. Select the scopes your application needs.',
    external: true,
    link: 'https://developer.tesla.com/dashboard',
    linkLabel: 'Open Developer Dashboard',
    note: 'Account creation requests can be automatically rejected if the application name already exists.',
  },
  {
    id: 'keypair',
    title: 'Generate & Host Public Key',
    description: 'Generate an EC keypair and host the public key at your domain. The key validates domain ownership and is required for Vehicle Commands and Fleet Telemetry.',
    toolId: 'keypair',
  },
  {
    id: 'register',
    title: 'Register as Partner',
    description: 'Generate a partner authentication token (client_credentials) and call the register endpoint to complete registration with Fleet API.',
    toolId: 'register',
    note: 'The register call needs to be completed in each region of operation.',
  },
  {
    id: 'auth',
    title: 'Connect Tesla Account',
    description: 'Authenticate a user via OAuth to obtain access tokens. This allows TeslaSync to access vehicle data and send commands on behalf of the user.',
    toolId: 'auth',
  },
  {
    id: 'pair',
    title: 'Pair Key to Vehicle',
    description: 'Pair your public key with a vehicle. This is required to send Vehicle Commands and set up Fleet Telemetry. The vehicle owner must approve on the touchscreen.',
    toolId: 'pair',
  },
  {
    id: 'telemetry',
    title: 'Configure Fleet Telemetry',
    description: 'Subscribe vehicles to stream real-time telemetry data directly to your server. Select the data fields you want and the streaming interval.',
    toolId: 'telemetry',
  },
]

type StepStatus = 'pending' | 'completed' | 'active'

function OnboardingWorkflow() {
  const STORAGE_KEY = 'teslasync-onboarding-progress'
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? new Set(JSON.parse(saved)) : new Set<number>()
    } catch { return new Set<number>() }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...completedSteps]))
  }, [completedSteps])

  const markComplete = (idx: number) => {
    setCompletedSteps(prev => new Set([...prev, idx]))
    if (idx < ONBOARDING_STEPS.length - 1) {
      setCurrentStep(idx + 1)
    }
  }
  const markIncomplete = (idx: number) => {
    setCompletedSteps(prev => { const n = new Set(prev); n.delete(idx); return n })
  }
  const resetAll = () => { setCompletedSteps(new Set()); setCurrentStep(0) }

  const getStepStatus = (idx: number): StepStatus => {
    if (completedSteps.has(idx)) return 'completed'
    if (idx === currentStep) return 'active'
    return 'pending'
  }

  const allComplete = ONBOARDING_STEPS.every((_, i) => completedSteps.has(i))
  const step = ONBOARDING_STEPS[currentStep]

  // Fetch live status checks for auto-detection
  const { data: keyStatus } = useQuery({ queryKey: ['onboard-key-status'], queryFn: () => apiFetch('public-key-status'), refetchInterval: 30000 })
  const { data: fleetInfo } = useQuery({ queryKey: ['onboard-fleet-info'], queryFn: () => apiFetch('fleet-api-info'), refetchInterval: 30000 })
  const { data: authStatus } = useQuery({ queryKey: ['onboard-auth-status'], queryFn: async () => {
    const res = await fetch(`${getApiBase()}/api/v1/auth/status`)
    return res.json()
  }, refetchInterval: 30000 })

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider shrink-0">Progress</span>
        <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-neon-cyan to-neon-green rounded-full transition-all duration-500"
            style={{ width: `${(completedSteps.size / ONBOARDING_STEPS.length) * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{completedSteps.size}/{ONBOARDING_STEPS.length}</span>
        {completedSteps.size > 0 && (
          <Button variant="ghost" size="sm" icon={<RefreshCw className="h-3 w-3" />} onClick={resetAll} className="ml-1" title="Reset progress" />
        )}
      </div>

      {/* Step indicators */}
      <div className="flex gap-1">
        {ONBOARDING_STEPS.map((s, i) => {
          const status = getStepStatus(i)
          return (
            <button
              key={s.id}
              onClick={() => setCurrentStep(i)}
              className={clsx(
                'flex-1 relative py-2 rounded-lg border transition-all text-center cursor-pointer group',
                status === 'completed' && 'bg-neon-green/10 border-neon-green/30',
                status === 'active' && 'bg-neon-cyan/10 border-neon-cyan/40 ring-1 ring-neon-cyan/20',
                status === 'pending' && 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]',
              )}
              title={s.title}
            >
              <span className={clsx(
                'text-[10px] font-bold',
                status === 'completed' && 'text-neon-green',
                status === 'active' && 'text-neon-cyan',
                status === 'pending' && 'text-[var(--text-muted)]',
              )}>
                {status === 'completed' ? '✓' : i + 1}
              </span>
              <p className={clsx(
                'text-[8px] mt-0.5 leading-tight hidden sm:block',
                status === 'completed' && 'text-neon-green/70',
                status === 'active' && 'text-neon-cyan/70',
                status === 'pending' && 'text-[var(--text-muted)]',
              )}>
                {s.title.replace('Tesla ', '').replace('Create ', '').replace('Configure ', '')}
              </p>
            </button>
          )
        })}
      </div>

      {/* All complete banner */}
      {allComplete && (
        <div className="p-4 rounded-xl bg-neon-green/10 border border-neon-green/30 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-neon-green shrink-0" />
          <div>
            <p className="text-sm font-semibold text-neon-green">Setup Complete!</p>
            <p className="text-xs text-neon-green/70 mt-0.5">
              Fleet API is fully configured. Your vehicles can now stream telemetry data and receive commands.
            </p>
          </div>
        </div>
      )}

      {/* Active step detail */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        {/* Step header */}
        <div className={clsx(
          'p-4 border-b',
          completedSteps.has(currentStep) ? 'border-neon-green/20 bg-neon-green/5' : 'border-white/[0.06]',
        )}>
          <div className="flex items-center gap-3">
            <div className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-lg shrink-0 font-bold text-sm',
              completedSteps.has(currentStep)
                ? 'bg-neon-green/20 text-neon-green ring-1 ring-neon-green/30'
                : 'bg-neon-cyan/15 text-neon-cyan ring-1 ring-neon-cyan/30',
            )}>
              {completedSteps.has(currentStep) ? <CheckCircle className="h-4 w-4" /> : currentStep + 1}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Step {currentStep + 1}: {step.title}
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{step.description}</p>
            </div>
          </div>
          {step.note && (
            <div className="mt-3 p-2.5 rounded-lg bg-neon-amber/5 border border-neon-amber/20 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-neon-amber shrink-0 mt-0.5" />
              <p className="text-[10px] text-neon-amber">{step.note}</p>
            </div>
          )}
        </div>

        {/* Step content */}
        <div className="p-4">
          {step.external ? (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-secondary)]">
                This step is completed on the Tesla Developer Portal.
              </p>
              <a
                href={step.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 glass-button text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {step.linkLabel}
              </a>
            </div>
          ) : step.toolId === 'keypair' ? (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-secondary)]">
                Use the tool below to generate a keypair. TeslaSync automatically hosts the public key at the required <code className="text-neon-cyan">.well-known</code> path.
              </p>
              {keyStatus && !keyStatus.error && keyStatus.fingerprint ? (
                <div className="p-3 rounded-lg bg-neon-green/5 border border-neon-green/20 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-neon-green shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-neon-green">Public key configured</p>
                    <p className="text-[10px] text-neon-green/70 font-mono mt-0.5">Fingerprint: {keyStatus.fingerprint}</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-neon-amber/5 border border-neon-amber/20 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-neon-amber shrink-0" />
                  <p className="text-xs text-neon-amber">No public key found. Generate one using the Public Key Setup tool in the Fleet API section below.</p>
                </div>
              )}
              <PublicKeySetupTool />
            </div>
          ) : step.toolId === 'register' ? (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-secondary)]">
                Enter your domain to register as a Tesla partner. This obtains a partner token automatically and calls the register endpoint.
              </p>
              {fleetInfo && !fleetInfo.error && (
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Current Configuration</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-[var(--text-muted)]">Region:</span> <span className="text-[var(--text-primary)] font-mono">{fleetInfo.base_url || 'Not set'}</span></div>
                    <div><span className="text-[var(--text-muted)]">Client ID:</span> <span className="text-[var(--text-primary)] font-mono">{fleetInfo.client_id ? '••••' + fleetInfo.client_id.slice(-4) : 'Not set'}</span></div>
                  </div>
                </div>
              )}
              <PartnerRegistrationTool />
            </div>
          ) : step.toolId === 'auth' ? (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-secondary)]">
                Connect a Tesla account via OAuth. This grants TeslaSync permission to access vehicle data and send commands.
              </p>
              {authStatus && authStatus.authenticated ? (
                <div className="p-3 rounded-lg bg-neon-green/5 border border-neon-green/20 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-neon-green shrink-0" />
                  <p className="text-xs text-neon-green font-semibold">Tesla account connected</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-neon-amber/5 border border-neon-amber/20 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-neon-amber shrink-0" />
                    <p className="text-xs text-neon-amber">No Tesla account connected.</p>
                  </div>
                  <a href="/api/v1/auth/login" className="inline-flex items-center gap-2 glass-button text-xs">
                    <KeyRound className="h-3.5 w-3.5" />
                    Connect Tesla Account
                  </a>
                </div>
              )}
            </div>
          ) : step.toolId === 'pair' ? (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-secondary)]">
                Select a vehicle and pair your public key. The vehicle owner must approve on the car&apos;s touchscreen after pairing.
              </p>
              <VehicleKeyPairingTool />
            </div>
          ) : step.toolId === 'telemetry' ? (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-secondary)]">
                Configure your vehicles to stream real-time telemetry data. Select vehicles, data fields, and your telemetry server hostname.
              </p>
              <FleetTelemetrySubscribeTool />
            </div>
          ) : null}
        </div>

        {/* Step actions footer */}
        <div className="p-4 border-t border-white/[0.06] flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
          >
            Previous
          </Button>

          <div className="flex items-center gap-2">
            {completedSteps.has(currentStep) ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markIncomplete(currentStep)}
                className="hover:text-neon-amber"
                icon={<RefreshCw className="h-3 w-3" />}
              >
                Mark Incomplete
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => markComplete(currentStep)} icon={<CheckCircle className="h-3.5 w-3.5" />}>
                Mark Complete {currentStep < ONBOARDING_STEPS.length - 1 ? '& Continue' : ''}
              </Button>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentStep(Math.min(ONBOARDING_STEPS.length - 1, currentStep + 1))}
            disabled={currentStep === ONBOARDING_STEPS.length - 1}
          >
            Next <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function FleetApiSection() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4 pt-0">
      <PublicKeySetupTool />
      <FleetApiConfigTool />
      <BackendTool icon={Globe} color="green" title="Region Detection" description="Detect which Fleet API region your account belongs to" endpoint="detect-region" />
      <PartnerRegistrationTool />
      <BackendTool icon={Network} color="cyan" title="API Connectivity Test" description="Test if Fleet API is reachable from the server" endpoint="test-api" />
      <BackendTool icon={Key} color="amber" title="Token Info" description="Show token expiry, validity, and scopes" endpoint="token-info" />
      <VehicleKeyPairingTool />
      <FleetTelemetrySubscribeTool />
      <FleetTelemetryConfigTool />
      <FleetStatusTool />
      <VehicleDataTools />
    </div>
  )
}

// ─── Section 2: Infrastructure ───────────────────────────────────

function MqttTestTool() {
  const [topic, setTopic] = useState('')
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const mut = useMutation({
    mutationFn: () => apiFetch('mqtt-test', 'POST', { topic, message }),
    onSuccess: (data: Record<string, unknown>) => setResult(data),
    onError: (err) => setResult({ error: (err as Error).message }),
  })
  return (
    <ToolCard icon={Radio} color="green" title="MQTT Test" description="Test MQTT connectivity and send a test message">
      <div className="space-y-2 mb-3">
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">Topic (optional)</label>
          <Input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="test/topic" />
        </div>
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">Message (optional)</label>
          <Input type="text" value={message} onChange={e => setMessage(e.target.value)} placeholder="Hello MQTT" />
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={() => mut.mutate()} loading={mut.isPending} icon={<Play className="h-3.5 w-3.5" />}>
        Send Test
      </Button>
      {result !== null && <ResultPanel title="MQTT Test Result" data={result} />}
    </ToolCard>
  )
}

function InfrastructureSection() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4 pt-0">
      <BackendTool icon={Database} color="purple" title="Database Stats" description="Table row counts and database size" endpoint="db-stats" />
      <BackendTool icon={GitBranch} color="cyan" title="Migration Status" description="Current database migration version" endpoint="migration-status" />
      <MqttTestTool />
      <BackendTool icon={Settings} color="amber" title="Environment Check" description="Which environment variables are set or unset" endpoint="env-check" />
      <BackendTool icon={Cpu} color="green" title="Runtime Info" description="Go runtime stats — goroutines, memory, uptime" endpoint="runtime-info" />
    </div>
  )
}

// ─── Section 3: Client-Side Utilities ────────────────────────────

// --- VIN Decoder ---
const VIN_MANUFACTURERS: Record<string, string> = { '5YJ': 'Tesla (USA)', 'LRW': 'Tesla (China)', '7SA': 'Tesla (EU/Berlin)', 'XP7': 'Tesla (USA)' }
const VIN_MODELS: Record<string, string> = { S: 'Model S', '3': 'Model 3', X: 'Model X', Y: 'Model Y' }
const VIN_DRIVE: Record<string, string> = { '1': 'Single Motor RWD', '2': 'Dual Motor AWD', '3': 'Performance AWD', '4': 'Single Motor RWD (LFP)', A: 'Dual Motor AWD', B: 'Dual Motor AWD', F: 'Performance AWD', P: 'Performance', E: 'Dual Motor', N: 'Dual Motor' }
const VIN_YEAR: Record<string, string> = { H: '2017', J: '2018', K: '2019', L: '2020', M: '2021', N: '2022', P: '2023', R: '2024', S: '2025', T: '2026' }
const VIN_PLANT: Record<string, string> = { F: 'Fremont, CA', A: 'Austin, TX', B: 'Berlin, Germany', C: 'Shanghai, China', G: 'Gigafactory', E: 'Palo Alto, CA' }

function VinDecoderTool() {
  const [vin, setVin] = useState('')
  const decoded = useMemo(() => {
    const v = vin.toUpperCase().trim()
    if (v.length !== 17) return null
    const mfr = VIN_MANUFACTURERS[v.substring(0, 3)] || `Unknown (${v.substring(0, 3)})`
    const model = VIN_MODELS[v[3]] || `Unknown (${v[3]})`
    const drive = VIN_DRIVE[v[5]] || `Unknown (${v[5]})`
    const year = VIN_YEAR[v[9]] || `Unknown (${v[9]})`
    const plant = VIN_PLANT[v[10]] || `Unknown (${v[10]})`
    const serial = v.substring(11)
    return { manufacturer: mfr, model, drive, year, plant, serial, bodyType: v[4], batteryType: v[7], checkDigit: v[8] }
  }, [vin])

  return (
    <ToolCard icon={Car} color="cyan" title="VIN Decoder" description="Decode Tesla VIN to model, year, drive type, battery">
      <Input type="text" value={vin} onChange={e => setVin(e.target.value)} placeholder="5YJ3E1EA1PF000000" maxLength={17} />
      {vin.length > 0 && vin.length !== 17 && <p className="text-[10px] text-neon-amber mt-1">{17 - vin.length} more characters needed</p>}
      {decoded && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
          {Object.entries(decoded).map(([k, v]) => (
            <div key={k} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">{k.replace(/([A-Z])/g, ' $1').trim()}</p>
              <p className="text-xs font-mono text-[var(--text-primary)] mt-0.5">{v}</p>
            </div>
          ))}
        </div>
      )}
    </ToolCard>
  )
}

// --- JWT Decoder ---
function JwtDecoderTool() {
  const [jwt, setJwt] = useState('')
  const decoded = useMemo(() => {
    if (!jwt.trim()) return null
    const parts = jwt.trim().split('.')
    if (parts.length < 2) return { error: 'Invalid JWT: expected at least 2 parts separated by dots' }
    try {
      const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')))
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
      return { header, payload }
    } catch {
      return { error: 'Failed to decode JWT — invalid base64 or JSON' }
    }
  }, [jwt])

  return (
    <ToolCard icon={Key} color="purple" title="JWT Decoder" description="Decode JWT header & payload (no verification)">
      <textarea value={jwt} onChange={e => setJwt(e.target.value)} placeholder="Paste JWT token here..." className={textareaClasses} rows={3} />
      {decoded && (
        'error' in decoded ? (
          <ResultPanel title="Decode Error" data={decoded} error={decoded.error as string} />
        ) : (
          <div className="space-y-2 mt-3">
            {(['header', 'payload'] as const).map(key => (
              <div key={key} className="p-3 rounded-xl bg-neon-green/5 border border-neon-green/20">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{key}</p>
                  <CopyButton text={JSON.stringify(decoded[key], null, 2)} />
                </div>
                <pre className="text-xs font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap">{JSON.stringify(decoded[key], null, 2)}</pre>
              </div>
            ))}
          </div>
        )
      )}
    </ToolCard>
  )
}

// --- Timestamp Converter ---
function TimestampTool() {
  const [input, setInput] = useState('')
  const result = useMemo(() => {
    const v = input.trim()
    if (!v) return null
    let date: Date | null = null
    const num = Number(v)
    if (!isNaN(num)) {
      // Seconds (10 digits) vs milliseconds (13 digits)
      date = v.length >= 13 ? new Date(num) : new Date(num * 1000)
    } else {
      const parsed = new Date(v)
      if (!isNaN(parsed.getTime())) date = parsed
    }
    if (!date || isNaN(date.getTime())) return { error: 'Could not parse timestamp' }
    return {
      'Unix (s)': Math.floor(date.getTime() / 1000).toString(),
      'Unix (ms)': date.getTime().toString(),
      'ISO 8601': date.toISOString(),
      'UTC': date.toUTCString(),
      'Local': date.toLocaleString(),
      'Relative': getRelativeTime(date),
    }
  }, [input])

  return (
    <ToolCard icon={Clock} color="green" title="Timestamp Converter" description="Convert between Unix epoch, ISO 8601, and human-readable dates">
      <Input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="1700000000, 2024-01-15T12:00:00Z, or Jan 15 2024" />
      <Button variant="secondary" size="sm" onClick={() => setInput(Math.floor(Date.now() / 1000).toString())} icon={<Clock className="h-3 w-3" />} className="mt-2">
        Now
      </Button>
      {result && !('error' in result) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
          {Object.entries(result).map(([k, v]) => (
            <div key={k} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">{k}</p>
                <p className="text-xs font-mono text-[var(--text-primary)] truncate mt-0.5">{v}</p>
              </div>
              <CopyButton text={v} />
            </div>
          ))}
        </div>
      ) : result ? (
        <ResultPanel title="Parse Error" data={result} error="parse error" />
      ) : null}
    </ToolCard>
  )
}

function getRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const abs = Math.abs(diff)
  const suffix = diff > 0 ? 'ago' : 'from now'
  if (abs < 60_000) return `${Math.floor(abs / 1000)}s ${suffix}`
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m ${suffix}`
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ${suffix}`
  return `${Math.floor(abs / 86_400_000)}d ${suffix}`
}

// --- Base64 Encode/Decode ---
function Base64Tool() {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const output = useMemo(() => {
    if (!input) return ''
    try {
      return mode === 'encode' ? btoa(input) : atob(input)
    } catch {
      return '⚠ Invalid input for ' + mode
    }
  }, [input, mode])

  return (
    <ToolCard icon={FileCode} color="amber" title="Base64 Encode/Decode" description="Text ↔ Base64 converter">
      <div className="flex gap-2 mb-2">
        {(['encode', 'decode'] as const).map(m => (
          <Button key={m} variant="ghost" size="sm" onClick={() => setMode(m)} className={clsx(mode === m ? 'bg-neon-cyan/10 text-neon-cyan ring-1 ring-neon-cyan/20' : 'bg-white/[0.04] text-[var(--text-muted)] hover:bg-white/[0.06]')}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </Button>
        ))}
      </div>
      <textarea value={input} onChange={e => setInput(e.target.value)} placeholder={mode === 'encode' ? 'Enter text to encode...' : 'Enter Base64 to decode...'} className={textareaClasses} rows={3} />
      {output && (
        <GlassPanel className="mt-3 p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Output</p>
            <CopyButton text={output} />
          </div>
          <pre className="text-xs font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all">{output}</pre>
        </GlassPanel>
      )}
    </ToolCard>
  )
}

// --- URL Encoder/Decoder ---
function UrlEncoderTool() {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const output = useMemo(() => {
    if (!input) return ''
    try {
      return mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input)
    } catch {
      return '⚠ Invalid input for ' + mode
    }
  }, [input, mode])

  return (
    <ToolCard icon={Link} color="cyan" title="URL Encoder/Decoder" description="Encode/decode URL components">
      <div className="flex gap-2 mb-2">
        {(['encode', 'decode'] as const).map(m => (
          <Button key={m} variant="ghost" size="sm" onClick={() => setMode(m)} className={clsx(mode === m ? 'bg-neon-cyan/10 text-neon-cyan ring-1 ring-neon-cyan/20' : 'bg-white/[0.04] text-[var(--text-muted)] hover:bg-white/[0.06]')}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </Button>
        ))}
      </div>
      <textarea value={input} onChange={e => setInput(e.target.value)} placeholder={mode === 'encode' ? 'Enter URL to encode...' : 'Enter encoded URL to decode...'} className={textareaClasses} rows={2} />
      {output && (
        <GlassPanel className="mt-3 p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Output</p>
            <CopyButton text={output} />
          </div>
          <pre className="text-xs font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all">{output}</pre>
        </GlassPanel>
      )}
    </ToolCard>
  )
}

// --- JSON Formatter ---
function JsonFormatterTool() {
  const [input, setInput] = useState('')
  const result = useMemo(() => {
    if (!input.trim()) return null
    try {
      const parsed = JSON.parse(input)
      return { formatted: JSON.stringify(parsed, null, 2), valid: true }
    } catch (e) {
      return { error: (e as Error).message, valid: false }
    }
  }, [input])

  return (
    <ToolCard icon={Braces} color="green" title="JSON Formatter" description="Paste JSON, format and validate with highlighting">
      <textarea value={input} onChange={e => setInput(e.target.value)} placeholder='{"key": "value"}' className={textareaClasses} rows={4} />
      {result && (
        result.valid ? (
          <div className="mt-3 p-3 rounded-xl bg-neon-green/5 border border-neon-green/20">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-neon-green uppercase tracking-wider flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Valid JSON</p>
              <CopyButton text={result.formatted!} />
            </div>
            <pre className="text-xs font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap">{result.formatted}</pre>
          </div>
        ) : (
          <div className="mt-3 p-3 rounded-xl bg-neon-red/5 border border-neon-red/20">
            <p className="text-[10px] text-neon-red uppercase tracking-wider flex items-center gap-1"><XCircle className="h-3 w-3" /> Invalid JSON</p>
            <p className="text-xs text-neon-red mt-1 font-mono">{result.error}</p>
          </div>
        )
      )}
    </ToolCard>
  )
}

// --- UUID Generator ---
function UuidGeneratorTool() {
  const [uuids, setUuids] = useState<string[]>([])
  const generate = () => {
    const id = crypto.randomUUID()
    setUuids(prev => [id, ...prev].slice(0, 10))
  }
  return (
    <ToolCard icon={Fingerprint} color="purple" title="UUID Generator" description="Generate v4 UUIDs with one click">
      <Button variant="secondary" size="sm" onClick={generate} icon={<RefreshCw className="h-3.5 w-3.5" />}>
        Generate UUID
      </Button>
      {uuids.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {uuids.map((id, i) => (
            <div key={id + i} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <code className="text-xs font-mono text-[var(--text-primary)] flex-1">{id}</code>
              <CopyButton text={id} />
            </div>
          ))}
        </div>
      )}
    </ToolCard>
  )
}

// --- Hash Calculator ---
function HashCalculatorTool() {
  const [input, setInput] = useState('')
  const [hash, setHash] = useState('')
  const calculate = useCallback(async (text: string) => {
    if (!text) { setHash(''); return }
    const encoded = new TextEncoder().encode(text)
    const buf = await crypto.subtle.digest('SHA-256', encoded)
    const arr = Array.from(new Uint8Array(buf))
    setHash(arr.map(b => b.toString(16).padStart(2, '0')).join(''))
  }, [])

  return (
    <ToolCard icon={Hash} color="cyan" title="Hash Calculator" description="Calculate SHA-256 hash of input text">
      <textarea value={input} onChange={e => { setInput(e.target.value); calculate(e.target.value) }} placeholder="Enter text to hash..." className={textareaClasses} rows={3} />
      {hash && (
        <GlassPanel className="mt-3 p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">SHA-256</p>
            <CopyButton text={hash} />
          </div>
          <code className="text-xs font-mono text-[var(--text-primary)] break-all">{hash}</code>
        </GlassPanel>
      )}
    </ToolCard>
  )
}

// --- Byte Size Converter ---
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
function ByteSizeTool() {
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState<string>('MB')
  const conversions = useMemo(() => {
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) return null
    const unitIdx = BYTE_UNITS.indexOf(unit as typeof BYTE_UNITS[number])
    if (unitIdx === -1) return null
    const bytes = num * Math.pow(1024, unitIdx)
    return Object.fromEntries(BYTE_UNITS.map((u, i) => [u, (bytes / Math.pow(1024, i)).toLocaleString(undefined, { maximumFractionDigits: 6 })]))
  }, [value, unit])

  return (
    <ToolCard icon={HardDrive} color="amber" title="Byte Size Converter" description="Convert between B, KB, MB, GB, TB">
      <div className="flex gap-2">
        <Input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="1024" className="flex-1" />
        <Select value={unit} onChange={e => setUnit(e.target.value)} options={BYTE_UNITS.map(u => ({ value: u, label: u }))} />
      </div>
      {conversions && (
        <div className="grid grid-cols-5 gap-2 mt-3">
          {Object.entries(conversions).map(([u, v]) => (
            <div key={u} className={clsx('p-2 rounded-lg border text-center', u === unit ? 'bg-neon-cyan/5 border-neon-cyan/20' : 'bg-white/[0.02] border-white/[0.04]')}>
              <p className="text-[9px] text-[var(--text-muted)] uppercase">{u}</p>
              <p className="text-[10px] font-mono text-[var(--text-primary)] mt-0.5 truncate" title={v}>{v}</p>
            </div>
          ))}
        </div>
      )}
    </ToolCard>
  )
}

// --- Color Converter ---
function ColorConverterTool() {
  const [input, setInput] = useState('#3B82F6')
  const result = useMemo(() => {
    const v = input.trim()
    let r = 0, g = 0, b = 0
    // Try HEX
    const hexMatch = v.match(/^#?([0-9a-fA-F]{6})$/)
    if (hexMatch) {
      r = parseInt(hexMatch[1].substring(0, 2), 16)
      g = parseInt(hexMatch[1].substring(2, 4), 16)
      b = parseInt(hexMatch[1].substring(4, 6), 16)
    } else {
      // Try rgb(r, g, b)
      const rgbMatch = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (rgbMatch) {
        r = parseInt(rgbMatch[1]); g = parseInt(rgbMatch[2]); b = parseInt(rgbMatch[3])
      } else {
        // Try hsl(h, s%, l%)
        const hslMatch = v.match(/^hsla?\((\d+),\s*(\d+)%?,\s*(\d+)%?/)
        if (hslMatch) {
          const [rr, gg, bb] = hslToRgb(parseInt(hslMatch[1]), parseInt(hslMatch[2]), parseInt(hslMatch[3]))
          r = rr; g = gg; b = bb
        } else return null
      }
    }
    const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`
    const [h, s, l] = rgbToHsl(r, g, b)
    return { hex: hex.toUpperCase(), rgb: `rgb(${r}, ${g}, ${b})`, hsl: `hsl(${h}, ${s}%, ${l}%)`, r, g, b }
  }, [input])

  return (
    <ToolCard icon={Palette} color="purple" title="Color Converter" description="Convert between HEX, RGB, HSL">
      <div className="flex gap-2">
        <Input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="#3B82F6 or rgb(59,130,246) or hsl(217,91%,60%)" className="flex-1" />
        {result && <div className="w-10 h-10 rounded-lg border border-white/[0.08] shrink-0" style={{ backgroundColor: result.hex }} />}
      </div>
      {result && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          {(['hex', 'rgb', 'hsl'] as const).map(fmt => (
            <div key={fmt} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <p className="text-[9px] text-[var(--text-muted)] uppercase">{fmt}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <p className="text-[10px] font-mono text-[var(--text-primary)] flex-1 truncate">{result[fmt]}</p>
                <CopyButton text={result[fmt]} />
              </div>
            </div>
          ))}
        </div>
      )}
    </ToolCard>
  )
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

// --- Cron Expression Parser ---
function CronParserTool() {
  const [cron, setCron] = useState('')
  const result = useMemo(() => {
    if (!cron.trim()) return null
    const parts = cron.trim().split(/\s+/)
    if (parts.length !== 5) return { error: 'Expected 5 fields: minute hour day month weekday' }
    const [minute, hour, day, month, weekday] = parts
    const description = describeCron(minute, hour, day, month, weekday)
    const nextRuns = getNextCronRuns(parts, 5)
    return { description, fields: { minute, hour, day, month, weekday }, nextRuns }
  }, [cron])

  return (
    <ToolCard icon={Timer} color="green" title="Cron Expression Parser" description="Parse cron expressions and show next run times">
      <Input type="text" value={cron} onChange={e => setCron(e.target.value)} placeholder="*/5 * * * *" />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {[
          { label: 'Every minute', val: '* * * * *' },
          { label: 'Every 5 min', val: '*/5 * * * *' },
          { label: 'Hourly', val: '0 * * * *' },
          { label: 'Daily midnight', val: '0 0 * * *' },
          { label: 'Weekly Monday', val: '0 0 * * 1' },
        ].map(p => (
          <Button key={p.val} variant="ghost" size="sm" onClick={() => setCron(p.val)} className="!px-2 !py-0.5 !text-[10px] !rounded bg-white/[0.04] text-[var(--text-muted)] hover:bg-white/[0.08]">
            {p.label}
          </Button>
        ))}
      </div>
      {result && (
        'error' in result ? (
          <ResultPanel title="Parse Error" data={result} error={result.error} />
        ) : (
          <div className="mt-3 space-y-2">
            <div className="p-3 rounded-xl bg-neon-green/5 border border-neon-green/20">
              <p className="text-xs text-[var(--text-primary)]">{result.description}</p>
            </div>
            <GlassPanel className="p-3">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Next 5 runs</p>
              {result.nextRuns.map((t, i) => (
                <p key={i} className="text-xs font-mono text-[var(--text-secondary)]">{t}</p>
              ))}
            </GlassPanel>
          </div>
        )
      )}
    </ToolCard>
  )
}

function describeCron(min: string, hr: string, day: string, mon: string, wd: string): string {
  const parts: string[] = []
  if (min === '*' && hr === '*') parts.push('Every minute')
  else if (min.startsWith('*/')) parts.push(`Every ${min.slice(2)} minutes`)
  else if (hr === '*') parts.push(`At minute ${min} of every hour`)
  else if (min === '0' && hr === '0') parts.push('At midnight')
  else if (min === '0') parts.push(`At ${hr}:00`)
  else parts.push(`At ${hr}:${min.padStart(2, '0')}`)
  if (day !== '*') parts.push(`on day ${day}`)
  if (mon !== '*') parts.push(`in month ${mon}`)
  const wdNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  if (wd !== '*') {
    const idx = parseInt(wd)
    parts.push(`on ${isNaN(idx) ? wd : (wdNames[idx] || wd)}`)
  }
  return parts.join(' ')
}

function getNextCronRuns(parts: string[], count: number): string[] {
  // Simple approximation: calculate next runs for common patterns
  const runs: string[] = []
  const now = new Date()
  const [min, hr, day, mon, wd] = parts

  const matches = (val: string, current: number, _max: number): boolean => {
    if (val === '*') return true
    if (val.startsWith('*/')) return current % parseInt(val.slice(2)) === 0
    if (val.includes(',')) return val.split(',').map(Number).includes(current)
    if (val.includes('-')) {
      const [lo, hi] = val.split('-').map(Number)
      return current >= lo && current <= hi
    }
    return parseInt(val) === current
  }

  const d = new Date(now)
  d.setSeconds(0)
  d.setMilliseconds(0)
  d.setMinutes(d.getMinutes() + 1)

  let iterations = 0
  while (runs.length < count && iterations < 525960) {
    iterations++
    if (
      matches(min, d.getMinutes(), 59) &&
      matches(hr, d.getHours(), 23) &&
      matches(day, d.getDate(), 31) &&
      matches(mon, d.getMonth() + 1, 12) &&
      matches(wd, d.getDay(), 6)
    ) {
      runs.push(d.toLocaleString())
    }
    d.setMinutes(d.getMinutes() + 1)
  }
  return runs.length > 0 ? runs : ['Could not compute next runs']
}

// --- HTTP Status Code Reference ---
const HTTP_CODES: [number, string, string][] = [
  [100, 'Continue', 'Initial part of request received, continue sending'],
  [101, 'Switching Protocols', 'Server is switching to requested protocol'],
  [200, 'OK', 'Standard successful response'],
  [201, 'Created', 'Resource successfully created'],
  [202, 'Accepted', 'Request accepted for processing'],
  [204, 'No Content', 'Successful but no body returned'],
  [301, 'Moved Permanently', 'Resource permanently moved to new URL'],
  [302, 'Found', 'Resource temporarily at different URL'],
  [304, 'Not Modified', 'Cached version is still valid'],
  [307, 'Temporary Redirect', 'Temporary redirect preserving method'],
  [308, 'Permanent Redirect', 'Permanent redirect preserving method'],
  [400, 'Bad Request', 'Malformed request syntax or invalid parameters'],
  [401, 'Unauthorized', 'Authentication required or failed'],
  [403, 'Forbidden', 'Server understood but refuses to authorize'],
  [404, 'Not Found', 'Requested resource does not exist'],
  [405, 'Method Not Allowed', 'HTTP method not supported for this endpoint'],
  [408, 'Request Timeout', 'Server timed out waiting for the request'],
  [409, 'Conflict', 'Request conflicts with current state of resource'],
  [410, 'Gone', 'Resource permanently removed'],
  [412, 'Precondition Failed', 'Precondition in headers evaluated to false'],
  [413, 'Payload Too Large', 'Request body exceeds server limits'],
  [415, 'Unsupported Media Type', 'Content type not supported'],
  [422, 'Unprocessable Entity', 'Request understood but semantically invalid'],
  [429, 'Too Many Requests', 'Rate limit exceeded'],
  [500, 'Internal Server Error', 'Unexpected server error'],
  [502, 'Bad Gateway', 'Invalid response from upstream server'],
  [503, 'Service Unavailable', 'Server temporarily overloaded or down'],
  [504, 'Gateway Timeout', 'Upstream server did not respond in time'],
]

function HttpStatusTool() {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    if (!search) return HTTP_CODES
    const q = search.toLowerCase()
    return HTTP_CODES.filter(([code, name, desc]) =>
      code.toString().includes(q) || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
    )
  }, [search])
  const getColor = (code: number) => {
    if (code < 200) return 'text-[var(--text-muted)]'
    if (code < 300) return 'text-neon-green'
    if (code < 400) return 'text-neon-cyan'
    if (code < 500) return 'text-neon-amber'
    return 'text-neon-red'
  }

  return (
    <ToolCard icon={Network} color="cyan" title="HTTP Status Code Reference" description="Searchable table of HTTP status codes">
      <Input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code or name..." />
      <div className="mt-3 max-h-64 overflow-y-auto space-y-1 pr-1">
        {filtered.map(([code, name, desc]) => (
          <div key={code} className="flex items-start gap-3 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <span className={clsx('text-xs font-mono font-bold w-8 shrink-0', getColor(code))}>{code}</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--text-primary)]">{name}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{desc}</p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center py-4">No matching status codes</p>}
      </div>
    </ToolCard>
  )
}

// --- Tesla API Endpoint Reference ---
const TESLA_ENDPOINTS: [string, string, string][] = [
  ['GET', '/api/1/users/region', 'Detect user account region'],
  ['GET', '/api/1/vehicles', 'List all vehicles on the account'],
  ['GET', '/api/1/vehicles/{id}', 'Get specific vehicle details'],
  ['GET', '/api/1/vehicles/{id}/vehicle_data', 'Get comprehensive vehicle data'],
  ['POST', '/api/1/vehicles/{id}/command/wake_up', 'Wake vehicle from sleep'],
  ['POST', '/api/1/vehicles/{id}/command/door_lock', 'Lock vehicle doors'],
  ['POST', '/api/1/vehicles/{id}/command/door_unlock', 'Unlock vehicle doors'],
  ['POST', '/api/1/vehicles/{id}/command/honk_horn', 'Honk the horn'],
  ['POST', '/api/1/vehicles/{id}/command/flash_lights', 'Flash the headlights'],
  ['POST', '/api/1/vehicles/{id}/command/charge_start', 'Start charging'],
  ['POST', '/api/1/vehicles/{id}/command/charge_stop', 'Stop charging'],
  ['POST', '/api/1/vehicles/{id}/command/set_charge_limit', 'Set charge limit percentage'],
  ['POST', '/api/1/vehicles/{id}/command/auto_conditioning_start', 'Start climate control'],
  ['POST', '/api/1/vehicles/{id}/command/auto_conditioning_stop', 'Stop climate control'],
  ['POST', '/api/1/vehicles/{id}/command/set_temps', 'Set cabin temperature'],
  ['POST', '/api/1/vehicles/{id}/command/set_sentry_mode', 'Enable/disable sentry mode'],
  ['GET', '/api/1/vehicles/{id}/nearby_charging_sites', 'List nearby Superchargers'],
  ['POST', '/api/1/partner_accounts', 'Register as a Tesla partner'],
  ['GET', '/api/1/partner_accounts/public_key', 'Get partner public key info'],
  ['POST', '/api/1/vehicles/{id}/signed_command', 'Send signed vehicle command'],
  ['POST', '/api/1/vehicles/fleet_telemetry_config', 'Configure fleet telemetry streaming'],
  ['GET', '/api/1/vehicles/{vin}/fleet_telemetry_config', 'Get fleet telemetry config'],
  ['DELETE', '/api/1/vehicles/{vin}/fleet_telemetry_config', 'Remove fleet telemetry config'],
  ['GET', '/api/1/vehicles/{vin}/fleet_telemetry_errors', 'Get fleet telemetry errors'],
  ['POST', '/api/1/vehicles/fleet_status', 'Get fleet status (firmware, telemetry version)'],
]

function TeslaApiRefTool() {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    if (!search) return TESLA_ENDPOINTS
    const q = search.toLowerCase()
    return TESLA_ENDPOINTS.filter(([method, path, desc]) =>
      method.toLowerCase().includes(q) || path.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
    )
  }, [search])

  return (
    <ToolCard icon={BookOpen} color="green" title="Tesla API Endpoint Reference" description="Common Tesla Fleet API endpoints">
      <Input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search endpoints..." />
      <div className="mt-3 max-h-72 overflow-y-auto space-y-1 pr-1">
        {filtered.map(([method, path, desc], i) => (
          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <span className={clsx('text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0', method === 'GET' ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-amber/10 text-neon-amber')}>
              {method}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <code className="text-[10px] font-mono text-[var(--text-primary)] truncate">{path}</code>
                <CopyButton text={path} />
              </div>
              <p className="text-[10px] text-[var(--text-muted)]">{desc}</p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center py-4">No matching endpoints</p>}
      </div>
    </ToolCard>
  )
}

// --- Regex Tester ---
function RegexTesterTool() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testStr, setTestStr] = useState('')
  const result = useMemo(() => {
    if (!pattern || !testStr) return null
    try {
      const re = new RegExp(pattern, flags)
      const matches: { match: string; index: number; groups?: Record<string, string> }[] = []
      let m: RegExpExecArray | null
      if (flags.includes('g')) {
        while ((m = re.exec(testStr)) !== null) {
          matches.push({ match: m[0], index: m.index, groups: m.groups })
          if (!m[0]) break
        }
      } else {
        m = re.exec(testStr)
        if (m) matches.push({ match: m[0], index: m.index, groups: m.groups })
      }
      return { matches, count: matches.length }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [pattern, flags, testStr])

  return (
    <ToolCard icon={Regex} color="amber" title="Regex Tester" description="Test regex patterns against input text">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input type="text" value={pattern} onChange={e => setPattern(e.target.value)} placeholder="Pattern: e.g. \d+" className="flex-1" />
          <Input type="text" value={flags} onChange={e => setFlags(e.target.value)} placeholder="gi" className="w-16" />
        </div>
        <textarea value={testStr} onChange={e => setTestStr(e.target.value)} placeholder="Test string..." className={textareaClasses} rows={3} />
      </div>
      {result && (
        'error' in result ? (
          <ResultPanel title="Regex Error" data={result} error={result.error} />
        ) : (
          <div className="mt-3 p-3 rounded-xl bg-neon-green/5 border border-neon-green/20">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">{result.count} match{result.count !== 1 ? 'es' : ''}</p>
            {result.matches.map((m, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono py-0.5">
                <span className="text-[var(--text-muted)] w-6 text-right shrink-0">{i}:</span>
                <span className="text-neon-green">&quot;{m.match}&quot;</span>
                <span className="text-[var(--text-muted)]">at index {m.index}</span>
              </div>
            ))}
            {result.count === 0 && <p className="text-xs text-[var(--text-muted)]">No matches found</p>}
          </div>
        )
      )}
    </ToolCard>
  )
}

// --- Unix Permission Calculator ---
const PERMS = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'] as const
function UnixPermTool() {
  const [input, setInput] = useState('755')
  const result = useMemo(() => {
    const v = input.trim()
    // Try octal
    if (/^[0-7]{3,4}$/.test(v)) {
      const digits = v.slice(-3).split('').map(Number)
      const symbolic = digits.map(d => PERMS[d]).join('')
      const prefix = v.length === 4 ? v[0] : '0'
      const entities = ['Owner', 'Group', 'Other']
      return {
        octal: v.padStart(4, '0'),
        symbolic: (prefix !== '0' ? prefix : '') + symbolic,
        breakdown: digits.map((d, i) => ({ entity: entities[i], octal: d.toString(), symbolic: PERMS[d] })),
      }
    }
    // Try symbolic (e.g. rwxr-xr-x)
    const sym = v.replace(/^[-d]/, '')
    if (/^([rwx-]{3}){3}$/.test(sym)) {
      const chunks = [sym.slice(0, 3), sym.slice(3, 6), sym.slice(6, 9)]
      const digits = chunks.map(ch => {
        let n = 0
        if (ch[0] === 'r') n += 4
        if (ch[1] === 'w') n += 2
        if (ch[2] === 'x') n += 1
        return n
      })
      const entities = ['Owner', 'Group', 'Other']
      return {
        octal: digits.join(''),
        symbolic: sym,
        breakdown: digits.map((d, i) => ({ entity: entities[i], octal: d.toString(), symbolic: chunks[i] })),
      }
    }
    return null
  }, [input])

  return (
    <ToolCard icon={Lock} color="purple" title="Unix Permission Calculator" description="Convert between octal (755) and symbolic (rwxr-xr-x)">
      <Input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="755 or rwxr-xr-x" />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {['755', '644', '700', '777', '600', '444'].map(p => (
          <Button key={p} variant="ghost" size="sm" onClick={() => setInput(p)} className="!px-2 !py-0.5 !text-[10px] !rounded bg-white/[0.04] text-[var(--text-muted)] hover:bg-white/[0.08] font-mono">
            {p}
          </Button>
        ))}
      </div>
      {result && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-3">
            <div className="flex-1 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <p className="text-[9px] text-[var(--text-muted)] uppercase">Octal</p>
              <div className="flex items-center gap-1 mt-0.5">
                <code className="text-sm font-mono text-[var(--text-primary)]">{result.octal}</code>
                <CopyButton text={result.octal} />
              </div>
            </div>
            <div className="flex-1 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <p className="text-[9px] text-[var(--text-muted)] uppercase">Symbolic</p>
              <div className="flex items-center gap-1 mt-0.5">
                <code className="text-sm font-mono text-[var(--text-primary)]">{result.symbolic}</code>
                <CopyButton text={result.symbolic} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {result.breakdown.map(b => (
              <div key={b.entity} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
                <p className="text-[9px] text-[var(--text-muted)] uppercase">{b.entity}</p>
                <p className="text-xs font-mono text-[var(--text-primary)]">{b.symbolic} <span className="text-[var(--text-muted)]">({b.octal})</span></p>
              </div>
            ))}
          </div>
        </div>
      )}
    </ToolCard>
  )
}

// ─── Client-Side Section ─────────────────────────────────────────

function ClientUtilitiesSection() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4 pt-0">
      <VinDecoderTool />
      <JwtDecoderTool />
      <TimestampTool />
      <Base64Tool />
      <UrlEncoderTool />
      <JsonFormatterTool />
      <UuidGeneratorTool />
      <HashCalculatorTool />
      <ByteSizeTool />
      <ColorConverterTool />
      <CronParserTool />
      <HttpStatusTool />
      <TeslaApiRefTool />
      <RegexTesterTool />
      <UnixPermTool />
    </div>
  )
}

// ─── Main Page Component ─────────────────────────────────────────

export default function DevTools() {
  usePageTitle('Dev Tools')
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const toggle = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer Tools"
        subtitle="Tesla Fleet API utilities, infrastructure diagnostics, and client-side developer tools"
      />

      {/* Section 0: Guided Onboarding Workflow */}
      <AccordionSection
        icon={<ListChecks className="h-4 w-4 text-neon-cyan" />}
        title="Fleet API Setup Wizard"
        description="Guided onboarding workflow"
        badges={<StatusBadge color="cyan" label="Setup" />}
        isOpen={!!openSections.workflow}
        onToggle={() => toggle('workflow')}
      >
        <OnboardingWorkflow />
      </AccordionSection>

      {/* Section 1: Tesla Fleet API */}
      <AccordionSection
        icon={<Wrench className="h-4 w-4 text-neon-cyan" />}
        title="Tesla Fleet API"
        description="API tools & diagnostics"
        badges={<StatusBadge color="cyan" label="API" />}
        isOpen={!!openSections.fleet}
        onToggle={() => toggle('fleet')}
      >
        <FleetApiSection />
      </AccordionSection>

      {/* Section 2: Infrastructure */}
      <AccordionSection
        icon={<Server className="h-4 w-4 text-neon-green" />}
        title="Infrastructure"
        description="Database, MQTT & runtime"
        badges={<StatusBadge color="green" label="Infra" />}
        isOpen={!!openSections.infra}
        onToggle={() => toggle('infra')}
      >
        <InfrastructureSection />
      </AccordionSection>

      {/* Section 3: Client-Side Utilities */}
      <AccordionSection
        icon={<Cpu className="h-4 w-4 text-neon-purple" />}
        title="Client-Side Utilities"
        description="In-browser tools"
        badges={<StatusBadge color="purple" label="Browser" />}
        isOpen={!!openSections.client}
        onToggle={() => toggle('client')}
      >
        <ClientUtilitiesSection />
      </AccordionSection>

      {/* Reference Links */}
      <AccordionSection
        icon={<ExternalLink className="h-4 w-4 text-[var(--text-muted)]" />}
        title="Reference"
        description="Tesla Fleet API docs"
        badges={<StatusBadge color="gray" label="Docs" />}
        isOpen={!!openSections.reference}
        onToggle={() => toggle('reference')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'Fleet API Overview', url: 'https://developer.tesla.com/docs/fleet-api' },
            { label: 'Partner Endpoints', url: 'https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register' },
            { label: 'Tesla Developer Portal', url: 'https://developer.tesla.com' },
            { label: 'Fleet Telemetry Guide', url: 'https://developer.tesla.com/docs/fleet-api/fleet-telemetry' },
          ].map(link => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5 text-neon-cyan shrink-0" />
              <span className="text-xs text-[var(--text-primary)]">{link.label}</span>
            </a>
          ))}
        </div>
      </AccordionSection>
    </div>
  )
}
