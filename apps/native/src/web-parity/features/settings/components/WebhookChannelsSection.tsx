// Native parity port of
// web/src/features/settings/components/WebhookChannelsSection.tsx.
//
// The web module is the Webhook notification channels Settings section. It
// surfaces the existing notification_channel_webhook records as an editable list
// under <section id="webhooks"> on the Settings page and adds three things on
// top of the generic channel CRUD:
//   1. A focused list view limited to kind=webhook with a status pill and
//      per-row Test / Edit / Delete actions.
//   2. A wizard-style form modal that walks the user through the four fields the
//      backend persists — name, URL, HTTP method, and the (repurposed) signing
//      secret — instead of editing raw JSON.
//   3. A live HMAC X-TeslaSync-Signature preview that calls the
//      /notifications/webhooks/preview-signature utility endpoint so the user
//      can verify their receiver's signing logic before firing a real webhook.
//
// The Blocked-Path constraint (no body templating yet, no migrations) means the
// headers + body_template fields exist in the TypeScript union but are NOT
// round-tripped through the backend. We initialise them to `{}` / `''` and cast
// the resulting payload through NotificationChannelInput so the type-checker
// stays honest while the runtime contract matches the existing schema. The body
// template editor and content-type select are intentionally omitted until the
// notification_channel_webhook table gains the missing columns.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() hook whose
//     t(key, fallback, values?) returns the English fallback (interpolating
//     `{{token}}` placeholders), preserving every translation key verbatim at the
//     call site (the native parity tree ships no i18next runtime).
//   • lucide-react Webhook/Plus/Send/Pencil/Trash2/Eye/EyeOff -> SemanticIcon
//     link/add/send/pencil/delete/show/hide glyph boxes (native ships no SVG icon
//     set; the tinted glyph carries the visual intent). <IconBox color="cyan">
//     <Webhook/></IconBox> folds to a single <SemanticIcon name="link"> (its
//     accent box IS the cyan IconBox).
//   • @/components/ui GlassPanel -> the reused native GlassPanel.
//   • @/components/ui Button/Badge/Select/Toggle/Modal + ConfirmDialog + Heading/
//     Text/Label/HelperText/IconBox + @/components/feedback Spinner -> inlined
//     native primitives (Pressable Button, View Badge, Pressable+Modal Select,
//     Pressable Toggle, RN Modal sheet, RN Modal ConfirmDialog, AppText
//     Heading/Text/Label/HelperText, ActivityIndicator Spinner). No parity barrel
//     ships these yet, mirroring the QuietHoursPanel precedent.
//   • @/components/ui Input -> the already-ported native Input (a <TextInput>);
//     web type="url"/"password" -> keyboardType + secureTextEntry; web onChange
//     e.target.value -> onChangeText.
//   • @/components/ui CopyButton -> the ported native CopyButton (iconOnly).
//   • @/components/feedback EmptyState -> the ported native EmptyState (icon +
//     title + message + imperative `action`; web `onClick` -> native `onPress`).
//   • @/components/motion FadeIn -> the ported native FadeIn.
//   • @/api/hooks/useNotificationChannels -> '../../../api/hooks/useNotification
//     Channels' (the already-ported native hooks + types; same query key
//     notification-channels + paths /notifications[/{id}][/toggle|/webhook-test]
//     and /notifications/webhooks/preview-signature).
//   • DOM <details>/<summary> -> a Pressable expander toggling the response body.
//     <code>/<pre> -> monospace AppText. window.setTimeout -> setTimeout. data-
//     testid -> testID. aria-label -> accessibilityLabel. role="alert" ->
//     accessibilityRole="alert".
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys). No DOM elements, react-i18next, lucide-react, framer-motion,
// Recharts, Leaflet, react-dom, or web UI-kit modules are imported here.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  type NotificationChannelInput,
  type NotificationChannelWebhook,
  type WebhookTestResult,
  useDeleteChannel,
  useSaveChannel,
  useTestWebhookChannel,
  useToggleChannel,
  useWebhookChannels,
  useWebhookSignaturePreview,
} from '../../../api/hooks/useNotificationChannels';
import {CopyButton} from '../../../components/ui/CopyButton';
import {Input} from '../../../components/ui/Input';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {FadeIn} from '../../../components/motion/FadeIn';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation()) ────────────────── */

type TranslationValues = Record<string, string | number>;

type TFunc = (key: string, fallback: string, values?: TranslationValues) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback while preserving every key at
// the call site, interpolating `{{token}}` placeholders so the status/latency/
// error copy resolves identically to the web. Stable useCallback identity.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (match, token: string) => {
      const value = values[token];
      return value === undefined ? match : String(value);
    });
  }, []);
  return {t};
}

/* ─── pure helpers (ported verbatim from the source) ────────────────────── */

type HttpMethod = 'POST' | 'PUT' | 'PATCH';

// We accept POST and PUT from the backend (those are the only methods the
// existing channel union allows) and add PATCH as a UI option for receivers like
// Home Assistant that prefer it. The save payload still narrows to POST | PUT to
// satisfy the type system; PATCH falls back to POST until the schema gains a
// `method` column with a wider enum.
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
    // existing channel always starts with a blank secret box. The helper text in
    // the form makes this clear.
    secret: '',
    enabled: channel.enabled !== false,
  };
}

// Compose the save payload. Headers and body_template fields are satisfied with
// empty defaults (the backend's existing dispatch path ignores them), and the
// cast keeps the discriminated-union machinery in NotificationChannelInput happy.
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
    // The backend repurposes `bearer_token` as the HMAC signing secret. Sending
    // an empty string clears it.
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

/* ─── SignaturePreview (live HMAC X-TeslaSync-Signature preview) ─────────── */

interface SignaturePreviewProps {
  secret: string;
  body: string;
}

function SignaturePreview({secret, body}: SignaturePreviewProps) {
  const {t} = useTranslation();
  const [signature, setSignature] = useState<string>('');
  const [error, setError] = useState<string>('');
  const previewMut = useWebhookSignaturePreview();

  // Stash the latest mutation function in a ref so the debounced effect doesn't
  // reschedule itself every render — the React Query mutation object is unstable
  // across renders.
  const mutateRef = useRef(previewMut.mutateAsync);
  mutateRef.current = previewMut.mutateAsync;

  useEffect(() => {
    setError('');
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

  if (secret.trim() === '') {
    return (
      <HelperText>
        {t(
          'webhookChannels.signature.empty',
          'Add a signing secret to preview the X-TeslaSync-Signature header.',
        )}
      </HelperText>
    );
  }

  return (
    <View style={styles.previewInner} testID="webhook-signature-preview">
      <Label>{t('webhookChannels.signature.label', 'Signature preview')}</Label>
      {previewMut.isPending && signature === '' ? (
        <View style={styles.inlineRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <AppText style={styles.bodySm}>
            {t('webhookChannels.signature.loading', 'Computing signature…')}
          </AppText>
        </View>
      ) : error !== '' ? (
        <AppText style={styles.errorText}>
          {t(
            'webhookChannels.signature.error',
            'Failed to compute signature: {{error}}',
            {error},
          )}
        </AppText>
      ) : signature !== '' ? (
        <View style={styles.inlineRow}>
          <AppText style={styles.codeInline} numberOfLines={1}>
            {signature}
          </AppText>
          <CopyButton text={signature} iconOnly />
        </View>
      ) : null}
      <HelperText>
        {t(
          'webhookChannels.signature.help',
          'Send this header value with every webhook so receivers can verify authenticity.',
        )}
      </HelperText>
    </View>
  );
}

/* ─── WebhookFormModal (wizard-style add/edit form) ─────────────────────── */

interface WebhookFormModalProps {
  open: boolean;
  initial: WebhookFormState | null;
  onClose: () => void;
  onSaved: () => void;
}

function WebhookFormModal({open, initial, onClose, onSaved}: WebhookFormModalProps) {
  const {t} = useTranslation();
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

  // Static body sample used to build a representative signature so the user sees
  // a non-trivial hex string. Mirrors the envelope the backend WebhookTest
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
      onError: err => {
        setFormError(err instanceof Error ? err.message : String(err));
      },
    });
  }, [form, onSaved, saveMut, t]);

  if (!open) {
    return null;
  }

  const title = isEdit
    ? t('webhookChannels.form.editTitle', 'Edit webhook')
    : t('webhookChannels.form.addTitle', 'Add webhook');

  return (
    <Modal
      animationType="fade"
      transparent
      visible={open}
      onRequestClose={onClose}>
      <View
        accessibilityViewIsModal
        accessibilityLabel={title}
        style={styles.modalOverlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View style={styles.modalSheet} testID="webhook-form-modal">
          <View style={styles.modalHeader}>
            <AppText style={styles.modalTitle} weight="semibold">
              {title}
            </AppText>
            <Button
              variant="ghost"
              size="sm"
              icon={<SemanticIcon name="close" size="sm" decorative />}
              onPress={onClose}
              accessibilityLabel={t('webhookChannels.form.cancel', 'Cancel')}
            />
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}>
            <View style={styles.formField}>
              <Label htmlFor="webhook-form-name" required>
                {t('webhookChannels.form.name', 'Name')}
              </Label>
              <Input
                id="webhook-form-name"
                accessibilityLabel={t('webhookChannels.form.name', 'Name')}
                value={form.name}
                onChangeText={text => setForm(s => ({...s, name: text}))}
                placeholder={t(
                  'webhookChannels.form.namePlaceholder',
                  'Discord #alerts',
                )}
                autoCapitalize="none"
                testID="webhook-form-name"
              />
            </View>

            <View style={styles.formField}>
              <Label htmlFor="webhook-form-url" required>
                {t('webhookChannels.form.url', 'URL')}
              </Label>
              <Input
                id="webhook-form-url"
                accessibilityLabel={t('webhookChannels.form.url', 'URL')}
                keyboardType="url"
                value={form.url}
                onChangeText={text => setForm(s => ({...s, url: text}))}
                placeholder={t(
                  'webhookChannels.form.urlPlaceholder',
                  'https://discord.com/api/webhooks/...',
                )}
                autoCapitalize="none"
                testID="webhook-form-url"
              />
              <HelperText>
                {t(
                  'webhookChannels.form.urlHelp',
                  'Compatible with Discord, Slack, n8n, Home Assistant, and any HTTP receiver.',
                )}
              </HelperText>
            </View>

            <View style={styles.formField}>
              <Label htmlFor="webhook-form-method">
                {t('webhookChannels.form.method', 'HTTP method')}
              </Label>
              <Select
                id="webhook-form-method"
                accessibilityLabel={t(
                  'webhookChannels.form.method',
                  'HTTP method',
                )}
                value={form.method}
                onChange={value =>
                  setForm(s => ({...s, method: value as HttpMethod}))
                }
                options={HTTP_METHODS.map(m => ({value: m, label: m}))}
              />
            </View>

            <View style={styles.formField}>
              <Label htmlFor="webhook-form-secret">
                {t('webhookChannels.form.secret', 'Signing secret')}
              </Label>
              <View style={styles.secretRow}>
                <Input
                  id="webhook-form-secret"
                  accessibilityLabel={t(
                    'webhookChannels.form.secret',
                    'Signing secret',
                  )}
                  secureTextEntry={!showSecret}
                  value={form.secret}
                  onChangeText={text => setForm(s => ({...s, secret: text}))}
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
                  autoCapitalize="none"
                  autoComplete="off"
                  textContentType="password"
                  containerStyle={styles.secretInput}
                  testID="webhook-form-secret"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={
                    <SemanticIcon
                      name={showSecret ? 'hide' : 'show'}
                      size="sm"
                      decorative
                    />
                  }
                  onPress={() => setShowSecret(v => !v)}
                  accessibilityLabel={
                    showSecret
                      ? t('webhookChannels.form.hideSecret', 'Hide secret')
                      : t('webhookChannels.form.showSecret', 'Show secret')
                  }
                  testID="webhook-form-toggle-secret"
                />
              </View>
              <HelperText>
                {t(
                  'webhookChannels.form.secretHelp',
                  'When set, every request includes X-TeslaSync-Signature: sha256=<hmac> so the receiver can verify authenticity.',
                )}
              </HelperText>
            </View>

            <View style={styles.previewBox}>
              <SignaturePreview secret={form.secret} body={sampleBody} />
            </View>

            <View style={styles.enabledRow}>
              <Toggle
                label={t('webhookChannels.form.enabled', 'Enabled')}
                checked={form.enabled}
                onChange={v => setForm(s => ({...s, enabled: v}))}
                testID="webhook-form-enabled"
              />
            </View>

            {formError !== '' ? (
              <AppText
                accessibilityRole="alert"
                style={styles.errorText}>
                {formError}
              </AppText>
            ) : null}

            <View style={styles.footerRow}>
              <Button
                variant="ghost"
                onPress={onClose}
                testID="webhook-form-cancel">
                {t('webhookChannels.form.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                onPress={handleSubmit}
                disabled={saveMut.isPending}
                icon={
                  saveMut.isPending ? (
                    <ActivityIndicator size="small" color={colors.background} />
                  ) : undefined
                }
                testID="webhook-form-submit">
                {saveMut.isPending
                  ? t('webhookChannels.form.saving', 'Saving…')
                  : isEdit
                    ? t('webhookChannels.form.saveEdit', 'Save changes')
                    : t('webhookChannels.form.save', 'Add webhook')}
              </Button>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ─── WebhookRow (one webhook channel + its last test result) ───────────── */

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
  const {t} = useTranslation();
  const [showBody, setShowBody] = useState(false);
  return (
    <View style={styles.row} testID={`webhook-row-${channel.id}`}>
      <View style={styles.rowHeader}>
        <View style={styles.rowMain}>
          <View style={styles.rowTitleRow}>
            <AppText style={styles.panelHeading} weight="semibold">
              {channel.name}
            </AppText>
            <Badge variant={channel.enabled ? 'success' : 'neutral'}>
              {channel.enabled
                ? t('webhookChannels.row.enabled', 'Enabled')
                : t('webhookChannels.row.disabled', 'Disabled')}
            </Badge>
            <Badge variant="info">
              {(channel.method ?? 'POST').toUpperCase()}
            </Badge>
          </View>
          <AppText style={styles.rowUrl}>{channel.url}</AppText>
        </View>
        <View style={styles.rowActions}>
          <Toggle
            label={t('webhookChannels.row.toggle', 'Active')}
            checked={channel.enabled}
            onChange={onToggle}
            hideLabel
            size="sm"
          />
          <Button
            variant="ghost"
            size="sm"
            onPress={onTest}
            disabled={testBusy || toggleBusy}
            accessibilityLabel={t('webhookChannels.row.test', 'Test webhook')}
            testID={`webhook-test-${channel.id}`}
            icon={
              testBusy ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <SemanticIcon name="send" size="sm" decorative />
              )
            }
          />
          <Button
            variant="ghost"
            size="sm"
            onPress={onEdit}
            accessibilityLabel={t('webhookChannels.row.edit', 'Edit webhook')}
            testID={`webhook-edit-${channel.id}`}
            icon={<SemanticIcon name="pencil" size="sm" decorative />}
          />
          <Button
            variant="ghost"
            size="sm"
            onPress={onDelete}
            accessibilityLabel={t('webhookChannels.row.delete', 'Delete webhook')}
            testID={`webhook-delete-${channel.id}`}
            icon={<SemanticIcon name="delete" size="sm" decorative />}
          />
        </View>
      </View>

      {testResult ? (
        <View
          style={styles.testResultBox}
          testID={`webhook-test-result-${channel.id}`}>
          <View style={styles.testResultHeader}>
            <Badge variant={testResult.success ? 'success' : 'danger'}>
              {testResult.success
                ? t('webhookChannels.test.success', 'Success')
                : t('webhookChannels.test.failure', 'Failed')}
            </Badge>
            <AppText style={styles.bodySm}>
              {t('webhookChannels.test.status', 'Status {{status}}', {
                status: testResult.status_code,
              })}
            </AppText>
            <AppText style={styles.mutedSm}>
              {t('webhookChannels.test.latency', '{{ms}} ms', {
                ms: testResult.latency_ms,
              })}
            </AppText>
          </View>
          {testResult.signature ? (
            <View style={styles.testSignatureRow}>
              <AppText style={styles.mutedSm}>
                {t('webhookChannels.test.signature', 'Signature:')}
              </AppText>
              <AppText style={styles.codeInline} numberOfLines={1}>
                {testResult.signature}
              </AppText>
            </View>
          ) : null}
          {testResult.body_preview ? (
            <View style={styles.testBodyWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{expanded: showBody}}
                onPress={() => setShowBody(v => !v)}
                style={styles.testBodySummary}>
                <AppText style={styles.mutedSm}>
                  {t('webhookChannels.test.body', 'Response body')}
                </AppText>
              </Pressable>
              {showBody ? (
                <AppText style={styles.codeBlock}>
                  {testResult.body_preview}
                  {testResult.truncated
                    ? `\n${t('webhookChannels.test.truncated', '… (truncated)')}`
                    : ''}
                </AppText>
              ) : null}
            </View>
          ) : null}
          {testResult.error ? (
            <AppText style={styles.errorTextSm}>{testResult.error}</AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ─── WebhookChannelsSection (the exported section) ─────────────────────── */

export function WebhookChannelsSection() {
  const {t} = useTranslation();
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
          onSuccess: res => {
            setTestResults(prev => ({...prev, [id]: res}));
          },
          onError: err => {
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
    () => [...webhooks].sort((a, b) => a.name.localeCompare(b.name)),
    [webhooks],
  );

  return (
    <FadeIn>
      <GlassPanel style={styles.panel} testID="webhook-channels-section">
        <View style={styles.headerRow}>
          <SemanticIcon name="link" size="md" decorative />
          <View style={styles.headerText}>
            <AppText style={styles.sectionHeading} weight="semibold">
              {t('webhookChannels.title', 'Webhook channels')}
            </AppText>
            <AppText style={styles.bodySm}>
              {t(
                'webhookChannels.subtitle',
                'Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, or any HTTP receiver. Each channel can be HMAC-signed so receivers can verify authenticity.',
              )}
            </AppText>
          </View>
          <Button
            variant="primary"
            size="sm"
            onPress={handleAdd}
            icon={<SemanticIcon name="add" size="sm" decorative />}
            testID="webhook-add">
            {t('webhookChannels.addButton', 'Add webhook')}
          </Button>
        </View>

        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : error ? (
          <AppText accessibilityRole="alert" style={styles.errorText}>
            {t(
              'webhookChannels.loadError',
              'Failed to load webhook channels: {{error}}',
              {error: error instanceof Error ? error.message : String(error)},
            )}
          </AppText>
        ) : sortedWebhooks.length === 0 ? (
          <EmptyState
            icon={<SemanticIcon name="link" size="lg" decorative />}
            title={t('webhookChannels.empty.title', 'No webhooks yet')}
            message={t(
              'webhookChannels.empty.message',
              'Add a webhook to forward TeslaSync events to your favourite chat or automation tool.',
            )}
            action={{
              label: t('webhookChannels.empty.action', 'Add your first webhook'),
              onPress: handleAdd,
            }}
          />
        ) : (
          <View style={styles.list}>
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

        <View style={styles.docsBox}>
          <AppText style={styles.docsTitle} weight="semibold">
            {t('webhookChannels.docs.title', 'Available payload variables')}
          </AppText>
          <AppText style={styles.mutedSm}>
            {t(
              'webhookChannels.docs.intro',
              'Webhook receivers get a JSON envelope with these fields:',
            )}
          </AppText>
          <View style={styles.docList}>
            <DocItem code="title" description=" — short headline of the event" />
            <DocItem code="message" description=" — long-form body of the event" />
            <DocItem code="source" description=' — always "teslasync"' />
            <DocItem code="timestamp" description=" — RFC3339 server-side time" />
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

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={t('webhookChannels.delete.title', 'Delete webhook?')}
        message={t(
          'webhookChannels.delete.message',
          'This will permanently remove the webhook. TeslaSync will stop sending notifications to it immediately.',
        )}
        confirmLabel={t('webhookChannels.delete.confirm', 'Delete webhook')}
        cancelLabel={t('webhookChannels.delete.cancel', 'Cancel')}
        variant="danger"
        loading={deleteMut.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {/* The save mutation surfaces its own toasts via useSaveChannel, and the
          modal reflects in-flight state via `saveMut.isPending` inside
          WebhookFormModal — no extra live-region announcement needed here. */}
    </FadeIn>
  );
}

WebhookChannelsSection.displayName = 'WebhookChannelsSection';

export default WebhookChannelsSection;

/* ─── DocItem (web <li><code/> — text> bullet) ──────────────────────────── */

function DocItem({code, description}: {code: string; description: string}) {
  return (
    <AppText style={styles.docItem}>
      {'\u2022  '}
      <AppText style={styles.codeInlineText}>{code}</AppText>
      <AppText style={styles.mutedSm}>{description}</AppText>
    </AppText>
  );
}

/* ─── Inlined @/components/ui Label (DOM <label> + required asterisk) ────── */

interface LabelProps {
  /** Web `htmlFor`; accepted for call-site parity (no RN label/for association). */
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}

function Label({required, children}: LabelProps) {
  return (
    <AppText style={styles.fieldLabel} weight="semibold">
      {children}
      {required ? <AppText style={styles.requiredMark}> *</AppText> : null}
    </AppText>
  );
}

/* ─── Inlined @/components/ui HelperText (DOM <p> caption) ───────────────── */

function HelperText({children}: {children: ReactNode}) {
  return <AppText style={styles.helperText}>{children}</AppText>;
}

/* ─── Inlined @/components/ui Button (DOM <button> -> Pressable) ─────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  variant?: ButtonVariant;
  /** Web cosmetic size; accepted for call-site parity. */
  size?: 'sm' | 'md';
  icon?: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  children?: ReactNode;
}

const BUTTON_TONES: Record<
  ButtonVariant,
  {bg: string; border: string; text: string}
> = {
  primary: {bg: colors.accent, border: colors.accent, text: colors.background},
  secondary: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
  ghost: {bg: 'transparent', border: 'transparent', text: colors.textSecondary},
  danger: {bg: colors.danger, border: colors.danger, text: colors.background},
};

function Button({
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  onPress,
  accessibilityLabel,
  testID,
  children,
}: ButtonProps) {
  const tone = BUTTON_TONES[variant];
  const hasLabel = children != null && children !== false;
  const iconOnly = !hasLabel && icon != null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled: !!disabled}}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.btn,
        size === 'sm' ? styles.btnSm : null,
        iconOnly ? styles.btnIconOnly : null,
        {backgroundColor: tone.bg, borderColor: tone.border},
        disabled ? styles.btnDisabled : null,
        pressed && !disabled ? styles.btnPressed : null,
      ]}>
      {icon ? (
        <View style={hasLabel ? styles.btnIconWrap : null}>{icon}</View>
      ) : null}
      {hasLabel ? (
        <AppText style={[styles.btnText, {color: tone.text}]} weight="semibold">
          {children}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── Inlined @/components/ui Badge (DOM <span> -> View chip) ────────────── */

type BadgeVariant = 'success' | 'neutral' | 'info' | 'danger';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

const BADGE_TONES: Record<
  BadgeVariant,
  {bg: string; border: string; text: string}
> = {
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
  info: {
    bg: colors.surfaceSelected,
    border: colors.borderAccent,
    text: colors.accent,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    text: colors.danger,
  },
};

function Badge({variant = 'neutral', children}: BadgeProps) {
  const tone = BADGE_TONES[variant];
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: tone.bg, borderColor: tone.border},
      ]}>
      <AppText style={[styles.badgeText, {color: tone.text}]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── Inlined @/components/ui Toggle (DOM switch -> Pressable track) ─────── */

interface ToggleProps {
  label?: string;
  /** When true the visible label text is hidden (web `size="sm"` row switch). */
  hideLabel?: boolean;
  size?: 'sm' | 'md';
  checked: boolean;
  onChange: (checked: boolean) => void;
  testID?: string;
}

function Toggle({label, hideLabel, checked, onChange, testID}: ToggleProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked}}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      testID={testID}
      style={styles.toggleRow}>
      <View style={[styles.toggleTrack, checked ? styles.toggleTrackOn : null]}>
        <View
          style={[styles.toggleThumb, checked ? styles.toggleThumbOn : null]}
        />
      </View>
      {label && !hideLabel ? (
        <AppText style={styles.toggleLabel}>{label}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── Inlined @/components/ui Select (DOM <select> -> Modal picker) ──────── */

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  id?: string;
  accessibilityLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}

// RN ships no <select>; a Pressable trigger that opens a Modal scroll list
// faithfully reproduces the web dropdown contract (value/onChange/options).
// onChange receives the chosen option value, mirroring the web `e.target.value`.
function Select({id, accessibilityLabel, value, onChange, options}: SelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        nativeID={id}
        onPress={() => setOpen(true)}
        testID={id}
        style={({pressed}) => [
          styles.selectTrigger,
          pressed ? styles.chipPressed : null,
        ]}>
        <AppText style={styles.selectValue} numberOfLines={1}>
          {selected?.label ?? value}
        </AppText>
        <AppText style={styles.selectChevron}>{'\u2304'}</AppText>
      </Pressable>
      {open ? (
        <Modal
          animationType="fade"
          transparent
          visible={open}
          onRequestClose={() => setOpen(false)}>
          <Pressable
            accessibilityRole="button"
            style={styles.pickerBackdrop}
            onPress={() => setOpen(false)}>
            <View style={styles.pickerSheet}>
              <ScrollView style={styles.pickerScroll}>
                {options.map(opt => {
                  const active = opt.value === value;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="button"
                      accessibilityState={{selected: active}}
                      onPress={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      style={({pressed}) => [
                        styles.pickerOption,
                        active ? styles.pickerOptionActive : null,
                        pressed ? styles.pickerOptionPressed : null,
                      ]}>
                      <AppText
                        style={
                          active
                            ? styles.pickerOptionTextActive
                            : styles.pickerOptionText
                        }
                        weight={active ? 'semibold' : 'regular'}>
                        {opt.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

/* ─── Inlined @/components/ui ConfirmDialog (DOM dialog -> Modal) ────────── */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }
  const handleCancel = loading ? undefined : onCancel;
  return (
    <Modal
      animationType="fade"
      transparent
      visible={open}
      onRequestClose={handleCancel}>
      <View
        accessibilityViewIsModal
        accessibilityRole="alert"
        accessibilityLabel={title}
        style={styles.modalOverlay}>
        <Pressable
          accessibilityElementsHidden
          disabled={loading}
          importantForAccessibility="no-hide-descendants"
          onPress={handleCancel}
          style={styles.modalBackdrop}
        />
        <View style={styles.confirmSheet} testID="webhook-confirm-dialog">
          <AppText style={styles.modalTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.confirmMessage}>{message}</AppText>
          <View style={styles.footerRow}>
            <Button
              variant="ghost"
              onPress={onCancel}
              disabled={loading}
              testID="webhook-confirm-cancel">
              {cancelLabel}
            </Button>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              onPress={onConfirm}
              disabled={loading}
              icon={
                loading ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : undefined
              }
              testID="webhook-confirm-confirm">
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const ROW_SURFACE = 'rgba(255, 255, 255, 0.02)';
const SURFACE_2 = 'rgba(255, 255, 255, 0.04)';

const styles = StyleSheet.create({
  panel: {
    gap: spacing.lg,
    padding: spacing.lg + spacing.xs,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  sectionHeading: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  panelHeading: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  bodySm: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  mutedSm: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  loadingRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  list: {
    gap: spacing.md,
  },
  row: {
    backgroundColor: ROW_SURFACE,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowMain: {
    flex: 1,
    gap: spacing.xs,
  },
  rowTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rowUrl: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  rowActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  testResultBox: {
    backgroundColor: SURFACE_2,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  testResultHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  testSignatureRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  testBodyWrap: {
    gap: spacing.xs,
  },
  testBodySummary: {
    alignSelf: 'flex-start',
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  codeInline: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    color: colors.textPrimary,
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  codeInlineText: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  codeBlock: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    padding: spacing.sm,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
  },
  requiredMark: {
    color: colors.danger,
    fontSize: 14,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  formField: {
    gap: spacing.xs,
  },
  secretRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secretInput: {
    flex: 1,
  },
  previewBox: {
    backgroundColor: SURFACE_2,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
  },
  previewInner: {
    gap: spacing.xs,
  },
  enabledRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  errorTextSm: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 16,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  docsBox: {
    backgroundColor: SURFACE_2,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  docsTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  docList: {
    gap: 2,
    marginTop: spacing.xs,
  },
  docItem: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  /* Button */
  btn: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  btnSm: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  btnIconOnly: {
    minWidth: 32,
    paddingHorizontal: 6,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnIconWrap: {
    marginRight: 6,
  },
  btnText: {
    fontSize: 13,
    lineHeight: 18,
  },
  /* Badge */
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  /* Toggle */
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 3,
    width: 44,
  },
  toggleTrackOn: {
    backgroundColor: colors.accentSoft,
  },
  toggleThumb: {
    backgroundColor: colors.textMuted,
    borderRadius: 999,
    height: 18,
    width: 18,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },
  toggleLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
  },
  /* Select */
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectValue: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  chipPressed: {
    opacity: 0.7,
  },
  /* Modal + picker */
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalSheet: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: '90%',
    maxWidth: 520,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalScrollContent: {
    gap: spacing.md,
    padding: spacing.md,
  },
  confirmSheet: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    maxWidth: 480,
    padding: spacing.lg,
    width: '100%',
  },
  confirmMessage: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  pickerBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pickerSheet: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 360,
    overflow: 'hidden',
    width: '100%',
  },
  pickerScroll: {
    flexGrow: 0,
  },
  pickerOption: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  pickerOptionActive: {
    backgroundColor: colors.surfaceSelected,
  },
  pickerOptionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  pickerOptionText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
  },
  pickerOptionTextActive: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 18,
  },
});
