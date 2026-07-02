/**
 * Browser push notification channel settings card.
 *
 * Renders alongside the user-configurable notification channels in the
 * "Channels" tab. Unlike Discord/Slack/etc., browser push is a per-device
 * affordance: subscribing here registers THIS browser-device-pairing
 * with the server so it can receive push notifications when the
 * TeslaSync tab is closed.
 *
 * The card surfaces three states:
 *   - Unsupported (Notification API + PushManager + service worker not
 *     all available, OR the server has no VAPID keys configured).
 *   - Not subscribed on this device.
 *   - Subscribed on this device.
 *
 * Plus a per-device list (every browser that has ever registered) so
 * the user can revoke a stale phone or laptop without having to log into
 * that device.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, BellOff, Smartphone, Trash2, AlertCircle } from 'lucide-react';

import { Badge, Button, GlassPanel, Heading, Text } from '@/components/ui';
import { useWebPush } from '@/hooks/useWebPush';
import { usePushSubscriptions, useUnsubscribePush, usePushPublicKey } from '@/api/hooks/usePush';
import { formatRelative } from '@/lib/dateFormat';
import type { PushSubscriptionRow } from '@/api/types';

interface BrowserPushChannelCardProps {
  className?: string;
}

export function BrowserPushChannelCard({ className }: BrowserPushChannelCardProps) {
  const { t } = useTranslation();
  const {
    isSupported: notifSupported,
    isPushSupported,
    isSubscribed,
    currentEndpoint,
    permission,
    subscribe,
    unsubscribe,
  } = useWebPush();
  const { data: publicKey, isLoading: keyLoading } = usePushPublicKey();
  const { data: subs } = usePushSubscriptions();
  const unsubMut = useUnsubscribePush();

  const rows = useMemo<PushSubscriptionRow[]>(() => subs ?? [], [subs]);

  // Disabled-state reason — the card still renders so users can SEE
  // that browser push exists but is not currently available.
  const disabledReason = (() => {
    if (!notifSupported) return t('webpush.unsupported.notification', "This browser doesn't support notifications.");
    if (!isPushSupported && !keyLoading && publicKey === null)
      return t('webpush.unsupported.serverDisabled', 'Browser push is not configured on this server. Ask your administrator to set the VAPID keys.');
    if (!isPushSupported)
      return t('webpush.unsupported.pushApi', "This browser doesn't support the Push API.");
    if (permission === 'denied')
      return t('webpush.unsupported.permissionDenied', 'Notifications are blocked for this site. Re-enable them in your browser settings to use browser push.');
    return null;
  })();

  const isUnsupported = disabledReason !== null;

  const handleEnable = async () => {
    await subscribe();
  };

  const handleDisable = async () => {
    await unsubscribe();
  };

  const handleRemoveDevice = async (endpoint: string) => {
    await unsubMut.mutateAsync(endpoint);
  };

  return (
    <GlassPanel className={className}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl p-2.5 ring-1 ring-cyan-300/30 bg-cyan-300/10">
              <BellRing className="h-5 w-5 text-cyan-300" aria-hidden="true" />
            </div>
            <div>
              <Heading level="panel" as="h3">
                {t('webpush.title', 'Browser push')}
              </Heading>
              <Text as="p" variant="bodySm" className="mt-0.5">
                {t(
                  'webpush.subtitle',
                  'Get OS-level notifications even when TeslaSync is closed.',
                )}
              </Text>
            </div>
          </div>
          {!isUnsupported && (
            isSubscribed ? (
              <Badge variant="success">{t('webpush.status.subscribed', 'Active on this device')}</Badge>
            ) : (
              <Badge variant="neutral">{t('webpush.status.notSubscribed', 'Not subscribed')}</Badge>
            )
          )}
          {isUnsupported && (
            <Badge variant="warning">{t('webpush.status.unsupported', 'Unavailable')}</Badge>
          )}
        </div>

        {isUnsupported ? (
          <div className="flex items-start gap-2 rounded-lg bg-amber-300/5 p-3 ring-1 ring-amber-300/20">
            <AlertCircle className="h-4 w-4 text-amber-300 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <Text as="p" size="xs" className="text-amber-300">{disabledReason}</Text>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {isSubscribed ? (
              <Button variant="secondary" size="sm" onClick={handleDisable} aria-label={t('webpush.disable', 'Disable on this device')}>
                <BellOff className="h-4 w-4 mr-2" aria-hidden="true" />
                {t('webpush.disable', 'Disable on this device')}
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleEnable} aria-label={t('webpush.enable', 'Enable on this device')}>
                <BellRing className="h-4 w-4 mr-2" aria-hidden="true" />
                {t('webpush.enable', 'Enable on this device')}
              </Button>
            )}
            <Text as="p" variant="bodySm">
              {t(
                'webpush.iosNote',
                'iOS Safari requires version 16.4 or later, and you must add TeslaSync to your Home Screen.',
              )}
            </Text>
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
            <Heading level="sub" as="h4" className="text-xs uppercase tracking-wide">
              {t('webpush.devices.title', 'Registered devices')}
            </Heading>
            <ul className="space-y-2">
              {rows.map((row) => {
                const isThisDevice = currentEndpoint !== null && currentEndpoint === row.endpoint;
                const ua = row.user_agent ?? t('webpush.devices.unknownAgent', 'Unknown browser');
                const last = row.last_used_at
                  ? t('webpush.devices.lastUsed', 'Last used {{when}}', {
                      when: formatRelative(row.last_used_at),
                    })
                  : t('webpush.devices.neverUsed', 'Not yet used');
                return (
                  <li
                    key={row.id}
                    className="flex items-start justify-between gap-3 rounded-lg bg-white/[0.02] p-2.5 ring-1 ring-white/5"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <Smartphone className="h-4 w-4 text-[var(--text-secondary)] mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <Text as="p" size="xs" color="primary" className="truncate" title={ua}>
                          {ua}
                          {isThisDevice && (
                            <Text as="span" size="xs" className="ml-2 text-cyan-300">
                              {t('webpush.devices.thisDevice', '(this device)')}
                            </Text>
                          )}
                        </Text>
                        <Text as="p" size="xs" color="secondary" className="mt-0.5">{last}</Text>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveDevice(row.endpoint)}
                      aria-label={t('webpush.devices.remove', 'Remove this device')}
                      title={t('webpush.devices.remove', 'Remove this device')}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
