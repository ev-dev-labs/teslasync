// Native parity port of web/src/features/system/components/status/UpdateAvailableCallout.tsx.
//
// `UpdateAvailableCallout` is the in-page callout shown above the System Status
// chip bar when /system/update-check reports `update_available`. It is distinct
// from the global <NewVersionBanner> (a frontend-bundle reload prompt); this
// callout surfaces a server-side UPGRADE — a new release of the chart/binary
// itself — and points the operator at the GitHub release notes so they can
// review what's new before upgrading their deployment (web L1-11 doc comment).
//
// The web source pulls three browser/web-only modules with no native parity
// surface (rules 4/5/7); each is replaced with a native-safe equivalent and
// recorded in the sidecar:
//   - lucide-react `Sparkles` / `ExternalLink` SVGs (L13; react-native-svg is
//     not a dependency) -> decorative aria-hidden AppText glyphs: Sparkles ->
//     "\u2728", ExternalLink -> "\u2197" (the InboxBody externalLink glyph),
//     each flagged decorative because adjacent text carries the meaning.
//   - `@/components/ui` `GlassPanel` (L14) -> the native GlassPanel primitive;
//     the `border-cyan-400/20 bg-cyan-500/[0.06] overflow-hidden` className
//     becomes an explicit rgba border + background + overflow:'hidden' override.
//   - `@/hooks/useDateFormat` `formatDateTime` (L15) -> an inlined formatter
//     byte-identical to web `@/lib/dateFormat` (the ScheduledMaintenanceCard
//     precedent); the native build has no settings/timezone port so it uses the
//     device locale + zone (no per-call override object).
//   - the `<a href target=_blank rel=noopener>` release-notes link (L48-56) ->
//     a Pressable whose onPress calls Linking.openURL (the InlineCallout /
//     HealthRow seam); the external https URL opens in the system browser.
//
// The web `role="status"` + `aria-live="polite"` (L28-29) map to
// accessibilityRole="text" + accessibilityLiveRegion="polite"; `data-testid`
// (L30) maps to `testID`. The deliberate cyan-300/cyan-200 text shades +
// cyan-400/cyan-500 border/background/ring tints are kept as their exact values
// so the callout's cyan intent survives; --text-primary/--text-secondary/
// --text-muted map to the AppText primary/secondary/muted tones. No DOM
// modules, HTML elements, Recharts, Leaflet, or old web UI components are used.

import React, { useCallback } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { spacing } from '../../../../../theme/tokens';

// Web L49 href — the GitHub "latest release" notes the View-notes link opens.
const RELEASE_NOTES_URL =
  'https://github.com/ev-dev-labs/teslasync/releases/latest';

// lucide-react icons -> decorative glyph stand-ins (react-native-svg is not a
// dependency); adjacent text carries meaning so both are flagged decorative.
const SPARKLES_GLYPH = '\u2728';
const EXTERNAL_LINK_GLYPH = '\u2197';

// ── formatDateTime (inlined from web @/hooks/useDateFormat -> @/lib/dateFormat) ─
// "Apr 4, 2026, 2:30 AM" — byte-identical to the web formatter; "\u2014" for
// empty/invalid. The native build has no settings/timezone port so it relies on
// the device locale + zone (no per-call override object).
function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '\u2014';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface UpdateAvailableCalloutProps {
  current: string | undefined;
  latest: string | undefined;
  checkedAt?: string;
}

export function UpdateAvailableCallout({
  current,
  latest,
  checkedAt,
}: UpdateAvailableCalloutProps): React.ReactElement {
  const handleViewNotes = useCallback(() => {
    // Linking rejects on unhandled schemes; swallow so a missing handler never
    // surfaces an unhandled rejection. The open-release-notes affordance is
    // preserved regardless.
    Linking.openURL(RELEASE_NOTES_URL).catch(() => undefined);
  }, []);

  // Web L41: optional "You're running vX. " prefix + the fixed review sentence.
  const body = `${
    current ? `You're running v${current}. ` : ''
  }Review the release notes before upgrading your deployment.`;

  return (
    <GlassPanel
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={styles.panel}
      testID="update-available-callout">
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.sparkles}>
            {SPARKLES_GLYPH}
          </AppText>
        </View>
        <View style={styles.bodyWrap}>
          <AppText style={styles.title} weight="semibold">
            {`Update available${latest ? ` \u2014 v${latest}` : ''}`}
          </AppText>
          <AppText style={styles.body} tone="secondary">
            {body}
            {checkedAt ? (
              <AppText style={styles.bodyMuted} tone="muted">
                {` \u00b7 Last checked ${formatDateTime(checkedAt)}`}
              </AppText>
            ) : null}
          </AppText>
        </View>
        <View style={styles.actionWrap}>
          <Pressable
            accessibilityHint="View notes"
            accessibilityRole="link"
            onPress={handleViewNotes}
            style={({ pressed }) => [
              styles.button,
              pressed ? styles.buttonPressed : null,
            ]}>
            <AppText style={styles.buttonLabel}>View notes</AppText>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.buttonGlyph}>
              {EXTERNAL_LINK_GLYPH}
            </AppText>
          </Pressable>
        </View>
      </View>
    </GlassPanel>
  );
}

UpdateAvailableCallout.displayName = 'UpdateAvailableCallout';

const styles = StyleSheet.create({
  actionWrap: {
    flexShrink: 0,
  },
  body: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  bodyMuted: {
    fontSize: 12,
    lineHeight: 16,
  },
  bodyWrap: {
    flex: 1,
    minWidth: 0,
  },
  button: {
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderColor: 'rgba(34, 211, 238, 0.3)',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  buttonGlyph: {
    color: '#a5f3fc',
    fontSize: 14,
    lineHeight: 14,
  },
  buttonLabel: {
    color: '#a5f3fc',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  buttonPressed: {
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
  },
  iconWrap: {
    flexShrink: 0,
  },
  panel: {
    backgroundColor: 'rgba(6, 182, 212, 0.06)',
    borderColor: 'rgba(34, 211, 238, 0.2)',
    overflow: 'hidden',
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    padding: 16,
  },
  sparkles: {
    color: '#67e8f9',
    fontSize: 20,
    lineHeight: 20,
  },
  title: {
    fontSize: 14,
    lineHeight: 20,
  },
});

export default UpdateAvailableCallout;
