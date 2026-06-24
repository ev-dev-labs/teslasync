import React, { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import {
  useAuthMode,
  useAuthStatus,
  useAuthURL,
  useSessions,
  useTOTPStatus,
} from '../api/hooks';
import type { AuthModeCapabilities } from '../api/types';
import { KeyValueRow } from '../components/data/KeyValueRow';
import {
  RouteReadinessPanel,
  type RouteReadinessItem,
} from '../components/data/RouteReadinessPanel';
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppButton } from '../components/ui/AppButton';
import { AppText } from '../components/ui/AppText';
import { StatusPill } from '../components/ui/StatusPill';
import { formatDateTime } from '../lib/format';
import { spacing } from '../theme/tokens';

const closedCapabilities: AuthModeCapabilities = {
  step_up_reauth: false,
  totp_enrollment: false,
  session_list: false,
  impersonation: false,
  rbac: false,
};

const onboardingRouteItems: RouteReadinessItem[] = [
  {
    id: 'onboarding',
    label: 'Onboarding route',
    route: '/onboarding',
    api: '/system/auth-mode, /auth/status, /auth/url',
    status: 'implemented',
    evidence:
      'Native onboarding renders identity mode, Tesla account handoff, capability, session, and TOTP readiness without storing tokens or embedding login pages.',
  },
];

const accountRouteItems: RouteReadinessItem[] = [
  {
    id: 'account-2fa',
    label: 'Two-factor authentication',
    route: '/account/2fa',
    api: '/auth/totp',
    status: 'implemented',
    evidence:
      'Native renders TOTP enrollment status, backup-code count, and last-use metadata while enrollment/revoke/rotation actions remain disabled.',
  },
  {
    id: 'account-sessions',
    label: 'Active sessions',
    route: '/account/sessions',
    api: '/auth/sessions',
    status: 'implemented',
    evidence:
      'Native renders current and other sessions when forward-auth exposes session_list, but revoke actions remain unavailable without confirmation.',
  },
  {
    id: 'account-privacy',
    label: 'Account privacy',
    route: '/account/privacy',
    api: '/system/auth-mode, /auth/status',
    status: 'implemented',
    evidence:
      'Native renders identity mode, provider, Tesla account state, token-storage posture, and disabled privacy export/revoke controls.',
  },
];

export function AuthScreen() {
  const authModeQuery = useAuthMode();
  const authStatusQuery = useAuthStatus();
  const authUrlMutation = useAuthURL();
  const authMode = authModeQuery.data;
  const isForwardAuth = authMode?.mode === 'forward_auth';
  const hasSubject = Boolean(authMode?.subject);
  const capabilities = authMode?.capabilities ?? closedCapabilities;
  const sessionFeatureAvailable = isForwardAuth && hasSubject && capabilities.session_list;
  const totpFeatureAvailable = isForwardAuth && hasSubject && capabilities.totp_enrollment;
  const sessionsQuery = useSessions({enabled: sessionFeatureAvailable});
  const totpQuery = useTOTPStatus({enabled: totpFeatureAvailable});
  const [linkError, setLinkError] = useState<string | null>(null);

  const capabilityRows = useMemo(
    () =>
      (Object.keys(capabilities) as Array<keyof AuthModeCapabilities>).map(key => ({
        key,
        enabled: capabilities[key],
      })),
    [capabilities],
  );

  const requestTeslaAuthUrl = () => {
    setLinkError(null);
    authUrlMutation.mutate(undefined, {
      onSuccess: result => {
        Linking.openURL(result.auth_url).then(
          () => setLinkError(null),
          error => setLinkError(error instanceof Error ? error.message : 'Unable to open auth URL.'),
        );
      },
      onError: error => setLinkError(error.message),
    });
  };

  const modeLabel = authModeQuery.isLoading
    ? 'Loading'
    : authMode?.mode === 'forward_auth'
      ? 'ForwardAuth active'
      : authMode?.mode === 'open'
        ? 'Open mode'
        : 'Unavailable';

  return (
    <View style={styles.root}>
      <ScreenSection
        title="Identity mode"
        subtitle="Native auth state mirrors the web forward-auth/open-mode contract without storing identity tokens locally.">
        <StatusPill
          label={modeLabel}
          state={authMode?.mode === 'forward_auth' ? 'online' : authMode?.mode === 'open' ? 'warning' : 'offline'}
        />
        <KeyValueRow label="Subject" value={authMode?.subject ?? 'not resolved'} />
        <KeyValueRow label="Subject header" value={authMode?.subject_header ?? '-'} />
        <KeyValueRow label="Provider" value={authMode?.provider_hint ?? '-'} />
        <KeyValueRow label="Contract endpoint" value="/system/auth-mode" />
        {!isForwardAuth ? (
          <EmptyState
            title="Forward-auth-dependent features are unavailable"
            message="This deployment is in open mode, so sessions, TOTP enrollment, RBAC, and step-up reauth are intentionally disabled."
          />
        ) : hasSubject ? (
          <AppText tone="secondary">
            Forward-auth is active. Native requests rely on the upstream proxy cookie/session;
            the app does not persist an identity token.
          </AppText>
        ) : (
          <EmptyState
            title="Forward-auth header missing"
            message="The deployment is configured for forward-auth, but this request did not include a resolved subject."
          />
        )}
      </ScreenSection>

      <ScreenSection title="Capabilities" subtitle="First native surface for account security parity.">
        {authModeQuery.error ? (
          <EmptyState
            title="Auth contract unavailable"
            message="Auth mode could not be loaded from the API, so native auth controls stay disabled."
          />
        ) : (
          capabilityRows.map(({key, enabled}) => (
            <KeyValueRow key={key} label={key} value={enabled ? 'enabled' : 'disabled'} />
          ))
        )}
      </ScreenSection>

      <ScreenSection
        title="Tesla account connection"
        subtitle="Production auth handoff uses the system browser and keeps Tesla credentials server-side.">
        <StatusPill
          label={authStatusQuery.data?.authenticated ? 'Connected' : 'Not connected'}
          state={authStatusQuery.data?.authenticated ? 'online' : authStatusQuery.error ? 'offline' : 'warning'}
        />
        <KeyValueRow label="Token expires" value={formatDateTime(authStatusQuery.data?.expires_at)} />
        <View style={styles.actions}>
          <AppButton
            label={authUrlMutation.isPending ? 'Preparing auth URL...' : 'Open Tesla auth'}
            onPress={requestTeslaAuthUrl}
            disabled={authUrlMutation.isPending}
          />
        </View>
        {linkError ? (
          <EmptyState
            title="Tesla auth handoff failed"
            message={linkError}
          />
        ) : (
          <AppText tone="secondary">
            The native app opens the API-provided Tesla login URL in the system browser. It
            does not embed the login page and does not store refresh tokens on device.
          </AppText>
        )}
      </ScreenSection>

      <ScreenSection title="Active sessions" subtitle="Device/session visibility is available only in forward-auth mode.">
        {!sessionFeatureAvailable ? (
          <EmptyState
            title="Sessions unavailable"
            message="Session management requires forward-auth, a resolved subject, and the session_list capability."
          />
        ) : sessionsQuery.error ? (
          <EmptyState
            title="Session list unavailable"
            message="The session endpoint returned an error; no success-shaped fallback is shown."
          />
        ) : sessionsQuery.data?.mode === 'session' && sessionsQuery.data.sessions.length > 0 ? (
          sessionsQuery.data.sessions.slice(0, 5).map(session => (
            <View key={session.id} style={styles.card}>
              <View style={styles.rowHeader}>
                <AppText weight="semibold">{session.current ? 'Current session' : 'Other session'}</AppText>
                <StatusPill label={session.current ? 'Current' : 'Active'} state={session.current ? 'online' : 'warning'} />
              </View>
              <KeyValueRow label="IP" value={session.ip} />
              <KeyValueRow label="Last seen" value={formatDateTime(session.last_seen_at)} />
              <KeyValueRow label="User agent" value={session.user_agent || '-'} />
            </View>
          ))
        ) : (
          <EmptyState
            title={sessionsQuery.isLoading ? 'Loading sessions' : 'No active sessions returned'}
            message="Forward-auth is available, but the backend did not return tracked sessions for this subject."
          />
        )}
        <View style={styles.actions}>
          <AppButton
            label="Revoke other sessions unavailable"
            disabled
            variant="ghost"
            onPress={() => undefined}
          />
        </View>
        <EmptyState
          title="Native session revocation unavailable"
          message="Session revoke actions remain disabled until native destructive-action confirmation and step-up reauth are implemented."
        />
      </ScreenSection>

      <ScreenSection title="TOTP step-up" subtitle="Native parity reports enrollment state without persisting sudo tokens.">
        {!totpFeatureAvailable ? (
          <EmptyState
            title="TOTP unavailable"
            message="Per-user TOTP requires forward-auth, a resolved subject, and the totp_enrollment capability."
          />
        ) : totpQuery.error ? (
          <EmptyState
            title="TOTP status unavailable"
            message="The TOTP endpoint returned an error; enrollment controls remain disabled."
          />
        ) : totpQuery.data?.mode === 'session' ? (
          <>
            <StatusPill
              label={totpQuery.data.activated ? 'Enrolled' : 'Not enrolled'}
              state={totpQuery.data.activated ? 'online' : 'warning'}
            />
            <KeyValueRow label="Backup codes remaining" value={totpQuery.data.backup_codes_remaining} />
            <KeyValueRow label="Last used" value={formatDateTime(totpQuery.data.last_used_at)} />
            <EmptyState
              title="Native enrollment actions unavailable"
              message="Enrollment, revoke, and backup-code rotation remain disabled until the native app has a secure QR/code confirmation flow."
            />
          </>
        ) : (
          <EmptyState
            title={totpQuery.isLoading ? 'Loading TOTP status' : 'TOTP requires authenticated mode'}
            message="Open-mode deployments cannot enroll per-user TOTP."
          />
        )}
      </ScreenSection>

      <ScreenSection
        title="Account privacy"
        subtitle="Native account parity is explicit about proxy-managed identity, Tesla credential storage, and unavailable privacy actions.">
        <KeyValueRow
          label="Identity token storage"
          value="Disabled - uses proxy session"
        />
        <KeyValueRow
          label="Tesla refresh token"
          value="Server-side only"
        />
        <KeyValueRow
          label="Sudo token persistence"
          value="None on device"
        />
        <KeyValueRow
          label="Forward-auth provider"
          value={authMode?.provider_hint ?? '-'}
        />
        <KeyValueRow
          label="Subject"
          value={authMode?.subject ?? 'not resolved'}
        />
        <KeyValueRow
          label="Tesla account"
          value={
            authStatusQuery.data?.authenticated ? 'connected' : 'not connected'
          }
        />
        <View style={styles.actions}>
          <AppButton
            label="Privacy export unavailable"
            disabled
            variant="ghost"
            onPress={() => undefined}
          />
          <AppButton
            label="Disconnect Tesla unavailable"
            disabled
            variant="ghost"
            onPress={() => undefined}
          />
        </View>
        <EmptyState
          title="Native privacy actions unavailable"
          message="Privacy export, account deletion, disconnect, and session-revoke actions are intentionally disabled until native confirmation and audit contracts are implemented."
        />
      </ScreenSection>

      <RouteReadinessPanel
        title="Onboarding route readiness"
        subtitle="The R0001 onboarding route is implemented by the native Auth surface with explicit unavailable states for unsafe actions."
        items={onboardingRouteItems}
        testID="onboarding-route-readiness"
      />
      <RouteReadinessPanel
        title="Account route readiness"
        subtitle="R0005 account routes are represented by native auth, session, TOTP, and privacy evidence without persisting insecure tokens."
        items={accountRouteItems}
        testID="account-route-readiness"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  card: {
    gap: spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
