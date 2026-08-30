import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, Send, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Caption,
  GlassPanel,
  HelperText,
  IconBox,
  Input,
  PanelTitle,
  Select,
  Toggle,
} from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDeviceNotificationPrefs } from '@/hooks/useDeviceNotificationPrefs';
import { useWebPush } from '@/hooks/useWebPush';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  evaluateNotification,
  type NotificationCategory,
  type NotificationSeverity,
} from '@/sw/notificationPolicy';
import { cn } from '@/lib/cn';

/**
 * Per-device notification preferences (PWA-05).
 *
 * ## What is enforced where — read this before changing anything
 *
 * TeslaSync has three notification-filtering layers and they are NOT
 * interchangeable:
 *
 *  1. **Channel event-type routing** — server-side, install-wide.
 *     `GET|PUT /api/v1/notifications/{channelID}/preferences`, edited from the
 *     Channels page via `useNotificationPreferences` /
 *     `useUpdateNotificationPreference`.
 *  2. **Quiet hours with severity bypass** — server-side, install-wide.
 *     `/api/v1/notifications/quiet-hours`, edited on the Quiet Hours page via
 *     `useQuietHours` / `useSaveQuietHours`. The dispatcher defers matching
 *     notifications and replays them afterwards.
 *  3. **This panel** — device-side, THIS browser only. The API has no notion
 *     of a device, so "critical only on my phone" and "only my daily driver
 *     on this tablet" cannot be expressed server-side today. The policy is
 *     stored locally and pushed into the service worker so it also applies
 *     when every tab is closed.
 *
 * The honest caveat, stated in the UI as well as here: a push filtered on the
 * device has still been delivered to the browser. It costs battery and, on
 * Chromium, consumes silent-push budget. Server-side filtering (layers 1-2)
 * is always the cheaper option when it can express what you want.
 */

export interface DeviceNotificationPrefsPanelProps {
  className?: string;
}

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  alert: 'Alerts',
  charging: 'Charging',
  drive: 'Drives',
  battery: 'Battery',
  security: 'Security',
  system: 'System health',
  export: 'Exports',
  other: 'Other',
};

/**
 * Static key map. `lint:i18n` forbids template literals inside `t()` because a
 * computed key is invisible to the catalog extractor, so the keys are spelled
 * out here and looked up by category.
 */
const CATEGORY_I18N_KEYS: Record<NotificationCategory, string> = {
  alert: 'notifications.device.category.alert',
  charging: 'notifications.device.category.charging',
  drive: 'notifications.device.category.drive',
  battery: 'notifications.device.category.battery',
  security: 'notifications.device.category.security',
  system: 'notifications.device.category.system',
  export: 'notifications.device.category.export',
  other: 'notifications.device.category.other',
};

const BYPASS_I18N_KEYS: Record<NotificationSeverity, string> = {
  info: 'notifications.device.bypass.info',
  warn: 'notifications.device.bypass.warn',
  critical: 'notifications.device.bypass.critical',
};

const BYPASS_LABELS: Record<NotificationSeverity, string> = {
  info: 'Ring through: info',
  warn: 'Ring through: warnings',
  critical: 'Ring through: critical',
};

const WEEKDAY_ALL_MASK = 0b111_1111;

export function DeviceNotificationPrefsPanel({
  className,
}: DeviceNotificationPrefsPanelProps) {
  const { t } = useTranslation();
  const { prefs, updatePrefs, resetPrefs, hasFilters } = useDeviceNotificationPrefs();
  const { permission, isSupported } = useWebPush();
  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data ?? [];
  const [testResult, setTestResult] = useState<string | null>(null);

  const severityOptions = useMemo(
    () => [
      { value: 'info', label: t('notifications.device.severity.info', 'All (info and above)') },
      { value: 'warn', label: t('notifications.device.severity.warn', 'Warnings and critical') },
      { value: 'critical', label: t('notifications.device.severity.critical', 'Critical only') },
    ],
    [t],
  );

  const scopeOptions = useMemo(
    () => [
      { value: 'all', label: t('notifications.device.scope.all', 'All vehicles') },
      { value: 'selected', label: t('notifications.device.scope.selected', 'Selected vehicles') },
    ],
    [t],
  );

  const toggleVehicle = useCallback(
    (vehicleId: number, checked: boolean) => {
      const next = checked
        ? [...prefs.vehicleIds, vehicleId]
        : prefs.vehicleIds.filter((id) => id !== vehicleId);
      updatePrefs({ vehicleIds: next });
    },
    [prefs.vehicleIds, updatePrefs],
  );

  /**
   * Device test delivery.
   *
   * There is no `POST /push/test` route on the backend, so this cannot be a
   * true end-to-end push round-trip. What it DOES exercise is everything the
   * device owns: OS permission, an active service-worker registration, the
   * device policy below, and the OS notification rendering. When the policy
   * suppresses the test we say exactly which rule fired instead of silently
   * showing nothing — a silent no-op is indistinguishable from a broken
   * subscription.
   */
  const sendTest = useCallback(async () => {
    setTestResult(null);
    const payload = {
      title: 'TeslaSync',
      severity: 'warn' as const,
      category: 'alert' as const,
      tag: 'device-policy-test',
    };
    const decision = evaluateNotification(payload, prefs, Date.now());

    if (!decision.show) {
      setTestResult(
        t(
          'notifications.device.test.suppressed',
          'Suppressed on this device by the "{{reason}}" rule.',
          { reason: decision.reason },
        ),
      );
      return;
    }
    if (!isSupported || permission !== 'granted') {
      setTestResult(
        t(
          'notifications.device.test.noPermission',
          'Notification permission has not been granted in this browser.',
        ),
      );
      return;
    }
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration == null) {
        setTestResult(
          t(
            'notifications.device.test.noWorker',
            'No service worker is registered, so background delivery is unavailable.',
          ),
        );
        return;
      }
      await registration.showNotification('TeslaSync', {
        body: t(
          'notifications.device.test.body',
          'Test notification — your device policy allows this severity.',
        ),
        badge: '/icons/badge-72.png',
        tag: payload.tag,
        silent: decision.silent,
        requireInteraction: decision.requireInteraction,
        data: { url: '/notifications/inbox' },
      });
      setTestResult(
        decision.silent
          ? t(
              'notifications.device.test.deliveredSilent',
              'Delivered silently — quiet hours are active.',
            )
          : t('notifications.device.test.delivered', 'Test notification delivered.'),
      );
    } catch {
      setTestResult(
        t('notifications.device.test.failed', 'The browser refused to show the notification.'),
      );
    }
  }, [isSupported, permission, prefs, t]);

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <IconBox color="cyan">
            <BellRing className="h-5 w-5" aria-hidden="true" />
          </IconBox>
          <PanelTitle>
            {t('notifications.device.heading', 'This device')}
          </PanelTitle>
          {hasFilters ? (
            <Badge variant="warning" data-testid="device-prefs-filtered">
              {t('notifications.device.filtered', 'Filters active')}
            </Badge>
          ) : (
            <Badge variant="neutral">
              {t('notifications.device.unfiltered', 'Everything delivered')}
            </Badge>
          )}
        </div>

        <HelperText>
          {t(
            'notifications.device.intro',
            'These rules apply only to this browser and are enforced by the service worker, so they also work when every tab is closed. Channel routing and install-wide quiet hours stay on the server.',
          )}
        </HelperText>

        <Toggle
          label={t('notifications.device.enabled', 'Show notifications on this device')}
          checked={prefs.enabled}
          onChange={(checked) => updatePrefs({ enabled: checked })}
          size="sm"
        />

        <div
          className={cn('space-y-4', !prefs.enabled && 'opacity-50')}
          aria-disabled={!prefs.enabled}
        >
          {/* ── Categories ─────────────────────────────────────────────── */}
          <section aria-label={t('notifications.device.categories', 'Categories')}>
            <Caption className="block mb-2">
              {t('notifications.device.categories', 'Categories')}
            </Caption>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {NOTIFICATION_CATEGORIES.map((category) => (
                <Toggle
                  key={category}
                  size="sm"
                  disabled={!prefs.enabled}
                  label={t(CATEGORY_I18N_KEYS[category], CATEGORY_LABELS[category])}
                  checked={prefs.categories[category]}
                  onChange={(checked) =>
                    updatePrefs({ categories: { [category]: checked } })
                  }
                />
              ))}
            </div>
          </section>

          {/* ── Severity floor ─────────────────────────────────────────── */}
          <Select
            label={t('notifications.device.minSeverity', 'Minimum severity')}
            value={prefs.minSeverity}
            disabled={!prefs.enabled}
            options={severityOptions}
            size="sm"
            hint={t(
              'notifications.device.minSeverityHint',
              'Anything below this level is dropped before it reaches the OS.',
            )}
            onChange={(event) =>
              updatePrefs({
                minSeverity: event.target.value as NotificationSeverity,
              })
            }
          />

          {/* ── Vehicle scope ──────────────────────────────────────────── */}
          <section
            aria-label={t(
              'notifications.device.vehicleScopeSection',
              'Vehicle scope settings',
            )}
          >
            <Select
              label={t('notifications.device.vehicleScope', 'Vehicle scope')}
              value={prefs.vehicleScope}
              disabled={!prefs.enabled}
              options={scopeOptions}
              size="sm"
              hint={t(
                'notifications.device.vehicleScopeHint',
                'Fleet-wide notifications with no vehicle attached are always delivered.',
              )}
              onChange={(event) =>
                updatePrefs({
                  vehicleScope: event.target.value === 'selected' ? 'selected' : 'all',
                })
              }
            />
            {prefs.vehicleScope === 'selected' && (
              <div className="mt-2 space-y-2">
                {vehicles.length === 0 ? (
                  // no-action: adding a vehicle happens in onboarding / the
                  // Vehicles page, not from a notification-scope selector.
                  <EmptyState
                    message={t(
                      'notifications.device.noVehicles',
                      'No vehicles are available to scope to yet.',
                    )}
                  />
                ) : (
                  vehicles.map((vehicle) => (
                    <Toggle
                      key={vehicle.id}
                      size="sm"
                      disabled={!prefs.enabled}
                      label={vehicle.display_name ?? `#${vehicle.id}`}
                      checked={prefs.vehicleIds.includes(vehicle.id)}
                      onChange={(checked) => toggleVehicle(vehicle.id, checked)}
                    />
                  ))
                )}
              </div>
            )}
          </section>

          {/* ── Device quiet hours ─────────────────────────────────────── */}
          <section aria-label={t('notifications.device.quietHours', 'Quiet hours on this device')}>
            <Caption className="block mb-2">
              {t('notifications.device.quietHours', 'Quiet hours on this device')}
            </Caption>
            <Toggle
              size="sm"
              disabled={!prefs.enabled}
              label={t('notifications.device.quietEnabled', 'Silence notifications overnight')}
              checked={prefs.quietHours.enabled}
              onChange={(checked) =>
                updatePrefs({
                  quietHours: { ...prefs.quietHours, enabled: checked, weekdays: WEEKDAY_ALL_MASK },
                })
              }
            />
            {prefs.quietHours.enabled && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input
                  type="time"
                  label={t('notifications.device.quietStart', 'From')}
                  value={prefs.quietHours.startLocal}
                  disabled={!prefs.enabled}
                  onChange={(event) =>
                    updatePrefs({
                      quietHours: { ...prefs.quietHours, startLocal: event.target.value },
                    })
                  }
                />
                <Input
                  type="time"
                  label={t('notifications.device.quietEnd', 'Until')}
                  value={prefs.quietHours.endLocal}
                  disabled={!prefs.enabled}
                  onChange={(event) =>
                    updatePrefs({
                      quietHours: { ...prefs.quietHours, endLocal: event.target.value },
                    })
                  }
                />
              </div>
            )}
            <HelperText className="mt-1 block">
              {t(
                'notifications.device.quietHint',
                'Quiet hours silence the notification rather than dropping it, so nothing is lost. Critical alerts still ring.',
              )}
            </HelperText>
            <div className="mt-2 flex flex-wrap gap-2">
              {NOTIFICATION_SEVERITIES.map((severity) => (
                <Toggle
                  key={severity}
                  size="sm"
                  disabled={!prefs.enabled || !prefs.quietHours.enabled}
                  label={t(BYPASS_I18N_KEYS[severity], BYPASS_LABELS[severity])}
                  checked={prefs.quietHours.bypassSeverities.includes(severity)}
                  onChange={(checked) =>
                    updatePrefs({
                      quietHours: {
                        ...prefs.quietHours,
                        bypassSeverities: checked
                          ? [...prefs.quietHours.bypassSeverities, severity]
                          : prefs.quietHours.bypassSeverities.filter((s) => s !== severity),
                      },
                    })
                  }
                />
              ))}
            </div>
          </section>
        </div>

        {/* ── Test delivery + reset ────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void sendTest()}
            data-testid="device-prefs-test"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {t('notifications.device.test.action', 'Send test notification')}
          </Button>
          <Button size="sm" variant="ghost" onClick={resetPrefs} data-testid="device-prefs-reset">
            {t('notifications.device.reset', 'Reset device rules')}
          </Button>
        </div>

        {testResult != null && (
          <Caption role="status" aria-live="polite" className="block" data-testid="device-prefs-test-result">
            {testResult}
          </Caption>
        )}

        <HelperText className="flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'notifications.device.caveat',
              'A notification filtered here has still been delivered to the browser. Prefer server-side channel routing and quiet hours whenever they can express the same rule.',
            )}
          </span>
        </HelperText>
      </div>
    </GlassPanel>
  );
}

export default DeviceNotificationPrefsPanel;
