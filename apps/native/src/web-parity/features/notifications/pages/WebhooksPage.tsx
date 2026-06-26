// Native parity port of web/src/features/notifications/pages/WebhooksPage.tsx.
//
// WebhooksPage (web L1-26) is a thin wrapper: usePageTitle('Webhooks'), a
// PageContainer (title + subtitle + copyLink), and a single
// <WebhookChannelsSection /> (web/src/features/settings/components/
// WebhookChannelsSection.tsx). The section is the real surface — custom outgoing
// webhook endpoints with HMAC-signed payloads, a delivery/test audit, and a
// live X-TeslaSync-Signature preview.
//
// WebhookChannelsSection has not been converted to native yet, so — exactly like
// AlertsListPage inlined the not-yet-converted AcknowledgeAlertDialog/AlertCard —
// its full behaviour is reproduced inline here against the already-converted
// native hooks (../../../api/hooks/useNotificationChannels): useWebhookChannels,
// useSaveChannel, useDeleteChannel, useToggleChannel, useTestWebhookChannel,
// useWebhookSignaturePreview. Every API path is therefore unchanged.
//
// The web original composes the shared DOM kit (PageContainer, GlassPanel, Badge,
// Button, ConfirmDialog, CopyButton, Heading, HelperText, IconBox, Input, Label,
// Modal, Select, Text, Toggle, EmptyState, Spinner, FadeIn), lucide SVG icons,
// react-i18next, and `window.setTimeout`/`navigator.clipboard`. React Native has
// no DOM, no Tailwind, no lucide SVGs, no framer-motion, no wired react-i18next,
// and no `document.title`, so the port reproduces the same contract with RN
// primitives + the established native parity building blocks:
//
//   - PageContainer (title/subtitle/copyLink) -> an inline ScrollView scaffold: a
//     persistent header (title + subtitle). usePageTitle(t('Webhooks')) sets the
//     browser tab title, which has no native analogue, so the same translated
//     string is surfaced as the on-screen header (documented in the sidecar). The
//     `copyLink` button (copies the current URL) has no native router/URL and is
//     omitted (documented).
//   - IconBox color="cyan" + lucide Webhook -> a SemanticIcon "link" (the closest
//     native semantic glyph for an HTTP endpoint).
//   - Heading/Text/HelperText/Label -> AppText variants/tones.
//   - Badge (success/neutral/info/danger) -> inline pills.
//   - Button (primary/ghost, sm) + lucide Plus/Send/Pencil/Trash2/Eye/EyeOff ->
//     native Pressable buttons with text glyphs.
//   - Toggle -> the shared native web-parity Toggle (label/checked/onChange/size).
//   - Input -> labelled TextInput; the secret field uses secureTextEntry with a
//     show/hide Pressable (web Eye/EyeOff); Select (HTTP method) -> a segmented
//     pill group (the established native single-choice control).
//   - Modal (add/edit form) + ConfirmDialog (delete) -> RN Modal overlays.
//   - CopyButton (signature) -> an inline native-safe copy Pressable using the
//     same navigator.clipboard strategy as MaskedValue (reports "unavailable"
//     when no clipboard is present rather than silently succeeding).
//   - SignaturePreview keeps the 300ms debounce + ref-stashed mutateAsync + the
//     timer cleanup (so nothing leaks under --detectOpenHandles), using global
//     setTimeout/clearTimeout instead of window.*.
//   - EmptyState -> the shared native EmptyState; Spinner -> ActivityIndicator;
//     FadeIn -> a plain View.
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     preserving every t('key','Default',{var}) verbatim and reproducing i18next
//     {{var}} interpolation.
//
// State names (modalOpen, editing, confirmDeleteId, testResults, form, showSecret,
// formError, signature, error), the HttpMethod union, HTTP_METHODS,
// SAVE_METHOD_FALLBACK, EMPTY_FORM, fromChannel, toSavePayload, isHttpsLike, the
// sampleBody envelope, the sortedWebhooks name-sort, and every channel field read
// (id/name/url/method/enabled) are preserved verbatim. No DOM, Recharts, Leaflet,
// react-router, lucide-react, framer-motion, or old web UI components are imported.

import React, {
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

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {Toggle} from '../../../components/ui/Toggle';
import {
  useDeleteChannel,
  useSaveChannel,
  useTestWebhookChannel,
  useToggleChannel,
  useWebhookChannels,
  useWebhookSignaturePreview,
  type NotificationChannelInput,
  type NotificationChannelWebhook,
  type WebhookTestResult,
} from '../../../api/hooks/useNotificationChannels';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so the fallback returns the English default
// while keeping every key verbatim and reproducing i18next's {{var}}
// interpolation (error/status/ms are the only interpolated vars used here).
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, options?: TOptions) => string;

function interpolate(template: string, options: TOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = options[name];
    return value === undefined ? '' : String(value);
  });
}

const t: TFunc = (key, fallback, options) => {
  const base = fallback ?? key;
  return options ? interpolate(base, options) : base;
};

/* ─── Native-safe clipboard (web CopyButton) ──────────────────────────── */

type CopyState = 'idle' | 'copied' | 'unavailable';

// Mirrors MaskedValue.writeClipboard: use navigator.clipboard.writeText when
// present (react-native-web), otherwise report `unavailable` so the affordance
// surfaces an explicit degraded state instead of silently "succeeding".
async function writeClipboard(text: string): Promise<CopyState> {
  const nav = (
    globalThis as unknown as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator;
  const clipboard = nav?.clipboard;
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    return 'unavailable';
  }
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'idle';
  }
}

/* ─── Form model + helpers (ported verbatim from the web section) ─────── */

type HttpMethod = 'POST' | 'PUT' | 'PATCH';

// We accept POST and PUT from the backend (those are the only methods the
// existing channel union allows) and add PATCH as a UI option for receivers
// like Home Assistant that prefer it. The save payload still narrows to
// POST | PUT to satisfy the type system; PATCH falls back to POST until the
// schema gains a `method` column with a wider enum.
const HTTP_METHODS: readonly HttpMethod[] = ['POST', 'PUT', 'PATCH'] as const;

const SAVE_METHOD_FALLBACK: 'POST' | 'PUT' = 'POST';

interface WebhookFormState {
  id: number | null;
  name: string;
  url: string;
  method: HttpMethod;
  secret: string;
  enabled: boolean;
}

const EMPTY_FORM: WebhookFormState = {
  id: null,
  name: '',
  url: '',
  method: 'POST',
  secret: '',
  enabled: true,
};

function fromChannel(channel: NotificationChannelWebhook): WebhookFormState {
  const upper = (channel.method ?? 'POST').toUpperCase();
  const method: HttpMethod =
    upper === 'PUT' ? 'PUT' : upper === 'PATCH' ? 'PATCH' : 'POST';
  return {
    id: channel.id,
    name: channel.name ?? '',
    url: channel.url ?? '',
    method,
    // Backend never echoes the bearer_token / secret on read, so editing an
    // existing channel always starts with a blank secret box. The helper text
    // in the form makes this clear.
    secret: '',
    enabled: channel.enabled !== false,
  };
}

// Compose the save payload. Headers and body_template fields are satisfied
// with empty defaults (the backend's existing dispatch path ignores them), and
// the cast keeps the discriminated-union machinery in NotificationChannelInput
// happy.
function toSavePayload(form: WebhookFormState): NotificationChannelInput {
  const safeMethod: 'POST' | 'PUT' =
    form.method === 'PUT' ? 'PUT' : SAVE_METHOD_FALLBACK;
  const idPart = form.id !== null ? {id: form.id} : {};
  const payload = {
    ...idPart,
    kind: 'webhook' as const,
    name: form.name.trim(),
    enabled: form.enabled,
    url: form.url.trim(),
    method: safeMethod,
    headers: {} as Record<string, string>,
    body_template: '',
    // The backend repurposes `bearer_token` as the HMAC signing secret.
    // Sending an empty string clears it.
    bearer_token: form.secret,
  } as unknown as NotificationChannelInput;
  return payload;
}

function isHttpsLike(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') {
    return false;
  }
  return /^https?:\/\//i.test(trimmed);
}

/* ─── Small inline pill (web Badge) ───────────────────────────────────── */

type PillTone = 'success' | 'neutral' | 'info' | 'danger';

function Pill({label, tone}: {label: string; tone: PillTone}) {
  return (
    <View style={[styles.pill, pillToneStyles[tone]]}>
      <AppText variant="caption" weight="semibold" style={pillTextStyles[tone]}>
        {label}
      </AppText>
    </View>
  );
}

/* ─── Inline buttons (web Button primary/ghost) ───────────────────────── */

function PrimaryButton({
  label,
  glyph,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  glyph?: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.primaryButton,
        disabled ? styles.buttonDisabled : undefined,
        pressed && !disabled ? styles.buttonPressed : undefined,
      ]}>
      <AppText weight="semibold" style={styles.primaryButtonText}>
        {glyph ? `${glyph}  ${label}` : label}
      </AppText>
    </Pressable>
  );
}

function GhostButton({
  label,
  glyph,
  onPress,
  disabled,
  accessibilityLabel,
  testID,
}: {
  label: string;
  glyph?: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.ghostButton,
        disabled ? styles.buttonDisabled : undefined,
        pressed && !disabled ? styles.buttonPressed : undefined,
      ]}>
      <AppText weight="semibold" style={styles.ghostButtonText}>
        {glyph ? (label ? `${glyph}  ${label}` : glyph) : label}
      </AppText>
    </Pressable>
  );
}

/* ─── Signature preview (web SignaturePreview) ────────────────────────── */

interface SignaturePreviewProps {
  secret: string;
  body: string;
}

function SignaturePreview({secret, body}: SignaturePreviewProps) {
  const [signature, setSignature] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const previewMut = useWebhookSignaturePreview();

  // Stash the latest mutation function in a ref so the debounced effect doesn't
  // reschedule itself every render — the React Query mutation object is
  // unstable across renders.
  const mutateRef = useRef(previewMut.mutateAsync);
  mutateRef.current = previewMut.mutateAsync;

  useEffect(() => {
    setError('');
    setCopyState('idle');
    if (secret.trim() === '') {
      setSignature('');
      return;
    }
    const handle = setTimeout(() => {
      mutateRef
        .current({secret, body})
        .then(res => {
          setSignature(res.signature);
        })
        .catch((err: unknown) => {
          setSignature('');
          setError(err instanceof Error ? err.message : String(err));
        });
    }, 300);
    return () => clearTimeout(handle);
  }, [secret, body]);

  const onCopy = useCallback(() => {
    void writeClipboard(signature).then(setCopyState);
  }, [signature]);

  if (secret.trim() === '') {
    return (
      <AppText variant="caption" tone="muted">
        {t(
          'webhookChannels.signature.empty',
          'Add a signing secret to preview the X-TeslaSync-Signature header.',
        )}
      </AppText>
    );
  }

  return (
    <View style={styles.signatureBlock} testID="webhook-signature-preview">
      <AppText variant="caption" tone="muted" weight="semibold">
        {t('webhookChannels.signature.label', 'Signature preview')}
      </AppText>
      {previewMut.isPending && signature === '' ? (
        <View style={styles.inlineRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <AppText variant="caption" tone="secondary">
            {t('webhookChannels.signature.loading', 'Computing signature…')}
          </AppText>
        </View>
      ) : error !== '' ? (
        <AppText variant="caption" tone="danger">
          {t(
            'webhookChannels.signature.error',
            'Failed to compute signature: {{error}}',
            {error},
          )}
        </AppText>
      ) : signature !== '' ? (
        <View style={styles.inlineRow}>
          <AppText
            variant="caption"
            style={styles.code}
            numberOfLines={1}
            ellipsizeMode="middle">
            {signature}
          </AppText>
          <GhostButton
            label=""
            glyph={copyState === 'copied' ? 'OK' : 'CP'}
            onPress={onCopy}
            accessibilityLabel={t('webhookChannels.signature.copy', 'Copy')}
            testID="webhook-signature-copy"
          />
        </View>
      ) : null}
      {copyState === 'unavailable' ? (
        <AppText variant="caption" tone="muted">
          {t(
            'webhookChannels.signature.copyUnavailable',
            'Clipboard is unavailable in this environment.',
          )}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="muted">
        {t(
          'webhookChannels.signature.help',
          'Send this header value with every webhook so receivers can verify authenticity.',
        )}
      </AppText>
    </View>
  );
}

/* ─── Add/Edit form modal (web WebhookFormModal) ──────────────────────── */

interface WebhookFormModalProps {
  open: boolean;
  initial: WebhookFormState | null;
  onClose: () => void;
  onSaved: () => void;
}

function WebhookFormModal({open, initial, onClose, onSaved}: WebhookFormModalProps) {
  const [form, setForm] = useState<WebhookFormState>(initial ?? EMPTY_FORM);
  const [showSecret, setShowSecret] = useState(false);
  const [formError, setFormError] = useState('');
  const saveMut = useSaveChannel();
  const isEdit = (initial?.id ?? null) !== null;

  // Reset state every time the modal opens for a different channel.
  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(initial ?? EMPTY_FORM);
    setShowSecret(false);
    setFormError('');
  }, [open, initial]);

  // Static body sample used to build a representative signature so the user
  // sees a non-trivial hex string. Mirrors the envelope the backend WebhookTest
  // handler emits.
  const sampleBody = useMemo(
    () =>
      JSON.stringify({
        title: 'Test event',
        message: 'Hello from TeslaSync',
        source: 'teslasync',
        test: true,
      }),
    [],
  );

  const handleSubmit = useCallback(() => {
    setFormError('');
    const trimmedName = form.name.trim();
    const trimmedUrl = form.url.trim();
    if (trimmedName === '') {
      setFormError(t('webhookChannels.form.nameRequired', 'Name is required.'));
      return;
    }
    if (!isHttpsLike(trimmedUrl)) {
      setFormError(
        t(
          'webhookChannels.form.urlInvalid',
          'URL must start with http:// or https://.',
        ),
      );
      return;
    }
    saveMut.mutate(toSavePayload({...form, name: trimmedName, url: trimmedUrl}), {
      onSuccess: () => {
        onSaved();
      },
      onError: (err: unknown) => {
        setFormError(err instanceof Error ? err.message : String(err));
      },
    });
  }, [form, onSaved, saveMut]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <GlassPanel style={styles.modalCard} testID="webhook-form-modal">
          <AppText variant="title" weight="bold">
            {isEdit
              ? t('webhookChannels.form.editTitle', 'Edit webhook')
              : t('webhookChannels.form.addTitle', 'Add webhook')}
          </AppText>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled">
            {/* Name */}
            <View style={styles.field}>
              <AppText variant="caption" tone="muted" weight="semibold">
                {t('webhookChannels.form.name', 'Name')}
                <AppText tone="danger"> *</AppText>
              </AppText>
              <TextInput
                value={form.name}
                onChangeText={value => setForm(s => ({...s, name: value}))}
                placeholder={t(
                  'webhookChannels.form.namePlaceholder',
                  'Discord #alerts',
                )}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                testID="webhook-form-name"
              />
            </View>

            {/* URL */}
            <View style={styles.field}>
              <AppText variant="caption" tone="muted" weight="semibold">
                {t('webhookChannels.form.url', 'URL')}
                <AppText tone="danger"> *</AppText>
              </AppText>
              <TextInput
                value={form.url}
                onChangeText={value => setForm(s => ({...s, url: value}))}
                placeholder={t(
                  'webhookChannels.form.urlPlaceholder',
                  'https://discord.com/api/webhooks/...',
                )}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.input}
                testID="webhook-form-url"
              />
              <AppText variant="caption" tone="muted">
                {t(
                  'webhookChannels.form.urlHelp',
                  'Compatible with Discord, Slack, n8n, Home Assistant, and any HTTP receiver.',
                )}
              </AppText>
            </View>

            {/* HTTP method (web Select) */}
            <View style={styles.field}>
              <AppText variant="caption" tone="muted" weight="semibold">
                {t('webhookChannels.form.method', 'HTTP method')}
              </AppText>
              <View style={styles.segmented} testID="webhook-form-method">
                {HTTP_METHODS.map(m => {
                  const selected = form.method === m;
                  return (
                    <Pressable
                      key={m}
                      accessibilityRole="button"
                      accessibilityState={{selected}}
                      onPress={() => setForm(s => ({...s, method: m}))}
                      style={({pressed}) => [
                        styles.segment,
                        selected ? styles.segmentSelected : undefined,
                        pressed ? styles.buttonPressed : undefined,
                      ]}
                      testID={`webhook-form-method-${m}`}>
                      <AppText
                        variant="caption"
                        weight="semibold"
                        style={selected ? styles.segmentTextSelected : undefined}>
                        {m}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Signing secret */}
            <View style={styles.field}>
              <AppText variant="caption" tone="muted" weight="semibold">
                {t('webhookChannels.form.secret', 'Signing secret')}
              </AppText>
              <View style={styles.inlineRow}>
                <TextInput
                  value={form.secret}
                  onChangeText={value => setForm(s => ({...s, secret: value}))}
                  placeholder={
                    isEdit
                      ? t(
                          'webhookChannels.form.secretPlaceholderEdit',
                          'Leave blank to keep existing',
                        )
                      : t(
                          'webhookChannels.form.secretPlaceholder',
                          'Optional — used for HMAC signing',
                        )
                  }
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showSecret}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, styles.inputFlex]}
                  testID="webhook-form-secret"
                />
                <GhostButton
                  label=""
                  glyph={showSecret ? 'HX' : 'EY'}
                  onPress={() => setShowSecret(v => !v)}
                  accessibilityLabel={
                    showSecret
                      ? t('webhookChannels.form.hideSecret', 'Hide secret')
                      : t('webhookChannels.form.showSecret', 'Show secret')
                  }
                  testID="webhook-form-toggle-secret"
                />
              </View>
              <AppText variant="caption" tone="muted">
                {t(
                  'webhookChannels.form.secretHelp',
                  'When set, every request includes X-TeslaSync-Signature: sha256=<hmac> so the receiver can verify authenticity.',
                )}
              </AppText>
            </View>

            {/* Live signature preview */}
            <View style={styles.previewBox}>
              <SignaturePreview secret={form.secret} body={sampleBody} />
            </View>

            {/* Enabled */}
            <View style={styles.enabledRow}>
              <Toggle
                label={t('webhookChannels.form.enabled', 'Enabled')}
                checked={form.enabled}
                onChange={value => setForm(s => ({...s, enabled: value}))}
                testID="webhook-form-enabled"
              />
            </View>

            {formError !== '' ? (
              <AppText
                variant="caption"
                tone="danger"
                accessibilityRole="alert">
                {formError}
              </AppText>
            ) : null}
          </ScrollView>

          <View style={styles.modalActions}>
            <GhostButton
              label={t('webhookChannels.form.cancel', 'Cancel')}
              onPress={onClose}
              testID="webhook-form-cancel"
            />
            <PrimaryButton
              label={
                saveMut.isPending
                  ? t('webhookChannels.form.saving', 'Saving…')
                  : isEdit
                  ? t('webhookChannels.form.saveEdit', 'Save changes')
                  : t('webhookChannels.form.save', 'Add webhook')
              }
              onPress={handleSubmit}
              disabled={saveMut.isPending}
              testID="webhook-form-submit"
            />
          </View>
        </GlassPanel>
      </View>
    </Modal>
  );
}

/* ─── Webhook row (web WebhookRow) ────────────────────────────────────── */

interface WebhookRowProps {
  channel: NotificationChannelWebhook;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onTest: () => void;
  toggleBusy: boolean;
  testBusy: boolean;
  testResult?: WebhookTestResult;
}

function WebhookRow({
  channel,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  toggleBusy,
  testBusy,
  testResult,
}: WebhookRowProps) {
  const [showBody, setShowBody] = useState(false);

  return (
    <View style={styles.row} testID={`webhook-row-${channel.id}`}>
      <View style={styles.rowHeader}>
        <View style={styles.rowInfo}>
          <View style={styles.rowTitleRow}>
            <AppText weight="semibold" numberOfLines={1} style={styles.rowName}>
              {channel.name}
            </AppText>
            <Pill
              tone={channel.enabled ? 'success' : 'neutral'}
              label={
                channel.enabled
                  ? t('webhookChannels.row.enabled', 'Enabled')
                  : t('webhookChannels.row.disabled', 'Disabled')
              }
            />
            <Pill tone="info" label={(channel.method ?? 'POST').toUpperCase()} />
          </View>
          <AppText variant="caption" tone="muted">
            {channel.url}
          </AppText>
        </View>
      </View>

      <View style={styles.rowActions}>
        <Toggle
          label={t('webhookChannels.row.toggle', 'Active')}
          checked={channel.enabled}
          onChange={onToggle}
          size="sm"
        />
        <GhostButton
          label=""
          glyph={testBusy ? '..' : 'SN'}
          onPress={onTest}
          disabled={testBusy || toggleBusy}
          accessibilityLabel={t('webhookChannels.row.test', 'Test webhook')}
          testID={`webhook-test-${channel.id}`}
        />
        <GhostButton
          label=""
          glyph="ED"
          onPress={onEdit}
          accessibilityLabel={t('webhookChannels.row.edit', 'Edit webhook')}
          testID={`webhook-edit-${channel.id}`}
        />
        <GhostButton
          label=""
          glyph="DL"
          onPress={onDelete}
          accessibilityLabel={t('webhookChannels.row.delete', 'Delete webhook')}
          testID={`webhook-delete-${channel.id}`}
        />
      </View>

      {testResult ? (
        <View style={styles.testResult} testID={`webhook-test-result-${channel.id}`}>
          <View style={styles.testResultHead}>
            <Pill
              tone={testResult.success ? 'success' : 'danger'}
              label={
                testResult.success
                  ? t('webhookChannels.test.success', 'Success')
                  : t('webhookChannels.test.failure', 'Failed')
              }
            />
            <AppText variant="caption" tone="secondary">
              {t('webhookChannels.test.status', 'Status {{status}}', {
                status: testResult.status_code,
              })}
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('webhookChannels.test.latency', '{{ms}} ms', {
                ms: testResult.latency_ms,
              })}
            </AppText>
          </View>

          {testResult.signature ? (
            <View style={styles.inlineRow}>
              <AppText variant="caption" tone="muted">
                {t('webhookChannels.test.signature', 'Signature:')}
              </AppText>
              <AppText
                variant="caption"
                style={styles.code}
                numberOfLines={1}
                ellipsizeMode="middle">
                {testResult.signature}
              </AppText>
            </View>
          ) : null}

          {testResult.body_preview ? (
            <View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowBody(v => !v)}
                style={({pressed}) => [pressed ? styles.buttonPressed : undefined]}>
                <AppText variant="caption" tone="muted">
                  {`${showBody ? 'v' : '>'}  ${t(
                    'webhookChannels.test.body',
                    'Response body',
                  )}`}
                </AppText>
              </Pressable>
              {showBody ? (
                <View style={styles.bodyPre}>
                  <AppText variant="caption" style={styles.code}>
                    {testResult.body_preview}
                    {testResult.truncated
                      ? `\n${t(
                          'webhookChannels.test.truncated',
                          '… (truncated)',
                        )}`
                      : ''}
                  </AppText>
                </View>
              ) : null}
            </View>
          ) : null}

          {testResult.error ? (
            <AppText variant="caption" tone="danger">
              {testResult.error}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ─── Delete confirm dialog (web ConfirmDialog) ───────────────────────── */

interface ConfirmDeleteProps {
  open: boolean;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDeleteDialog({open, loading, onConfirm, onCancel}: ConfirmDeleteProps) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <GlassPanel style={styles.modalCard} testID="webhook-delete-dialog">
          <AppText variant="title" weight="bold">
            {t('webhookChannels.delete.title', 'Delete webhook?')}
          </AppText>
          <AppText tone="secondary">
            {t(
              'webhookChannels.delete.message',
              'This will permanently remove the webhook. TeslaSync will stop sending notifications to it immediately.',
            )}
          </AppText>
          <View style={styles.modalActions}>
            <GhostButton
              label={t('webhookChannels.delete.cancel', 'Cancel')}
              onPress={onCancel}
              disabled={loading}
              testID="webhook-delete-cancel"
            />
            <PrimaryButton
              label={
                loading
                  ? t('webhookChannels.form.saving', 'Saving…')
                  : t('webhookChannels.delete.confirm', 'Delete webhook')
              }
              onPress={onConfirm}
              disabled={loading}
              testID="webhook-delete-confirm"
            />
          </View>
        </GlassPanel>
      </View>
    </Modal>
  );
}

/* ─── Webhook channels section (web WebhookChannelsSection) ────────────── */

function WebhookChannelsSection() {
  const {data: webhooks, isLoading, error} = useWebhookChannels();
  const deleteMut = useDeleteChannel();
  const toggleMut = useToggleChannel();
  const testMut = useTestWebhookChannel();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookFormState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, WebhookTestResult>>(
    {},
  );

  const handleAdd = useCallback(() => {
    setEditing(null);
    setModalOpen(true);
  }, []);

  const handleEdit = useCallback((channel: NotificationChannelWebhook) => {
    setEditing(fromChannel(channel));
    setModalOpen(true);
  }, []);

  const handleSaved = useCallback(() => {
    setModalOpen(false);
    setEditing(null);
  }, []);

  const handleToggle = useCallback(
    (id: number) => {
      toggleMut.mutate(id);
    },
    [toggleMut],
  );

  const handleTest = useCallback(
    (id: number) => {
      testMut.mutate(
        {id},
        {
          onSuccess: (res: WebhookTestResult) => {
            setTestResults(prev => ({...prev, [id]: res}));
          },
          onError: (err: unknown) => {
            setTestResults(prev => ({
              ...prev,
              [id]: {
                success: false,
                status_code: 0,
                latency_ms: 0,
                error: err instanceof Error ? err.message : String(err),
              },
            }));
          },
        },
      );
    },
    [testMut],
  );

  const handleConfirmDelete = useCallback(() => {
    if (confirmDeleteId === null) {
      return;
    }
    const id = confirmDeleteId;
    deleteMut.mutate(id, {
      onSuccess: () => {
        setConfirmDeleteId(null);
        setTestResults(prev => {
          if (!(id in prev)) {
            return prev;
          }
          const next = {...prev};
          delete next[id];
          return next;
        });
      },
    });
  }, [confirmDeleteId, deleteMut]);

  const sortedWebhooks = useMemo(
    () => [...(webhooks ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [webhooks],
  );

  return (
    <View>
      <GlassPanel style={styles.panel} testID="webhook-channels-section">
        <View style={styles.sectionHeader}>
          <SemanticIcon name="link" size="md" decorative />
          <View style={styles.sectionHeaderText}>
            <AppText weight="semibold">
              {t('webhookChannels.title', 'Webhook channels')}
            </AppText>
            <AppText variant="caption" tone="secondary">
              {t(
                'webhookChannels.subtitle',
                'Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, or any HTTP receiver. Each channel can be HMAC-signed so receivers can verify authenticity.',
              )}
            </AppText>
          </View>
        </View>

        <PrimaryButton
          label={t('webhookChannels.addButton', 'Add webhook')}
          glyph="+"
          onPress={handleAdd}
          testID="webhook-add"
        />

        {isLoading ? (
          <View style={styles.loading} testID="webhook-channels-loading">
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : error ? (
          <AppText variant="caption" tone="danger" accessibilityRole="alert">
            {t(
              'webhookChannels.loadError',
              'Failed to load webhook channels: {{error}}',
              {error: error instanceof Error ? error.message : String(error)},
            )}
          </AppText>
        ) : sortedWebhooks.length === 0 ? (
          <View testID="webhook-channels-empty">
            <EmptyState
              title={t('webhookChannels.empty.title', 'No webhooks yet')}
              message={t(
                'webhookChannels.empty.message',
                'Add a webhook to forward TeslaSync events to your favourite chat or automation tool.',
              )}
            />
            <View style={styles.emptyAction}>
              <GhostButton
                label={t('webhookChannels.empty.action', 'Add your first webhook')}
                onPress={handleAdd}
                testID="webhook-empty-add"
              />
            </View>
          </View>
        ) : (
          <View style={styles.list} testID="webhook-channels-list">
            {sortedWebhooks.map(ch => (
              <WebhookRow
                key={ch.id}
                channel={ch}
                onEdit={() => handleEdit(ch)}
                onDelete={() => setConfirmDeleteId(ch.id)}
                onToggle={() => handleToggle(ch.id)}
                onTest={() => handleTest(ch.id)}
                toggleBusy={toggleMut.isPending && toggleMut.variables === ch.id}
                testBusy={testMut.isPending && testMut.variables?.id === ch.id}
                testResult={testResults[ch.id]}
              />
            ))}
          </View>
        )}

        <View style={styles.docs}>
          <AppText variant="caption" weight="semibold">
            {t('webhookChannels.docs.title', 'Available payload variables')}
          </AppText>
          <AppText variant="caption" tone="muted">
            {t(
              'webhookChannels.docs.intro',
              'Webhook receivers get a JSON envelope with these fields:',
            )}
          </AppText>
          <View style={styles.docsList}>
            <AppText variant="caption" tone="muted">
              • title — short headline of the event
            </AppText>
            <AppText variant="caption" tone="muted">
              • message — long-form body of the event
            </AppText>
            <AppText variant="caption" tone="muted">
              • source — always "teslasync"
            </AppText>
            <AppText variant="caption" tone="muted">
              • timestamp — RFC3339 server-side time
            </AppText>
          </View>
        </View>
      </GlassPanel>

      <WebhookFormModal
        open={modalOpen}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          handleSaved();
          // Note: useSaveChannel already invalidates the channels cache.
        }}
      />

      <ConfirmDeleteDialog
        open={confirmDeleteId !== null}
        loading={deleteMut.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </View>
  );
}

/* ─── Page (web WebhooksPage) ─────────────────────────────────────────── */

export default function WebhooksPage() {
  // usePageTitle(t('Webhooks')) sets the browser tab title on web; native has no
  // document.title, so the translated title is surfaced as the on-screen header.
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="webhooks-page">
      <View style={styles.header}>
        <AppText accessibilityRole="header" variant="title" weight="bold">
          {t('notifications.webhooks.title', 'Webhooks')}
        </AppText>
        <AppText variant="caption" tone="secondary">
          {t(
            'notifications.webhooks.subtitle',
            'Custom HTTPS endpoints that receive HMAC-signed event payloads.',
          )}
        </AppText>
      </View>

      <WebhookChannelsSection />
    </ScrollView>
  );
}

WebhooksPage.displayName = 'WebhooksPage';

/* ─── Styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    rowGap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    rowGap: spacing.sm,
  },
  panel: {
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: spacing.md,
  },
  sectionHeaderText: {
    flex: 1,
    rowGap: spacing.xs,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyAction: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  list: {
    rowGap: spacing.md,
  },
  /* row */
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    rowGap: spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: spacing.sm,
  },
  rowInfo: {
    flex: 1,
    rowGap: spacing.xs,
  },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.xs,
    rowGap: spacing.xs,
  },
  rowName: {
    flexShrink: 1,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  /* test result */
  testResult: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    padding: spacing.sm,
    rowGap: spacing.xs,
  },
  testResultHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  bodyPre: {
    marginTop: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: spacing.sm,
  },
  /* pills */
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  /* buttons */
  primaryButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  ghostButton: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  /* form */
  field: {
    rowGap: spacing.xs,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
  },
  inputFlex: {
    flex: 1,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  segmented: {
    flexDirection: 'row',
    columnGap: spacing.xs,
  },
  segment: {
    flexGrow: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  segmentSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  segmentTextSelected: {
    color: colors.accent,
  },
  previewBox: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    padding: spacing.md,
  },
  signatureBlock: {
    rowGap: spacing.xs,
  },
  code: {
    flex: 1,
    fontFamily: 'monospace',
    color: colors.textSecondary,
  },
  enabledRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  /* modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 16, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '88%',
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalScrollContent: {
    rowGap: spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    columnGap: spacing.sm,
  },
  /* docs */
  docs: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    padding: spacing.md,
    rowGap: spacing.xs,
  },
  docsList: {
    rowGap: 2,
    marginTop: spacing.xs,
  },
});

const pillToneStyles = StyleSheet.create({
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  neutral: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  info: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
});

const pillTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  neutral: {
    color: colors.textSecondary,
  },
  info: {
    color: colors.accent,
  },
  danger: {
    color: colors.danger,
  },
});
