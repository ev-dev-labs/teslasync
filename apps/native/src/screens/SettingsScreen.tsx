import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { apiUrl } from '../api/client';
import {
  useAuthMode,
  useAuthStatus,
  useNotificationChannels,
  useNotificationStats,
  useQuietHours,
  useSettings,
  useSystemStatus,
  useVersionInfo,
} from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import {
  RouteReadinessPanel,
  type RouteReadinessItem,
} from '../components/data/RouteReadinessPanel';
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppButton } from '../components/ui/AppButton';
import { AppText } from '../components/ui/AppText';
import { GlassPanel } from '../components/ui/GlassPanel';
import { StatusPill } from '../components/ui/StatusPill';
import { formatBoolean, formatCount, formatDateTime } from '../lib/format';
import {
  buildPlatformIntegrationStatus,
  type PlatformCapabilityState,
  type PlatformIntegrationStatus,
} from '../platform/status';
import { colors, spacing } from '../theme/tokens';

interface SettingsScreenProps {
  platformStatus?: PlatformIntegrationStatus;
}

const settingsRouteItems: RouteReadinessItem[] = [
  {
    id: 'settings',
    label: 'Settings',
    route: '/settings',
    api: '/settings, /system/auth-mode, /system/status',
    status: 'implemented',
    evidence:
      'Native renders user preferences, API contract, auth context, notification settings, and system metadata from production endpoints.',
  },
  {
    id: 'settings-safety',
    label: 'Safety settings',
    route: '/settings/safety',
    api: '/settings',
    status: 'implemented',
    evidence:
      'Native renders quiet-hours, digest, critical flash, tab badge, and API kill-switch state as read-only safety settings.',
  },
  {
    id: 'integrations-helix',
    label: 'Helix integration',
    route: '/integrations/helix',
    api: '/settings',
    status: 'implemented',
    evidence:
      'Native renders Helix mode, feature-selection count, provider-config presence, and cost-cap state without validating providers or storing AI secrets.',
  },
  {
    id: 'gas-price',
    label: 'Gas price',
    route: '/gas-price',
    api: '/settings, /analytics/tco',
    status: 'implemented',
    evidence:
      'Native renders cost-setting posture and keeps gas price edits disabled until settings validation and confirmation gates are available.',
  },
];

function capabilityPillState(
  state: PlatformCapabilityState,
): 'online' | 'warning' | 'offline' {
  if (state === 'available' || state === 'configured') {
    return 'online';
  }
  if (state === 'unknown') {
    return 'offline';
  }
  return 'warning';
}

function formatDeepLinkSummary(
  link: PlatformIntegrationStatus['lastDeepLink'],
): string {
  if (!link) {
    return 'none observed';
  }
  return link.matched && link.routeId
    ? `${link.webPath} -> ${link.routeId}`
    : `${link.webPath} -> unmatched`;
}

function formatCostCap(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) {
    return '-';
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export function SettingsScreen({ platformStatus }: SettingsScreenProps) {
  const settingsQuery = useSettings();
  const authModeQuery = useAuthMode();
  const authStatusQuery = useAuthStatus();
  const notificationChannelsQuery = useNotificationChannels();
  const notificationStatsQuery = useNotificationStats();
  const quietHoursQuery = useQuietHours();
  const systemStatusQuery = useSystemStatus();
  const versionQuery = useVersionInfo();
  const settings = settingsQuery.data;
  const channels = notificationChannelsQuery.data ?? [];
  const quietHours = quietHoursQuery.data ?? [];
  const notificationStats = notificationStatsQuery.data;
  const authMode = authModeQuery.data;
  const systemOverall =
    systemStatusQuery.data?.overall ??
    systemStatusQuery.data?.status ??
    'unknown';
  const currentPlatformStatus =
    platformStatus ?? buildPlatformIntegrationStatus();
  const platformLaunchActions = currentPlatformStatus.launchActions ?? [];

  return (
    <View style={styles.root}>
      <GlassPanel style={styles.panel}>
        <View style={styles.panelHeader}>
          <View>
            <AppText variant="title" weight="bold">
              Platform foundation
            </AppText>
            <AppText tone="secondary">
              React Native baseline with lifecycle, deep-link parser, and honest
              unavailable states for native-only integrations.
            </AppText>
          </View>
          <StatusPill label={Platform.OS} state="online" />
        </View>

        <View style={styles.rows}>
          <KeyValueRow
            label="App lifecycle"
            value={currentPlatformStatus.appState}
          />
          <KeyValueRow
            label="Lifecycle observed"
            value={formatDateTime(currentPlatformStatus.lifecycleObservedAt)}
          />
          <KeyValueRow
            label="Initial deep link"
            value={formatDeepLinkSummary(currentPlatformStatus.initialDeepLink)}
          />
          <KeyValueRow
            label="Last deep link"
            value={formatDeepLinkSummary(currentPlatformStatus.lastDeepLink)}
          />
          {currentPlatformStatus.deepLinkError ? (
            <KeyValueRow
              label="Deep-link error"
              value={currentPlatformStatus.deepLinkError}
            />
          ) : null}
          {currentPlatformStatus.capabilities.map(capability => (
            <View key={capability.id} style={styles.capabilityRow}>
              <View style={styles.capabilityCopy}>
                <AppText weight="semibold">{capability.label}</AppText>
                <AppText tone="secondary">{capability.detail}</AppText>
                <AppText variant="caption" tone="muted">
                  {capability.evidence}
                </AppText>
              </View>
              <StatusPill
                label={capability.state}
                state={capabilityPillState(capability.state)}
              />
            </View>
          ))}
          {platformLaunchActions.length > 0 ? (
            <View style={styles.launchActions}>
              <AppText variant="title" weight="bold">
                Platform launch actions
              </AppText>
              <AppText tone="secondary">
                Typed taskbar, jump-list, and launcher shortcut equivalents are
                visible here without claiming OS installation.
              </AppText>
              {platformLaunchActions.map(action => (
                <View key={action.id} style={styles.capabilityRow}>
                  <View style={styles.capabilityCopy}>
                    <AppText weight="semibold">{action.label}</AppText>
                    <AppText tone="secondary">{action.detail}</AppText>
                    <AppText variant="caption" tone="muted">
                      {action.deepLinkURL}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {action.evidence}
                    </AppText>
                  </View>
                  <StatusPill
                    label={action.state}
                    state={capabilityPillState(action.state)}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <AppText variant="title" weight="bold">
          API contract
        </AppText>
        <AppText tone="secondary">
          Hooks call paths without an /api/v1 prefix; the native API client adds
          it.
        </AppText>
        <View style={styles.codeBox}>
          <AppText variant="caption">{apiUrl('/vehicles')}</AppText>
        </View>
      </GlassPanel>

      <ScreenSection
        title="User preferences"
        subtitle="Read-only native settings parity from /settings using SI-safe display boundaries."
      >
        {settingsQuery.error ? (
          <EmptyState
            title="Settings unavailable"
            message="The settings endpoint could not be loaded; native editing remains disabled."
          />
        ) : settings ? (
          <>
            <KeyValueRow
              label="Length unit"
              value={settings.unit_of_length ?? '-'}
            />
            <KeyValueRow
              label="Temperature unit"
              value={settings.unit_of_temp ?? '-'}
            />
            <KeyValueRow
              label="Pressure unit"
              value={settings.unit_of_pressure ?? '-'}
            />
            <KeyValueRow
              label="Theme"
              value={settings.theme ?? settings.mode ?? '-'}
            />
            <KeyValueRow label="Language" value={settings.language ?? '-'} />
            <KeyValueRow label="Locale" value={settings.locale ?? '-'} />
            <KeyValueRow
              label="Timezone display"
              value={settings.tz_display_default ?? '-'}
            />
            <KeyValueRow
              label="Decimal precision"
              value={settings.decimal_precision ?? '-'}
            />
            <KeyValueRow
              label="API suspended"
              value={formatBoolean(settings.api_suspended)}
            />
            <KeyValueRow
              label="Tab badge"
              value={formatBoolean(settings.tab_badge_enabled)}
            />
          </>
        ) : (
          <EmptyState
            title={
              settingsQuery.isLoading
                ? 'Loading settings'
                : 'No settings returned'
            }
            message="Settings values will appear here when the backend returns the app preferences payload."
          />
        )}
        <EmptyState
          title="Native settings editing unavailable"
          message="This slice exposes production settings state only. Write actions stay disabled until native form validation and sudo gates are implemented."
        />
      </ScreenSection>

      <ScreenSection
        title="Safety settings"
        subtitle="Read-only notification safety settings from /settings; native write actions stay disabled."
      >
        {settings ? (
          <>
            <KeyValueRow
              label="Quiet hours"
              value={formatBoolean(settings.quiet_hours_enabled)}
            />
            <KeyValueRow
              label="Quiet-hours start"
              value={settings.quiet_hours_start ?? '-'}
            />
            <KeyValueRow
              label="Quiet-hours end"
              value={settings.quiet_hours_end ?? '-'}
            />
            <KeyValueRow
              label="Alert digest mode"
              value={settings.alert_digest_mode ?? 'instant'}
            />
            <KeyValueRow
              label="Critical-alert tab flash"
              value={formatBoolean(settings.critical_flash_enabled)}
            />
            <KeyValueRow
              label="Unread tab badge"
              value={formatBoolean(settings.tab_badge_enabled)}
            />
            <KeyValueRow
              label="API kill-switch"
              value={settings.api_suspended ? 'suspended' : 'active'}
            />
          </>
        ) : (
          <EmptyState
            title={
              settingsQuery.isLoading
                ? 'Loading safety settings'
                : 'Safety settings unavailable'
            }
            message="Safety settings will appear when /settings returns preference data."
          />
        )}
        <View style={styles.actions}>
          <AppButton
            label="Edit safety settings unavailable"
            disabled
            variant="ghost"
            onPress={() => undefined}
          />
          <AppButton
            label="Ask Helix unavailable"
            disabled
            variant="ghost"
            onPress={() => undefined}
          />
        </View>
        <EmptyState
          title="Native safety setting writes unavailable"
          message="Quiet hours, digest, tab signalling, API suspension, and Helix explanations stay read-only until native validation and confirmation gates are implemented."
        />
      </ScreenSection>

      <ScreenSection
        title="Gas price configuration"
        subtitle="Cost-comparison inputs are visible without fabricating local gas-price data or enabling unsafe writes."
      >
        {settings ? (
          <>
            <KeyValueRow
              label="Base electricity cost"
              value={formatCostCap(
                settings.base_cost_per_kwh == null
                  ? null
                  : settings.base_cost_per_kwh * 100,
              )}
            />
            <KeyValueRow
              label="Currency"
              value={settings.currency_symbol ?? '-'}
            />
            <KeyValueRow
              label="Locale"
              value={settings.locale ?? '-'}
            />
            <KeyValueRow
              label="Gas price source"
              value="Server analytics/settings only"
            />
          </>
        ) : (
          <EmptyState
            title={
              settingsQuery.isLoading
                ? 'Loading gas price settings'
                : 'Gas price settings unavailable'
            }
            message="Gas price configuration will appear when settings or TCO analytics expose server-side cost inputs."
          />
        )}
        <View style={styles.actions}>
          <AppButton
            label="Edit gas price unavailable"
            disabled
            onPress={() => undefined}
          />
          <AppButton
            label="Reset gas price unavailable"
            disabled
            variant="ghost"
            onPress={() => undefined}
          />
        </View>
        <EmptyState
          title="Native gas price writes unavailable"
          message="Gas price edits remain disabled until native validation, audit, and settings persistence flows are implemented."
        />
      </ScreenSection>

      <ScreenSection
        title="Auth and account state"
        subtitle="Native settings reflects open-mode and forward-auth without persisting tokens."
      >
        <StatusPill
          label={
            authMode?.mode === 'forward_auth'
              ? 'ForwardAuth'
              : authMode?.mode === 'open'
              ? 'Open mode'
              : 'Unknown'
          }
          state={
            authMode?.mode === 'forward_auth'
              ? 'online'
              : authMode?.mode === 'open'
              ? 'warning'
              : 'offline'
          }
        />
        <KeyValueRow
          label="Subject"
          value={authMode?.subject ?? 'not resolved'}
        />
        <KeyValueRow label="Provider" value={authMode?.provider_hint ?? '-'} />
        <KeyValueRow
          label="Tesla account"
          value={
            authStatusQuery.data?.authenticated ? 'connected' : 'not connected'
          }
        />
        <KeyValueRow
          label="Tesla token expires"
          value={formatDateTime(authStatusQuery.data?.expires_at)}
        />
        {authModeQuery.error || authStatusQuery.error ? (
          <EmptyState
            title="Auth state partially unavailable"
            message="At least one auth endpoint returned an error; native controls remain disabled instead of assuming success."
          />
        ) : null}
      </ScreenSection>

      <ScreenSection
        title="Notification settings"
        subtitle="Channels, delivery stats, and quiet-hours status from /notifications."
      >
        {notificationChannelsQuery.error ||
        notificationStatsQuery.error ||
        quietHoursQuery.error ? (
          <EmptyState
            title="Notification settings unavailable"
            message="One or more notification endpoints could not be loaded from the API."
          />
        ) : (
          <>
            <KeyValueRow
              label="Channels"
              value={formatCount(channels.length)}
            />
            <KeyValueRow
              label="Enabled channels"
              value={formatCount(notificationStats?.enabled_channels)}
            />
            <KeyValueRow
              label="Sent notifications"
              value={formatCount(notificationStats?.sent)}
            />
            <KeyValueRow
              label="Failed notifications"
              value={formatCount(notificationStats?.failed)}
            />
            <KeyValueRow
              label="Pending notifications"
              value={formatCount(notificationStats?.pending)}
            />
            <KeyValueRow
              label="Quiet-hours windows"
              value={formatCount(quietHours.length)}
            />
          </>
        )}
      </ScreenSection>

      <ScreenSection
        title="Helix integration"
        subtitle="Optional AI integration state from settings; provider validation and secret entry are disabled in native."
      >
        {settings ? (
          <>
            <StatusPill
              label={settings.ai_mode ?? 'off'}
              state={
                settings.ai_mode && settings.ai_mode !== 'off'
                  ? 'warning'
                  : 'online'
              }
            />
            <KeyValueRow
              label="Enabled feature toggles"
              value={formatCount(
                Object.values(settings.ai_features ?? {}).filter(Boolean)
                  .length,
              )}
            />
            <KeyValueRow
              label="Archived feature toggles"
              value={formatCount(
                Object.values(settings.ai_features_archived ?? {}).filter(
                  Boolean,
                ).length,
              )}
            />
            <KeyValueRow
              label="Provider config"
              value={
                settings.ai_provider_config &&
                Object.keys(settings.ai_provider_config).length > 0
                  ? 'configured'
                  : 'not configured'
              }
            />
            <KeyValueRow
              label="Daily cost cap"
              value={formatCostCap(settings.ai_cost_cap_cents)}
            />
          </>
        ) : (
          <EmptyState
            title={
              settingsQuery.isLoading
                ? 'Loading Helix settings'
                : 'Helix settings unavailable'
            }
            message="Helix settings will appear when /settings returns the AI integration payload."
          />
        )}
        <View style={styles.actions}>
          <AppButton
            label="Save Helix settings unavailable"
            disabled
            onPress={() => undefined}
          />
          <AppButton
            label="Validate provider unavailable"
            disabled
            variant="ghost"
            onPress={() => undefined}
          />
        </View>
        <EmptyState
          title="Native Helix writes unavailable"
          message="Native does not accept provider secrets, validate external AI providers, restore archived feature selections, or claim Helix calls until secure native forms are implemented."
        />
      </ScreenSection>

      <ScreenSection
        title="System contract"
        subtitle="Operational settings context from /system endpoints."
      >
        <StatusPill
          label={systemOverall}
          state={
            systemOverall === 'healthy'
              ? 'online'
              : systemStatusQuery.error
              ? 'offline'
              : 'warning'
          }
        />
        <KeyValueRow
          label="Database"
          value={systemStatusQuery.data?.database?.status ?? '-'}
        />
        <KeyValueRow
          label="MQTT"
          value={systemStatusQuery.data?.mqtt?.status ?? '-'}
        />
        <KeyValueRow
          label="Tesla API"
          value={systemStatusQuery.data?.tesla_api?.status ?? '-'}
        />
        <KeyValueRow
          label="Fleet telemetry"
          value={systemStatusQuery.data?.fleet_telemetry?.status ?? '-'}
        />
        <KeyValueRow
          label="Chart version"
          value={versionQuery.data?.chart_version ?? '-'}
        />
        <KeyValueRow
          label="Go runtime"
          value={versionQuery.data?.go_version ?? '-'}
        />
        <KeyValueRow
          label="OS / arch"
          value={
            versionQuery.data
              ? `${versionQuery.data.os}/${versionQuery.data.arch}`
              : '-'
          }
        />
        {systemStatusQuery.error || versionQuery.error ? (
          <EmptyState
            title="System metadata unavailable"
            message="System endpoints could not be loaded from the native client."
          />
        ) : null}
      </ScreenSection>

      <RouteReadinessPanel
        title="Settings route readiness"
        subtitle="R0005 settings and integration routes render API-backed native summaries without unsafe writes or secret persistence."
        items={settingsRouteItems}
        testID="settings-route-readiness"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  capabilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  capabilityCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  launchActions: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  codeBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
});
