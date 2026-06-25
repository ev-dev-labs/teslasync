// Native parity port of web/src/components/feedback/ReauthDialog.tsx.
//
// Sudo-style step-up reauth dialog. The web source is opened by the api/client
// `request()` interceptor whenever the backend gates a sensitive action with a
// 401 + `code: 'SUDO_REQUIRED'` response. Mode-aware behaviour is preserved:
//   • forward-auth installs render the credential form (password tab, plus a
//     TOTP tab when enabled) and POST /auth/reauth (or /auth/totp/sudo for
//     per-user TOTP) to mint a sudo token;
//   • open-mode installs render a typed-confirmation form and resolve locally
//     with { mode: 'open' } — no token is minted.
//
// The module-level challenge queue (active/pending/listeners/enqueue/
// resolveActive/rejectActive), the test-only seams
// (__resetReauthDialogForTests / __enqueueSudoChallengeForTests), the provider
// registration, the credential POST helpers, and ALL component state names
// (activeTab, password, totp, confirmText, submitting, error, submittingRef)
// are ported verbatim. The reauth flow fully functions on native — `apiUrl` and
// the SUDO_REQUIRED interceptor already exist in the native api/client, so this
// is NOT an "unavailable" stub.
//
// Browser-only dependencies replaced per conversion rules 4/7 (documented in
// the sidecar):
//   - web <Modal> (createPortal/document/focus-trap) -> React Native <Modal>
//     with an overlay/backdrop/dialog scaffold (same pattern as the sibling
//     ConfirmDialog / AddAnnotationPopover ports). The web Modal's hardcoded
//     "Close" aria-label is mirrored on the native close Pressable.
//   - web <Tabs> (role=tablist DOM buttons) -> a native DialogTabs view using
//     accessibilityRole tablist/tab + roving selected state.
//   - web <Input> / <Button> / <ErrorText> / <HelperText> -> RN <TextInput>,
//     Pressable DialogAction buttons, and styled <AppText>. type=password ->
//     secureTextEntry; inputMode=numeric/pattern -> keyboardType=number-pad +
//     the same /\D/g digit-only slice(0,8) transform; autoComplete/textContent
//     hints are kept via textContentType.
//   - react-i18next useTranslation -> a local useNativeTranslationFallback that
//     returns the inline English fallback AND interpolates {{token}} options,
//     so every `t(key, fallback, opts)` call site and its i18n key are kept.
//   - @/hooks/useSessionMonitor (window.setInterval / focus polling) -> a local
//     useReauthSessionMode() that reads the SAME /auth/session endpoint via the
//     native request() client and derives open/session/unknown — only the
//     `mode` field the dialog actually consumes is reproduced.
//   - FormEvent<HTMLFormElement> submit -> a no-arg handleSubmit fired by the
//     primary button's onPress (no e.preventDefault needed on native).
// data-testid attributes are preserved verbatim as testID.

import React, {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';
import {
  apiUrl,
  registerSudoChallengeProvider,
  request,
  SudoCanceledError,
  type SudoChallengeProvider,
  type SudoCredential,
} from '../../api/client';
import type {SessionInfo} from '../../api/types';
import {useTOTPStatus} from '../../api/hooks/useTOTP';

export {SudoCanceledError} from '../../api/client';

/**
 * Mode the dialog is operating in. Forward-auth installs require a credential;
 * open-mode installs only need a typed confirmation. The mode is resolved from
 * the session monitor so a proxy mid-flight flip is handled cleanly.
 */
type DialogMode = 'credential' | 'confirm';

interface PendingChallenge {
  /** API path that triggered the challenge; available for future action context. */
  path: string;
  /** Resolves with the SudoCredential after a successful submission. */
  resolve: (cred: SudoCredential) => void;
  /** Rejects with a SudoCanceledError when the user dismisses. */
  reject: (err: Error) => void;
}

// Module-level queue. Only one challenge is ever active because the dialog is
// modal — concurrent SUDO_REQUIRED responses await the same promise via the
// listeners below.
let active: PendingChallenge | null = null;
let pending: PendingChallenge[] = [];
type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    l();
  }
}

function enqueue(path: string): Promise<SudoCredential> {
  return new Promise<SudoCredential>((resolve, reject) => {
    const ch: PendingChallenge = {path, resolve, reject};
    if (active == null) {
      active = ch;
    } else {
      pending.push(ch);
    }
    notify();
  });
}

function resolveActive(cred: SudoCredential): void {
  if (active == null) {
    return;
  }
  const ch = active;
  active = pending.shift() ?? null;
  ch.resolve(cred);
  notify();
}

function rejectActive(err: Error): void {
  if (active == null) {
    return;
  }
  const ch = active;
  active = pending.shift() ?? null;
  ch.reject(err);
  notify();
}

/**
 * Test-only — drains the queue so each `describe` starts clean. Marked with the
 * `__tests__` underscore prefix so production code never imports it.
 */
export function __resetReauthDialogForTests(): void {
  if (active != null) {
    try {
      active.reject(new Error('test reset'));
    } catch {
      /* swallow */
    }
  }
  for (const ch of pending) {
    try {
      ch.reject(new Error('test reset'));
    } catch {
      /* swallow */
    }
  }
  active = null;
  pending = [];
  notify();
}

/**
 * Test-only — directly enqueues a challenge without going through the
 * api/client registration round-trip. Used by ReauthDialog tests to assert the
 * queue + Root composition; production code never imports this.
 */
export function __enqueueSudoChallengeForTests(
  path = '/test',
): Promise<SudoCredential> {
  return enqueue(path);
}

/**
 * Registers `enqueue` with the API client. Returns the unregister function for
 * use in test teardown.
 */
function registerProvider(): () => void {
  const provider: SudoChallengeProvider = path => enqueue(path);
  return registerSudoChallengeProvider(provider);
}

interface ReauthDialogState {
  active: PendingChallenge | null;
  /** Total count including queued + active so the dialog can show "1 of N
   * pending" if we ever surface that. */
  total: number;
}

function useReauthDialogState(): ReauthDialogState {
  const [state, setState] = useState<ReauthDialogState>(() => ({
    active,
    total: (active != null ? 1 : 0) + pending.length,
  }));

  useEffect(() => {
    const update: Listener = () => {
      setState({
        active,
        total: (active != null ? 1 : 0) + pending.length,
      });
    };
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  return state;
}

/**
 * Native replacement for the web `useSessionMonitor()` dependency. The dialog
 * only consumes `monitor.mode`, so this minimal hook reads the SAME
 * /auth/session endpoint via the native request() client and derives the
 * open/session/unknown discriminator — preserving the API path and the
 * "open mode => typed confirmation" behaviour without porting the full
 * countdown monitor.
 */
function useReauthSessionMode(): {mode: 'open' | 'session' | 'unknown'} {
  const query = useQuery<SessionInfo>({
    queryKey: ['auth', 'session'],
    queryFn: ({signal}) => request<SessionInfo>('/auth/session', {signal}),
    staleTime: 4 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const data = query.data ?? null;
  if (data == null) {
    return {mode: 'unknown'};
  }
  return {mode: data.mode === 'open' ? 'open' : 'session'};
}

export interface ReauthDialogProps {
  /** Hard override for the dialog mode. When unset, the mode is derived from
   * the session monitor so open-mode installs always see the typed-confirmation
   * variant. */
  forceMode?: DialogMode;
}

const TYPED_CONFIRMATION_TOKEN = 'CONFIRM';

/**
 * The mounted dialog. Subscribes to the module-level queue and renders whenever
 * an active challenge exists.
 */
export function ReauthDialogRoot({forceMode}: ReauthDialogProps = {}) {
  const {active: current} = useReauthDialogState();
  const monitor = useReauthSessionMode();
  const open = current != null;

  useEffect(() => {
    return registerProvider();
  }, []);

  // Resolve mode each render so a mid-flight proxy flip is honoured.
  const mode: DialogMode =
    forceMode ?? (monitor.mode === 'open' ? 'confirm' : 'credential');

  // Query per-user TOTP enrollment only in credential mode. It controls tab
  // visibility and routes enrolled users to /auth/totp/sudo; legacy
  // shared-secret installs continue through /auth/reauth.
  const totpStatus = useTOTPStatus({enabled: mode === 'credential'});
  const totpEnrolled =
    totpStatus.data != null &&
    totpStatus.data.mode === 'session' &&
    totpStatus.data.activated === true;
  // Show the TOTP tab when EITHER per-user TOTP is enrolled OR we haven't
  // proven it isn't (loading / errored / 501) — preserves backward compat with
  // installs that have only the shared secret and never call the per-user
  // endpoint.
  const totpTabAvailable =
    !totpStatus.isFetched ||
    totpStatus.isError ||
    totpEnrolled ||
    totpStatus.data?.mode !== 'open';

  const submitCredential = useMemo<
    PureReauthDialogProps['onSubmitCredential']
  >(() => {
    if (!totpEnrolled) {
      return undefined;
    }
    // When per-user TOTP is enrolled, route TOTP submissions to the per-user
    // endpoint; password submissions still go to /auth/reauth.
    return async (body: SudoSubmitBody): Promise<SudoCredential> => {
      if (body.totp_code != null) {
        return submitPerUserTotp(body.totp_code);
      }
      return defaultSubmitCredential(body);
    };
  }, [totpEnrolled]);

  return (
    <ReauthDialog
      mode={mode}
      onCancel={() => rejectActive(new SudoCanceledError())}
      onSubmit={cred => resolveActive(cred)}
      onSubmitCredential={submitCredential}
      open={open}
      path={current?.path ?? ''}
      totpTabAvailable={totpTabAvailable}
    />
  );
}
ReauthDialogRoot.displayName = 'ReauthDialogRoot';

/**
 * Pure, presentation-only dialog. Exported for direct rendering in tests;
 * production code mounts {@link ReauthDialogRoot}.
 */
export interface PureReauthDialogProps {
  open: boolean;
  mode: DialogMode;
  path: string;
  onSubmit: (cred: SudoCredential) => void;
  onCancel: () => void;
  /** Override the credential POST for tests. Must mirror the server's
   * { sudo_token, expires_at, mode } shape. */
  onSubmitCredential?: (body: SudoSubmitBody) => Promise<SudoCredential>;
  /**
   * Controls TOTP tab visibility. Defaults to true for direct test renders;
   * production disables it when neither per-user nor shared-secret TOTP exists.
   */
  totpTabAvailable?: boolean;
}

interface SudoSubmitBody {
  password?: string;
  totp_code?: string;
}

/**
 * Issues POST /auth/reauth and returns the parsed credential. Kept as a free
 * function (not a request<T>() call) so it bypasses the SUDO_REQUIRED
 * interceptor — calling the interceptor from inside the recovery flow would
 * deadlock.
 *
 * Parses snake_case `sudo_token` and `expires_at`, while tolerating legacy
 * camelCase aliases during mixed-version deployments.
 */
async function defaultSubmitCredential(
  body: SudoSubmitBody,
): Promise<SudoCredential> {
  const res = await fetch(apiUrl('/auth/reauth'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res
      .json()
      .catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
    const message =
      typeof errBody.error === 'string' && errBody.error.trim() !== ''
        ? errBody.error
        : `HTTP ${res.status}`;
    const err = new Error(message) as Error & {code?: string; status?: number};
    err.code = typeof errBody.code === 'string' ? errBody.code : undefined;
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as Record<string, unknown>;
  const tokenValue =
    typeof json.sudo_token === 'string'
      ? json.sudo_token
      : typeof json.token === 'string'
      ? json.token
      : undefined;
  const expiresValue =
    typeof json.expires_at === 'string'
      ? json.expires_at
      : typeof json.expiresAt === 'string'
      ? json.expiresAt
      : undefined;
  return {
    mode: json.mode === 'open' ? 'open' : 'session',
    token: tokenValue,
    expiresAt: expiresValue,
  };
}

/**
 * Submits per-user TOTP to /auth/totp/sudo instead of the shared-secret
 * /auth/reauth path. Matches defaultSubmitCredential error handling.
 */
async function submitPerUserTotp(code: string): Promise<SudoCredential> {
  const res = await fetch(apiUrl('/auth/totp/sudo'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({code}),
  });
  if (!res.ok) {
    const errBody = (await res
      .json()
      .catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
    // Renamed from the web's inner `code` const to satisfy no-shadow against the
    // function param `code`; semantics are unchanged.
    const rawCode =
      typeof errBody.code === 'string' && errBody.code.trim() !== ''
        ? errBody.code
        : undefined;
    // Map per-user TOTP errors back to the legacy INVALID_CREDENTIAL code so the
    // dialog's existing error-message branch still fires.
    const remappedCode =
      rawCode === 'TOTP_INVALID' ? 'INVALID_CREDENTIAL' : rawCode;
    const message =
      typeof errBody.error === 'string' && errBody.error.trim() !== ''
        ? errBody.error
        : `HTTP ${res.status}`;
    const err = new Error(message) as Error & {code?: string; status?: number};
    err.code = remappedCode;
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as Record<string, unknown>;
  return {
    mode: 'session',
    token: typeof json.sudo_token === 'string' ? json.sudo_token : undefined,
    expiresAt:
      typeof json.expires_at === 'string' ? json.expires_at : undefined,
  };
}

type NativeTOptions = Record<string, string>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

// react-i18next has no native parity module; resolve to the inline English
// fallback and interpolate {{token}} options so the i18n key + copy intent
// survive (same pattern as the BrowserCompatBanner / EmptyStateThreshold ports).
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.entries(options).reduce(
        (text, [token, value]) => text.split(`{{${token}}}`).join(value),
        fallback,
      );
    },
    [],
  );
}

interface TabItem {
  key: string;
  label: string;
  disabled?: boolean;
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
    totpTabAvailable = true,
  } = props;
  const t = useNativeTranslationFallback();

  const credentialTabs = useMemo<TabItem[]>(() => {
    const tabs: TabItem[] = [
      {key: 'password', label: t('sudo.tabs.password', 'Password')},
    ];
    if (totpTabAvailable) {
      tabs.push({key: 'totp', label: t('sudo.tabs.totp', 'Authenticator')});
    }
    return tabs;
  }, [t, totpTabAvailable]);

  const [activeTab, setActiveTab] = useState<'password' | 'totp'>('password');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  // If the TOTP tab disappears mid-flight (e.g. status query returns
  // mode='open'), fall back to the password tab so the visible selection always
  // matches a tab that actually exists.
  useEffect(() => {
    if (!totpTabAvailable && activeTab === 'totp') {
      setActiveTab('password');
    }
  }, [totpTabAvailable, activeTab]);

  // Reset form whenever the dialog re-opens for a fresh challenge so the
  // previous attempt's text never bleeds across actions. Re-keyed on `path` as
  // well so consecutive queued challenges (open stays true) still get a clean
  // form when the active changes.
  useEffect(() => {
    if (open) {
      setPassword('');
      setTotp('');
      setConfirmText('');
      setError(null);
      setActiveTab('password');
      setSubmitting(false);
      submittingRef.current = false;
    }
  }, [open, path]);

  const handleCancel = useCallback(() => {
    if (submittingRef.current) {
      return;
    }
    onCancel();
  }, [onCancel]);

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) {
      return;
    }

    // Confirm-mode resolves locally — no network round-trip, no token. The
    // interceptor short-circuits subsequent retries with mode='open' so the
    // action proceeds without an X-Sudo-Token.
    if (mode === 'confirm') {
      if (confirmText.trim() !== TYPED_CONFIRMATION_TOKEN) {
        setError(
          t(
            'sudo.errors.typedConfirmationMismatch',
            'Type {{token}} exactly to confirm.',
            {token: TYPED_CONFIRMATION_TOKEN},
          ),
        );
        return;
      }
      onSubmit({mode: 'open'});
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const body: SudoSubmitBody =
        activeTab === 'password' ? {password} : {totp_code: totp};
      if (activeTab === 'password' && password.trim() === '') {
        setError(
          t('sudo.errors.passwordRequired', 'Enter your password to continue.'),
        );
        return;
      }
      if (activeTab === 'totp' && totp.trim() === '') {
        setError(
          t(
            'sudo.errors.totpRequired',
            'Enter the 6-digit code from your authenticator.',
          ),
        );
        return;
      }

      const cred = await onSubmitCredential(body);
      onSubmit(cred);
    } catch (err) {
      const code = (err as Error & {code?: string}).code;
      if (code === 'REAUTH_NOT_CONFIGURED') {
        setError(
          t(
            'sudo.errors.notConfigured',
            'Step-up reauth is not configured on this server. Ask your administrator to set TESLASYNC_SUDO_PASSWORD or TESLASYNC_SUDO_TOTP_SECRET.',
          ),
        );
      } else if (code === 'INVALID_CREDENTIAL') {
        setError(
          activeTab === 'password'
            ? t('sudo.errors.invalidPassword', 'Password did not match.')
            : t('sudo.errors.invalidTotp', 'Authenticator code was rejected.'),
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : t('sudo.errors.unknown', 'Reauthentication failed.'),
        );
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [
    activeTab,
    confirmText,
    mode,
    onSubmit,
    onSubmitCredential,
    password,
    t,
    totp,
  ]);

  const dialogTitle =
    mode === 'confirm'
      ? t('sudo.openMode.title', 'Confirm sensitive action')
      : t('sudo.title', 'Confirm your identity');

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleCancel}
      transparent
      visible={open}>
      <View
        accessibilityLabel={dialogTitle}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          disabled={submitting}
          importantForAccessibility="no-hide-descendants"
          onPress={handleCancel}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="reauth-dialog">
          <View style={styles.header}>
            <AppText style={styles.title} variant="title" weight="bold">
              {dialogTitle}
            </AppText>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              disabled={submitting}
              onPress={handleCancel}
              style={({pressed}) => [
                styles.closeButton,
                pressed && !submitting && styles.pressed,
              ]}>
              <AppText style={styles.closeGlyph} weight="bold">
                ×
              </AppText>
            </Pressable>
          </View>

          <ScrollView
            bounces={false}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled">
            <AppText style={styles.description} tone="secondary">
              {mode === 'confirm'
                ? t(
                    'sudo.openMode.body',
                    'This is a destructive action. Type {{token}} to continue.',
                    {token: TYPED_CONFIRMATION_TOKEN},
                  )
                : t(
                    'sudo.description',
                    'For your security, please re-enter your password or authenticator code before this action runs.',
                  )}
            </AppText>

            {mode === 'credential' ? (
              <>
                <DialogTabs
                  activeTab={activeTab}
                  ariaLabel={t('sudo.tabs.label', 'Reauth method')}
                  onChange={k => setActiveTab(k === 'totp' ? 'totp' : 'password')}
                  tabs={credentialTabs}
                />
                {activeTab === 'password' ? (
                  <FormField label={t('sudo.passwordLabel', 'Password')}>
                    <TextInput
                      accessibilityLabel={t('sudo.passwordLabel', 'Password')}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus
                      editable={!submitting}
                      onChangeText={setPassword}
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry
                      style={[styles.input, submitting && styles.inputDisabled]}
                      testID="reauth-password"
                      textContentType="password"
                      value={password}
                    />
                  </FormField>
                ) : (
                  <FormField label={t('sudo.totpLabel', 'Authenticator code')}>
                    <TextInput
                      accessibilityLabel={t(
                        'sudo.totpLabel',
                        'Authenticator code',
                      )}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus
                      editable={!submitting}
                      keyboardType="number-pad"
                      maxLength={8}
                      onChangeText={text =>
                        setTotp(text.replace(/\D/g, '').slice(0, 8))
                      }
                      placeholderTextColor={colors.textMuted}
                      style={[styles.input, submitting && styles.inputDisabled]}
                      testID="reauth-totp"
                      textContentType="oneTimeCode"
                      value={totp}
                    />
                  </FormField>
                )}
                <AppText style={styles.helperText} variant="caption">
                  {t(
                    'sudo.helper',
                    'Your reauth lasts 5 minutes; rapid follow-up actions will not re-prompt.',
                  )}
                </AppText>
              </>
            ) : (
              <FormField
                label={t(
                  'sudo.typedConfirmationLabel',
                  'Type {{token}} to confirm',
                  {token: TYPED_CONFIRMATION_TOKEN},
                )}>
                <TextInput
                  accessibilityLabel={t(
                    'sudo.typedConfirmationLabel',
                    'Type {{token}} to confirm',
                    {token: TYPED_CONFIRMATION_TOKEN},
                  )}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoFocus
                  editable={!submitting}
                  onChangeText={setConfirmText}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, submitting && styles.inputDisabled]}
                  testID="reauth-confirm-text"
                  value={confirmText}
                />
              </FormField>
            )}

            {error != null ? (
              <AppText
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={styles.errorText}
                testID="reauth-error"
                variant="caption">
                {error}
              </AppText>
            ) : null}

            <View style={styles.actionRow}>
              <DialogAction
                disabled={submitting}
                label={t('sudo.cancel', 'Cancel')}
                onPress={handleCancel}
                testID="reauth-cancel"
                variant="ghost"
              />
              <DialogAction
                label={
                  mode === 'confirm'
                    ? t('sudo.openMode.submit', 'Continue')
                    : t('sudo.submit', 'Confirm')
                }
                loading={submitting}
                onPress={() => {
                  handleSubmit();
                }}
                testID="reauth-submit"
                variant="primary"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
ReauthDialog.displayName = 'ReauthDialog';

function FormField({children, label}: {children: ReactNode; label: string}) {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} variant="caption" weight="semibold">
        {label}
      </AppText>
      {children}
    </View>
  );
}

function DialogTabs({
  activeTab,
  ariaLabel,
  onChange,
  tabs,
}: {
  activeTab: string;
  ariaLabel: string;
  onChange: (key: string) => void;
  tabs: TabItem[];
}) {
  return (
    <View
      accessibilityLabel={ariaLabel}
      accessibilityRole="tablist"
      style={styles.tabBar}>
      {tabs.map(tab => {
        const selected = activeTab === tab.key;
        return (
          <Pressable
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{disabled: tab.disabled ?? false, selected}}
            disabled={tab.disabled}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({pressed}) => [
              styles.tab,
              selected && styles.tabSelected,
              pressed && !tab.disabled && styles.pressed,
            ]}>
            <AppText
              style={[styles.tabLabel, selected && styles.tabLabelSelected]}
              variant="caption"
              weight={selected ? 'semibold' : 'regular'}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function DialogAction({
  disabled = false,
  label,
  loading = false,
  onPress,
  testID,
  variant,
}: {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'ghost';
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: isDisabled}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        <AppText
          style={
            variant === 'primary'
              ? styles.primaryButtonText
              : styles.ghostButtonText
          }
          weight="semibold">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    gap: spacing.md,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 112,
    paddingHorizontal: spacing.lg,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  closeGlyph: {
    color: colors.textSecondary,
    fontSize: 20,
    lineHeight: 22,
  },
  description: {
    lineHeight: 20,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxHeight: '88%',
    maxWidth: 460,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  disabled: {
    opacity: 0.48,
  },
  errorText: {
    color: colors.danger,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  ghostButton: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  helperText: {
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  tab: {
    alignItems: 'center',
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tabBar: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tabLabel: {
    color: colors.textMuted,
  },
  tabLabelSelected: {
    color: colors.accent,
  },
  tabSelected: {
    borderBottomColor: colors.accent,
  },
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
});
