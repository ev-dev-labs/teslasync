// Native parity port of web/src/hooks/useRealtimeEvents.ts.
//
// React hook for real-time SSE events. Uses a SINGLETON connection shared
// across all hook instances — only ONE SSE connection is open no matter how
// many screens use useVehicleLive or useRealtimeEvents.
//
// Web -> native adaptation (conversion contract rule 7): the shared sseManager
// singleton this hook drives is a browser EventSource wrapper with no native
// equivalent. Its native parity port (../lib/sseManager) probes for a host
// EventSource polyfill and, when none is present (the React Native default),
// stays in the explicit `reconnecting` (live wiring unavailable) state — the
// same value the web manager reports before any successful connection. The hook
// surface (SSEState, SSEDiagnostics, the SSEOptions callbacks, and the returned
// {connected, state, diagnostics}) is preserved verbatim, so consumers degrade
// gracefully: `connected` simply stays false until a polyfill connects.

import {useEffect, useRef, useState} from 'react';

import {sseManager} from '../lib/sseManager';

export type SSEState = 'connected' | 'reconnecting';

export interface SSEDiagnostics {
  state: SSEState;
  connected: boolean;
  failCount: number;
  lastConnected: Date | null;
  endpoint: string;
  nextRetryIn: number | null;
}

interface SSEOptions {
  onVehicleUpdate?: (data: unknown) => void;
  onAlert?: (data: unknown) => void;
  onExportStatus?: (data: unknown) => void;
  onAchievementUnlocked?: (data: unknown) => void;
  onConnected?: (clientId: string) => void;
  onDisconnected?: () => void;
  onFallbackToPolling?: () => void;
  enabled?: boolean;
}

/**
 * React hook for real-time SSE events. Uses a SINGLETON connection
 * shared across all hook instances — only ONE SSE connection is open
 * no matter how many screens use useVehicleLive or useRealtimeEvents.
 */
export function useRealtimeEvents(options: SSEOptions = {}) {
  const {enabled = true} = options;
  const [state, setState] = useState<SSEState>(() => sseManager.getState());
  const [lastConnected, setLastConnected] = useState<Date | null>(null);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onVehicleUpdate = (data: unknown) =>
      callbacksRef.current.onVehicleUpdate?.(data);
    const onAlert = (data: unknown) => callbacksRef.current.onAlert?.(data);
    const onExportStatus = (data: unknown) =>
      callbacksRef.current.onExportStatus?.(data);
    const onAchievementUnlocked = (data: unknown) =>
      callbacksRef.current.onAchievementUnlocked?.(data);
    const onConnected = (data: unknown) => {
      setState('connected');
      setLastConnected(new Date());
      const d = data as {client_id?: string};
      callbacksRef.current.onConnected?.(d?.client_id ?? '');
    };
    const onDisconnected = () => {
      const s = sseManager.getState();
      setState(s);
      if (s === 'reconnecting') {
        callbacksRef.current.onFallbackToPolling?.();
      }
      callbacksRef.current.onDisconnected?.();
    };

    sseManager.subscribe('vehicle_update', onVehicleUpdate);
    sseManager.subscribe('alert', onAlert);
    sseManager.subscribe('export_status', onExportStatus);
    sseManager.subscribe('achievement_unlocked', onAchievementUnlocked);
    sseManager.subscribe('connected', onConnected);
    sseManager.subscribe('disconnected', onDisconnected);

    return () => {
      sseManager.unsubscribe('vehicle_update', onVehicleUpdate);
      sseManager.unsubscribe('alert', onAlert);
      sseManager.unsubscribe('export_status', onExportStatus);
      sseManager.unsubscribe('achievement_unlocked', onAchievementUnlocked);
      sseManager.unsubscribe('connected', onConnected);
      sseManager.unsubscribe('disconnected', onDisconnected);
    };
  }, [enabled]);

  const diagnostics: SSEDiagnostics = {
    state,
    connected: state === 'connected',
    failCount: 0,
    lastConnected,
    endpoint: '/api/v1/events',
    nextRetryIn: null,
  };

  return {connected: state === 'connected', state, diagnostics};
}
