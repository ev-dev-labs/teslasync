import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

export {AnnouncerRegion} from './AnnouncerRegion';
export {
  RouteAnnouncer,
  nativeRouteAnnouncerCapabilities,
  type RouteAnnouncerProps,
} from './RouteAnnouncer';

type AnnouncerPriority = 'polite' | 'assertive';
type NativeHiddenElement = 'text' | 'view';

export const nativeVisuallyHiddenCapabilities = {
  domSrOnlyClassAvailable: false,
  nativeHiddenPrimitiveAvailable: true,
  focusRevealAvailable: false,
} as const;

export type VisuallyHiddenOwnProps<T extends NativeHiddenElement = 'text'> = {
  as?: T;
  liveRegion?: boolean;
  priority?: AnnouncerPriority;
  focusable?: boolean;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
};

type NativeHiddenProps = Omit<TextProps & ViewProps, keyof VisuallyHiddenOwnProps>;

export type VisuallyHiddenProps<T extends NativeHiddenElement = 'text'> =
  VisuallyHiddenOwnProps<T> &
    NativeHiddenProps & {
      style?: StyleProp<TextStyle | ViewStyle>;
    };

export function VisuallyHidden<T extends NativeHiddenElement = 'text'>(
  props: VisuallyHiddenProps<T>,
) {
  const {
    as = 'text',
    liveRegion = false,
    priority = 'polite',
    children,
    testID,
    style,
    accessibilityRole,
    accessibilityLiveRegion,
    accessible,
    importantForAccessibility,
    maxFontSizeMultiplier,
    ...restWithWebOnlyProps
  } = props as VisuallyHiddenProps<NativeHiddenElement>;
  const dataTestID = props['data-testid'];
  const rest = {...restWithWebOnlyProps};
  delete (rest as Partial<VisuallyHiddenOwnProps>)['data-testid'];
  delete (rest as Partial<VisuallyHiddenOwnProps>).focusable;
  delete (rest as Partial<VisuallyHiddenOwnProps>).className;
  const resolvedTestID = testID ?? dataTestID;
  const hiddenStyle = [styles.hidden, style];
  const sharedAccessibility = {
    accessible: accessible ?? liveRegion,
    accessibilityElementsHidden: false,
    importantForAccessibility:
      importantForAccessibility ?? (liveRegion ? 'yes' : 'auto'),
    testID: resolvedTestID,
  } as const;

  if (as === 'view') {
    return React.createElement(
      View,
      {
        ...rest,
        ...sharedAccessibility,
        style: hiddenStyle,
      } as ViewProps,
      children,
    );
  }

  const liveRole: AccessibilityRole | undefined =
    liveRegion && priority === 'assertive' ? 'alert' : accessibilityRole;

  return React.createElement(
    Text,
    {
      ...rest,
      ...sharedAccessibility,
      accessibilityLiveRegion:
        accessibilityLiveRegion ?? (liveRegion ? priority : undefined),
      accessibilityRole: liveRole,
      maxFontSizeMultiplier: maxFontSizeMultiplier ?? 1,
      style: hiddenStyle,
    } as TextProps,
    children,
  );
}

const styles = StyleSheet.create({
  hidden: {
    height: 1,
    left: 0,
    opacity: 0,
    overflow: 'hidden',
    position: 'absolute',
    top: 0,
    width: 1,
  },
});
