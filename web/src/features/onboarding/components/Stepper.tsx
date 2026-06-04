import { type ReactNode } from 'react';
import { Check, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';

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

function stateOf(steps: OnboardingStep[], index: number): 'done' | 'current' | 'pending' {
  if (steps[index].done) return 'done';
  // The "current" step is the first not-done step. Subsequent
  // not-done steps stay pending so the user follows the flow.
  const firstPending = steps.findIndex((s) => !s.done);
  return firstPending === index ? 'current' : 'pending';
}

const indicatorClasses = {
  done: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300',
  current: 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300',
  pending: 'bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-muted)]',
} as const;

const titleClasses = {
  done: 'text-[var(--text-primary)]',
  current: 'text-white',
  pending: 'text-[var(--text-secondary)]',
} as const;

const descriptionClasses = {
  done: 'text-[var(--text-secondary)]',
  current: 'text-[var(--text-secondary)]',
  pending: 'text-[var(--text-muted)]',
} as const;

export function Stepper({ steps, renderCta }: StepperProps) {
  return (
    <ol className="flex flex-col gap-6" aria-label="Onboarding steps">
      {steps.map((step, idx) => {
        const state = stateOf(steps, idx);
        const showCta = state === 'current' && step.cta;
        return (
          <li
            key={step.key}
            id={`onboarding-step-${step.key}`}
            className="flex gap-4"
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
              {idx < steps.length - 1 && (
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
              <h3 className={cn('text-base font-semibold', titleClasses[state])}>
                {step.title}
              </h3>
              <p className={cn('mt-1 text-sm leading-relaxed', descriptionClasses[state])}>
                {step.description}
              </p>
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
