// Native parity port of web/src/components/data-display/Timeline.tsx.
//
// The web component is a Tailwind `<div>` vertical timeline: a `space-y-4`
// column of rows, each row drawing an absolute connector line (except the last
// row), an absolute 22px dot/icon bubble at the left gutter, and a content
// column with a baseline-aligned title + time row plus an optional subtitle.
// This native version reproduces the same public contract
// (TimelineItemData -> icon / title / subtitle / time / color, TimelineProps ->
// items / className) using React Native View + AppText primitives and the
// existing design tokens.
//
// The web `cn()` Tailwind class merge is web-only and is dropped; `className`
// is still accepted for source parity but is inert on native (native styling
// uses StyleSheet + an optional `style` override). Dark-mode Tailwind variants
// are the source of truth because the native shell is always dark: text-gray-100
// -> textPrimary, var(--text-muted) -> textMuted, and the structural grays
// (bg-gray-700 connector, bg-gray-900 dot fill, border-gray-600 default ring)
// are pinned to their literal Tailwind hexes so the bubble keeps masking the
// connector exactly like the web. The connector's `h-full` overflow is
// reproduced with an absolute top/bottom span that bridges the inter-row gap so
// each dot links to the next. `title`/`subtitle`/`icon` are ReactNode, so string
// and number nodes are wrapped in AppText (carrying the text styling) while
// already-rendered native elements pass through unchanged.

import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

// Tailwind dark-mode grays the web Timeline renders. Pinned to literal hexes so
// the bubble fill keeps masking the connector regardless of the host surface.
const GRAY_700 = '#374151'; // dark:bg-gray-700  -> connector line
const GRAY_900 = '#111827'; // dark:bg-gray-900  -> dot bubble fill
const GRAY_600 = '#4b5563'; // dark:border-gray-600 -> default dot ring

export interface TimelineItemData {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  time: string;
  color?: string;
}

export interface TimelineProps {
  items: TimelineItemData[];
  /** Accepted for web source parity; native styling uses StyleSheet. */
  className?: string;
  /** Native style override applied to the timeline root (web maps className here). */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testID?: string;
}

function isTextNode(node: ReactNode): node is string | number {
  return typeof node === 'string' || typeof node === 'number';
}

export function Timeline({items, className: _className, style, testID}: TimelineProps) {
  return (
    <View style={[styles.container, style]} testID={testID ?? 'timeline'}>
      {items.map((item, i) => {
        // currentColor in the web bubble resolves to the icon/text colour, which
        // is the item colour when provided else var(--text-muted).
        const contentColor = item.color ?? colors.textMuted;
        const ringColor = item.color ?? GRAY_600;

        return (
          <View key={i} style={styles.item} testID={`timeline-item-${i}`}>
            {/* connector line — every row but the last */}
            {i < items.length - 1 ? (
              <View style={styles.connector} testID={`timeline-connector-${i}`} />
            ) : null}

            {/* dot / icon bubble */}
            <View style={[styles.dot, {borderColor: ringColor}]}>
              {item.icon != null ? (
                isTextNode(item.icon) ? (
                  <AppText style={[styles.iconGlyph, {color: contentColor}]}>
                    {item.icon}
                  </AppText>
                ) : (
                  item.icon
                )
              ) : (
                <View style={[styles.innerDot, {backgroundColor: contentColor}]} />
              )}
            </View>

            {/* content */}
            <View style={styles.content}>
              <View style={styles.titleRow}>
                {isTextNode(item.title) ? (
                  <AppText style={styles.title}>{item.title}</AppText>
                ) : (
                  <View style={styles.titleNodeSlot}>{item.title}</View>
                )}
                <AppText style={styles.time}>{item.time}</AppText>
              </View>
              {item.subtitle ? (
                isTextNode(item.subtitle) ? (
                  <AppText style={styles.subtitle}>{item.subtitle}</AppText>
                ) : (
                  <View style={styles.subtitleSlot}>{item.subtitle}</View>
                )
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

Timeline.displayName = 'Timeline';

const styles = StyleSheet.create({
  connector: {
    backgroundColor: GRAY_700,
    bottom: -20,
    left: 11,
    position: 'absolute',
    top: 24,
    width: 1,
  },
  container: {
    position: 'relative',
    rowGap: 16,
  },
  content: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  dot: {
    alignItems: 'center',
    backgroundColor: GRAY_900,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    top: 4,
    width: 22,
  },
  iconGlyph: {
    fontSize: 12,
    lineHeight: 14,
  },
  innerDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  item: {
    flexDirection: 'row',
    paddingLeft: 24,
    position: 'relative',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  subtitleSlot: {
    marginTop: 2,
  },
  time: {
    color: colors.textMuted,
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 16,
  },
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  titleNodeSlot: {
    flexShrink: 1,
    minWidth: 0,
  },
  titleRow: {
    alignItems: 'baseline',
    columnGap: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
