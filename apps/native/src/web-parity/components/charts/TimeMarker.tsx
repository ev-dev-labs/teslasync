// Native parity port of web/src/components/charts/TimeMarker.tsx.
// Replaces Recharts ReferenceLine with a React Native overlay marker.

import React, {memo} from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export type Severity = 'info' | 'warn' | 'critical' | 'success';

export type SeverityIconName =
  | 'Info'
  | 'AlertTriangle'
  | 'AlertOctagon'
  | 'CheckCircle';

export interface SeverityTokens {
  bg: string;
  border: string;
  color: string;
  dot: string;
  fg: string;
  icon: SeverityIconName;
  surface: string;
}

export interface TimeMarkerProps extends Omit<ViewProps, 'style'> {
  /** Value matching the chart's x-axis dataKey for the alert moment. */
  x: string | number | null | undefined;
  /** Severity of the underlying alert. Drives the marker color. Defaults to "warn". */
  severity?: Severity | string | null;
  /** Optional label rendered next to the marker. Defaults to "Alert". */
  label?: string;
  /** Override the dash pattern; native supports dashed styling but not exact dash arrays. */
  strokeDasharray?: string;
  /** Override the stroke width; default 2. */
  strokeWidth?: number;
  /** Recharts overflow behavior. Kept as a compatibility prop for native callers. */
  ifOverflow?: 'discard' | 'hidden' | 'visible' | 'extendDomain';
  /** Recharts yAxisId for charts that have multiple Y axes. Kept for API parity. */
  yAxisId?: string | number;
  style?: StyleProp<ViewStyle>;
  'data-testid'?: string;
}

export const TIME_MARKER_NATIVE_LIMITATION =
  'React Native chart parity cannot ask Recharts for a categorical x-axis pixel position; numeric x values are placed directly, and non-numeric values fall back to the chart midpoint.' as const;

const SEVERITY_STROKE: Record<Severity, string> = {
  info: '#0ea5e9',
  warn: '#f59e0b',
  critical: '#ef4444',
  success: '#10b981',
};

export const severityTokens: Record<Severity, SeverityTokens> = {
  critical: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    color: colors.danger,
    dot: 'bg-red-400',
    fg: 'text-red-300',
    icon: 'AlertOctagon',
    surface: colors.dangerSurface,
  },
  info: {
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    color: colors.accent,
    dot: 'bg-sky-400',
    fg: 'text-sky-300',
    icon: 'Info',
    surface: colors.accentSoft,
  },
  success: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    color: colors.success,
    dot: 'bg-emerald-400',
    fg: 'text-emerald-300',
    icon: 'CheckCircle',
    surface: colors.successSurface,
  },
  warn: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    color: colors.warning,
    dot: 'bg-amber-400',
    fg: 'text-amber-300',
    icon: 'AlertTriangle',
    surface: colors.warningSurface,
  },
};

function TimeMarkerBase({
  x,
  severity,
  label = 'Alert',
  strokeDasharray,
  strokeWidth = 2,
  ifOverflow: _ifOverflow = 'extendDomain',
  yAxisId: _yAxisId,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityHint,
  accessibilityLabel,
  ...rest
}: TimeMarkerProps) {
  if (x == null || x === '') {
    return null;
  }

  const sev = normalizeSeverity(severity ?? 'warn');
  const stroke = SEVERITY_STROKE[sev] ?? SEVERITY_STROKE.warn;
  const token = severityTokens[sev];
  const placement = resolveMarkerPlacement(x);
  const width = normalizeStrokeWidth(strokeWidth);

  return (
    <View
      {...rest}
      accessible
      accessibilityHint={accessibilityHint ?? placement.hint}
      accessibilityLabel={
        accessibilityLabel ?? `${label} marker at ${String(x)}`
      }
      accessibilityRole="summary"
      pointerEvents="none"
      style={[
        styles.root,
        {left: placement.left},
        placement.approximate && styles.approximateRoot,
        {backgroundColor: token.surface},
        style,
      ]}
      testID={testID ?? dataTestID ?? 'time-marker'}>
      <AppText
        numberOfLines={1}
        style={[styles.label, {color: stroke}]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.line,
          {
            borderLeftColor: stroke,
            borderLeftWidth: width,
            marginLeft: -width / 2,
          },
          strokeDasharray ? styles.dashedLine : null,
        ]}
      />
    </View>
  );
}

TimeMarkerBase.displayName = 'TimeMarkerBase';

export const TimeMarker = memo(TimeMarkerBase);

TimeMarker.displayName = 'TimeMarker';

function normalizeSeverity(severity: string | null | undefined): Severity {
  if (!severity) {
    return 'info';
  }

  const value = severity.toLowerCase();
  if (value === 'warning') {
    return 'warn';
  }
  if (value === 'error' || value === 'fatal') {
    return 'critical';
  }
  if (value === 'ok' || value === 'success') {
    return 'success';
  }
  if (value === 'info' || value === 'warn' || value === 'critical') {
    return value;
  }
  return 'info';
}

interface MarkerPlacement {
  approximate: boolean;
  hint: string;
  left: DimensionValue;
}

function resolveMarkerPlacement(x: string | number): MarkerPlacement {
  const numeric = typeof x === 'number' ? x : Number(x.trim());

  if (Number.isFinite(numeric)) {
    const left = numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;

    if (left >= 0 && left <= 100) {
      return {
        approximate: false,
        hint: 'Native marker positioned from a numeric chart x value.',
        left: `${left}%` as DimensionValue,
      };
    }

    return {
      approximate: false,
      hint: 'Native marker positioned from an absolute chart x value.',
      left,
    };
  }

  return {
    approximate: true,
    hint: TIME_MARKER_NATIVE_LIMITATION,
    left: '50%',
  };
}

function normalizeStrokeWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(width, 1) : 2;
}

const styles = StyleSheet.create({
  approximateRoot: {
    borderColor: colors.warningBorder,
    borderWidth: 1,
  },
  dashedLine: {
    borderStyle: 'dashed',
  },
  label: {
    backgroundColor: colors.surfaceGlass,
    borderRadius: 999,
    fontSize: 10,
    lineHeight: 14,
    maxWidth: 96,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    textAlign: 'center',
  },
  line: {
    alignSelf: 'center',
    flex: 1,
    marginTop: 2,
    minHeight: 18,
  },
  root: {
    alignItems: 'center',
    bottom: 0,
    marginLeft: -48,
    paddingHorizontal: spacing.xs,
    position: 'absolute',
    top: 0,
    width: 96,
  },
});
