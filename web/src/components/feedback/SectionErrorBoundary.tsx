import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { Icon } from '../ui/Icon';
import { Text, HelperText } from '../ui/Typography';
import { cn } from '@/lib/cn';
import { severityTokens } from '@/lib/tokens';

interface SectionErrorBoundaryProps {
  children: ReactNode;
  /** Unique name for log correlation (e.g. "BatteryDegradationChart"). */
  name: string;
  /**
   * Custom inline title to show in the fallback. When omitted, the underlying
   * ErrorBoundary's default inline UI (with a working Retry button) is used.
   */
  fallbackTitle?: string;
  /**
   * Override the entire fallback node — useful when the boundary lives inside
   * structural HTML (e.g. inside a `<tbody>` where the default `<div>` fallback
   * would be invalid markup). When provided, no Retry button is shown.
   */
  fallback?: ReactNode;
}

/**
 * Wraps a section / widget / chart in an error boundary so a render failure
 * inside it doesn't bubble up and blank out the whole page.
 *
 * Defaults to the existing `ErrorBoundary` inline UI (which includes a Retry
 * button); pass `fallbackTitle` for a custom message or `fallback` to override
 * the entire node (e.g. for HTML-structural placements like a table row).
 */
export function SectionErrorBoundary({
  children, name, fallbackTitle, fallback,
}: SectionErrorBoundaryProps) {
  const { t } = useTranslation();

  if (fallback !== undefined) {
    return (
      <ErrorBoundary name={name} fallback={fallback}>
        {children}
      </ErrorBoundary>
    );
  }

  if (fallbackTitle) {
    const titleFallback = (
      <div
        role="alert"
        className={cn(
          'flex min-w-0 items-start gap-3 rounded-panel border p-4',
          severityTokens.critical.bg,
          severityTokens.critical.border,
        )}
      >
        <Icon icon={AlertTriangle} size="lg" className={severityTokens.critical.fg} />
        <div className="flex-1 min-w-0">
          <Text as="p" variant="bodySm" className="break-words">{fallbackTitle}</Text>
          <HelperText className="break-words">
            {t('errors.section.subtitle', 'Other parts of the page should still work.')}
          </HelperText>
        </div>
      </div>
    );
    return (
      <ErrorBoundary name={name} fallback={titleFallback}>
        {children}
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary name={name} inline>
      {children}
    </ErrorBoundary>
  );
}
