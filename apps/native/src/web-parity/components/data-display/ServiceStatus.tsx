// Native parity port of web/src/components/data-display/ServiceStatus.tsx.
// Two pieces: ServiceStatusBanner (offline banner) and SystemHealthDot (sidebar
// health dot). React Native has no window online/offline events, so the banner's
// resilience.onStatusChange subscription becomes an optional `subscribe` prop and
// the initial value comes from the web-parity client's getConnectionStatus(). The
// framer-motion height/opacity transition and the lucide WifiOff icon degrade to a
// static View + a warning glyph (no animation/icon libs in this native tree). The
// SystemHealthDot keeps its useQuery (key, 60s interval, retry: 1) and the CSS glow
// becomes a coloured RN shadow.

import React, {useEffect, useState} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../components/ui/AppText';
import {getConnectionStatus, request} from '../../api/client';

type ConnectionStatus = 'online' | 'offline' | 'unknown';

export interface ServiceStatusBannerProps {
  /**
   * Native parity for the web's resilience.onStatusChange subscription. Receives
   * a listener and returns an unsubscribe fn. When omitted, the banner reflects
   * the one-shot getConnectionStatus() snapshot because React Native has no
   * window 'online'/'offline' events to subscribe to.
   */
  subscribe?: (listener: (status: ConnectionStatus) => void) => () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ServiceStatusBanner({
  subscribe,
  style,
  testID,
}: ServiceStatusBannerProps) {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>(
    getConnectionStatus(),
  );

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe(setConnStatus);
  }, [subscribe]);

  const isOffline = connStatus === 'offline';

  if (!isOffline) return null;

  return (
    <View
      accessibilityLabel="You are offline. Data may be stale. Reconnecting automatically..."
      accessibilityRole="alert"
      style={[styles.banner, style]}
      testID={testID}>
      <AppText style={styles.bannerIcon}>⚠</AppText>
      <AppText style={styles.bannerText}>
        You are offline. Data may be stale. Reconnecting automatically...
      </AppText>
    </View>
  );
}

// Compact system health indicator for the sidebar.
type HealthTier = 'healthy' | 'degraded' | 'down';

const DOT_COLOR: Record<HealthTier, string> = {
  healthy: '#10b981',
  degraded: '#f59e0b',
  down: '#ef4444',
};

/** Minimal shape consumed here; mirrors the web resilience SystemStatus.overall. */
export interface SystemStatus {
  overall: string;
}

async function fetchSystemStatus(): Promise<SystemStatus> {
  return request<SystemStatus>('/system/status');
}

export interface SystemHealthDotProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SystemHealthDot({style, testID}: SystemHealthDotProps) {
  const {data} = useQuery<SystemStatus>({
    queryKey: ['system-status'],
    queryFn: fetchSystemStatus,
    refetchInterval: 60_000,
    retry: 1,
  });

  if (!data) return null;

  const color =
    data.overall === 'healthy'
      ? DOT_COLOR.healthy
      : data.overall === 'degraded'
        ? DOT_COLOR.degraded
        : DOT_COLOR.down;

  return (
    <View
      accessibilityLabel={`System: ${data.overall}`}
      accessibilityRole="image"
      style={[
        styles.healthDot,
        {backgroundColor: color, shadowColor: color},
        style,
      ]}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderBottomColor: 'rgba(239, 68, 68, 0.2)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bannerIcon: {
    color: '#f87171',
    fontSize: 14,
  },
  bannerText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '500',
  },
  healthDot: {
    borderRadius: 4,
    elevation: 4,
    height: 8,
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.5,
    shadowRadius: 6,
    width: 8,
  },
});
