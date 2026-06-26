// Native parity port of web/src/features/automations/pages/ConflictWarnings.tsx.
//
// Renders a vertical stack of inline conflict notices in the automation builder,
// one per detected AutomationConflict. The web source mapped each conflict onto a
// shared web <AlertBanner>, choosing the "warning" variant (neon-amber, with a
// lucide-react <AlertTriangle> glyph) when `severity === 'warning'` and the "info"
// variant (neon-cyan, with a lucide-react <Info> glyph) otherwise, titled via
// react-i18next and bodied with `"{name}": {reason}`. It returned null when there
// were no conflicts.
//
// This port reproduces the identical branching, copy, and visual intent with React
// Native View/AppText primitives, the SemanticIcon warning/info glyphs, and the
// design tokens -- no DOM, no lucide-react, no recharts/leaflet, and no web UI
// components. AlertBanner has no native parity port yet, so both of its variant
// chromes are recreated inline here (mirroring the sibling banner ports:
// LiveStaleDataBanner rebuilds the amber warning banner and DraftRecoveryBanner the
// cyan info banner). react-i18next is not wired on native, so the title key falls
// back to its English default through a useNativeTranslationFallback helper that
// matches those same sibling ports.

import React, {useCallback} from 'react';
import {StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {spacing} from '../../../../theme/tokens';
import type {AutomationConflict} from '../../../api/types';

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * The web component read `t` from react-i18next. Native parity has no i18n
 * runtime wired yet, so this returns the English fallback string, preserving the
 * i18n key/fallback intent.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export interface ConflictWarningsProps {
  conflicts: AutomationConflict[];
}

/**
 * ConflictWarnings -- stack of inline notices warning the user that the
 * automation they are editing overlaps with other automations. Renders nothing
 * when there are no conflicts (parity for the web `if (conflicts.length === 0)
 * return null`).
 */
export function ConflictWarnings({conflicts}: ConflictWarningsProps) {
  const t = useNativeTranslationFallback();

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <View style={styles.stack}>
      {conflicts.map((c, i) => (
        <ConflictBanner
          key={`${c.automation_id}-${i}`}
          severity={c.severity}
          title={t('automations.builder.conflict', 'Potential Conflict')}
          message={`"${c.automation_name}": ${c.reason}`}
        />
      ))}
    </View>
  );
}

ConflictWarnings.displayName = 'ConflictWarnings';

/**
 * Inline recreation of the web AlertBanner used per conflict. `severity ===
 * 'warning'` picks the neon-amber warning chrome + warning glyph; anything else
 * picks the neon-cyan info chrome + info glyph -- the exact branch the web source
 * used for both `variant` and the lucide icon.
 */
function ConflictBanner({
  severity,
  title,
  message,
}: {
  severity: AutomationConflict['severity'];
  title: string;
  message: string;
}) {
  const isWarning = severity === 'warning';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, isWarning ? styles.bannerWarning : styles.bannerInfo]}>
      <View pointerEvents="none" style={styles.icon}>
        <SemanticIcon decorative name={isWarning ? 'warning' : 'info'} size="sm" />
      </View>
      <View style={styles.body}>
        <AppText style={[styles.title, isWarning ? styles.titleWarning : styles.titleInfo]}>
          {title}
        </AppText>
        <AppText
          style={[styles.message, isWarning ? styles.messageWarning : styles.messageInfo]}>
          {message}
        </AppText>
      </View>
    </View>
  );
}

// neon-amber (#f59e0b = rgb(245, 158, 11)) and neon-cyan (#00f0ff = rgb(0, 240,
// 255)) are the web AlertBanner "warning"/"info" variant hues. The Tailwind ramps
// used border-neon-*/20, bg-neon-*/5, the icon/title at the full neon hue, and the
// body text at neon-*/80. The shared token set exposes approximate amber/cyan
// accents but not these exact neon alpha stops, so they are recreated here from
// the neon channels -- matching the sibling LiveStaleDataBanner/DraftRecoveryBanner
// ports.
const styles = StyleSheet.create({
  banner: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  bannerInfo: {
    backgroundColor: 'rgba(0, 240, 255, 0.05)',
    borderColor: 'rgba(0, 240, 255, 0.2)',
  },
  bannerWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  icon: {
    marginTop: 2,
  },
  message: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  messageInfo: {
    color: 'rgba(0, 240, 255, 0.8)',
  },
  messageWarning: {
    color: 'rgba(245, 158, 11, 0.8)',
  },
  stack: {
    gap: spacing.sm,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  titleInfo: {
    color: '#00f0ff',
  },
  titleWarning: {
    color: '#f59e0b',
  },
});
