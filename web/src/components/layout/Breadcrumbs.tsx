import { Fragment } from 'react';
import { PrefetchLink } from './PrefetchLink';
import { ChevronRight, Home } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { Icon } from '../ui/Icon';

const linkClasses = 'hover:text-[var(--text-secondary)] transition-colors duration-fast motion-reduce:transition-none min-h-11 md:min-h-6 rounded-shape-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

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
      className={cn('flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-none', typography.size.sm, className)}
    >
      <PrefetchLink
        to={homeHref}
        className={cn(linkClasses, typography.color.muted, 'inline-flex items-center justify-center w-11 md:w-6 shrink-0')}
        aria-label={homeAriaLabel ?? t('a11y.breadcrumbHome', 'Dashboard')}
      >
        <Icon icon={Home} size="sm" />
      </PrefetchLink>

      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const isMiddle = i > 0 && !isLast;

        return (
          <Fragment key={i}>
            <Icon icon={ChevronRight} size="xs" className={cn(typography.color.muted, 'rtl:rotate-180')} />
            {isLast || !item.href ? (
              <span
                aria-current={isLast ? 'page' : undefined}
                title={item.label}
                className={cn(
                  'truncate max-w-breadcrumb-label',
                  isLast ? cn(typography.color.secondary, typography.weight.medium) : typography.color.muted,
                  isMiddle && 'hidden sm:inline',
                )}
              >
                {item.label}
              </span>
            ) : (
              <PrefetchLink
                to={item.href}
                title={item.label}
                className={cn(
                  linkClasses, typography.color.muted, 'truncate max-w-breadcrumb-label',
                  'block content-center',
                  isMiddle && 'hidden sm:inline',
                )}
              >
                {item.label}
              </PrefetchLink>
            )}
            {/* Collapsed indicator on mobile for hidden middle items */}
            {isMiddle && (
              <span className={cn(typography.color.muted, 'sm:hidden')} aria-hidden="true">…</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
