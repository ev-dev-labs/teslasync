/**
 * @module components/feedback/ReauthDialog
 *
 * Phase-46 / Prompt 31 — sudo-style step-up reauth dialog.
 *
 * The {@link ReauthDialog} is opened by the {@link request} client in
 * `web/src/api/client.ts` when the backend gates a sensitive action
 * with the RequireSudo middleware (401 + `code: 'SUDO_REQUIRED'`).
 *
 * Auth-mode aware:
 *   • forward-auth installs render the credential form (password tab,
 *     plus a TOTP tab when enabled) and POST /auth/reauth to mint a
 *     sudo token bound to the X-Forwarded-User subject;
 *   • open-mode installs render a typed-confirmation form and resolve
 *     locally — no token is minted, the route's RequireSudo middleware
 *     is a passthrough, and the action proceeds.
 *
 * Usage:
 *   1. Mount {@link ReauthDialogRoot} once at the top of the component
 *      tree (e.g. inside <Layout>).
 *   2. Whenever the API returns SUDO_REQUIRED, the request() client
 *      automatically calls the registered challenge provider — no
 *      explicit caller wiring is needed. On user cancel, the original
 *      mutation rejects with a {@link SudoCanceledError} the caller
 *      may treat as a "user changed their mind" no-op.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button, Input, Tabs, type TabItem } from '@/components/ui'
import { ErrorText, HelperText } from '@/components/ui'
import { useSessionMonitor } from '@/hooks/useSessionMonitor'
import {
  registerSudoChallengeProvider,
  SudoCanceledError,
  type SudoChallengeProvider,
  type SudoCredential,
  apiUrl,
} from '@/api/client'

export { SudoCanceledError } from '@/api/client'

/**
 * Mode the dialog is operating in. Forward-auth installs require a
 * credential; open-mode installs only need a typed confirmation. The
 * mode is resolved per-prompt from {@link useSessionMonitor} so a
 * proxy mid-flight flip is handled cleanly.
 */
type DialogMode = 'credential' | 'confirm'

interface PendingChallenge {
  /** API path that triggered the prompt. Surfaced to the dialog so
   * future enhancements can show "you are about to do X" context. */
  path: string
  /** Resolves with the SudoCredential after a successful submission. */
  resolve: (cred: SudoCredential) => void
  /** Rejects with a SudoCanceledError when the user dismisses. */
  reject: (err: Error) => void
}

// Module-level queue. Only one challenge is ever active because the
// dialog is modal — concurrent SUDO_REQUIRED responses await the same
// promise via the listeners below.
let active: PendingChallenge | null = null
let pending: PendingChallenge[] = []
type Listener = () => void
const listeners = new Set<Listener>()

function notify(): void {
  for (const l of listeners) l()
}

function enqueue(path: string): Promise<SudoCredential> {
  return new Promise<SudoCredential>((resolve, reject) => {
    const ch: PendingChallenge = { path, resolve, reject }
    if (active == null) {
      active = ch
    } else {
      pending.push(ch)
    }
    notify()
  })
}

function resolveActive(cred: SudoCredential): void {
  if (active == null) return
  const ch = active
  active = pending.shift() ?? null
  ch.resolve(cred)
  notify()
}

function rejectActive(err: Error): void {
  if (active == null) return
  const ch = active
  active = pending.shift() ?? null
  ch.reject(err)
  notify()
}

/**
 * Test-only — drains the queue so each `describe` starts clean. Marked
 * with the `__tests__` underscore prefix so production code never
 * imports it.
 */
export function __resetReauthDialogForTests(): void {
  if (active != null) {
    try {
      active.reject(new Error('test reset'))
    } catch {
      /* swallow */
    }
  }
  for (const ch of pending) {
    try {
      ch.reject(new Error('test reset'))
    } catch {
      /* swallow */
    }
  }
  active = null
  pending = []
  notify()
}

/**
 * Test-only — directly enqueues a challenge without going through the
 * api/client registration round-trip. Used by ReauthDialog tests to
 * assert the queue + Root composition; production code never imports
 * this.
 */
export function __enqueueSudoChallengeForTests(
  path = '/test',
): Promise<SudoCredential> {
  return enqueue(path)
}

/**
 * Registers `enqueue` with the API client. Returns the unregister
 * function for use in test teardown.
 */
function registerProvider(): () => void {
  const provider: SudoChallengeProvider = (path) => enqueue(path)
  return registerSudoChallengeProvider(provider)
}

interface ReauthDialogState {
  active: PendingChallenge | null
  /** Total count including queued + active so the dialog can show
   * "1 of N pending" if we ever surface that. */
  total: number
}

function useReauthDialogState(): ReauthDialogState {
  const [state, setState] = useState<ReauthDialogState>(() => ({
    active,
    total: (active != null ? 1 : 0) + pending.length,
  }))

  useEffect(() => {
    const update: Listener = () => {
      setState({
        active,
        total: (active != null ? 1 : 0) + pending.length,
      })
    }
    listeners.add(update)
    return () => {
      listeners.delete(update)
    }
  }, [])

  return state
}

export interface ReauthDialogProps {
  /** Hard override for the dialog mode. When unset, the mode is
   * derived from `useSessionMonitor()` so open-mode installs always
   * see the typed-confirmation variant. */
  forceMode?: DialogMode
}

const TYPED_CONFIRMATION_TOKEN = 'CONFIRM'

/**
 * The portal-mounted dialog. Subscribes to the module-level queue and
 * renders whenever an active challenge exists.
 */
export function ReauthDialogRoot({ forceMode }: ReauthDialogProps = {}) {
  const { active: current } = useReauthDialogState()
  const monitor = useSessionMonitor()
  const open = current != null

  useEffect(() => {
    return registerProvider()
  }, [])

  // Resolve mode each render so a mid-flight proxy flip is honoured.
  const mode: DialogMode =
    forceMode ?? (monitor.mode === 'open' ? 'confirm' : 'credential')

  return (
    <ReauthDialog
      open={open}
      mode={mode}
      path={current?.path ?? ''}
      onSubmit={(cred) => resolveActive(cred)}
      onCancel={() => rejectActive(new SudoCanceledError())}
    />
  )
}

/**
 * Pure, presentation-only dialog. Exported for direct rendering in
 * tests; production code mounts {@link ReauthDialogRoot}.
 */
export interface PureReauthDialogProps {
  open: boolean
  mode: DialogMode
  path: string
  onSubmit: (cred: SudoCredential) => void
  onCancel: () => void
  /** Override the credential POST for tests. Must mirror the server's
   * { sudo_token, expires_at, mode } shape. */
  onSubmitCredential?: (body: SudoSubmitBody) => Promise<SudoCredential>
}

interface SudoSubmitBody {
  password?: string
  totp_code?: string
}

/**
 * Issues POST /auth/reauth and returns the parsed credential. Kept as
 * a free function (not an `request<T>` call) so it bypasses the
 * SUDO_REQUIRED interceptor — calling the interceptor from inside the
 * recovery flow would deadlock.
 */
async function defaultSubmitCredential(body: SudoSubmitBody): Promise<SudoCredential> {
  const res = await fetch(apiUrl('/auth/reauth'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}) as Record<string, unknown>)
    const message =
      typeof errBody.error === 'string' && errBody.error.trim() !== ''
        ? errBody.error
        : `HTTP ${res.status}`
    const err = new Error(message)
    ;(err as Error & { code?: string; status?: number }).code =
      typeof errBody.code === 'string' ? errBody.code : undefined
    ;(err as Error & { code?: string; status?: number }).status = res.status
    throw err
  }
  const json = (await res.json()) as Partial<SudoCredential>
  return {
    mode: json.mode === 'open' ? 'open' : 'session',
    token: typeof json.token === 'string' ? json.token : undefined,
    expiresAt: typeof json.expiresAt === 'string' ? json.expiresAt : undefined,
  }
}

/**
 * Inner dialog. Owns the form state and the submit/cancel routing.
 */
export function ReauthDialog(props: PureReauthDialogProps) {
  const {
    open,
    mode,
    path,
    onSubmit,
    onCancel,
    onSubmitCredential = defaultSubmitCredential,
  } = props
  const { t } = useTranslation()

  const credentialTabs = useMemo<TabItem[]>(
    () => [
      { key: 'password', label: t('sudo.tabs.password', 'Password') },
      { key: 'totp', label: t('sudo.tabs.totp', 'Authenticator') },
    ],
    [t],
  )

  const [activeTab, setActiveTab] = useState<'password' | 'totp'>('password')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  // Reset form whenever the dialog re-opens for a fresh challenge so the
  // previous attempt's text never bleeds across actions. Re-keyed on
  // `path` as well so consecutive queued challenges (open stays true)
  // still get a clean form when the active changes.
  useEffect(() => {
    if (open) {
      setPassword('')
      setTotp('')
      setConfirmText('')
      setError(null)
      setActiveTab('password')
      setSubmitting(false)
      submittingRef.current = false
    }
  }, [open, path])

  const handleCancel = useCallback(() => {
    if (submittingRef.current) return
    onCancel()
  }, [onCancel])

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (submittingRef.current) return

      // Confirm-mode resolves locally — no network round-trip, no
      // token. The interceptor short-circuits subsequent retries with
      // mode='open' so the action proceeds without an X-Sudo-Token.
      if (mode === 'confirm') {
        if (confirmText.trim() !== TYPED_CONFIRMATION_TOKEN) {
          setError(
            t(
              'sudo.errors.typedConfirmationMismatch',
              'Type {{token}} exactly to confirm.',
              { token: TYPED_CONFIRMATION_TOKEN },
            ),
          )
          return
        }
        onSubmit({ mode: 'open' })
        return
      }

      submittingRef.current = true
      setSubmitting(true)
      setError(null)
      try {
        const body: SudoSubmitBody =
          activeTab === 'password' ? { password } : { totp_code: totp }
        if (activeTab === 'password' && password.trim() === '') {
          setError(t('sudo.errors.passwordRequired', 'Enter your password to continue.'))
          return
        }
        if (activeTab === 'totp' && totp.trim() === '') {
          setError(
            t('sudo.errors.totpRequired', 'Enter the 6-digit code from your authenticator.'),
          )
          return
        }

        const cred = await onSubmitCredential(body)
        onSubmit(cred)
      } catch (err) {
        const code = (err as Error & { code?: string }).code
        if (code === 'REAUTH_NOT_CONFIGURED') {
          setError(
            t(
              'sudo.errors.notConfigured',
              'Step-up reauth is not configured on this server. Ask your administrator to set TESLASYNC_SUDO_PASSWORD or TESLASYNC_SUDO_TOTP_SECRET.',
            ),
          )
        } else if (code === 'INVALID_CREDENTIAL') {
          setError(
            activeTab === 'password'
              ? t('sudo.errors.invalidPassword', 'Password did not match.')
              : t('sudo.errors.invalidTotp', 'Authenticator code was rejected.'),
          )
        } else {
          setError(
            err instanceof Error
              ? err.message
              : t('sudo.errors.unknown', 'Reauthentication failed.'),
          )
        }
      } finally {
        submittingRef.current = false
        setSubmitting(false)
      }
    },
    [activeTab, confirmText, mode, onSubmit, onSubmitCredential, password, t, totp],
  )

  const dialogTitle =
    mode === 'confirm'
      ? t('sudo.openMode.title', 'Confirm sensitive action')
      : t('sudo.title', 'Confirm your identity')

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      size="sm"
      title={dialogTitle}
      data-testid="reauth-dialog"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          {mode === 'confirm'
            ? t(
                'sudo.openMode.body',
                'This is a destructive action. Type {{token}} to continue.',
                { token: TYPED_CONFIRMATION_TOKEN },
              )
            : t(
                'sudo.description',
                'For your security, please re-enter your password or authenticator code before this action runs.',
              )}
        </p>

        {mode === 'credential' ? (
          <>
            <Tabs
              tabs={credentialTabs}
              activeTab={activeTab}
              onChange={(k) => setActiveTab(k === 'totp' ? 'totp' : 'password')}
              ariaLabel={t('sudo.tabs.label', 'Reauth method')}
            />
            {activeTab === 'password' ? (
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                label={t('sudo.passwordLabel', 'Password')}
                required
                autoFocus
                autoComplete="current-password"
                data-testid="reauth-password"
                disabled={submitting}
              />
            ) : (
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                label={t('sudo.totpLabel', 'Authenticator code')}
                required
                autoFocus
                autoComplete="one-time-code"
                data-testid="reauth-totp"
                disabled={submitting}
              />
            )}
            <HelperText>
              {t(
                'sudo.helper',
                'Your reauth lasts 5 minutes; rapid follow-up actions will not re-prompt.',
              )}
            </HelperText>
          </>
        ) : (
          <Input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            label={t('sudo.typedConfirmationLabel', 'Type {{token}} to confirm', {
              token: TYPED_CONFIRMATION_TOKEN,
            })}
            required
            autoFocus
            autoComplete="off"
            data-testid="reauth-confirm-text"
            disabled={submitting}
          />
        )}

        {error != null ? (
          <ErrorText data-testid="reauth-error">{error}</ErrorText>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleCancel}
            data-testid="reauth-cancel"
            disabled={submitting}
          >
            {t('sudo.cancel', 'Cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            data-testid="reauth-submit"
          >
            {mode === 'confirm'
              ? t('sudo.openMode.submit', 'Continue')
              : t('sudo.submit', 'Confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
