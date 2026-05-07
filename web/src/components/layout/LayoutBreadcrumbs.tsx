import { Breadcrumbs } from './Breadcrumbs';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';
import { useBreadcrumbOverrides } from './BreadcrumbOverridesContext';

/**
 * Single canonical breadcrumb row mounted in the global Layout chrome.
 *
 * Reads per-page label overrides from `BreadcrumbOverridesContext` (which
 * `<PageContainer>` populates via the `breadcrumbLabels` prop) and
 * resolves the full parent chain via `useBreadcrumbs`. `<Breadcrumbs>`
 * self-suppresses when the chain has <= 1 items so top-level pages
 * render an empty slot — the surrounding row keeps the "Ctrl+K to jump"
 * hint visible.
 */
export function LayoutBreadcrumbs({ className }: { className?: string }) {
  const overrides = useBreadcrumbOverrides();
  const items = useBreadcrumbs(overrides);
  return <Breadcrumbs items={items} className={className} />;
}
