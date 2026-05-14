import { useTranslation } from 'react-i18next';
import { numericToGrade, gradeInfo, type ScoreGrade, type ScoreGradeInfo } from '@/lib/scoreScale';
import { cn } from '@/lib/cn';

export type ScoreBadgeSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  /**
   * Display size:
   *   - `'sm'` ≈ 12 px font, used inline next to other text
   *   - `'md'` (default) ≈ 20 px font, used in list rows
   *   - `'lg'` ≈ 28 px font, used in section headers
   */
  size?: ScoreBadgeSize;
  /** Optional class on the outer span. */
  className?: string;
  /** Test hook. */
  testId?: string;
  /** Override the auto-generated `aria-label`. */
  ariaLabel?: string;
}

interface ScoreInputProps extends CommonProps {
  /**
   * Numeric score input. Mapped to a letter via {@link numericToGrade}.
   * Pass `thresholds` to use a non-default scale (e.g. inverse Wh/km
   * for efficiency).
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

const SIZE_CLASS: Record<ScoreBadgeSize, string> = {
  sm: 'text-xs',
  md: 'text-xl',
  lg: 'text-3xl',
};

/**
 * `ScoreBadge` — letter-grade pill (A+ / A / B / C / D / F / —).
 *
 * Used on history-style rows (Drives, Charging, Trips) and in section
 * headers ("Avg score: B"). The letter IS the badge — no extra "SCORE"
 * sub-label, per UX critique.
 *
 * Two prop styles:
 *   <ScoreBadge score={87}             />   // numeric → grade
 *   <ScoreBadge grade="B"              />   // pre-computed
 *   <ScoreBadge score={150} thresholds={whThresholds} />  // custom scale
 *
 * Colour comes from the shared {@link gradeInfo} palette so any badge
 * with the same letter has the same colour everywhere in the app.
 */
export function ScoreBadge(props: ScoreBadgeProps) {
  const { t } = useTranslation();
  const { size = 'md', className, testId, ariaLabel } = props;

  let info: ScoreGradeInfo;
  if ('grade' in props && props.grade) {
    info = gradeInfo(props.grade);
  } else {
    info = numericToGrade(props.score, props.thresholds);
  }

  const labelText = ariaLabel ?? t('score.aria', 'Score {{grade}}', { grade: info.label });

  return (
    <span
      data-testid={testId}
      aria-label={labelText}
      className={cn(
        'inline-block font-bold leading-none tabular-nums',
        SIZE_CLASS[size],
        className,
      )}
      style={{ color: info.color }}
    >
      {info.label}
    </span>
  );
}
