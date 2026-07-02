/**
 * ChannelCard — one configured notification channel. Shows the provider
 * icon/brand, name, enabled state, a masked preview of its credentials, and
 * per-channel Test / Edit / Delete / toggle controls. Each card owns its own
 * mutation instances so loading state and toasts are scoped to this channel.
 */

import { useTranslation } from 'react-i18next';
import { Pencil, TestTube, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Button, GlassPanel, Heading, Text, Toggle } from '@/components/ui';
import { useToast } from '@/components/feedback/Toast';
import {
  useDeleteChannel, useTestChannel, useToggleChannel,
} from '@/api/hooks/useNotifications';
import type { NotificationChannel } from '@/api/types';
import { channelToFormConfig, getChannelMeta, isSecretField } from './channelMeta';

interface ChannelCardProps {
  channel: NotificationChannel;
  onEdit: (channel: NotificationChannel) => void;
}

export function ChannelCard({ channel, onEdit }: ChannelCardProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const toggleMut = useToggleChannel();
  const deleteMut = useDeleteChannel();
  const testMut = useTestChannel();

  const meta = getChannelMeta(channel.kind);
  const Icon = meta.icon;
  const configPreview = channelToFormConfig(channel);
  const previewEntries = Object.entries(configPreview ?? {}).slice(0, 3);

  const handleToggle = () => {
    toggleMut.mutate(channel.id, {
      onSuccess: () => toast.success(channel.enabled
        ? t('notifications.channels.toggledOff', 'Channel disabled')
        : t('notifications.channels.toggledOn', 'Channel enabled')),
      onError: () => toast.error(t('notifications.channels.toggleFailed', 'Failed to toggle channel')),
    });
  };

  const handleTest = () => {
    testMut.mutate(channel.id, {
      onSuccess: (data) => {
        if (data?.success) toast.success(`${channel.name}: ${t('notifications.channels.testSuccessShort', 'Test sent!')}`);
        else toast.error(`${channel.name}: ${t('notifications.channels.testFailed', 'Test failed')}`, data?.error);
      },
      onError: () => toast.error(`${channel.name}: ${t('notifications.channels.testFailed', 'Test failed')}`),
    });
  };

  const handleDelete = () => {
    deleteMut.mutate(channel.id, {
      onSuccess: () => toast.success(t('notifications.channels.deleted', 'Channel deleted')),
      onError: () => toast.error(t('notifications.channels.deleteFailed', 'Failed to delete channel')),
    });
  };

  return (
    <GlassPanel
      hover
      className={cn(
        'flex h-full flex-col gap-4 p-4 sm:p-5 transition-all duration-normal',
        channel.enabled ? 'ring-1 ring-white/[0.08]' : 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="shrink-0 rounded-xl p-2.5 ring-1"
            style={{ background: `${meta.color}15`, borderColor: `${meta.color}30` }}
          >
            <Icon className="h-5 w-5" style={{ color: meta.color }} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <Heading level="panel" as="h3" className="truncate">{channel.name}</Heading>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <Text as="span" size="xs" weight="medium" className="capitalize" style={{ color: meta.color }}>
                {channel.kind}
              </Text>
              <Badge variant={channel.enabled ? 'success' : 'neutral'} size="sm">
                {channel.enabled ? t('notifications.channels.active', 'Active') : t('notifications.channels.disabled', 'Disabled')}
              </Badge>
            </div>
          </div>
        </div>
        <Toggle
          checked={channel.enabled}
          onChange={handleToggle}
          aria-label={t('notifications.channels.toggleAria', 'Toggle {{name}}', { name: channel.name })}
        />
      </div>

      <div className="space-y-1 rounded-lg bg-white/[0.02] p-2.5">
        {previewEntries.length === 0 ? (
          <Text as="span" variant="caption">—</Text>
        ) : (
          previewEntries.map(([k, v]) => (
            <Text key={k} as="p" variant="caption" className="block truncate">
              <Text as="span" size="xs" weight="medium" color="secondary">{k}:</Text>{' '}
              {isSecretField(k) ? '••••••••' : (v || '—')}
            </Text>
          ))
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
        <Button
          variant="primary"
          size="sm"
          icon={<TestTube className="h-3.5 w-3.5" aria-hidden="true" />}
          loading={testMut.isPending}
          onClick={handleTest}
        >
          {testMut.isPending ? t('notifications.channels.testing', 'Testing…') : t('notifications.channels.testShort', 'Test')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => onEdit(channel)}
        >
          {t('common.edit', 'Edit')}
        </Button>
        <Button
          variant="danger"
          size="sm"
          className="ml-auto"
          icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
          loading={deleteMut.isPending}
          onClick={handleDelete}
          aria-label={t('notifications.channels.deleteAria', 'Delete {{name}}', { name: channel.name })}
        />
      </div>
    </GlassPanel>
  );
}
