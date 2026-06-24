import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuthMode } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
import { StatusPill } from '../components/ui/StatusPill';
import { spacing } from '../theme/tokens';

export function AuthScreen() {
  const authModeQuery = useAuthMode();
  const mode = authModeQuery.data?.mode ?? 'unknown';
  const subject = authModeQuery.data?.subject ?? 'not resolved';
  const capabilities = authModeQuery.data?.capabilities ?? {};
  const capabilityRows = Object.entries(capabilities).slice(0, 8);

  return (
    <View style={styles.root}>
      <ScreenSection
        title="Identity mode"
        subtitle="Native auth state mirrors the web forward-auth/open-mode contract.">
        <StatusPill
          label={mode}
          state={mode === 'forward_auth' ? 'online' : mode === 'open' ? 'warning' : 'offline'}
        />
        <KeyValueRow label="Subject" value={subject} />
        <KeyValueRow label="Contract endpoint" value="/system/auth-mode" />
      </ScreenSection>

      <ScreenSection title="Capabilities" subtitle="First native surface for account security parity.">
        {capabilityRows.length === 0 ? (
          <EmptyState
            title={authModeQuery.isLoading ? 'Loading capabilities' : 'No capabilities exposed'}
            message={
              authModeQuery.error
                ? 'Auth contract could not be loaded from the API.'
                : 'Capability flags will appear here when forward-auth is enabled.'
            }
          />
        ) : (
          capabilityRows.map(([key, enabled]) => (
            <KeyValueRow key={key} label={key} value={enabled ? 'enabled' : 'disabled'} />
          ))
        )}
      </ScreenSection>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
});
