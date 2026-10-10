import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { Button as CtaButton, BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui/Button';
import { Heading, Text } from '@/components/ui/Typography';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message: string;
  /** Supporting context that explains prerequisites or the next expected system event. */
  description?: string;
  /** Imperative action — runs on click (mutates state, opens modal, etc.) */
  action?: { label: string; onClick: () => void };
  /** Navigation action — preferred when the CTA just goes somewhere. Takes priority over `action`. */
  actionTo?: { label: string; to: string };
  /** Optional second CTA rendered beside the primary (e.g. an alternative path). */
  secondaryAction?: { label: string; onClick: () => void };
  /** Navigation form of the secondary CTA. Takes priority over `secondaryAction`. */
  secondaryActionTo?: { label: string; to: string };
  className?: string;
}

// Button-equivalent classes for the Link-based actionTo CTA. Derived from the
// shared Button constants rather than hand-copied, so the visual stays in
// lock-step with the component library by construction — a re-skin of the
// neutral variants now reaches this CTA automatically.
const linkButtonClasses = cn(
  BUTTON_BASE,
  BUTTON_VARIANTS.secondary,
  'min-w-0 max-w-full min-h-11 md:min-h-10 px-4 py-2 text-sm whitespace-normal break-words',
);

export function EmptyState({
  icon,
  title,
  message,
  description,
  action,
  actionTo,
  secondaryAction,
  secondaryActionTo,
  className,
}: EmptyStateProps) {
  const hasPrimary = actionTo != null || action != null;
  const hasSecondary = secondaryActionTo != null || secondaryAction != null;
  return (
    <div
      role="status"
      className={cn('flex min-w-0 flex-col items-center justify-center px-4 py-16 text-center', className)}
    >
      {icon && (
        <div className="mb-5 rounded-shape-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-3 text-[var(--text-secondary)]">
          {icon}
        </div>
      )}
      {title && (
        <Heading level="panel" className="mb-2 max-w-full break-words">
          {title}
        </Heading>
      )}
      <Text
        variant="bodySm"
        as="p"
        className={cn(description ? 'mb-2' : 'mb-6', 'w-full min-w-0 max-w-lg break-words leading-relaxed')}
      >
        {message}
      </Text>
      {description && (
        <Text variant="bodySm" as="p" color="muted" className="mb-6 w-full min-w-0 max-w-lg break-words leading-relaxed">
          {description}
        </Text>
      )}
      {(hasPrimary || hasSecondary) && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-3">
          {actionTo ? (
            <Link to={actionTo.to} className={linkButtonClasses}>
              {actionTo.label}
            </Link>
          ) : action ? (
            <CtaButton onClick={action.onClick} variant="secondary" size="md" wrapLabel className="min-h-11 md:min-h-10">
              {action.label}
            </CtaButton>
          ) : null}
          {secondaryActionTo ? (
            <Link to={secondaryActionTo.to} className={linkButtonClasses}>
              {secondaryActionTo.label}
            </Link>
          ) : secondaryAction ? (
            <CtaButton onClick={secondaryAction.onClick} variant="ghost" size="md" wrapLabel className="min-h-11 md:min-h-10">
              {secondaryAction.label}
            </CtaButton>
          ) : null}
        </div>
      )}
    </div>
  );
}
