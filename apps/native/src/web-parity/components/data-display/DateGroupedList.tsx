// Native parity port of web/src/components/data-display/DateGroupedList.tsx.
// Converts date divider sections and item wrappers to React Native primitives
// while preserving the generic group/renderItem API and spacing prop names.

import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export interface DateGroupedListGroup<T> {
  /** Sortable key, typically `YYYY-MM-DD`. Used as React key. */
  dateKey: string;
  /** Visible date label, pre-formatted by the caller (e.g. "May 9, 2026"). */
  dateLabel: string;
  /**
   * Optional secondary label -- relative time text such as "3 days ago".
   * Rendered muted, after the primary label.
   */
  relativeLabel?: string;
  /**
   * Optional summary text rendered right-aligned in the divider row
   * (e.g. "2 drives \u00b7 6.2 mi"). Free-form ReactNode for flexibility.
   */
  summary?: ReactNode;
  /** Items belonging to this group. */
  items: T[];
}

export interface DateGroupedListProps<T> {
  groups: readonly DateGroupedListGroup<T>[];
  /**
   * Render function for each item. Called once per item per group;
   * receives the item and its zero-based index within the group.
   */
  renderItem: (item: T, indexInGroup: number) => ReactNode;
  /**
   * Stable React key extractor. Falls back to `index` when omitted, but
   * an explicit key avoids re-render thrash when groups update.
   */
  itemKey?: (item: T, indexInGroup: number) => string | number;
  /** Spacing between successive items inside a group. Default `space-y-3`. */
  itemSpacing?: string;
  /** Spacing between successive groups. Default `space-y-6`. */
  groupSpacing?: string;
  /** Additional class names on the outer container. Retained for source compatibility. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testId?: string;
  /** Native test hook alias. */
  testID?: string;
}

/**
 * `DateGroupedList` -- generic list with horizontal-rule date dividers
 * and an optional per-group summary on the right-hand side. Used by
 * any feed-style page where items naturally cluster by day.
 *
 * Domain-specific aggregation lives on the caller so this component stays
 * free of unit/format logic.
 */
export function DateGroupedList<T>({
  groups,
  renderItem,
  itemKey,
  itemSpacing = 'space-y-3',
  groupSpacing = 'space-y-6',
  className: _className,
  style,
  testId,
  testID,
}: DateGroupedListProps<T>) {
  const itemGap = tailwindSpaceYToGap(itemSpacing, spacing.md);
  const groupGap = tailwindSpaceYToGap(groupSpacing, 24);

  return (
    <View
      style={[styles.root, {gap: groupGap}, style]}
      testID={testID ?? testId}>
      {groups.map(group => (
        <View
          key={group.dateKey}
          accessibilityLabel={groupAccessibilityLabel(group)}
          style={styles.group}
          testID={`date-group-${group.dateKey}`}>
          <View
            accessibilityRole="header"
            accessible
            style={styles.header}
            testID={`date-group-${group.dateKey}-header`}>
            <View style={styles.labelRow}>
              <AppText
                numberOfLines={1}
                style={styles.dateLabel}
                variant="caption"
                weight="semibold">
                {group.dateLabel}
              </AppText>
              {group.relativeLabel ? (
                <AppText
                  numberOfLines={1}
                  style={styles.relativeLabel}
                  variant="caption">
                  {`\u00b7 ${group.relativeLabel}`}
                </AppText>
              ) : null}
            </View>

            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.divider}
            />

            {group.summary ? (
              <View style={styles.summary}>
                {renderNativeNode(group.summary, styles.summaryText)}
              </View>
            ) : null}
          </View>

          <View style={[styles.items, {gap: itemGap}]}>
            {group.items.map((item, idx) => (
              <View key={itemKey ? itemKey(item, idx) : idx}>
                {renderNativeNode(renderItem(item, idx))}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

DateGroupedList.displayName = 'DateGroupedList';

function groupAccessibilityLabel<T>(group: DateGroupedListGroup<T>): string {
  return [group.dateLabel, group.relativeLabel].filter(Boolean).join(', ');
}

function renderNativeNode(
  node: ReactNode,
  textStyle?: StyleProp<TextStyle>,
): ReactNode {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return null;
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return (
      <AppText
        numberOfLines={1}
        style={textStyle}
        variant="caption">
        {node}
      </AppText>
    );
  }

  return node;
}

function tailwindSpaceYToGap(spacingClass: string, fallback: number): number {
  const match = /^space-y-(\d+(?:\.\d+)?)$/u.exec(spacingClass.trim());
  if (!match) {
    return fallback;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed * 4 : fallback;
}

const styles = StyleSheet.create({
  dateLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  divider: {
    backgroundColor: colors.border,
    flex: 1,
    height: StyleSheet.hairlineWidth,
    opacity: 0.5,
  },
  group: {
    gap: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  items: {
    width: '100%',
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
    minWidth: 0,
  },
  relativeLabel: {
    color: colors.textMuted,
    flexShrink: 1,
  },
  root: {
    width: '100%',
  },
  summary: {
    alignItems: 'flex-end',
    flexShrink: 0,
    maxWidth: '42%',
  },
  summaryText: {
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
});
