// Native parity port of web/src/components/data-display/ScoreBadge.tsx.
//
// The web badge is a Tailwind `<span>` that renders a single letter grade
// (A+ / A / B / C / D / F / —) coloured from the shared score palette. This
// native version reproduces the same public prop contract (the discriminated
// `score | grade` union, `size`, `className`, `testId`, `ariaLabel`) using a
// React Native AppText primitive plus the existing design tokens.
//
// Two web dependencies are not browser features but have no native parity port
// yet, so they are reduced explicitly here and documented in the sidecar:
//   - `@/lib/scoreScale` (numericToGrade / gradeInfo / ScoreGrade /
//     ScoreGradeInfo / GRADE_PALETTE / DEFAULT_SCORE_THRESHOLDS) is a pure,
//     React-free helper module. The exact subset ScoreBadge consumes is
//     inlined verbatim (same palette hexes, same thresholds, same lower-bound
//     inclusive highest-first matching) so any badge with the same letter keeps
//     the same colour everywhere, matching the web palette lock-step contract.
//   - `react-i18next`'s `useTranslation` is replaced by a native-safe `t`
//     fallback that resolves the English default string and interpolates the
//     `{{grade}}` token, mirroring `t('score.aria', 'Score {{grade}}', {...})`.
// The web-only `cn()` class merge and the `inline-block` layout class are
// dropped — native styling uses StyleSheet + an optional `style` override.

import React, {useCallback} from 'react';
import {StyleSheet, type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

// ── scoreScale (native-safe port of web/src/lib/scoreScale.ts subset) ──

/** Display label. `—` when input is null / NaN. */
export type ScoreGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | '—';

export interface ScoreGradeInfo {
  /** Display label. `—` when input is null / NaN. */
  label: ScoreGrade;
  /** Hex colour for the badge text. */
  color: string;
  /**
   * Numeric weight for averaging across many items. `null` for the "no data"
   * sentinel so callers can skip it in arithmetic.
   */
  numeric: number | null;
}

/** Shared palette. Keep in lock-step with `lib/drivesAggregation` GRADE_PALETTE. */
const GRADE_PALETTE: Record<ScoreGrade, {color: string; numeric: number | null}> =
  {
    'A+': {color: '#10b981', numeric: 4.5},
    A: {color: '#10b981', numeric: 4.0},
    B: {color: '#00f0ff', numeric: 3.0},
    C: {color: '#f59e0b', numeric: 2.0},
    D: {color: '#ef4444', numeric: 1.0},
    F: {color: '#b91c1c', numeric: 0.5},
    '—': {color: '#6b7280', numeric: null},
  };

/** Default 0–100 thresholds. Lower bound inclusive. */
const DEFAULT_SCORE_THRESHOLDS: ReadonlyArray<{min: number; label: ScoreGrade}> =
  [
    {min: 90, label: 'A+'},
    {min: 80, label: 'A'},
    {min: 65, label: 'B'},
    {min: 50, label: 'C'},
    {min: 35, label: 'D'},
    {min: 0, label: 'F'},
  ];

/**
 * Map a 0–100 numeric score to a letter grade. Caller can override thresholds
 * (Wh/km efficiency, latency ms, anything ordered).
 */
function numericToGrade(
  score: number | null | undefined,
  thresholds: ReadonlyArray<{
    min: number;
    label: ScoreGrade;
  }> = DEFAULT_SCORE_THRESHOLDS,
): ScoreGradeInfo {
  if (score == null || !Number.isFinite(score)) {
    return {label: '—', ...GRADE_PALETTE['—']};
  }
  // Thresholds are evaluated highest-first so the first match wins.
  const sorted = [...thresholds].sort((a, b) => b.min - a.min);
  for (const threshold of sorted) {
    if (score >= threshold.min) {
      return {label: threshold.label, ...GRADE_PALETTE[threshold.label]};
    }
  }
  return {label: 'F', ...GRADE_PALETTE.F};
}

/** Lookup the colour + numeric weight for a known grade label. */
function gradeInfo(label: ScoreGrade): ScoreGradeInfo {
  return {label, ...GRADE_PALETTE[label]};
}

// ── native translation fallback (native-safe port of react-i18next) ──

type InterpolationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  defaultValueOrOptions?: string | InterpolationValues,
  options?: InterpolationValues,
) => string;

function interpolate(
  template: string,
  values: InterpolationValues | undefined,
): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    return value === undefined ? '' : String(value);
  });
}

// Mirrors react-i18next's `t(key, defaultValue?, options?)` overloads: resolve
// the English default string (or `key` as last resort) and interpolate any
// `{{token}}` placeholders from the options object.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key, defaultValueOrOptions, options) => {
    if (typeof defaultValueOrOptions === 'string') {
      return interpolate(defaultValueOrOptions, options);
    }
    const opts = defaultValueOrOptions;
    const template =
      typeof opts?.defaultValue === 'string' ? opts.defaultValue : key;
    return interpolate(template, opts);
  }, []);
}

// ── ScoreBadge ──

export type ScoreBadgeSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  /**
   * Display size:
   *   - `'sm'` ≈ 12 px font, used inline next to other text
   *   - `'md'` (default) ≈ 20 px font, used in list rows
   *   - `'lg'` ≈ 28 px font, used in section headers
   */
  size?: ScoreBadgeSize;
  /** Accepted for web source parity; native styling uses StyleSheet. */
  className?: string;
  /** Native style override applied to the badge text (web maps className here). */
  style?: StyleProp<TextStyle>;
  /** Test hook. */
  testId?: string;
  /** Native alias for `testId`. */
  testID?: string;
  /** Override the auto-generated accessibility label. */
  ariaLabel?: string;
}

interface ScoreInputProps extends CommonProps {
  /**
   * Numeric score input. Mapped to a letter via {@link numericToGrade}. Pass
   * `thresholds` to use a non-default scale (e.g. inverse Wh/km for efficiency).
   */
  score: number | null | undefined;
  thresholds?: Parameters<typeof numericToGrade>[1];
  /** Mutually exclusive with `grade`. */
  grade?: never;
}

interface GradeInputProps extends CommonProps {
  /** Pre-computed grade label — use when the caller already mapped score → grade. */
  grade: ScoreGrade;
  score?: never;
  thresholds?: never;
}

export type ScoreBadgeProps = ScoreInputProps | GradeInputProps;

// Web SIZE_CLASS mapped to its Tailwind px equivalents: text-xs=12, text-xl=20,
// text-3xl=30. leading-none → lineHeight equal to fontSize.
const SIZE_FONT: Record<ScoreBadgeSize, number> = {
  sm: 12,
  md: 20,
  lg: 30,
};

/**
 * `ScoreBadge` — letter-grade pill (A+ / A / B / C / D / F / —).
 *
 * Used on history-style rows (Drives, Charging, Trips) and in section headers
 * ("Avg score: B"). The letter IS the badge — no extra "SCORE" sub-label.
 *
 * Two prop styles:
 *   <ScoreBadge score={87} />                              // numeric → grade
 *   <ScoreBadge grade="B" />                               // pre-computed
 *   <ScoreBadge score={150} thresholds={whThresholds} />   // custom scale
 *
 * Colour comes from the shared {@link gradeInfo} palette so any badge with the
 * same letter has the same colour everywhere in the app.
 */
export function ScoreBadge(props: ScoreBadgeProps) {
  const t = useNativeTranslationFallback();
  const {size = 'md', style, testId, testID, ariaLabel} = props;

  let info: ScoreGradeInfo;
  if ('grade' in props && props.grade) {
    info = gradeInfo(props.grade);
  } else {
    info = numericToGrade(props.score, props.thresholds);
  }

  const labelText =
    ariaLabel ?? t('score.aria', 'Score {{grade}}', {grade: info.label});

  const fontSize = SIZE_FONT[size];

  return (
    <AppText
      accessibilityLabel={labelText}
      style={[
        styles.badge,
        {fontSize, lineHeight: fontSize, color: info.color},
        style,
      ]}
      testID={testId ?? testID}>
      {info.label}
    </AppText>
  );
}

ScoreBadge.displayName = 'ScoreBadge';

const styles = StyleSheet.create({
  badge: {
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
});
