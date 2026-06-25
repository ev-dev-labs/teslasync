// Native parity port of web/src/components/data-display/KVList.tsx.
//
// Preserves the definition-list behavior: an ordered list of {label, value}
// rows, an optional 1- or 2-column layout, the row dividers (web `divide-y`),
// the label/value justify-between row, the muted small label, and the
// medium-weight primary value. The web `<dl>/<dt>/<dd>` DOM elements and the
// Tailwind `cn` class merge have no native equivalent, so the structure is
// rebuilt with React Native View/AppText primitives and theme tokens, and the
// `className` prop is retained for source compatibility but ignored on native.
// `value` stays a ReactNode: plain string/number values are wrapped in AppText
// (text cannot be a bare child on native), while element values render as-is.

import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

export interface KVItem {
  label: string;
  value: ReactNode;
}

export interface KVListProps {
  items: KVItem[];
  columns?: 1 | 2;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

function isTextValue(value: ReactNode): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

export function KVList({
  items,
  columns = 1,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: KVListProps) {
  const twoCol = columns === 2;
  const list = items ?? [];

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[twoCol ? styles.gridTwoCol : styles.list, style]}
      testID={testID ?? dataTestID ?? 'kv-list'}>
      {list.map((item, index) => {
        // `divide-y` adds a top border to every row except the first (DOM order).
        const divided = index > 0;
        const textValue = isTextValue(item.value);
        const rowAccessibilityLabel = textValue
          ? `${item.label}: ${String(item.value)}`
          : undefined;

        return (
          <View
            accessibilityRole={textValue ? 'text' : undefined}
            accessibilityLabel={rowAccessibilityLabel}
            accessible={textValue || undefined}
            key={`${item.label}-${index}`}
            style={[
              styles.row,
              divided && styles.rowDivider,
              twoCol && styles.cell,
              twoCol && (index % 2 === 0 ? styles.cellLeft : styles.cellRight),
            ]}>
            <AppText style={styles.label}>{item.label}</AppText>
            {textValue ? (
              <AppText style={styles.value}>{item.value}</AppText>
            ) : (
              <View style={styles.valueSlot}>{item.value}</View>
            )}
          </View>
        );
      })}
    </View>
  );
}

KVList.displayName = 'KVList';

const styles = StyleSheet.create({
  cell: {
    width: '50%',
  },
  cellLeft: {
    paddingRight: 12,
  },
  cellRight: {
    paddingLeft: 12,
  },
  gridTwoCol: {
    alignContent: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  label: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  list: {
    flexDirection: 'column',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  rowDivider: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  value: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'right',
  },
  valueSlot: {
    alignItems: 'flex-end',
    flexShrink: 1,
  },
});
