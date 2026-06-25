// Native parity port of web/src/components/data-display/TransitionArrow.tsx.
//
// The web component is an inline monospace `<span>` that renders a
// "from → to" state transition with three colour tones (secondary / muted /
// primary mapped from the --text-* CSS vars). It is reproduced here with a
// parent `AppText` containing nested `AppText` segments so the colour runs stay
// inline, using the native theme tones instead of Tailwind/CSS variables. The
// web `mx-1` horizontal margin around the arrow (unsupported on inline RN Text)
// is preserved as surrounding spaces around the arrow glyph.

import {StyleSheet, type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

export interface TransitionArrowProps {
  from: string;
  to: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export function TransitionArrow({
  from,
  to,
  style,
  testID,
}: TransitionArrowProps) {
  return (
    <AppText
      accessibilityLabel={`${from} \u2192 ${to}`}
      style={[styles.mono, style]}
      testID={testID ?? 'transition-arrow'}
      variant="caption">
      <AppText style={styles.mono} tone="secondary" variant="caption">
        {from}
      </AppText>
      <AppText style={styles.mono} tone="muted" variant="caption">
        {' \u2192 '}
      </AppText>
      <AppText style={styles.mono} tone="primary" variant="caption">
        {to}
      </AppText>
    </AppText>
  );
}

TransitionArrow.displayName = 'TransitionArrow';

const styles = StyleSheet.create({
  mono: {
    fontFamily: 'monospace',
  },
});
