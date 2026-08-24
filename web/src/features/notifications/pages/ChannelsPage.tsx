/**
 * ChannelsPage — Notification delivery channels command center. Full-width
 * bento that manages every place TeslaSync can send alerts: Discord, Slack,
 * Telegram, email, ntfy, Pushover, a custom webhook, and per-device browser
 * push. Orchestrates the delivery-health KPI band, the configured-channels
 * grid, the browser-push + provider-reference band, and the create/edit modal.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Badge, Button, SectionTitle } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useNotificationChannels, useNotificationStats } from '@/api/hooks/useNotifications';
import type { NotificationChannel } from '@/api/types';

import { BrowserPushChannelCard } from '../components/BrowserPushChannelCard';
import { ChannelStatsBand } from '../components/channels/ChannelStatsBand';
import { ChannelsGrid } from '../components/channels/ChannelsGrid';
import { ChannelProvidersPanel } from '../components/channels/ChannelProvidersPanel';
import { ChannelFormModal } from '../components/channels/ChannelFormModal';
import { HealthAlertPreferencesPanel } from '../components/channels/HealthAlertPreferencesPanel';

export default function ChannelsPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.channels.title', 'Notification channels'));

  const channelsQuery = useNotificationChannels();
  const statsQuery = useNotificationStats();
  const channels: NotificationChannel[] = channelsQuery.data ?? [];

  const [showForm, setShowForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);

  const openAdd = () => { setEditingChannel(null); setShowForm(true); };
  const openEdit = (channel: NotificationChannel) => { setEditingChannel(channel); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingChannel(null); };
  const handleRefresh = () => { channelsQuery.refetch(); statsQuery.refetch(); };

  const actions = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        onClick={handleRefresh}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        variant="primary"
        icon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onClick={openAdd}
      >
        {t('notifications.channels.add', 'Add Channel')}
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('notifications.channels.title', 'Notification channels')}
      subtitle={t('notifications.channels.subtitle', 'Where to send notifications: Discord, Slack, Telegram, email, ntfy, Pushover, or a custom webhook.')}
      actions={actions}
      query={[channelsQuery, statsQuery]}
      copyLink
    >
      {/* 1 — Delivery-health KPI band (full-width) */}
      <FadeIn>
        <section aria-label={t('notifications.channels.statsAria', 'Notification delivery summary')}>
          <ChannelStatsBand stats={statsQuery.data} isLoading={statsQuery.isLoading} />
        </section>
      </FadeIn>

      {/* 2 — Configured channels (hero): auto-fit bento, 1 col → many on wide */}
      <FadeIn delay={0.1}>
        <section aria-labelledby="channels-heading" className="space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle id="channels-heading">
              {t('notifications.channels.listTitle', 'Delivery channels')}
            </SectionTitle>
            {channels.length > 0 && (
              <Badge variant="neutral" size="sm">{channels.length}</Badge>
            )}
          </div>
          <ChannelsGrid
            channels={channels}
            isLoading={channelsQuery.isLoading}
            isError={channelsQuery.isError}
            error={channelsQuery.error}
            onRetry={() => channelsQuery.refetch()}
            onEdit={openEdit}
            onAdd={openAdd}
          />
        </section>
      </FadeIn>

      {/* 3 — Per-channel component outage/recovery preferences */}
      <FadeIn delay={0.2}>
        <section aria-label={t('notifications.healthAlerts.section', 'Component health notification preferences')}>
          <HealthAlertPreferencesPanel channels={channels} onAddChannel={openAdd} />
        </section>
      </FadeIn>

      {/* 4 — Secondary band: per-device browser push + provider reference */}
      <FadeIn delay={0.3}>
        <section aria-labelledby="devices-heading" className="space-y-3 sm:space-y-4">
          <SectionTitle id="devices-heading">
            {t('notifications.channels.devicesTitle', 'Devices & providers')}
          </SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3 xl:gap-5">
            <div className="xl:col-span-1">
              <BrowserPushChannelCard className="h-full p-4 sm:p-5" />
            </div>
            <div className="xl:col-span-2">
              <ChannelProvidersPanel channels={channels} />
            </div>
          </div>
        </section>
      </FadeIn>

      {showForm && (
        <ChannelFormModal
          channel={editingChannel}
          onClose={closeForm}
          onSaved={closeForm}
        />
      )}
    </PageContainer>
  );
}
