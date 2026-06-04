import { useTranslation } from 'react-i18next';
import { VisuallyHidden } from '@/components/a11y';

/**
 * SkipToContent — WCAG 2.4.1 (Bypass Blocks, Level A).
 *
 * Visually hidden until focused; on activation jumps focus + scroll to
 * the page's `<main id="main-content">` landmark so keyboard users do
 * NOT have to tab through the entire sidebar (50+ items) on every page
 * load to reach the page body.
 *
 * MUST be mounted as the very first interactive element in the DOM
 * (i.e. the first child of `<Layout>`) so that pressing Tab once
 * surfaces it before any sidebar / header / banner control.
 *
 * Implementation note: composes `<VisuallyHidden as="a" focusable>` —
 * the only place in the codebase allowed to apply the Tailwind
 * `sr-only` utility (enforced by `audit:sr-only`). The `focus:*`
 * utilities below position + style the link's visible-on-focus state.
 *
 * Audit anchor: skipToContent|skip.to.content.
 */
export function SkipToContent() {
  const { t } = useTranslation();
  return (
    <VisuallyHidden
      as="a"
      focusable
      data-testid="skip-to-content"
      href="#main-content"
      className="focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-[var(--surface-1)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--text-primary)] focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
      onClick={(e) => {
        e.preventDefault();
        const main = document.getElementById('main-content');
        if (main) {
          main.focus({ preventScroll: false });
          main.scrollIntoView({ block: 'start' });
        }
      }}
    >
      {t('a11y.skipToContent', 'Skip to main content')}
    </VisuallyHidden>
  );
}
