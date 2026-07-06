import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export interface PageLoaderProps {
  /**
   * Accessible + visible loading label rendered beneath the brand spinner.
   * Defaults to the shared, translated “Loading…” copy so the status region is
   * announced in the user's language instead of the spinner's hardcoded English
   * fallback. Blank / whitespace-only values fall back to the default.
   */
  label?: string;
  /**
   * Extra classes merged onto the centring container — e.g. `min-h-screen` for
   * a true full-viewport fallback, or a shorter height for inline use.
   */
  className?: string;
}

/**
 * Full-page spinning loader, suitable as a React Suspense fallback for lazily
 * loaded route chunks. Centres the brand {@link Spinner} with an accessible,
 * translated loading label so assistive tech announces progress while the chunk
 * streams in.
 */
export function PageLoader({ label, className }: PageLoaderProps) {
  const { t } = useTranslation();
  const loadingLabel = label?.trim() ? label : t('common.loading', 'Loading…');

  return (
    <div
      className={cn('flex items-center justify-center py-32', className)}
      data-testid="page-loader"
    >
      <Spinner size="lg" label={loadingLabel} />
    </div>
  );
}
