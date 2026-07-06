/**
 * ChannelFormModal — create/edit dialog for a notification channel. Presents an
 * accessible provider picker (a radiogroup of provider tiles), a name field,
 * the provider-specific credential inputs, an enabled toggle, and — when
 * editing — a "Test connection" affordance that surfaces the result inline.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, TestTube, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Button, ErrorText, GlassPanel, HelpIcon, Input, Modal, Text, Toggle,
} from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useToast } from '@/components/feedback/Toast';
import { useSaveChannel, useTestChannel } from '@/api/hooks/useNotifications';
import type { NotificationChannel } from '@/api/types';
import {
  buildChannelPayload, channelToFormConfig, CHANNEL_TYPES, FIELD_HELP,
  getChannelMeta, type ChannelType,
} from './channelMeta';

interface ChannelFormModalProps {
  channel: NotificationChannel | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ChannelFormModal({ channel, onClose, onSaved }: ChannelFormModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = !!channel;
  const [kind, setKind] = useState<ChannelType>(channel?.kind ?? 'discord');
  const [name, setName] = useState(channel?.name ?? '');
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [config, setConfig] = useState<Record<string, string>>(
    channel ? channelToFormConfig(channel) : {},
  );
  const [formError, setFormError] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  const meta = getChannelMeta(kind);
  const saveMut = useSaveChannel();
  const testMut = useTestChannel();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setTestResult(null);
    if (!name.trim()) {
      setFormError(t('notifications.channels.nameRequired', 'Name is required'));
      return;
    }
    const payload = buildChannelPayload(kind, name, enabled, config, isEdit && channel ? channel.id : undefined);
    saveMut.mutate(payload, {
      onSuccess: () => { onSaved(); },
      onError: (err) => setFormError(String(err)),
    });
  };

  const handleTest = () => {
    if (!isEdit || !channel) return;
    testMut.mutate(channel.id, {
      onSuccess: (data) => {
        if (data?.success) {
          setTestResult({ success: true, message: t('notifications.channels.testSuccess', 'Test notification sent successfully!') });
          toast.success(t('notifications.channels.testSuccessShort', 'Test sent!'));
        } else {
          setTestResult({ success: false, message: data?.error || t('notifications.channels.testFailed', 'Test failed') });
          toast.error(t('notifications.channels.testFailed', 'Test failed'), data?.error);
        }
      },
      onError: () => {
        setTestResult({ success: false, message: t('notifications.channels.testFailed', 'Test failed') });
        toast.error(t('notifications.channels.testFailed', 'Test failed'));
      },
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? t('notifications.channels.editTitle', 'Edit Channel') : t('notifications.channels.addTitle', 'Add Channel')}
    >
      <FadeIn>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {!isEdit && (
            <div>
              <Text as="span" id="channel-type-label" size="xs" weight="medium" color="secondary" className="mb-2 block">
                {t('notifications.channels.typeLabel', 'Channel Type')}
              </Text>
              <div
                role="radiogroup"
                aria-labelledby="channel-type-label"
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
              >
                {CHANNEL_TYPES.map((ct) => {
                  const TIcon = ct.icon;
                  const selected = kind === ct.value;
                  return (
                    <Button
                      key={ct.value}
                      type="button"
                      variant="ghost"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => { setKind(ct.value); setConfig({}); setTestResult(null); }}
                      className={cn(
                        'h-auto w-full flex-col gap-1.5 rounded-xl border p-3 text-xs font-medium',
                        selected
                          ? 'border-neon-cyan/40 bg-neon-cyan/10'
                          : 'border-[var(--border-subtle)] bg-white/[0.02] hover:bg-[var(--surface-2)]',
                      )}
                    >
                      <TIcon
                        className={cn('h-5 w-5', !selected && 'text-[var(--text-secondary)]')}
                        style={selected ? { color: ct.color } : undefined}
                        aria-hidden="true"
                      />
                      <span
                        className={cn(!selected && 'text-[var(--text-secondary)]')}
                        style={selected ? { color: ct.color } : undefined}
                      >
                        {ct.label}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <Input
            label={t('notifications.channels.nameLabel', 'Channel Name')}
            help={{
              i18nKey: 'help.fields.channels.nameLabel',
              content: 'Friendly identifier shown in the channel list and on alert delivery logs. Has no functional impact — pick anything memorable.',
            }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${t('notifications.channels.namePlaceholderPrefix', 'My')} ${meta.label}`}
          />

          <div className="space-y-3">
            <Text as="span" size="xs" weight="medium" color="secondary" className="flex items-center gap-1">
              {meta.label} {t('notifications.channels.configLabel', 'Configuration')}
              <HelpIcon
                i18nKey="help.fields.channels.configSection"
                content="Provider-specific credentials and routing details. Required fields vary by channel type. All secrets are encrypted at rest."
                for={`channel-config-${meta.value}`}
              />
            </Text>
            {meta.fields.map((f) => (
              <Input
                key={f.key}
                label={t(f.i18nKey, f.label)}
                help={FIELD_HELP[f.key]}
                type={f.type === 'password' ? 'password' : 'text'}
                value={config[f.key] ?? ''}
                onChange={(e) => {
                  const { value } = e.target;
                  setConfig((prev) => ({ ...prev, [f.key]: value }));
                }}
                placeholder={f.placeholder}
              />
            ))}
            <Text as="p" variant="helper" className="flex items-center gap-1">
              <HelpIcon
                i18nKey="help.fields.channels.testHint"
                content='Use the "Send Test" button after saving to verify your configuration. Tests bypass severity filters but otherwise match real delivery.'
                for={`channel-test-${meta.value}`}
              />
              {t('notifications.channels.testHint', 'Save then click "Send Test" to verify the configuration.')}
            </Text>
          </div>

          <Toggle
            checked={enabled}
            onChange={setEnabled}
            label={enabled ? t('notifications.channels.enabled', 'Enabled') : t('notifications.channels.disabled', 'Disabled')}
          />

          {testResult && (
            <GlassPanel
              role="status"
              aria-live="polite"
              className={cn(
                'flex items-center gap-2 p-3',
                testResult.success ? 'border-neon-green/20 bg-neon-green/10' : 'border-neon-red/20 bg-neon-red/10',
              )}
            >
              {testResult.success
                ? <CheckCircle className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                : <XCircle className="h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />}
              <Text as="span" size="sm" className={testResult.success ? 'text-emerald-300' : 'text-rose-300'}>
                {testResult.message}
              </Text>
            </GlassPanel>
          )}

          {formError && <ErrorText>{formError}</ErrorText>}

          <div className="flex items-center gap-3 pt-2">
            {isEdit && (
              <Button
                type="button"
                variant="secondary"
                icon={<TestTube className="h-4 w-4" aria-hidden="true" />}
                loading={testMut.isPending}
                onClick={handleTest}
              >
                {testMut.isPending ? t('notifications.channels.testing', 'Testing…') : t('notifications.channels.test', 'Test Connection')}
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
            <Button type="submit" variant="primary" loading={saveMut.isPending}>
              {saveMut.isPending
                ? t('common.saving', 'Saving…')
                : isEdit ? t('common.update', 'Update') : t('common.create', 'Create')}
            </Button>
          </div>
        </form>
      </FadeIn>
    </Modal>
  );
}
