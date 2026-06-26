// Native parity port of web/src/features/system/components/status/AccordionSection.tsx.
//
// A collapsible "section" card: a pressable header (icon + title + description +
// optional badges + a chevron) that toggles a FadeIn-revealed body holding the
// section's children. Every behavioural detail of the web source is preserved
// 1:1 — the `open` state seeded from `defaultOpen`, the memoised `handleToggle`,
// the chevron's rotate-180 when open, and the body only mounting while `open`.
//
// Browser-only dependencies are replaced per conversion rules 4/5/7 (recorded in
// the sidecar):
//   - the web `<div role="button" tabIndex={0} onClick onKeyDown aria-expanded>`
//     header -> a React Native `Pressable` with accessibilityRole="button" +
//     accessibilityState={{expanded: open}}; `onClick` -> `onPress`. The web
//     `handleKeyDown` Enter/Space toggle has no standalone native analog —
//     Pressable already fires `onPress` from the keyboard (RNW/macOS/Windows
//     hardware Enter/Space on a button role) and from screen-reader activation,
//     so the "Enter/Space toggles open" behaviour is preserved without a
//     separate handler (the SearchInput keydown precedent).
//   - @/components/ui `GlassPanel` (Tailwind `overflow-hidden` glass card) -> the
//     native `GlassPanel` primitive with an `overflow: 'hidden'` style so the
//     body's top divider clips to the panel's rounded corners.
//   - @/components/motion `FadeIn` -> the native-parity `FadeIn` (the web-parity
//     motion barrel), the same Animated fade/slide entrance used by the
//     OptimizerSection port.
//   - lucide-react `ChevronDown` SVG (react-native-svg is not a dependency) -> a
//     decorative down-triangle glyph rotated 180deg when open (the NotionSidebar
//     Caret / DataTable ExpandToggle glyph precedent), flagged aria-hidden.
//   - `cn(...)` class merging -> StyleSheet style arrays; the web-only
//     cursor-pointer / select-none / transition utilities have no native analog,
//     and the `hover:bg-white/[0.02]` tint is approximated by a pressed-state
//     background.
//   - the `text-cyan-400` icon tint colours the web SVG via currentColor; on
//     native the `icon` is an opaque caller-supplied ReactNode, so the wrapper
//     only reserves its slot (flexShrink: 0) and leaves colouring to the caller
//     (whose accent already resolves to the native cyan `colors.accent`).
//
// This file has no strings of its own (title / description / badges are props),
// so there is no i18n surface, and no API path or unit handling to preserve.

import React, {useCallback, useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {spacing} from '../../../../../theme/tokens';
import {FadeIn} from '../../../../components/motion';

interface AccordionSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function AccordionSection({
  icon,
  title,
  description,
  badges,
  defaultOpen = false,
  children,
}: AccordionSectionProps): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  const handleToggle = useCallback(() => setOpen(prev => !prev), []);

  return (
    <GlassPanel style={styles.panel}>
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={handleToggle}
        style={({pressed}) => [styles.header, pressed && styles.headerPressed]}>
        <View style={styles.iconWrap}>{icon}</View>
        <View style={styles.textCol}>
          <AppText style={styles.title} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.description} tone="muted" variant="caption">
            {description}
          </AppText>
        </View>
        {badges ? <View style={styles.badges}>{badges}</View> : null}
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.chevron,
            {transform: [{rotate: open ? '180deg' : '0deg'}]},
          ]}
          tone="muted">
          {'\u25BE'}
        </AppText>
      </Pressable>
      {open ? (
        <FadeIn>
          <View style={styles.body}>{children}</View>
        </FadeIn>
      ) : null}
    </GlassPanel>
  );
}
AccordionSection.displayName = 'AccordionSection';

const styles = StyleSheet.create({
  badges: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.sm,
  },
  body: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    gap: 16,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
  },
  chevron: {
    fontSize: 14,
    lineHeight: 16,
  },
  description: {
    marginTop: 2,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
  },
  headerPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  iconWrap: {
    flexShrink: 0,
  },
  panel: {
    overflow: 'hidden',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    lineHeight: 20,
  },
});
