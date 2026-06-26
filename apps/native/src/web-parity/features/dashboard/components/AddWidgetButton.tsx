// Native parity port of
// web/src/features/dashboard/components/AddWidgetButton.tsx.
//
// The web component is a floating "+" action button (FAB) that opens the widget
// catalogue dialog from any dashboard view. It hides while the dashboard is in
// edit mode (`if (isEditing) return null`), otherwise it pins a circular primary
// `<Button>` to the bottom-right of the viewport, wrapped in a hover `<Tooltip>`
// that surfaces the localized "Add Widget" label, with a lucide Plus glyph
// (`Icons.add`) as its only visible content. It is reproduced here with React
// Native primitives, preserving the `AddWidgetButtonProps` (`onClick`/
// `isEditing`), the early `isEditing` return, the `dashboard.addWidget` i18n key
// + "Add Widget" fallback, and the `dashboard-add-widget-fab` testID:
//
//   - The outer `<div className="fixed bottom-20 right-6 z-[56]">` becomes an
//     absolutely-positioned `<View>`. Web `position: fixed` (viewport-anchored)
//     has no native analog; `position: 'absolute'` anchors the FAB to the
//     bottom-right of its parent screen container, which is the native FAB
//     convention. The Tailwind scale carries over verbatim: bottom-20 -> 80,
//     right-6 -> 24, z-[56] -> zIndex 56. `data-testid` -> `testID`.
//   - `data-print-hide` is a web print-stylesheet utility (hides the FAB on
//     printed dashboards). There is no native print surface, so the attribute is
//     dropped — documented in the sidecar.
//   - `@/components/ui` `Tooltip` is a hover/focus-only affordance with no native
//     touch equivalent (the same conclusion the VehicleTwin port reached for its
//     hover hotspots); it is dropped and the label string it carried is preserved
//     as the Button's `accessibilityLabel` — which is exactly what the web
//     `aria-label={label}` already does, so no information is lost.
//   - `@/components/ui` `Button` is the already-ported native parity Button:
//     `variant="primary" size="lg"`, `onClick -> onPress`, and `aria-label ->
//     accessibilityLabel` all carry over. The web `className="h-14 w-14
//     rounded-full p-0 shadow-xl"` (a 56px circle with no padding and an
//     elevated shadow) is expressed as the native `style` prop, which the Button
//     merges LAST so it wins over the `lg` size defaults: width/height 56,
//     borderRadius 28, paddingHorizontal 0, plus the shared panel shadow token
//     as the `shadow-xl` analog.
//   - lucide `Icons.add` (Plus) has no native icon dependency; per the precedent
//     of the FlagsTable / UserImpersonateButton glyph ports it becomes a
//     decorative "+" glyph in an AppText. The web `className="h-8 w-8"` (32px)
//     and `strokeWidth={2.5}` (the bumped weight that keeps a thin "+" legible
//     inside a 56px FAB) map to fontSize 32 + fontWeight 700. `aria-hidden` ->
//     `importantForAccessibility="no"` since the Button's accessibilityLabel
//     carries the accessible name.
//   - react-i18next `useTranslation` is not a native-parity dependency; a local
//     useNativeTranslationFallback() t() shim returns the English fallback
//     verbatim (same pattern as the SortControl / WeekSelector ports), so the
//     `dashboard.addWidget` key + "Add Widget" copy are preserved.

import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, shadows } from '../../../../theme/tokens';
import { Button } from '../../../components/ui/Button';

/* ─── i18n fallback shim ───────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── decorative glyph (lucide Plus / Icons.add) ───────────────────────────── */

// "+" stand-in for lucide Plus — decorative; the Button's accessibilityLabel
// carries the meaning.
const ADD_GLYPH = '+';

export interface AddWidgetButtonProps {
  /** Click handler — typically opens the widget catalogue dialog. */
  onClick: () => void;
  /** When the dashboard is in edit mode, the FAB hides because the header
   *  already exposes an `Add Widget` action. */
  isEditing: boolean;
}

export function AddWidgetButton({ onClick, isEditing }: AddWidgetButtonProps) {
  const t = useNativeTranslationFallback();
  if (isEditing) {
    return null;
  }
  const label = t('dashboard.addWidget', 'Add Widget');
  return (
    <View style={styles.fabContainer} testID="dashboard-add-widget-fab">
      <Button
        accessibilityLabel={label}
        onPress={onClick}
        size="lg"
        style={styles.fab}
        variant="primary">
        <AppText importantForAccessibility="no" style={styles.icon}>
          {ADD_GLYPH}
        </AppText>
      </Button>
    </View>
  );
}

AddWidgetButton.displayName = 'AddWidgetButton';

export default AddWidgetButton;

const styles = StyleSheet.create({
  fab: {
    borderRadius: 28,
    height: 56,
    paddingHorizontal: 0,
    width: 56,
    ...shadows.panel,
  },
  fabContainer: {
    bottom: 80,
    position: 'absolute',
    right: 24,
    zIndex: 56,
  },
  icon: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 34,
  },
});
