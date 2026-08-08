import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { Button as CtaButton, BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui/Button';
import { Heading, Text } from '@/components/ui/Typography';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message: string;
  /** Imperative action — runs on click (mutates state, opens modal, etc.) */
  action?: { label: string; onClick: () => void };
  /** Navigation action — preferred when the CTA just goes somewhere. Takes priority over `action`. */
  actionTo?: { label: string; to: string };
  className?: string;
}

// Button-equivalent classes for the Link-based actionTo CTA. Derived from the
// shared Button constants rather than hand-copied, so the visual stays in
// lock-step with the component library by construction — a re-skin of the
// neutral variants now reaches this CTA automatically.
const linkButtonClasses = cn(BUTTON_BASE, BUTTON_VARIANTS.secondary, 'h-8 px-3 text-xs');

export function EmptyState({ icon, title, message, action, actionTo, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center justify-center py-16 text-center', className)}
    >
      {icon && <div className="mb-4 text-[var(--text-muted)]">{icon}</div>}
      {title && (
        <Heading level="panel" className="mb-1">
          {title}
        </Heading>
      )}
      <Text variant="bodySm" as="p" className="mb-4 max-w-md">
        {message}
      </Text>
      {actionTo ? (
        <Link to={actionTo.to} className={linkButtonClasses}>
          {actionTo.label}
        </Link>
      ) : action ? (
        <CtaButton onClick={action.onClick} variant="secondary" size="sm">
          {action.label}
        </CtaButton>
      ) : null}
    </div>
  );
}
