// Native parity port of web/src/components/forms/FormSection.tsx.
//
// Labeled fieldset for grouping form controls with consistent spacing. The web
// version renders a `.glass-panel` <div> (`p-5 sm:p-6 space-y-4`) containing a
// header (<h3 class="section-title"> + an optional muted <p> description) and a
// `space-y-4` body that wraps the supplied form children.
//
// Native-safe adaptations (documented in the sidecar):
//   - The web `.glass-panel` surface is provided by the shared native
//     GlassPanel component (same 1px border / rounded radius / glass
//     background). The Tailwind `p-5` padding (20px -- the mobile base of
//     `p-5 sm:p-6`) and the `space-y-4` (16px) vertical rhythm become a
//     StyleSheet `padding` + `gap`.
//   - `<h3 class="section-title">` (`text-lg font-semibold tracking-tight`,
//     color var(--text-primary)) -> AppText weight="semibold" (primary tone)
//     with an 18px font size and a -0.45 letter-spacing (tracking-tight).
//   - `<p class="mt-1 text-xs text-[var(--text-muted)]">` -> AppText
//     variant="caption" tone="muted" with a 4px (`mt-1`) top margin.
//   - @/lib/cn + Tailwind utility classes are not available in native, so the
//     optional `className` is accepted-but-ignored for source compatibility and
//     a native `style` override prop is offered in its place.

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {spacing} from '../../../theme/tokens';

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Accepted for source parity with the web `className`; ignored in native. */
  className?: string;
  /** Native style override applied to the panel root. */
  style?: StyleProp<ViewStyle>;
}

// Tailwind `space-y-4` = 1rem = 16px vertical rhythm between siblings.
const SECTION_GAP = 16;
// Tailwind `mt-1` = 0.25rem = 4px description offset under the title.
const DESCRIPTION_MARGIN_TOP = 4;
// `.section-title` is text-lg (18px) with tracking-tight (~-0.025em * 18px).
const SECTION_TITLE_SIZE = 18;
const SECTION_TITLE_TRACKING = -0.45;

/** Labeled fieldset for grouping form controls with consistent spacing. */
export function FormSection({
  title,
  description,
  children,
  className: _className,
  style,
}: FormSectionProps) {
  return (
    <GlassPanel style={[styles.root, style]}>
      <View>
        <AppText style={styles.title} weight="semibold">
          {title}
        </AppText>
        {description ? (
          <AppText style={styles.description} tone="muted" variant="caption">
            {description}
          </AppText>
        ) : null}
      </View>
      <View style={styles.body}>{children}</View>
    </GlassPanel>
  );
}

FormSection.displayName = 'FormSection';

const styles = StyleSheet.create({
  body: {
    gap: SECTION_GAP,
  },
  description: {
    marginTop: DESCRIPTION_MARGIN_TOP,
  },
  root: {
    gap: SECTION_GAP,
    padding: spacing.lg,
  },
  title: {
    fontSize: SECTION_TITLE_SIZE,
    letterSpacing: SECTION_TITLE_TRACKING,
  },
});

export default FormSection;
