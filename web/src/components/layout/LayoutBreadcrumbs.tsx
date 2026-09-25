import { Breadcrumbs } from './Breadcrumbs';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';
import { useBreadcrumbOverrides } from './BreadcrumbOverridesContext';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { SectionGroup } from './sectionGroups';
import { sidebarBreadcrumbs, type BreadcrumbSection } from './sidebar/sidebarBreadcrumbs';

/**
 * Single canonical breadcrumb row mounted in the global Layout chrome.
 *
 * Reads per-page label overrides from `BreadcrumbOverridesContext` (which
 * `<PageContainer>` populates via the `breadcrumbLabels` prop) and
 * resolves the full parent chain via `useBreadcrumbs`. `<Breadcrumbs>`
 * renders every registered route, including a one-item chain for top-level
 * pages. This component owns the complete top bar so routes that are not
 * sidebar entries still receive the same breadcrumb and quick-jump hint.
 */
interface LayoutBreadcrumbsProps {
  className?: string;
  variant?: 'page' | 'workspace';
  sections?: readonly BreadcrumbSection[];
  collections?: readonly SectionGroup[];
}

export function LayoutBreadcrumbs({
  className,
  variant = 'page',
  sections,
  collections,
}: LayoutBreadcrumbsProps) {
  const { t } = useTranslation();
  const overrides = useBreadcrumbOverrides();
  const routeItems = useBreadcrumbs(overrides);
  const pathname = useLocation().pathname;
  const items = sections && collections
    ? sidebarBreadcrumbs(pathname, routeItems, sections, collections, (key, fallback) => t(key, fallback) as string)
    : routeItems;
  if (items.length === 0) return null;
  const workspace = variant === 'workspace';

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3',
        workspace ? 'min-h-5' : 'mb-5 min-h-8',
      )}
    >
      <Breadcrumbs items={items} className={className} />
      {!workspace && (
        <p className="hidden shrink-0 rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-1)] px-2.5 py-1 text-xs text-[var(--text-muted)] shadow-e1 xl:block">
          {t('nav.quickSearchHint', 'Ctrl+K to jump')}
        </p>
      )}
    </div>
  );
}
