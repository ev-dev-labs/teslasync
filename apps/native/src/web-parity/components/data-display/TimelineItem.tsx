// Native parity port of web/src/components/data-display/TimelineItem.tsx.
// Timeline row for activity feeds. The web `<Link>` drill-through becomes an
// optional `onPress` Pressable (React Native has no router context); the `href`
// is preserved on the props and surfaced via accessibilityValue for parity.

import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

interface TimelineItemProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  time: string;
  color: string;
  isLast?: boolean;
  /** Original web drill-through target; preserved for parity. */
  href?: string;
  /** Native navigation callback used in place of the web `<Link>`. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TimelineItem({
  icon,
  title,
  subtitle,
  time,
  color,
  isLast,
  href,
  onPress,
  style,
  testID,
}: TimelineItemProps) {
  const body = (
    <View style={styles.row}>
      <View style={styles.gutter}>
        <View style={[styles.iconBox, {backgroundColor: `${color}15`}]}>
          {icon}
        </View>
        {!isLast ? <View style={styles.connector} /> : null}
      </View>
      <View style={styles.content}>
        <AppText numberOfLines={1} variant="body" weight="semibold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.subtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
        <AppText style={styles.time} tone="muted" variant="caption">
          {time}
        </AppText>
      </View>
    </View>
  );

  if (href) {
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityValue={{text: href}}
        onPress={onPress}
        style={({pressed}) => [pressed && styles.pressed, style]}
        testID={testID}>
        {body}
      </Pressable>
    );
  }

  return (
    <View style={style} testID={testID}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  connector: {
    backgroundColor: colors.surfaceRaised,
    flex: 1,
    marginTop: 4,
    width: 1,
  },
  content: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 16,
  },
  gutter: {
    alignItems: 'center',
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  pressed: {
    opacity: 0.82,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  subtitle: {
    marginTop: 2,
  },
  time: {
    marginTop: 4,
  },
});
