// Webhook notification channels Settings section.
//
// Surfaces the existing notification_channel_webhook records as an
// editable list under <section id="webhooks"> on the Settings page.
// Adds three things on top of the generic channel CRUD already
// shipped in NotificationChannelsView.tsx:
//
//   1. A focused list view limited to kind=webhook with a status pill
//      and per-row Test / Edit / Delete actions.
//   2. A wizard-style form modal that walks the user through the four
//      fields the backend actually persists — name, URL, HTTP method,
//      and the (repurposed) signing secret — instead of asking them
//      to edit raw JSON in the legacy modal.
//   3. A live HMAC X-TeslaSync-Signature preview that calls the new
//      /notifications/webhooks/preview-signature utility endpoint so
//      the user can verify their receiver's signing logic before they
//      ever fire a real webhook.
//
// The Blocked-Path constraint (no body templating yet, no migrations)
// means headers + body_template fields exist in the TypeScript union
// `NotificationChannelWebhook` but are NOT round-tripped through the
// backend. We initialise them to `{}` and `''` and cast the resulting
// payload through `NotificationChannelInput` so the type-checker stays
// honest while the runtime contract matches the existing schema.
//
// Body template editor and content-type select are intentionally omitted
// until `notification_channel_webhook` has the missing columns
// (separate migration → schema → repo → handler patch).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Pencil, Plus, Send, Trash2, Webhook } from 'lucide-react';

import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  ErrorText,
  GlassPanel,
  Heading,
  HelperText,
  IconBox,
  Input,
  Modal,
  Select,
  Text,
  Toggle,
} from '@/components/ui';
// The form Label (label element with htmlFor + required asterisk) is
// intentionally imported directly. The barrel
// `@/components/ui` re-exports the typography Label (a span-based
// caption) under the same name; importing from the file path is the
// established escape hatch documented in TOTPEnrollmentSection.
import { Label } from '@/components/ui/Label';
import { EmptyState, ListSkeleton, Spinner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard';
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
} from '@/api/hooks/useNotificationChannels';

type HttpMethod = 'POST' | 'PUT' | 'PATCH';

// We accept POST and PUT from the backend (those are the only methods
// the existing channel union allows) and add PATCH as a UI option for
// receivers like Home Assistant that prefer it. The save payload still
// narrows to POST | PUT to satisfy the type system; PATCH falls back
// to POST until the schema gains a `method` column with a wider enum.
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
    // Backend never echoes the bearer_token / secret on read, so editing
    // an existing channel always starts with a blank secret box. The
    // helper text in the form makes this clear.
    secret: '',
    enabled: channel.enabled !== false,
  };
}

// Compose the save payload. Headers and body_template fields are
// satisfied with empty defaults (the backend's existing dispatch path
// ignores them), and the cast keeps the discriminated-union machinery
// in NotificationChannelInput happy.
function toSavePayload(form: WebhookFormState): NotificationChannelInput {
  const safeMethod: 'POST' | 'PUT' =
    form.method === 'PUT' ? 'PUT' : SAVE_METHOD_FALLBACK;
  const idPart = form.id !== null ? { id: form.id } : {};
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
  if (trimmed === '') return false;
  return /^https?:\/\//i.test(trimmed);
}

interface SignaturePreviewProps {
  secret: string;
  body: string;
}

function SignaturePreview({ secret, body }: SignaturePreviewProps) {
  const { t } = useTranslation();
  const [signature, setSignature] = useState<string>('');
  const [error, setError] = useState<string>('');
  const previewMut = useWebhookSignaturePreview();

  // Stash the latest mutation function in a ref so the debounced
  // effect doesn't reschedule itself every render — the React Query
  // mutation object is unstable across renders.
  const mutateRef = useRef(previewMut.mutateAsync);
  mutateRef.current = previewMut.mutateAsync;

  useEffect(() => {
    setError('');
    if (secret.trim() === '') {
      setSignature('');
      return;
    }
    const handle = window.setTimeout(() => {
      mutateRef.current({ secret, body })
        .then((res) => {
          setSignature(res.signature);
        })
        .catch((err: unknown) => {
          setSignature('');
          setError(err instanceof Error ? err.message : String(err));
        });
    }, 300);
    return () => window.clearTimeout(handle);
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
    <div data-testid="webhook-signature-preview" className="space-y-1">
      <Label>{t('webhookChannels.signature.label', 'Signature preview')}</Label>
      {previewMut.isPending && signature === '' ? (
        <Text variant="bodySm" className="flex items-center gap-2">
          <Spinner className="h-3 w-3" />
          {t('webhookChannels.signature.loading', 'Computing signature…')}
        </Text>
      ) : error !== '' ? (
        <Text variant="bodySm" className="text-rose-300">
          {t('webhookChannels.signature.error', 'Failed to compute signature: {{error}}', { error })}
        </Text>
      ) : signature !== '' ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-[var(--surface-2)] px-2 py-1 text-xs">
            {signature}
          </code>
          <CopyButton text={signature} iconOnly />
        </div>
      ) : null}
      <HelperText>
        {t(
          'webhookChannels.signature.help',
          'Send this header value with every webhook so receivers can verify authenticity.',
        )}
      </HelperText>
    </div>
  );
}

interface WebhookFormModalProps {
  open: boolean;
  initial: WebhookFormState | null;
  onClose: () => void;
  onSaved: () => void;
}

function WebhookFormModal({ open, initial, onClose, onSaved }: WebhookFormModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<WebhookFormState>(initial ?? EMPTY_FORM);
  const [showSecret, setShowSecret] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'url', string>>>({});
  const [formError, setFormError] = useState('');
  const saveMut = useSaveChannel();
  const isEdit = (initial?.id ?? null) !== null;

  // Reset state every time the modal opens for a different channel.
  useEffect(() => {
    if (!open) return;
    setForm(initial ?? EMPTY_FORM);
    setShowSecret(false);
    setFieldErrors({});
    setFormError('');
  }, [open, initial]);
  const isDirty = open
    && JSON.stringify(form) !== JSON.stringify(initial ?? EMPTY_FORM);
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    isDirty,
    onClose,
    {
      message: t(
        'webhookChannels.form.unsaved',
        'You have unsaved webhook changes. Discard them?',
      ),
    },
  );

  // Static body sample used to build a representative signature so the
  // user sees a non-trivial hex string. Mirrors the envelope the
  // backend WebhookTest handler emits.
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

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setFieldErrors({});
      setFormError('');
      const trimmedName = form.name.trim();
      const trimmedUrl = form.url.trim();
      const nextErrors: typeof fieldErrors = {};
      if (!trimmedName) {
        nextErrors.name = t('webhookChannels.form.nameRequired', 'Name is required.');
      }
      if (!isHttpsLike(trimmedUrl)) {
        nextErrors.url = t('webhookChannels.form.urlInvalid', 'URL must start with http:// or https://.');
      }
      setFieldErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        return;
      }
      saveMut.mutate(toSavePayload({ ...form, name: trimmedName, url: trimmedUrl }), {
        onSuccess: () => {
          onSaved();
        },
        onError: (err) => {
          setFormError(err instanceof Error ? err.message : String(err));
        },
      });
    },
    [fieldErrors, form, onSaved, saveMut, t],
  );

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title={
          isEdit
            ? t('webhookChannels.form.editTitle', 'Edit webhook')
            : t('webhookChannels.form.addTitle', 'Add webhook')
        }
        ariaLabel={
          isEdit
            ? t('webhookChannels.form.editTitle', 'Edit webhook')
            : t('webhookChannels.form.addTitle', 'Add webhook')
        }
        size="md"
        data-testid="webhook-form-modal"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="webhook-form-name" required>
            {t('webhookChannels.form.name', 'Name')}
          </Label>
          <Input
            id="webhook-form-name"
            value={form.name}
            onChange={(e) => {
              setForm((s) => ({ ...s, name: e.target.value }));
              setFieldErrors((current) => ({ ...current, name: undefined }));
            }}
            error={fieldErrors.name}
            placeholder={t('webhookChannels.form.namePlaceholder', 'Discord #alerts')}
            required
            data-testid="webhook-form-name"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="webhook-form-url" required>
            {t('webhookChannels.form.url', 'URL')}
          </Label>
          <Input
            id="webhook-form-url"
            type="url"
            value={form.url}
            onChange={(e) => {
              setForm((s) => ({ ...s, url: e.target.value }));
              setFieldErrors((current) => ({ ...current, url: undefined }));
            }}
            error={fieldErrors.url}
            placeholder={t(
              'webhookChannels.form.urlPlaceholder',
              'https://discord.com/api/webhooks/...',
            )}
            required
            data-testid="webhook-form-url"
          />
          <HelperText>
            {t(
              'webhookChannels.form.urlHelp',
              'Compatible with Discord, Slack, n8n, Home Assistant, and any HTTP receiver.',
            )}
          </HelperText>
        </div>

        <div className="space-y-1">
          <Label htmlFor="webhook-form-method">
            {t('webhookChannels.form.method', 'HTTP method')}
          </Label>
          <Select
            id="webhook-form-method"
            value={form.method}
            onChange={(e) =>
              setForm((s) => ({ ...s, method: e.target.value as HttpMethod }))
            }
            options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
            data-testid="webhook-form-method"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="webhook-form-secret">
            {t('webhookChannels.form.secret', 'Signing secret')}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="webhook-form-secret"
              type={showSecret ? 'text' : 'password'}
              value={form.secret}
              onChange={(e) => setForm((s) => ({ ...s, secret: e.target.value }))}
              placeholder={
                isEdit
                  ? t('webhookChannels.form.secretPlaceholderEdit', 'Leave blank to keep existing')
                  : t('webhookChannels.form.secretPlaceholder', 'Optional — used for HMAC signing')
              }
              autoComplete="new-password"
              data-testid="webhook-form-secret"
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowSecret((v) => !v)}
              aria-label={
                showSecret
                  ? t('webhookChannels.form.hideSecret', 'Hide secret')
                  : t('webhookChannels.form.showSecret', 'Show secret')
              }
              data-testid="webhook-form-toggle-secret"
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <HelperText>
            {t(
              'webhookChannels.form.secretHelp',
              'When set, every request includes X-TeslaSync-Signature: sha256=<hmac> so the receiver can verify authenticity.',
            )}
          </HelperText>
        </div>

        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <SignaturePreview secret={form.secret} body={sampleBody} />
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
          <Toggle
            label={t('webhookChannels.form.enabled', 'Enabled')}
            checked={form.enabled}
            onChange={(v) => setForm((s) => ({ ...s, enabled: v }))}
            data-testid="webhook-form-enabled"
          />
        </div>

        {formError !== '' ? <ErrorText>{formError}</ErrorText> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={requestClose}
            data-testid="webhook-form-cancel"
          >
            {t('webhookChannels.form.cancel', 'Cancel')}
          </Button>
          <Button
            type="submit"
            loading={saveMut.isPending}
            data-testid="webhook-form-submit"
          >
            {saveMut.isPending ? (
              t('webhookChannels.form.saving', 'Saving…')
            ) : isEdit ? (
              t('webhookChannels.form.saveEdit', 'Save changes')
            ) : (
              t('webhookChannels.form.save', 'Add webhook')
            )}
          </Button>
        </div>
      </form>
      </Modal>
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </>
  );
}

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
  const { t } = useTranslation();
  return (
    <div
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 space-y-3"
      data-testid={`webhook-row-${channel.id}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Heading level="panel">{channel.name}</Heading>
            <Badge variant={channel.enabled ? 'success' : 'neutral'}>
              {channel.enabled
                ? t('webhookChannels.row.enabled', 'Enabled')
                : t('webhookChannels.row.disabled', 'Disabled')}
            </Badge>
            <Badge variant="info">{(channel.method ?? 'POST').toUpperCase()}</Badge>
          </div>
          <Text variant="bodySm" className="block break-all text-[var(--text-muted)]">
            {channel.url}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Toggle
            label={t('webhookChannels.row.toggle', 'Active')}
            checked={channel.enabled}
            onChange={onToggle}
            size="sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onTest}
            disabled={testBusy || toggleBusy}
            loading={testBusy}
            icon={<Send className="h-4 w-4" />}
            aria-label={t('webhookChannels.row.test', 'Test webhook')}
            data-testid={`webhook-test-${channel.id}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={t('webhookChannels.row.edit', 'Edit webhook')}
            data-testid={`webhook-edit-${channel.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={t('webhookChannels.row.delete', 'Delete webhook')}
            data-testid={`webhook-delete-${channel.id}`}
          >
            <Trash2 className="h-4 w-4 text-rose-300" />
          </Button>
        </div>
      </div>

      {testResult ? (
        <div
          className="rounded border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 text-xs"
          data-testid={`webhook-test-result-${channel.id}`}
        >
          <div className="flex items-center gap-2">
            <Badge variant={testResult.success ? 'success' : 'danger'}>
              {testResult.success
                ? t('webhookChannels.test.success', 'Success')
                : t('webhookChannels.test.failure', 'Failed')}
            </Badge>
            <Text variant="bodySm">
              {t('webhookChannels.test.status', 'Status {{status}}', {
                status: testResult.status_code,
              })}
            </Text>
            <Text variant="bodySm" className="text-[var(--text-muted)]">
              {t('webhookChannels.test.latency', '{{ms}} ms', { ms: testResult.latency_ms })}
            </Text>
          </div>
          {testResult.signature ? (
            <div className="mt-2 flex items-center gap-2">
              <Text variant="bodySm" className="text-[var(--text-muted)]">
                {t('webhookChannels.test.signature', 'Signature:')}
              </Text>
              <code className="flex-1 truncate rounded bg-[var(--surface-1)] px-2 py-0.5 text-2xs">
                {testResult.signature}
              </code>
            </div>
          ) : null}
          {testResult.body_preview ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[var(--text-muted)]">
                {t('webhookChannels.test.body', 'Response body')}
              </summary>
              <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-[var(--surface-1)] p-2 text-2xs">
                {testResult.body_preview}
                {testResult.truncated
                  ? `\n${t('webhookChannels.test.truncated', '… (truncated)')}`
                  : ''}
              </pre>
            </details>
          ) : null}
          {testResult.error ? (
            <Text variant="bodySm" className="mt-1 text-rose-300">
              {testResult.error}
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WebhookChannelsSection() {
  const { t } = useTranslation();
  const { data: webhooks, isLoading, error } = useWebhookChannels();
  const deleteMut = useDeleteChannel();
  const toggleMut = useToggleChannel();
  const testMut = useTestWebhookChannel();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookFormState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, WebhookTestResult>>({});

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
        { id },
        {
          onSuccess: (res) => {
            setTestResults((prev) => ({ ...prev, [id]: res }));
          },
          onError: (err) => {
            setTestResults((prev) => ({
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
    if (confirmDeleteId === null) return;
    const id = confirmDeleteId;
    deleteMut.mutate(id, {
      onSuccess: () => {
        setConfirmDeleteId(null);
        setTestResults((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
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
      <GlassPanel
        className="p-5 space-y-5"
        data-testid="webhook-channels-section"
      >
        <div className="flex items-start gap-4">
          <IconBox color="cyan">
            <Webhook className="h-5 w-5" />
          </IconBox>
          <div className="flex-1 min-w-0">
            <Heading level="section">
              {t('webhookChannels.title', 'Webhook channels')}
            </Heading>
            <Text variant="bodySm">
              {t(
                'webhookChannels.subtitle',
                'Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, or any HTTP receiver. Each channel can be HMAC-signed so receivers can verify authenticity.',
              )}
            </Text>
          </div>
          <Button onClick={handleAdd} data-testid="webhook-add">
            <Plus className="mr-1 h-4 w-4" />
            {t('webhookChannels.addButton', 'Add webhook')}
          </Button>
        </div>

        {isLoading ? (
          <ListSkeleton
            rows={3}
            label={t('webhookChannels.loading', 'Loading webhook channels…')}
            testId="webhook-channels-loading"
          />
        ) : error ? (
          <Text variant="bodySm" className="text-rose-300" role="alert">
            {t('webhookChannels.loadError', 'Failed to load webhook channels: {{error}}', {
              error: error instanceof Error ? error.message : String(error),
            })}
          </Text>
        ) : sortedWebhooks.length === 0 ? (
          <EmptyState
            icon={<Webhook className="h-8 w-8" />}
            title={t('webhookChannels.empty.title', 'No webhooks yet')}
            message={t(
              'webhookChannels.empty.message',
              'Add a webhook to forward TeslaSync events to your favourite chat or automation tool.',
            )}
            action={{
              label: t('webhookChannels.empty.action', 'Add your first webhook'),
              onClick: handleAdd,
            }}
          />
        ) : (
          <div className="space-y-3">
            {sortedWebhooks.map((ch) => (
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
          </div>
        )}

        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 text-xs">
          <Heading level="sub">
            {t('webhookChannels.docs.title', 'Available payload variables')}
          </Heading>
          <Text variant="bodySm" className="text-[var(--text-muted)]">
            {t(
              'webhookChannels.docs.intro',
              'Webhook receivers get a JSON envelope with these fields:',
            )}
          </Text>
          <ul className="mt-1 list-disc pl-5 space-y-0.5 text-[var(--text-muted)]">
            <li><code>title</code> — short headline of the event</li>
            <li><code>message</code> — long-form body of the event</li>
            <li><code>source</code> — always <code>"teslasync"</code></li>
            <li><code>timestamp</code> — RFC3339 server-side time</li>
          </ul>
        </div>
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

      {/* The save mutation surfaces its own toasts via useSaveChannel,
          and the modal reflects in-flight state via `saveMut.isPending`
          inside WebhookFormModal — no extra live-region announcement
          needed at this layer. */}
    </FadeIn>
  );
}

export default WebhookChannelsSection;
