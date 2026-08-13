import { Breadcrumbs } from './Breadcrumbs';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';
import { useBreadcrumbOverrides } from './BreadcrumbOverridesContext';
import { useTranslation } from 'react-i18next';

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
export function LayoutBreadcrumbs({ className }: { className?: string }) {
  const { t } = useTranslation();
  const overrides = useBreadcrumbOverrides();
  const items = useBreadcrumbs(overrides);
  if (items.length === 0) return null;

  return (
    <div className="mb-3 flex min-h-8 items-center justify-between gap-3 border-b border-white/[0.06] pb-2">
      <Breadcrumbs items={items} className={className} />
      <p className="hidden shrink-0 text-2xs text-[var(--text-muted)] lg:block">
        {t('nav.quickSearchHint', 'Ctrl+K to jump')}
      </p>
    </div>
  );
}
