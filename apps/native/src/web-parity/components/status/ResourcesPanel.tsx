// Native parity port of web/src/components/status/ResourcesPanel.tsx.
//
// ResourcesPanel renders a server "resources at-a-glance" card: a "Resources"
// title followed by a stack of rows (memory, goroutines, DB pool, uptime, plus
// any caller-supplied rows). Each row shows label + value (+ optional meta) and,
// when a `percent` is supplied, a horizontal progress bar. Severity is driven by
// the same % thresholds as the web source (warn >= 70%, critical >= 90%) and
// colors the bar (green/amber/red-400) and the value text (primary/amber/red).
//
// Browser-only pieces are reproduced natively:
//   - web GlassPanel (Tailwind `p-4`) -> native GlassPanel + StyleSheet padding.
//   - `<h3>/<div>/<span>` DOM + Tailwind `cn` classes -> View/AppText primitives
//     and theme tokens; `className`/`id` are retained for source compatibility,
//     with `id` mapped to `testID` and `className` intentionally ignored.
//   - CSS `var(--text-*)` -> theme color tokens; the literal red/amber/green-400
//     and white/6% track colors are preserved as exact Tailwind hex/rgba values.
//   - `role="progressbar"` + aria-value* -> accessibilityRole/accessibilityValue;
//     `aria-label="<label> usage"` -> accessibilityLabel on the bar track.
//   - the web bar's `transition-all duration-slow` is a CSS animation with no
//     native equivalent, so the fill width is applied without a transition.
// `icon` stays a ReactNode: a bare string/number is wrapped in AppText (text
// cannot be a bare child on native) while element icons render as-is. See the
// .parity.json sidecar for the line-by-line source map.

import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors} from '../../../theme/tokens';

export interface ResourceRow {
  label: string;
  /** Display string for the value (e.g. "1.8 GB"). */
  valueText: string;
  /** Optional sub-label (e.g. "of 8 GB"). */
  metaText?: string;
  /** Percent 0-100 used to render a horizontal bar. Omit to skip the bar. */
  percent?: number;
  icon?: ReactNode;
}

export interface ResourcesPanelProps {
  rows: ResourceRow[];
  /** Optional footnote rendered beneath the rows. */
  footnote?: ReactNode;
  id?: string;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type Severity = 'normal' | 'warn' | 'critical';

/** Bar fill color — web `bg-{green,amber,red}-400`. */
const SEVERITY_BAR: Record<Severity, string> = {
  normal: '#4ade80',
  warn: '#fbbf24',
  critical: '#f87171',
};

/**
 * Value text color. `normal` falls back to the primary text token (web
 * `text-[var(--text-primary)]`); warn/critical use red/amber-400.
 */
const SEVERITY_TEXT: Record<Severity, string> = {
  normal: colors.textPrimary,
  warn: '#fbbf24',
  critical: '#f87171',
};

function severityFor(percent: number | undefined): Severity {
  if (percent == null) {
    return 'normal';
  }
  if (percent >= 90) {
    return 'critical';
  }
  if (percent >= 70) {
    return 'warn';
  }
  return 'normal';
}

/**
 * Renders an icon ReactNode. Native text cannot be a bare child, so a bare
 * string/number is wrapped in AppText (carrying the muted secondary color);
 * elements render as-is.
 */
function renderIcon(icon: ReactNode): ReactNode {
  if (typeof icon === 'string' || typeof icon === 'number') {
    return <AppText style={styles.icon}>{icon}</AppText>;
  }
  return icon;
}

export function ResourcesPanel({
  rows,
  footnote,
  id,
  className: _className,
  style,
  testID,
}: ResourcesPanelProps) {
  const list = rows ?? [];

  return (
    <GlassPanel style={[styles.root, style]} testID={testID ?? id ?? 'resources-panel'}>
      <AppText style={styles.title}>Resources</AppText>

      <View style={styles.rows}>
        {list.map(row => (
          <ResourceRowItem key={row.label} row={row} />
        ))}
      </View>

      {footnote != null && footnote !== false ? (
        <View style={styles.footnote}>
          {typeof footnote === 'string' || typeof footnote === 'number' ? (
            <AppText style={styles.footnoteText}>{footnote}</AppText>
          ) : (
            footnote
          )}
        </View>
      ) : null}
    </GlassPanel>
  );
}

ResourcesPanel.displayName = 'ResourcesPanel';

function ResourceRowItem({row}: {row: ResourceRow}) {
  const percent = row.percent;
  const severity = severityFor(percent);
  const barColor = SEVERITY_BAR[severity];
  const textColor = SEVERITY_TEXT[severity];

  // Visual width clamps to 0..100 so the fill never overflows the track, while
  // the accessibility value rounds the raw percent (matching the web source).
  const widthPct =
    percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const ariaNow = percent == null ? 0 : Math.round(percent);

  return (
    <View style={styles.rowGroup}>
      <View style={styles.row}>
        {row.icon != null && row.icon !== false ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.iconSlot}>
            {renderIcon(row.icon)}
          </View>
        ) : null}
        <AppText numberOfLines={1} style={styles.label}>
          {row.label}
        </AppText>
        <AppText style={[styles.value, {color: textColor}]}>
          {row.valueText}
          {row.metaText ? (
            <AppText style={styles.meta}>{` ${row.metaText}`}</AppText>
          ) : null}
        </AppText>
      </View>
      {percent != null ? (
        <View
          accessibilityLabel={`${row.label} usage`}
          accessibilityRole="progressbar"
          accessibilityValue={{max: 100, min: 0, now: ariaNow}}
          style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              {backgroundColor: barColor, width: `${widthPct}%`},
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  barFill: {
    height: '100%',
  },
  barTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
    width: '100%',
  },
  footnote: {
    marginTop: 12,
  },
  footnoteText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  icon: {
    color: colors.textSecondary,
  },
  iconSlot: {
    flexShrink: 0,
  },
  label: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  root: {
    padding: 16,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  rowGroup: {
    gap: 6,
  },
  rows: {
    gap: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  value: {
    flexShrink: 0,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
});
