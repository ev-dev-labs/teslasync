// Native parity port of web/src/components/ui/Typography.tsx.
//
// The web module is the shared typography layer: a <Heading> (source L42-49)
// rendering an h1/h2/h3/h4 picked by `level`, a generic <Text> (source L69-94)
// that either applies a pre-composed role or composes granular size/weight/
// color/mono tokens, and eleven 1:1 convenience wrappers (source L100-111)
// matching the canonical roles. Every visual value comes from the
// `typography` token in web/src/lib/tokens.ts (size/weight/color/family/role
// maps, L166-220) — a set of Tailwind class strings + CSS variables.
//
// Native-safe translation of every browser-only dependency (documented in the
// .parity.json sidecar):
//   - react `ReactNode` / `ElementType` (source L1): preserved verbatim. The
//     DOM-only `HTMLAttributes<HTMLElement>` extension behind `CommonProps`
//     (source L1, L11-14) becomes the idiomatic React Native passthrough —
//     `react-native` `TextProps` (style/testID/accessibility*/numberOfLines/
//     onPress/…) — which is the native analog of "spread the rest of the
//     element attributes". `as?: ElementType` is kept exactly as the web prop
//     so callers can still override the rendered component; on native it should
//     receive an RN component (a DOM tag string has no meaning here).
//   - @/lib/cn `cn()` (source L2): Tailwind class merging is meaningless on RN,
//     so the composed class strings become concrete `TextStyle` objects merged
//     in a style array. The optional `className` escape hatch (source L12)
//     becomes RN `style?: StyleProp<TextStyle>`, applied LAST so callers can
//     still tweak the text exactly like the web `className` did.
//   - @/lib/tokens `typography` + `TypographyRole/Size/Weight/Color`
//     (source L3-9): the web map holds Tailwind utility strings
//     (`text-xl`, `font-bold`, `text-[var(--text-primary)]`, `font-mono`, …);
//     here `typography` is RESOLVED to concrete RN `TextStyle` values — the same
//     px sizes the Tailwind scale maps to, the same 400/500/600/700 weights, the
//     dark-theme CSS-variable colours (web/src/index.css L23-25), tracking-tight
//     / tracking-wider expressed as `letterSpacing` (fontSize * -0.025 /
//     fontSize * 0.05), `uppercase` -> `textTransform`, `tabular-nums` ->
//     `fontVariant`, and `font-mono` -> the platform monospace family. The
//     `typography` export name + the four `Typography*` type unions are kept so
//     native callers/types line up 1:1 with the web ones.
//   - Semantic HTML: the web `HEADING_TAG` h1-h4 map (source L28-33) has no RN
//     analog (everything is `<Text>`), so its accessibility intent is preserved
//     via `accessibilityRole="header"` on every heading. The web `ErrorText`
//     `role="alert"` ARIA attribute (source L107) becomes
//     `accessibilityRole="alert"`. The `as="span"/"p"/"div"/"code"` semantic
//     tags on the convenience wrappers (source L105-111) are inert on RN (all
//     render `<Text>`), so they are dropped — `Code`/mono styling already comes
//     from the `code` role / `mono` token, not the tag.

import React, {type ElementType, type ReactNode} from 'react';
import {
  Platform,
  Text as RNText,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';

// ── monospace font (web `font-mono`, tokens.ts L198 / source L65,87) ──
// Same constant the sibling SignalQueryControls port uses.
const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// Resolved dark-theme text colours — the concrete values behind the web
// `text-[var(--text-*)]` classes (web/src/index.css L23-25, referenced by the
// tokens.ts `typography.color`/`role` maps).
const TEXT_PRIMARY = '#ffffff'; // --text-primary
const TEXT_SECONDARY = '#9ca3af'; // --text-secondary
const TEXT_MUTED = '#8a95a6'; // --text-muted
const ROSE_300 = '#fda4af'; // text-rose-300 (error role, tokens.ts L218)

// ─────────────────────────────────────────────
// Token unions — preserved verbatim from web/src/lib/tokens.ts (L222-225) so
// native callers and shared prop types match the web Heading/Text API.
// ─────────────────────────────────────────────

export type TypographyRole =
  | 'pageTitle'
  | 'sectionTitle'
  | 'panelTitle'
  | 'subhead'
  | 'body'
  | 'bodySm'
  | 'caption'
  | 'label'
  | 'metricValue'
  | 'metricLabel'
  | 'code'
  | 'helper'
  | 'error';

export type TypographySize =
  | '2xs'
  | 'xs'
  | 'sm'
  | 'base'
  | 'lg'
  | 'xl'
  | '2xl'
  | '3xl';

export type TypographyWeight = 'regular' | 'medium' | 'semibold' | 'bold';

export type TypographyColor =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'subtle'
  | 'disabled'
  | 'inverse';

// Resolved RN analog of the web `typography` token (tokens.ts L166-220). The
// Tailwind class strings become concrete `TextStyle` values. Each sub-map is
// explicitly typed so string-literal `fontWeight`/`textTransform` and the
// `fontVariant` tuple are contextually checked against `TextStyle`.

// Type scale (tokens.ts L168-177). px sizes + Tailwind default line-heights;
// `text-2xs` is the custom 10px/14px entry from web/tailwind.config.js L122.
const sizeStyles: Record<TypographySize, TextStyle> = {
  '2xs': {fontSize: 10, lineHeight: 14},
  xs: {fontSize: 12, lineHeight: 16},
  sm: {fontSize: 14, lineHeight: 20},
  base: {fontSize: 16, lineHeight: 24},
  lg: {fontSize: 18, lineHeight: 28},
  xl: {fontSize: 20, lineHeight: 28},
  '2xl': {fontSize: 24, lineHeight: 32},
  '3xl': {fontSize: 30, lineHeight: 36},
};

// Weights (tokens.ts L179-184): font-normal/medium/semibold/bold.
const weightStyles: Record<TypographyWeight, TextStyle> = {
  regular: {fontWeight: '400'},
  medium: {fontWeight: '500'},
  semibold: {fontWeight: '600'},
  bold: {fontWeight: '700'},
};

// Theme-aware colours (tokens.ts L187-194). `subtle`/`disabled`/`inverse` are
// the white-alpha utilities; `inverse` resolves to its dark-theme branch since
// the native app is dark-themed.
const colorStyles: Record<TypographyColor, TextStyle> = {
  primary: {color: TEXT_PRIMARY},
  secondary: {color: TEXT_SECONDARY},
  muted: {color: TEXT_MUTED},
  subtle: {color: 'rgba(255, 255, 255, 0.6)'},
  disabled: {color: 'rgba(255, 255, 255, 0.4)'},
  inverse: {color: 'rgba(255, 255, 255, 0.9)'},
};

// Font family (tokens.ts L196-199). `sans` is the system default (no override).
const familyStyles: Record<'sans' | 'mono', TextStyle> = {
  sans: {},
  mono: {fontFamily: MONO_FONT},
};

// Composed roles (tokens.ts L205-219) — the canonical style for each text
// "kind". Responsive `sm:`/`lg:` size bumps collapse to the mobile-first base
// size (RN has no breakpoints): pageTitle -> text-xl(20), metricValue ->
// text-2xl(24). tracking-tight -> letterSpacing fontSize*-0.025; tracking-wider
// -> fontSize*0.05; uppercase -> textTransform; tabular-nums -> fontVariant.
const roleStyles: Record<TypographyRole, TextStyle> = {
  pageTitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: TEXT_PRIMARY,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.45,
    color: TEXT_PRIMARY,
  },
  panelTitle: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  subhead: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: TEXT_SECONDARY,
  },
  body: {fontSize: 14, lineHeight: 20, color: TEXT_PRIMARY},
  bodySm: {fontSize: 12, lineHeight: 16, color: TEXT_SECONDARY},
  caption: {fontSize: 12, lineHeight: 16, color: TEXT_MUTED},
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: TEXT_MUTED,
  },
  metricValue: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: TEXT_PRIMARY,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: TEXT_MUTED,
  },
  code: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: MONO_FONT,
    color: TEXT_PRIMARY,
  },
  helper: {fontSize: 12, lineHeight: 16, color: TEXT_MUTED},
  error: {fontSize: 12, lineHeight: 16, color: ROSE_300},
};

/**
 * Resolved native analog of the web `typography` token (web/src/lib/tokens.ts).
 * Tailwind utility strings are replaced by concrete `TextStyle` values. Use via
 * the {@link Heading} / {@link Text} components below; reach for the granular
 * `size`/`weight`/`color`/`family` maps only for one-offs that don't fit a role.
 */
export const typography = {
  size: sizeStyles,
  weight: weightStyles,
  color: colorStyles,
  family: familyStyles,
  role: roleStyles,
} as const;

// ─────────────────────────────────────────────
// Shared props — native analog of web `CommonProps` (source L11-14).
// The DOM `HTMLAttributes<HTMLElement>` spread target becomes RN `TextProps`.
// ─────────────────────────────────────────────

export type CommonProps = {
  /** Native escape hatch replacing the web `className` override (source L12). */
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
} & Omit<RNTextProps, 'style' | 'children'>;

// ─────────────────────────────────────────────
// Heading — use for page / section / panel / sub titles (source L16-49)
// ─────────────────────────────────────────────

export type HeadingLevel = 'page' | 'section' | 'panel' | 'sub';

export interface HeadingProps extends CommonProps {
  level?: HeadingLevel;
  /**
   * Override the rendered component for this heading. Mirrors the web `as`
   * semantic-tag override (source L25); on native pass an RN component, not a
   * DOM tag string.
   */
  as?: ElementType;
}

// Web `HEADING_ROLE` (source L35-40): map each level to its canonical role.
const HEADING_ROLE: Record<HeadingLevel, TypographyRole> = {
  page: 'pageTitle',
  section: 'sectionTitle',
  panel: 'panelTitle',
  sub: 'subhead',
};

/**
 * Heading — title text picked by `level`. Native parity port of the web
 * Heading. The web `HEADING_TAG` h1-h4 distinction (source L28-33) collapses to
 * `accessibilityRole="header"` on a single `<Text>`.
 */
export function Heading({
  level = 'section',
  as,
  style,
  children,
  ...rest
}: HeadingProps) {
  const Tag = as ?? RNText;
  return (
    <Tag
      accessibilityRole="header"
      {...rest}
      style={[typography.role[HEADING_ROLE[level]], style]}>
      {children}
    </Tag>
  );
}

// ─────────────────────────────────────────────
// Text — generic body / span (source L51-94)
// ─────────────────────────────────────────────

export interface TextProps extends CommonProps {
  /** Pre-composed role. If set, size/weight/color are ignored (source L57). */
  variant?: TypographyRole;
  /** Granular size — only applied when variant is unset (source L59). */
  size?: TypographySize;
  /** Granular weight — only applied when variant is unset (source L61). */
  weight?: TypographyWeight;
  /** Granular color — only applied when variant is unset (source L63). */
  color?: TypographyColor;
  /** Switch the font family to the monospace face (source L65). */
  mono?: boolean;
  as?: ElementType;
}

/**
 * Text — generic body / inline text. Native parity port of the web Text: when
 * `variant` is set it applies that role, otherwise it composes the granular
 * size / weight / color / mono tokens (source L80-88).
 */
export function Text({
  variant,
  size,
  weight,
  color,
  mono,
  as,
  style,
  children,
  ...rest
}: TextProps) {
  const Tag = as ?? RNText;
  const classes: StyleProp<TextStyle> = variant
    ? typography.role[variant]
    : [
        size ? typography.size[size] : null,
        weight ? typography.weight[weight] : null,
        color ? typography.color[color] : null,
        mono ? typography.family.mono : null,
      ];
  return (
    <Tag {...rest} style={[classes, style]}>
      {children}
    </Tag>
  );
}

// ─────────────────────────────────────────────
// Convenience — match common roles 1:1 (source L96-111)
// ─────────────────────────────────────────────

export const PageTitle = (p: CommonProps) => <Heading level="page" {...p} />;
export const SectionTitle = (p: CommonProps) => (
  <Heading level="section" {...p} />
);
export const PanelTitle = (p: CommonProps) => <Heading level="panel" {...p} />;
export const Subhead = (p: CommonProps) => <Heading level="sub" {...p} />;

export const Caption = (p: CommonProps) => <Text variant="caption" {...p} />;
export const HelperText = (p: CommonProps) => <Text variant="helper" {...p} />;
export const ErrorText = (p: CommonProps) => (
  <Text variant="error" accessibilityRole="alert" {...p} />
);
export const Label = (p: CommonProps) => <Text variant="label" {...p} />;
export const MetricValue = (p: CommonProps) => (
  <Text variant="metricValue" {...p} />
);
export const MetricLabel = (p: CommonProps) => (
  <Text variant="metricLabel" {...p} />
);
export const Code = (p: CommonProps) => <Text variant="code" {...p} />;
