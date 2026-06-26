/**
 * helpers — native parity port of
 * web/src/features/system/components/status/helpers.tsx.
 *
 * Pure status/format utilities shared by the System Status sections
 * (BackendStatusSection, DataPipelineSection, HealthProbesSection,
 * OperationsSection). The exported surface (names + status groupings) is
 * preserved 1:1 so the section ports can import these verbatim.
 *
 * Native deviations from the web original:
 *   - `getStatusColor` is value-only and ports verbatim (identical hex
 *     palette: green-500 / amber-500 / red-500 / gray-500).
 *   - `statusTextClass` returned Tailwind text-color class strings on web
 *     (`text-green-400`, `text-amber-400`, `text-red-400`,
 *     `text-[var(--text-muted)]`). React Native has no className/Tailwind,
 *     so the helper keeps its name but returns a concrete color string
 *     carrying the same visual intent (the matching Tailwind *-400 shade;
 *     the muted default maps to the theme `textMuted` token). It is consumed
 *     natively as `<AppText style={{color: statusTextClass(s)}}>`.
 *   - `getStatusIcon` rendered a lucide-react SVG (`<CheckCircle/>`,
 *     `<AlertTriangle/>`, `<XCircle/>`) sized `h-4 w-4` and tinted via the
 *     `statusTextClass` className. lucide-react is DOM/SVG-only, so native
 *     returns a small glyph stand-in `<AppText>` (same convention as the
 *     AiUsageCard / APIUsageWidget ports), sized ~16px and tinted with the
 *     identical `statusTextClass` color so the green-check / amber-warning /
 *     red-x semantics are preserved.
 *   - `formatUptime` ports verbatim (pure day/hour/minute math).
 *   - `formatBytes` ports verbatim; its `@/lib/numberFormat` `fmtNumber`
 *     dependency is reproduced as a native-safe shim mirroring the web
 *     defaults (en-US locale, safeNumber guard, locale fallback).
 *   - `statusToBadgeVariant` is value-only and ports verbatim.
 */

import React from 'react';
import {StyleSheet} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';

// lucide-react icons are DOM/SVG components; native renders them as small
// glyph stand-ins (same convention as the AiUsageCard / APIUsageWidget ports).
const ICON_CHECK_CIRCLE = '\u2713'; // lucide CheckCircle
const ICON_ALERT_TRIANGLE = '\u26A0'; // lucide AlertTriangle
const ICON_X_CIRCLE = '\u2717'; // lucide XCircle

// Tailwind text-color equivalents preserved as concrete hex so the native
// `statusTextClass` keeps the web's exact visual intent.
const TEXT_GREEN_400 = '#4ade80'; // tailwind text-green-400
const TEXT_AMBER_400 = '#fbbf24'; // tailwind text-amber-400
const TEXT_RED_400 = '#f87171'; // tailwind text-red-400

// ── native-safe number formatting (web `@/lib/numberFormat` fmtNumber) ────────
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

export function getStatusColor(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return '#22c55e';
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return '#f59e0b';
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

export function statusTextClass(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return TEXT_GREEN_400;
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return TEXT_AMBER_400;
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return TEXT_RED_400;
    default:
      return colors.textMuted;
  }
}

export function getStatusIcon(status: string): React.ReactElement {
  const color = statusTextClass(status);
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return (
        <AppText
          accessibilityRole="image"
          accessibilityLabel={status}
          style={[styles.statusIcon, {color}]}>
          {ICON_CHECK_CIRCLE}
        </AppText>
      );
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return (
        <AppText
          accessibilityRole="image"
          accessibilityLabel={status}
          style={[styles.statusIcon, {color}]}>
          {ICON_ALERT_TRIANGLE}
        </AppText>
      );
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return (
        <AppText
          accessibilityRole="image"
          accessibilityLabel={status}
          style={[styles.statusIcon, {color}]}>
          {ICON_X_CIRCLE}
        </AppText>
      );
    default:
      return (
        <AppText
          accessibilityRole="image"
          accessibilityLabel={status}
          style={[styles.statusIcon, {color}]}>
          {ICON_ALERT_TRIANGLE}
        </AppText>
      );
  }
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${fmtNumber(bytes / Math.pow(k, i), 1)} ${sizes[i]}`;
}

export function statusToBadgeVariant(
  status: string,
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'ready':
    case 'sent':
    case 'completed':
      return 'success';
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return 'warning';
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

const styles = StyleSheet.create({
  statusIcon: {
    fontSize: 16,
    lineHeight: 16,
  },
});
