// Native parity port of web/src/components/charts/ChartTooltip.tsx.
// Recharts controls active/payload/label injection on web; native chart shims
// pass the same props explicitly and this component renders the tooltip body.

import React, { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../components/ui/AppText';
import { colors, spacing, typography } from '../../../theme/tokens';

interface TooltipPayload {
  name: string;
  value: unknown;
  color?: string;
  fill?: string;
  unit?: string;
  /** Recharts attaches the dataKey here for line/area/bar series. */
  dataKey?: string | number;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  /**
   * Optional value formatter. Receives the raw value plus the series name and
   * unit; returns the rendered string. Falls back to locale-aware number
   * formatting for numbers and `String(...)` for everything else.
   */
  valueFormatter?: (value: unknown, name: string, unit?: string) => ReactNode;
  /**
   * Optional label formatter. Defaults to ISO-detection: if `label` parses
   * as a date AND looks like an ISO timestamp, it's rendered via the native
   * local DateTime formatter. Otherwise the label is passed through as-is.
   */
  labelFormatter?: (label: string | number | undefined) => ReactNode;
  testID?: string;
}

/**
 * Heuristic: does the string look like an ISO 8601 timestamp? We require at
 * least `YYYY-MM-DDTHH:MM` so plain date strings like "Apr 4" don't trigger
 * the formatter (those live in formatted-string XAxis labels).
 */
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TS_RE.test(value);
}

function defaultLabelFormatter(label: string | number | undefined): ReactNode {
  if (label == null) {
    return '';
  }
  if (isIsoTimestamp(label)) {
    return formatDateTime(label);
  }
  return String(label);
}

function defaultValueFormatter(
  value: unknown,
  _name: string,
  unit: string | undefined,
): ReactNode {
  const formatted =
    typeof value === 'number' ? fmtNumber(value) : String(value ?? '');
  return (
    <AppText style={styles.valueText} variant="caption" weight="semibold">
      {formatted}
      {unit ? (
        <AppText style={styles.unitText} variant="caption">
          {unit}
        </AppText>
      ) : null}
    </AppText>
  );
}

/**
 * React Native chart tooltip body. Native chart libraries do not provide a
 * `role="tooltip"` equivalent, so the port uses a live summary container and
 * preserves the visible label, series color marker, name, value, and unit rows.
 *
 * The formatter behavior remains locale-aware for numbers and timezone-aware
 * for ISO labels while allowing chart-specific formatter overrides.
 */
export function ChartTooltipBase({
  active,
  payload,
  label,
  valueFormatter = defaultValueFormatter,
  labelFormatter = defaultLabelFormatter,
  testID,
}: ChartTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="summary"
      style={styles.root}
      testID={testID ?? 'chart-tooltip'}
    >
      <AppText style={styles.label} variant="caption" weight="semibold">
        {labelFormatter(label)}
      </AppText>
      {payload.map((p, i) => {
        const markerColor = resolvePayloadColor(p, i);
        return (
          <View key={`${p.name}-${i}`} style={styles.row}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={[
                styles.marker,
                {
                  backgroundColor: markerColor,
                  shadowColor: markerColor,
                },
              ]}
            />
            <AppText style={styles.name} variant="caption">
              {p.name}:
            </AppText>
            {renderFormattedValue(valueFormatter(p.value, p.name, p.unit))}
          </View>
        );
      })}
    </View>
  );
}

ChartTooltipBase.displayName = 'ChartTooltipBase';

export const ChartTooltip = memo(ChartTooltipBase);

ChartTooltip.displayName = 'ChartTooltip';

function renderFormattedValue(value: ReactNode): ReactNode {
  if (value == null || typeof value === 'boolean') {
    return (
      <AppText style={styles.valueText} variant="caption" weight="semibold">
        {''}
      </AppText>
    );
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return (
      <AppText style={styles.valueText} variant="caption" weight="semibold">
        {value}
      </AppText>
    );
  }

  return value;
}

function resolvePayloadColor(payload: TooltipPayload, index: number): string {
  const raw = payload.color || payload.fill;
  if (!raw || raw.includes('var(') || raw === 'currentColor') {
    return TOOLTIP_FALLBACK_COLORS[index % TOOLTIP_FALLBACK_COLORS.length];
  }
  return raw;
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const TOOLTIP_FALLBACK_COLORS = [
  colors.accent,
  colors.violet,
  colors.success,
  colors.warning,
] as const;

const styles = StyleSheet.create({
  label: {
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  marker: {
    borderRadius: 5,
    elevation: 2,
    height: 10,
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    width: 10,
  },
  name: {
    color: colors.textSecondary,
  },
  root: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: '#000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  unitText: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginLeft: 2,
  },
  valueText: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
  },
});
