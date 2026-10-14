import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, ArrowRight, ListChecks, CircleHelp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { severityTokens } from '@/lib/tokens';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { Button, Heading, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';

/**
 * Compact vertical step list used by the onboarding page. Each step
 * keeps completion evidence separate from action readiness:
 *
 *   - done        confirmed completion check
 *   - current     static arrow, or spinner only during explicit work
 *   - pending     muted index circle
 *   - unknown     neutral question mark, never inferred incompletion
 *
 * Only the first unconfirmed step renders its CTA so completed rows
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
  /** True once the anchor is satisfied; null means completion is unknown. */
  done: boolean | null;
  /** Explicit work in flight, not an idle CTA or a disabled action. */
  busy?: boolean;
  /** Optional CTA rendered when this is the first unconfirmed step. */
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

type StepState = 'done' | 'current' | 'pending' | 'unknown';

/**
 * Unknown completion stays unknown even when that row owns the next action.
 * Known unfinished rows follow the original current/pending ordering.
 */
function stepStateFor(done: OnboardingStep['done'], index: number, currentIndex: number): StepState {
  if (done == null) return 'unknown';
  if (done) return 'done';
  return index === currentIndex ? 'current' : 'pending';
}

const indicatorClasses = {
  done: cn(severityTokens.success.bg, severityTokens.success.border, severityTokens.success.fg),
  current: cn(severityTokens.info.bg, severityTokens.info.border, severityTokens.info.fg),
  pending: 'bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-muted)]',
  unknown: 'bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-secondary)]',
} as const;

const titleClasses = {
  done: 'text-[var(--text-primary)]',
  current: 'text-[var(--text-primary)]',
  pending: 'text-[var(--text-secondary)]',
  unknown: 'text-[var(--text-secondary)]',
} as const;

const descriptionClasses = {
  done: 'text-[var(--text-secondary)]',
  current: 'text-[var(--text-secondary)]',
  pending: 'text-[var(--text-muted)]',
  unknown: 'text-[var(--text-secondary)]',
} as const;

export function Stepper({ steps, renderCta }: StepperProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  // Null-safe: callers may hand us `data?.steps` before the query resolves.
  const items = steps ?? [];

  // Unknown evidence must not prevent the original first available action.
  const currentIndex = useMemo(() => items.findIndex((s) => s.done !== true), [items]);

  const statusLabel: Record<StepState, string> = {
    done: t('onboarding.stepper.status.done', 'Completed'),
    current: t('onboarding.stepper.status.current', 'In progress'),
    pending: t('onboarding.stepper.status.pending', 'Not started'),
    unknown: t('common.unknown', 'Unknown'),
  };

  if (items.length === 0) {
    return (
      <EmptyState /* no-action: OnboardingPage and FleetSetupProgress supply fixed checklists; this guards missing input rather than introducing another setup action. */
        icon={<ListChecks className="h-8 w-8" aria-hidden="true" />}
        message={t('onboarding.stepper.empty', 'No setup steps to show right now.')}
      />
    );
  }

  return (
    <ol className="flex min-w-0 max-w-full flex-col gap-5 sm:gap-6" aria-label={t('onboarding.stepper.label', 'Onboarding steps')}>
      {items.map((step, idx) => {
        const state = stepStateFor(step.done, idx, currentIndex);
        const isCurrent = idx === currentIndex;
        const isBusy = state === 'current' && step.busy === true;
        const showCta = isCurrent && step.cta;
        const isLast = idx === items.length - 1;
        return (
          <li
            key={step.key}
            id={`onboarding-step-${step.key}`}
            className="flex min-w-0 max-w-full gap-3 sm:gap-4"
            aria-current={isCurrent ? 'step' : undefined}
            aria-busy={isBusy || undefined}
          >
            <div className="relative flex shrink-0 flex-col items-center">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]',
                  indicatorClasses[state],
                )}
              >
                {state === 'done' ? (
                  <Check className="h-4 w-4" />
                ) : state === 'unknown' ? (
                  <CircleHelp className="h-4 w-4" />
                ) : state === 'current' ? (
                  isBusy ? (
                    <Loader2 className={cn('h-4 w-4 motion-reduce:animate-none', !reduce && 'animate-spin')} />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )
                ) : (
                  <Text as="span" size="sm" weight="semibold">{idx + 1}</Text>
                )}
              </span>
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1 w-px flex-1 min-h-[28px]',
                    state === 'done' ? severityTokens.success.dot : 'bg-[var(--surface-2)]',
                  )}
                />
              )}
            </div>

            <div className="min-w-0 flex-1 break-words pb-1 [overflow-wrap:anywhere]">
              <VisuallyHidden>{statusLabel[state]}</VisuallyHidden>
              <Heading level="panel" className={titleClasses[state]}>
                {step.title}
              </Heading>
              <Text as="p" size="sm" className={cn('mt-1 leading-relaxed', descriptionClasses[state])}>
                {step.description}
              </Text>
              {showCta && (
                <div className="mt-3 min-w-0 max-w-full [&>*]:max-w-full">
                  {renderCta ? (
                    renderCta(step)
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      wrapLabel
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
