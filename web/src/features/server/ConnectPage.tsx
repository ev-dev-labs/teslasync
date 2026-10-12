/**
 * ConnectPage — server picker for the generic native apps.
 *
 * Standalone route (no Layout chrome): the user enters their server
 * address, optionally pastes a personal access token, and the form
 * probes `/system/auth-mode` to validate reachability and learn whether
 * a token is required before saving. Saving reloads the app so every
 * query, stream, and provider boots against the picked server.
 */
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Server } from 'lucide-react'
import { PageHeader } from '@/components/layout'
import { Button, ErrorText, GlassPanel, Icon, Input, Text } from '@/components/ui'
import { usePageTitle } from '@/hooks/usePageTitle'
import {
  getServerBaseUrl,
  normalizeServerUrl,
  probeServer,
  setServerConnection,
  type ServerUrlRejection,
} from '@/lib/serverConnection'

const REJECTION_COPY: Record<ServerUrlRejection, { key: string; fallback: string }> = {
  empty: {
    key: 'serverConnect.connect.errorEmpty',
    fallback: 'Enter a server address, e.g. https://teslasync.example.com.',
  },
  'unsupported-scheme': {
    key: 'serverConnect.connect.errorScheme',
    fallback: 'Use an http:// or https:// address.',
  },
  unparseable: {
    key: 'serverConnect.connect.errorParse',
    fallback: "That address doesn't look valid — check it and try again.",
  },
  'missing-host': {
    key: 'serverConnect.connect.errorHost',
    fallback: 'That address has no host — e.g. https://teslasync.example.com.',
  },
  'credentials-in-url': {
    key: 'serverConnect.connect.errorCredentials',
    fallback: 'Leave usernames and passwords out of the address.',
  },
  'subpath-not-supported': {
    key: 'serverConnect.connect.errorSubpath',
    fallback: 'Enter just the server origin, without a /path.',
  },
}

export default function ConnectPage() {
  const { t } = useTranslation()
  usePageTitle(t('serverConnect.connect.title', 'Connect to your server'))

  const [server, setServer] = useState(getServerBaseUrl)
  const [token, setToken] = useState('')
  const [modeHint, setModeHint] = useState<'open' | 'forward_auth' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<'server' | 'token' | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const errorId = useId()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (inFlight.current) return
    setError(null)
    setErrorField(null)
    setModeHint(null)

    const normalized = normalizeServerUrl(server)
    if (!normalized.accepted) {
      const copy = REJECTION_COPY[normalized.rejection ?? 'unparseable']
      setError(t(copy.key, copy.fallback))
      setErrorField('server')
      return
    }

    inFlight.current = true
    setBusy(true)
    try {
      const probe = await probeServer(normalized.url, token.trim() === '' ? null : token)
      if (!probe.ok) {
        if (probe.authenticationRequired) {
          setModeHint('forward_auth')
          setErrorField('token')
          setError(token.trim() === ''
            ? t('serverConnect.connect.errorTokenRequired', 'This server needs an access token — paste one to continue.')
            : t('serverConnect.connect.errorTokenRejected', 'This server rejected the access token. Check the key and try again.'))
        } else {
          setError(t('serverConnect.connect.errorUnreachable', "Couldn't reach a TeslaSync server there. Check the address and that the server is running."))
        }
        return
      }
      if (probe.mode === 'forward_auth' && token.trim() === '') {
        setModeHint('forward_auth')
        setErrorField('token')
        setError(t('serverConnect.connect.errorTokenRequired', 'This server needs an access token — paste one to continue.'))
        return
      }
      setServerConnection(normalized.url, token.trim() === '' ? null : token)
      // A picked server changes the origin of every query, stream, and
      // cached payload — reboot onto it instead of hot-swapping.
      window.location.href = '/'
    } catch {
      setError(t('serverConnect.connect.errorSave', 'Could not save this connection. Check whether browser storage is enabled.'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <GlassPanel className="w-full max-w-md p-4 sm:p-6">
        <PageHeader
          title={t('serverConnect.connect.title', 'Connect to your server')}
          subtitle={t('serverConnect.connect.subtitle', 'Enter your TeslaSync address to continue.')}
          icon={<Icon icon={Server} size="lg" />}
        />
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('serverConnect.connect.serverLabel', 'Server address')}
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder={t('serverConnect.connect.serverPlaceholder', 'https://teslasync.example.com')}
            hint={t('serverConnect.connect.serverHint', 'Your self-hosted TeslaSync URL — local addresses like http://192.168.1.10:4000 work too.')}
            autoComplete="url"
            inputMode="url"
            autoFocus
            disabled={busy}
            aria-invalid={errorField === 'server' || undefined}
            aria-describedby={errorField === 'server' ? errorId : undefined}
            className="min-h-11 md:min-h-10"
          />
          <Input
            label={`${t('serverConnect.connect.tokenLabel', 'Access token')} (${t('serverConnect.connect.tokenOptional', 'optional')})`}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t('serverConnect.connect.tokenPlaceholder', 'ts_…')}
            hint={t('serverConnect.connect.tokenHint', 'Only needed when your server uses forward-auth login. Create one under Admin → API Keys.')}
            type="password"
            autoComplete="off"
            icon={<Icon icon={KeyRound} />}
            disabled={busy}
            aria-invalid={errorField === 'token' || undefined}
            aria-describedby={errorField === 'token' ? errorId : undefined}
            className="min-h-11 md:min-h-10"
          />
          {modeHint === 'forward_auth' && (
            <Text as="p" variant="caption">
              {t('serverConnect.connect.modeForwardAuth', 'This server uses login — an access token is required.')}
            </Text>
          )}
          {error != null && (
            <ErrorText id={errorId} role="alert">
              {error}
            </ErrorText>
          )}
          <Button type="submit" variant="primary" size="md" loading={busy} wrapLabel className="w-full min-h-11 md:min-h-10">
            {busy
              ? t('serverConnect.connect.connecting', 'Connecting…')
              : t('serverConnect.connect.submit', 'Connect')}
          </Button>
        </form>
      </GlassPanel>
    </div>
  )
}
