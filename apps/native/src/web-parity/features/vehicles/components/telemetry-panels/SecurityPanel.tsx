// Native parity port of
// web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx.
//
// Live Telemetry — the "Security" panel. Surfaces the latest SecurityEvent
// snapshot (lock status, Sentry Mode, doors, windows, user presence, an optional
// free-text detail) plus the vehicle's remote-start access flag. The panel shows
// whenever either the security snapshot OR the remote-start flag is present, and
// falls back to a transient, no-action empty state when both are missing. Every
// state name (securityData / remoteStartEnabled / hasData), the truthiness of each
// branch, the `?? 'Closed'` door/window fallbacks, the `== null` em-dash guard on
// remoteStartEnabled, and all i18n keys + English defaults are preserved verbatim.
//
// Web -> native mapping (contract rules 4, 5 & 7); each browser-only dependency is
// replaced with a React Native-safe equivalent and documented in the sidecar:
//   - react-i18next `useTranslation` (web L1, L14) -> inline useNativeTranslation():
//     a stable (key, fallback) => fallback shim so every t('key', 'English') call
//     keeps its English default and translation-key intent. All 17 common.* /
//     telemetry.* keys are preserved.
//   - lucide-react Shield/ShieldAlert/Eye/DoorClosed/Lock/Unlock/KeyRound/User
//     (web L2) -> no native SVG renderer, so:
//       * Shield title marker -> the shared SemanticIcon 'security' chip (a shield
//         glyph; the panel-marker precedent from AcDcStatsPanel/LiveMotorStatus).
//         Web tints it cyan-300; the shared icon bakes a success/green tone, a
//         documented minor tone tradeoff (LiveMotorStatus used 'settings' for the
//         Cog regardless of web colour).
//       * Lock/Unlock — the prominent h-6 icon inside a green/amber rounded box —
//         becomes the shared SemanticIcon 'locked'/'unlocked', whose boxed glyph
//         already carries the exact green(success)/amber(warning) border+surface+
//         glyph tone, replacing the web box AND icon in one element.
//       * ShieldAlert (inside the Sentry chip) and the tiny h-3 label icons
//         (Eye/DoorClosed/User/KeyRound) carry mostly a muted decorative signal
//         already spelled out by the adjacent label, so they become small
//         colour-coded status dots — the documented "variant-coloured status dot"
//         native idiom (LiveMotorStatus precedent). The web asymmetry is preserved:
//         the Windows row has no marker, so it gets no dot; the Sentry chip dot is
//         danger-toned when active and muted when inactive, matching the chip.
//   - `@/lib/cn` (web L3) -> not needed; the conditional class branches become
//     conditional RN style arrays / inline colour props.
//   - `@/components/ui` GlassPanel (web L4) -> the existing native GlassPanel
//     (className 'p-6 h-full' -> padding 24, flex:1 for the h-full equal-height
//     intent, ElevationChart precedent).
//   - `@/components/feedback` EmptyState (web L5, L151) -> the source passes a
//     message only (no title/icon/action — the web EmptyState renders just that
//     centred message), so native renders the same single centred muted message
//     rather than the shared native EmptyState, which would force an absent title.
//     The web "no-action: transient empty state" comment is preserved below.
//   - `@/api/types` SecurityEvent (web L6) -> imported from the ported native
//     web-parity api/types (identical snake_case wire shape).
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, lucide-react or
// react-i18next are imported — only react, react-native primitives, the existing
// apps/native SemanticIcon / AppText / GlassPanel / theme tokens, and the ported
// web-parity SecurityEvent type.

import React from 'react';
import {Platform, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import type {SecurityEvent} from '../../../../api/types';

interface SecurityPanelProps {
  securityData: SecurityEvent | null | undefined;
  remoteStartEnabled?: boolean | null;
}

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation-key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

/** Em-dash placeholder for the unknown remote-start state (web `'—'`, U+2014). */
const DASH = '\u2014';

/** Faint white tints from web `border-white/[0.06]` / `bg-white/[0.02]`. */
const FAINT_BORDER = 'rgba(255, 255, 255, 0.06)';
const FAINT_SURFACE = 'rgba(255, 255, 255, 0.02)';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

/**
 * The tiny muted h-3 lucide label icon (Eye / DoorClosed / User / KeyRound) ->
 * a small colour-coded status dot before the label text. Omitting `dotColor`
 * mirrors a web row whose label had no leading icon (the Windows row).
 */
function RowLabel({children, dotColor}: {children: string; dotColor?: string}) {
  return (
    <View style={styles.labelRow}>
      {dotColor ? (
        <View style={[styles.labelDot, {backgroundColor: dotColor}]} />
      ) : null}
      <AppText style={styles.labelText}>{children}</AppText>
    </View>
  );
}

export function SecurityPanel({securityData, remoteStartEnabled}: SecurityPanelProps) {
  const t = useNativeTranslation();

  const hasData = securityData != null || remoteStartEnabled != null;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <SemanticIcon decorative name="security" size="sm" />
        <AppText style={styles.sectionTitle}>
          {t('common.security', 'Security')}
        </AppText>
      </View>

      {hasData ? (
        <View style={styles.body}>
          {securityData ? (
            <>
              {/* Lock status */}
              <View style={styles.lockRow}>
                <SemanticIcon
                  decorative
                  name={securityData.locked ? 'locked' : 'unlocked'}
                  size="md"
                />
                <View>
                  <AppText
                    style={[
                      styles.lockLabel,
                      {color: securityData.locked ? colors.success : colors.warning},
                    ]}>
                    {securityData.locked
                      ? t('common.locked', 'Locked')
                      : t('common.unlocked', 'Unlocked')}
                  </AppText>
                  <AppText style={styles.lockSublabel}>
                    {t('telemetry.lockStatus', 'Vehicle lock status')}
                  </AppText>
                </View>
              </View>

              {/* Sentry Mode */}
              <View style={styles.kvRow}>
                <RowLabel dotColor={colors.textMuted}>
                  {t('telemetry.sentryMode', 'Sentry Mode')}
                </RowLabel>
                <View
                  style={[
                    styles.chip,
                    securityData.sentry_mode
                      ? styles.chipActive
                      : styles.chipInactive,
                  ]}>
                  <View
                    style={[
                      styles.chipDot,
                      {
                        backgroundColor: securityData.sentry_mode
                          ? colors.danger
                          : colors.textMuted,
                      },
                    ]}
                  />
                  <AppText
                    style={[
                      styles.chipText,
                      {
                        color: securityData.sentry_mode
                          ? colors.danger
                          : colors.textMuted,
                      },
                    ]}>
                    {securityData.sentry_mode
                      ? t('common.active', 'Active')
                      : t('common.inactive', 'Inactive')}
                  </AppText>
                </View>
              </View>

              {/* Doors */}
              <View style={styles.kvRow}>
                <RowLabel dotColor={colors.textMuted}>
                  {t('telemetry.doors', 'Doors')}
                </RowLabel>
                <AppText style={styles.monoValue}>
                  {securityData.doors_open ?? t('common.closed', 'Closed')}
                </AppText>
              </View>

              {/* Windows */}
              <View style={styles.kvRow}>
                <AppText style={styles.labelText}>
                  {t('telemetry.windows', 'Windows')}
                </AppText>
                <AppText style={styles.monoValue}>
                  {securityData.windows_open ?? t('common.closed', 'Closed')}
                </AppText>
              </View>

              {/* User presence */}
              <View style={styles.kvRow}>
                <RowLabel dotColor={colors.textMuted}>
                  {t('telemetry.userPresent', 'User Present')}
                </RowLabel>
                <AppText
                  style={[
                    styles.presenceValue,
                    {
                      color: securityData.user_present
                        ? colors.success
                        : colors.textMuted,
                    },
                  ]}>
                  {securityData.user_present
                    ? t('common.yes', 'Yes')
                    : t('common.no', 'No')}
                </AppText>
              </View>

              {securityData.detail ? (
                <AppText style={styles.detail}>{securityData.detail}</AppText>
              ) : null}
            </>
          ) : null}

          {/* Remote Start access */}
          <View style={styles.kvRow}>
            <RowLabel dotColor={colors.textMuted}>
              {t('telemetry.remoteStart', 'Remote Start')}
            </RowLabel>
            <AppText
              style={[
                styles.presenceValue,
                {
                  color:
                    remoteStartEnabled == null
                      ? colors.textMuted
                      : remoteStartEnabled
                        ? colors.success
                        : colors.textMuted,
                },
              ]}>
              {remoteStartEnabled == null
                ? DASH
                : remoteStartEnabled
                  ? t('common.enabled', 'Enabled')
                  : t('common.disabled', 'Disabled')}
            </AppText>
          </View>
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is missing;
        // no specific recovery action available.
        <View style={styles.emptyState}>
          <AppText style={styles.emptyText} tone="muted">
            {t('telemetry.noSecurityData', 'No security data available')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    padding: 24,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  body: {
    gap: 16,
  },
  lockRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  lockLabel: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  lockSublabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  kvRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  labelDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  labelText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chipActive: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  chipInactive: {
    backgroundColor: FAINT_SURFACE,
    borderColor: FAINT_BORDER,
  },
  chipDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  monoValue: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 14,
    lineHeight: 18,
  },
  presenceValue: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  detail: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    maxWidth: 360,
    textAlign: 'center',
  },
});

export default SecurityPanel;
