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
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
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
  codeBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
});
