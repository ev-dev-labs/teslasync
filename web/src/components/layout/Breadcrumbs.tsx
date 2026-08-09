import { Fragment } from 'react';
import { PrefetchLink } from './PrefetchLink';
import { ChevronRight, Home } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export interface BreadcrumbItem {
  label: string;
  href?: string; // undefined = current page (no link)
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
  /**
   * Destination of the leading Home icon link. Defaults to '/'. Override for
   * brandable / role-based homes (e.g. embedded surfaces that should anchor at
   * a sub-route).
   */
  homeHref?: string;
  /**
   * Aria label for the leading Home link. Defaults to the localized
   * `a11y.breadcrumbHome` key ("Dashboard" in English).
   */
  homeAriaLabel?: string;
}

export function Breadcrumbs({
  items,
  className,
  homeHref = '/',
  homeAriaLabel,
}: BreadcrumbsProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <nav
      aria-label={t('a11y.breadcrumb', 'Breadcrumb')}
      className={cn('flex items-center gap-1 text-sm overflow-x-auto scrollbar-none', className)}
    >
      <PrefetchLink
        to={homeHref}
        className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
        aria-label={homeAriaLabel ?? t('a11y.breadcrumbHome', 'Dashboard')}
      >
        <Home className="h-3.5 w-3.5" />
      </PrefetchLink>

      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const isMiddle = i > 0 && !isLast;

        return (
          <Fragment key={i}>
            <ChevronRight className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
            {isLast || !item.href ? (
              <span
                className={cn(
                  'truncate max-w-[200px]',
                  isLast ? 'text-[var(--text-secondary)] font-medium' : 'text-[var(--text-muted)]',
                  isMiddle && 'hidden sm:inline',
                )}
              >
                {item.label}
              </span>
            ) : (
              <PrefetchLink
                to={item.href}
                className={cn(
                  'text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors truncate max-w-[200px]',
                  isMiddle && 'hidden sm:inline',
                )}
              >
                {item.label}
              </PrefetchLink>
            )}
            {/* Collapsed indicator on mobile for hidden middle items */}
            {isMiddle && (
              <span className="text-[var(--text-muted)] sm:hidden" aria-hidden="true">…</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
