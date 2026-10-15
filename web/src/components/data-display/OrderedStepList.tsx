import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '../ui/Button';
import { IconBox } from '../ui/IconBox';
import { Text } from '../ui/Typography';
import { cn } from '@/lib/cn';

export interface OrderedStepAction {
  label: ReactNode;
  onClick: () => void;
  /** Supply a localized name when the visible label alone is insufficient. */
  ariaLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonProps['variant'];
}

export interface OrderedStep {
  /** Unique, stable identity independent of title, position and locale. */
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** Omit for passive instructions. The caller owns all progress decisions. */
  state?: {
    kind: 'completed' | 'current' | 'pending';
    /** Localized, visible status; state is never conveyed by color alone. */
    label: string;
  };
  /** Rendered whenever supplied, regardless of the step's state. */
  action?: OrderedStepAction;
}

export type OrderedStepListProps = {
  steps: readonly OrderedStep[];
  /** Optional caller-localized content outside the empty ordered list. */
  emptyContent?: ReactNode;
  id?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  className?: string;
} & (
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-labelledby': string; 'aria-label'?: never }
);

/**
 * Ordered instructions with passive numbering by default. No current step,
 * completion, action availability or domain policy is inferred.
 */
export function OrderedStepList({
  steps,
  emptyContent,
  id,
  dir,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: OrderedStepListProps) {
  const items = steps ?? [];
  const ids = new Set<string>();
  for (const step of items) {
    if (!step.id.trim() || ids.has(step.id)) {
      throw new Error('OrderedStepList: step ids must be nonempty and unique.');
    }
    ids.add(step.id);
  }

  return (
    <div dir={dir} className={cn('min-w-0 max-w-full', className)}>
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- Restore Safari list semantics when custom numbering removes native markers. */}
      <ol
        id={id}
        role="list"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="m-0 flex min-w-0 list-none flex-col gap-4 p-0"
      >
        {items.map((step, index) => (
          <li
            key={step.id}
            data-step-id={step.id}
            data-state={step.state?.kind}
            aria-current={step.state?.kind === 'current' ? 'step' : undefined}
            className="flex min-w-0 max-w-full items-start gap-3"
          >
            <div aria-hidden="true">
              <IconBox
                className={cn(
                  'h-auto min-h-10 w-auto min-w-10 bg-[var(--surface-2)] px-2 py-2 text-[var(--text-primary)] ring-[var(--border-default)] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] forced-colors:[outline-style:solid] forced-colors:outline-1 forced-colors:outline-[CanvasText]',
                  step.state?.kind === 'current' && 'ring-2',
                )}
              >
                <Text size="sm" weight="semibold">{index + 1}</Text>
              </IconBox>
            </div>
            <div className="min-w-0 flex-1 space-y-1 break-words [overflow-wrap:anywhere] [&_*]:max-w-full">
              <Text as="div" size="sm" weight="medium" color="primary">{step.title}</Text>
              {step.state && (
                <Text as="div" variant="bodySm">{step.state.label}</Text>
              )}
              {step.description != null && (
                <Text as="div" variant="bodySm">{step.description}</Text>
              )}
              {step.action && (
                <div className="pt-2">
                  <Button
                    type="button"
                    variant={step.action.variant ?? 'secondary'}
                    aria-label={step.action.ariaLabel}
                    onClick={step.action.onClick}
                    disabled={step.action.disabled}
                    loading={step.action.loading}
                    className="h-auto min-h-11 min-w-11 max-w-full whitespace-normal break-words py-2 text-start [overflow-wrap:anywhere]"
                  >
                    {step.action.label}
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {items.length === 0 && emptyContent != null && (
        <Text as="div" variant="bodySm" className="break-words [overflow-wrap:anywhere]">
          {emptyContent}
        </Text>
      )}
    </div>
  );
}
