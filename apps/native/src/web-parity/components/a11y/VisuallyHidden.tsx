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

export type AnnouncerPriority = 'polite' | 'assertive';

export type NativeHiddenElement = 'text' | 'view';
export type WebHiddenElement = 'span' | 'label' | 'a' | 'div';
export type VisuallyHiddenElement = NativeHiddenElement | WebHiddenElement;

export const nativeVisuallyHiddenCapabilities = {
  domSrOnlyClassAvailable: false,
  nativeHiddenPrimitiveAvailable: true,
  focusRevealAvailable: false,
  htmlElementPolymorphismAvailable: false,
} as const;

export type VisuallyHiddenOwnProps<
  T extends VisuallyHiddenElement = 'text',
> = {
  /** Web tags are accepted for parity and mapped to native Text/View. */
  as?: T;
  liveRegion?: boolean;
  priority?: AnnouncerPriority;
  focusable?: boolean;
  children?: ReactNode;
};

type WebCompatibilityProps = {
  className?: string;
  href?: string;
  htmlFor?: string;
  id?: string;
  role?: AccessibilityRole | 'status';
  'aria-live'?: AnnouncerPriority | 'off';
  'aria-atomic'?: boolean | 'true' | 'false';
  'data-testid'?: string;
  onClick?: TextProps['onPress'];
};

type NativeHiddenProps = Omit<
  TextProps & ViewProps,
  | keyof VisuallyHiddenOwnProps<VisuallyHiddenElement>
  | keyof WebCompatibilityProps
  | 'accessibilityLiveRegion'
  | 'accessibilityRole'
  | 'accessible'
  | 'children'
  | 'importantForAccessibility'
  | 'maxFontSizeMultiplier'
  | 'style'
  | 'testID'
>;

export type VisuallyHiddenProps<
  T extends VisuallyHiddenElement = 'text',
> = VisuallyHiddenOwnProps<T> &
  NativeHiddenProps &
  WebCompatibilityProps & {
    accessible?: boolean;
    accessibilityLiveRegion?: TextProps['accessibilityLiveRegion'];
    accessibilityRole?: AccessibilityRole;
    importantForAccessibility?: ViewProps['importantForAccessibility'];
    maxFontSizeMultiplier?: TextProps['maxFontSizeMultiplier'];
    style?: StyleProp<TextStyle | ViewStyle>;
    testID?: string;
  };

const webTextElements: ReadonlySet<VisuallyHiddenElement> = new Set([
  'a',
  'label',
  'span',
  'text',
]);

function shouldRenderText(as: VisuallyHiddenElement | undefined): boolean {
  return webTextElements.has(as ?? 'text');
}

function normalizeRole(
  role: AccessibilityRole | 'status' | undefined,
  accessibilityRole: AccessibilityRole | undefined,
  as: VisuallyHiddenElement | undefined,
  liveRegion: boolean,
  priority: AnnouncerPriority,
): AccessibilityRole | undefined {
  if (liveRegion && priority === 'assertive') {
    return 'alert';
  }

  if (liveRegion) {
    return role === 'alert' ? 'alert' : accessibilityRole ?? 'text';
  }

  if (role === 'status') {
    return 'text';
  }

  if (role) {
    return role;
  }

  if (as === 'a') {
    return 'link';
  }

  return accessibilityRole;
}

function normalizeLiveRegion(
  liveRegion: boolean,
  priority: AnnouncerPriority,
  ariaLive: AnnouncerPriority | 'off' | undefined,
  accessibilityLiveRegion: TextProps['accessibilityLiveRegion'],
): TextProps['accessibilityLiveRegion'] {
  if (accessibilityLiveRegion) {
    return accessibilityLiveRegion;
  }

  if (ariaLive === 'off') {
    return undefined;
  }

  return liveRegion ? priority : ariaLive;
}

export function VisuallyHidden<T extends VisuallyHiddenElement = 'text'>(
  props: VisuallyHiddenProps<T>,
) {
  const {
    as = 'text' as T,
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
    role,
    'aria-live': ariaLive,
    'data-testid': dataTestID,
    onClick,
    onPress,
    ...rest
  } = props;

  const nativeRest = {
    ...rest,
  } as NativeHiddenProps &
    Partial<VisuallyHiddenOwnProps<VisuallyHiddenElement>> &
    WebCompatibilityProps;
  delete nativeRest.className;
  delete nativeRest.focusable;
  delete nativeRest.href;
  delete nativeRest.htmlFor;
  delete nativeRest.id;
  delete nativeRest['aria-atomic'];

  const resolvedTestID = testID ?? dataTestID;
  const hiddenStyle = [styles.hidden, style];
  const resolvedLiveRegion = normalizeLiveRegion(
    liveRegion,
    priority,
    ariaLive,
    accessibilityLiveRegion,
  );
  const sharedAccessibility = {
    accessible: accessible ?? true,
    accessibilityElementsHidden: false,
    importantForAccessibility: importantForAccessibility ?? 'yes',
    testID: resolvedTestID,
  } as const;

  if (!shouldRenderText(as)) {
    return React.createElement(
      View,
      {
        ...nativeRest,
        ...sharedAccessibility,
        style: hiddenStyle,
      } as ViewProps,
      children,
    );
  }

  return React.createElement(
    Text,
    {
      ...nativeRest,
      ...sharedAccessibility,
      accessibilityLiveRegion: resolvedLiveRegion,
      accessibilityRole: normalizeRole(
        role,
        accessibilityRole,
        as,
        liveRegion || Boolean(resolvedLiveRegion),
        priority,
      ),
      maxFontSizeMultiplier: maxFontSizeMultiplier ?? 1,
      onPress: onPress ?? onClick,
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
