import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
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
   * a sub-route). Phase-40 / Prompt 61.
   */
  homeHref?: string;
  /**
   * Aria label for the leading Home link. Defaults to 'Dashboard'.
   */
  homeAriaLabel?: string;
}

export function Breadcrumbs({
  items,
  className,
  homeHref = '/',
  homeAriaLabel = 'Dashboard',
}: BreadcrumbsProps) {
  if (items.length <= 1) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex items-center gap-1 text-sm overflow-x-auto scrollbar-none', className)}
    >
      <Link
        to={homeHref}
        className="text-white/30 hover:text-white/60 transition-colors shrink-0"
        aria-label={homeAriaLabel}
      >
        <Home className="h-3.5 w-3.5" />
      </Link>

      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const isMiddle = i > 0 && !isLast;

        return (
          <Fragment key={i}>
            <ChevronRight className="h-3 w-3 text-white/15 shrink-0" />
            {isLast || !item.href ? (
              <span
                className={cn(
                  'truncate max-w-[200px]',
                  isLast ? 'text-white/70 font-medium' : 'text-white/40',
                  isMiddle && 'hidden sm:inline',
                )}
              >
                {item.label}
              </span>
            ) : (
              <Link
                to={item.href}
                className={cn(
                  'text-white/40 hover:text-white/70 transition-colors truncate max-w-[200px]',
                  isMiddle && 'hidden sm:inline',
                )}
              >
                {item.label}
              </Link>
            )}
            {/* Collapsed indicator on mobile for hidden middle items */}
            {isMiddle && (
              <span className="text-white/20 sm:hidden" aria-hidden="true">…</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
