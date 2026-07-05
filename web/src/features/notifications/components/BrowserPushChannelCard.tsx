/**
 * Browser push notification channel settings card.
 *
 * Renders alongside the user-configurable notification channels in the
 * "Channels" tab. Unlike Discord/Slack/etc., browser push is a per-device
 * affordance: subscribing here registers THIS browser-device-pairing
 * with the server so it can receive push notifications when the
 * TeslaSync tab is closed.
 *
 * The card surfaces these states:
 *   - Checking — the server VAPID key request is still in flight; the
 *     availability verdict is deferred so the card never flashes a false
 *     "unsupported" before the key resolves.
 *   - Error — the key request failed (network/5xx); a retry is offered.
 *   - Unsupported (Notification API + PushManager + service worker not
 *     all available, OR the server has no VAPID keys configured).
 *   - Not subscribed on this device.
 *   - Subscribed on this device.
 *
 * Plus a per-device list (every browser that has ever registered) so
 * the user can revoke a stale phone or laptop without having to log into
 * that device.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, BellOff, Smartphone, Trash2, AlertCircle, Loader2 } from 'lucide-react';

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
  const {
    data: publicKey,
    isLoading: keyLoading,
    isError: keyError,
    refetch: refetchPublicKey,
  } = usePushPublicKey();
  const { data: subs } = usePushSubscriptions();
  const {
    mutateAsync: removeDevice,
    isPending: removePending,
    variables: removingEndpoint,
  } = useUnsubscribePush();

  // Tracks the "Enable/Disable on this device" action so the button can
  // surface a spinner and guard against double submits — the underlying
  // subscribe()/unsubscribe() lifecycle in useWebPush does not expose its
  // own pending flag.
  const [busy, setBusy] = useState(false);

  const rows = useMemo<PushSubscriptionRow[]>(() => subs ?? [], [subs]);

  // While the VAPID public key request is still in flight we cannot yet
  // tell "push genuinely unsupported" from "key not fetched": useWebPush
  // folds the key into `isPushSupported`, so it reads false during load.
  // Deferring the verdict here (and surfacing a loading state below)
  // prevents the card from flashing a false negative on first mount.
  const isCheckingAvailability = notifSupported && keyLoading;

  // Disabled-state reason — the card still renders so users can SEE
  // that browser push exists but is not currently available. Ordering is
  // significant: a browser with no Notification API at all is decisively
  // unavailable regardless of key/loading state, whereas the Push-API and
  // server-key verdicts are deferred until the key request settles.
  const disabledReason = useMemo(() => {
    if (!notifSupported)
      return t('webpush.unsupported.notification', "This browser doesn't support notifications.");
    if (isCheckingAvailability || keyError) return null;
    if (!isPushSupported && publicKey === null)
      return t('webpush.unsupported.serverDisabled', 'Browser push is not configured on this server. Ask your administrator to set the VAPID keys.');
    if (!isPushSupported)
      return t('webpush.unsupported.pushApi', "This browser doesn't support the Push API.");
    if (permission === 'denied')
      return t('webpush.unsupported.permissionDenied', 'Notifications are blocked for this site. Re-enable them in your browser settings to use browser push.');
    return null;
  }, [notifSupported, isCheckingAvailability, keyError, isPushSupported, publicKey, permission, t]);

  const isUnsupported = disabledReason !== null;
  // A capable browser whose key request failed is an error (retryable), not
  // "unsupported" — only surface it once the unsupported verdict is ruled out.
  const showKeyError = !isUnsupported && notifSupported && keyError;
  const showLoading = !isUnsupported && !showKeyError && isCheckingAvailability;

  const runDeviceAction = useCallback(async (action: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      // subscribe()/unsubscribe() already surface their own failure toasts
      // via the mutation hooks; swallow here so a dismissed permission
      // prompt or PushManager rejection can't escape as an unhandled
      // rejection — and the button is always re-enabled by `finally`.
    } finally {
      setBusy(false);
    }
  }, []);

  const handleEnable = useCallback(() => runDeviceAction(subscribe), [runDeviceAction, subscribe]);
  const handleDisable = useCallback(() => runDeviceAction(unsubscribe), [runDeviceAction, unsubscribe]);

  const handleRemoveDevice = useCallback(
    (endpoint: string) => {
      // Fire-and-forget: useUnsubscribePush toasts on success/failure and
      // invalidates the device list, so the row disappears on its own. The
      // catch keeps a rejected mutation from bubbling out of the click handler.
      void removeDevice(endpoint).catch(() => {
        /* toasted by the mutation hook */
      });
    },
    [removeDevice],
  );

  const handleRetryKey = useCallback(() => {
    void refetchPublicKey();
  }, [refetchPublicKey]);

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
          {isUnsupported ? (
            <Badge variant="warning">{t('webpush.status.unsupported', 'Unavailable')}</Badge>
          ) : showKeyError || showLoading ? null : isSubscribed ? (
            <Badge variant="success">{t('webpush.status.subscribed', 'Active on this device')}</Badge>
          ) : (
            <Badge variant="neutral">{t('webpush.status.notSubscribed', 'Not subscribed')}</Badge>
          )}
        </div>

        {isUnsupported ? (
          <div className="flex items-start gap-2 rounded-lg bg-amber-300/5 p-3 ring-1 ring-amber-300/20">
            <AlertCircle className="h-4 w-4 text-amber-300 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <Text as="p" size="xs" className="text-amber-300">{disabledReason}</Text>
          </div>
        ) : showKeyError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-300/5 p-3 ring-1 ring-rose-300/20"
          >
            <AlertCircle className="h-4 w-4 text-rose-300 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <Text as="p" size="xs" className="text-rose-300">
              {t('webpush.error.load', "Couldn't check browser push availability.")}
            </Text>
            <Button variant="secondary" size="sm" onClick={handleRetryKey}>
              {t('webpush.retry', 'Retry')}
            </Button>
          </div>
        ) : showLoading ? (
          <div role="status" className="flex items-center gap-2" data-testid="webpush-loading">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" aria-hidden="true" />
            <Text as="p" variant="bodySm">
              {t('webpush.checking', 'Checking browser push availability…')}
            </Text>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {isSubscribed ? (
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={handleDisable}
                icon={<BellOff className="h-4 w-4" aria-hidden="true" />}
                aria-label={t('webpush.disable', 'Disable on this device')}
              >
                {t('webpush.disable', 'Disable on this device')}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={handleEnable}
                icon={<BellRing className="h-4 w-4" aria-hidden="true" />}
                aria-label={t('webpush.enable', 'Enable on this device')}
              >
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
            <Text as="h4" variant="label">
              {t('webpush.devices.title', 'Registered devices')}
            </Text>
            <ul className="space-y-2">
              {rows.map((row) => {
                const isThisDevice = currentEndpoint !== null && currentEndpoint === row.endpoint;
                const ua = row.user_agent ?? t('webpush.devices.unknownAgent', 'Unknown browser');
                const last = row.last_used_at
                  ? t('webpush.devices.lastUsed', 'Last used {{when}}', {
                      when: formatRelative(row.last_used_at),
                    })
                  : t('webpush.devices.neverUsed', 'Not yet used');
                const removing = removePending && removingEndpoint === row.endpoint;
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
                      loading={removing}
                      onClick={() => handleRemoveDevice(row.endpoint)}
                      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                      aria-label={t('webpush.devices.remove', 'Remove this device')}
                      title={t('webpush.devices.remove', 'Remove this device')}
                    />
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
