import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, ArrowRight, ListChecks } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Heading, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';

/**
 * Compact vertical step list used by the onboarding page. Each step
 * is in one of three states:
 *
 *   - done        ✓ green check
 *   - in-progress spinner (current actionable step)
 *   - pending     muted index circle
 *
 * Steps render their CTA only while in-progress so completed rows
 * stay visually quiet, and pending rows below don't tempt the user
 * into clicking ahead.
 */

export interface OnboardingStep {
  /** Stable key — used as React key and for screen-reader id. */
  key: string;
  /** Localized title shown next to the indicator. */
  title: string;
  /** Localized supporting copy explaining the step. */
  description: string;
  /** True once the underlying anchor is satisfied. */
  done: boolean;
  /** Optional CTA rendered while the step is in-progress. */
  cta?: {
    label: string;
    onClick?: () => void;
    href?: string;
    to?: string;
    /** Disables the button while a parent action is pending. */
    disabled?: boolean;
  };
  /** Optional icon override; defaults to a numeric circle. */
  icon?: ReactNode;
}

export interface StepperProps {
  steps: OnboardingStep[];
  /** Render-prop hook so the page can wrap CTAs in <Link>/<a>. */
  renderCta?: (step: OnboardingStep) => ReactNode;
}

type StepState = 'done' | 'current' | 'pending';

/**
 * Resolve a row's visual state from its own `done` flag and the index of
 * the first not-done step (`currentIndex`, computed once by the caller so
 * the whole list isn't re-scanned per row). Done rows are always `done`;
 * the single first-pending row is `current`; every later not-done row
 * stays `pending` so the user follows the flow top-to-bottom.
 */
function stepStateFor(done: boolean, index: number, currentIndex: number): StepState {
  if (done) return 'done';
  return index === currentIndex ? 'current' : 'pending';
}

const indicatorClasses = {
  done: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300',
  current: 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300',
  pending: 'bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-muted)]',
} as const;

const titleClasses = {
  done: 'text-[var(--text-primary)]',
  current: 'text-[var(--text-primary)]',
  pending: 'text-[var(--text-secondary)]',
} as const;

const descriptionClasses = {
  done: 'text-[var(--text-secondary)]',
  current: 'text-[var(--text-secondary)]',
  pending: 'text-[var(--text-muted)]',
} as const;

export function Stepper({ steps, renderCta }: StepperProps) {
  const { t } = useTranslation();
  // Null-safe: callers may hand us `data?.steps` before the query resolves.
  const items = steps ?? [];

  // The "current" step is the first not-done step. Compute it once here
  // instead of re-scanning the whole list inside every row (previously an
  // O(n²) pass). `-1` means every step is done — no current, no CTA.
  const currentIndex = useMemo(() => items.findIndex((s) => !s.done), [items]);

  // Screen-reader-only status announced before each row's title, since the
  // done/current/pending state is otherwise conveyed with colour + an
  // aria-hidden indicator glyph only.
  const statusLabel: Record<StepState, string> = {
    done: t('onboarding.stepper.status.done', 'Completed'),
    current: t('onboarding.stepper.status.current', 'In progress'),
    pending: t('onboarding.stepper.status.pending', 'Not started'),
  };

  if (items.length === 0) {
    return (
      <EmptyState /* no-action: the only caller (OnboardingPage) always supplies a fixed 3-step checklist built with useMemo; this guards the shared component against a hypothetical empty `steps` array, not a reachable product state. */
        icon={<ListChecks className="h-8 w-8" aria-hidden="true" />}
        message={t('onboarding.stepper.empty', 'No setup steps to show right now.')}
      />
    );
  }

  return (
    <ol className="flex flex-col gap-5 sm:gap-6" aria-label={t('onboarding.stepper.label', 'Onboarding steps')}>
      {items.map((step, idx) => {
        const state = stepStateFor(step.done, idx, currentIndex);
        const showCta = state === 'current' && step.cta;
        const isLast = idx === items.length - 1;
        return (
          <li
            key={step.key}
            id={`onboarding-step-${step.key}`}
            className="flex gap-3 sm:gap-4"
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <div className="relative flex flex-col items-center">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors',
                  indicatorClasses[state],
                )}
              >
                {state === 'done' ? (
                  <Check className="h-4 w-4" />
                ) : state === 'current' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </span>
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1 w-px flex-1 min-h-[28px]',
                    state === 'done' ? 'bg-emerald-400/40' : 'bg-[var(--surface-2)]',
                  )}
                />
              )}
            </div>

            <div className="flex-1 pb-1">
              <VisuallyHidden>{statusLabel[state]}</VisuallyHidden>
              <Heading level="panel" className={titleClasses[state]}>
                {step.title}
              </Heading>
              <Text as="p" size="sm" className={cn('mt-1 leading-relaxed', descriptionClasses[state])}>
                {step.description}
              </Text>
              {showCta && (
                <div className="mt-3">
                  {renderCta ? (
                    renderCta(step)
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={step.cta?.onClick}
                      disabled={step.cta?.disabled}
                      icon={<ArrowRight className="h-4 w-4" />}
                    >
                      {step.cta?.label}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
