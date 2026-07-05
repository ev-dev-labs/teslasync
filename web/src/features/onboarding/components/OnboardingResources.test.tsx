import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The component reads every label through `t(key, fallback)`. Mocking
// react-i18next to echo the inline English fallback keeps the assertions
// deterministic (independent of en.json wiring) and mirrors the convention
// used by the sibling checklist.test.ts. `@testing-library/user-event` is
// intentionally NOT used — it is not installed in this repo (see
// components/ui/Lightbox.test.tsx), so interactions go through fireEvent /
// native focus instead.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

import { OnboardingResources } from './OnboardingResources';

function renderPanel(props?: { className?: string }) {
  return render(
    <MemoryRouter>
      <OnboardingResources {...props} />
    </MemoryRouter>,
  );
}

describe('OnboardingResources', () => {
  it('renders the panel heading and the privacy reassurance note', () => {
    renderPanel();

    expect(
      screen.getByRole('heading', { name: 'Resources & help', level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /TeslaSync runs entirely on your hardware\. No data ever leaves your install\./i,
      ),
    ).toBeInTheDocument();
  });

  it('labels the navigation landmark for assistive technology', () => {
    renderPanel();

    const nav = screen.getByRole('navigation', { name: 'Resources & help' });
    expect(nav).toBeInTheDocument();
    // The links live inside a semantic list within the nav landmark.
    const list = within(nav).getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders exactly three resource links, each with a title and description', () => {
    renderPanel();

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);

    expect(screen.getByText('Tesla account')).toBeInTheDocument();
    expect(screen.getByText('Connect or manage your Fleet API access.')).toBeInTheDocument();
    expect(screen.getByText('Fleet Telemetry setup guide')).toBeInTheDocument();
    expect(screen.getByText('Configure streaming so live data starts arriving.')).toBeInTheDocument();
    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Guides, reference, and troubleshooting.')).toBeInTheDocument();
  });

  it('routes the Tesla account link through the SPA router (internal, no new tab)', () => {
    renderPanel();

    const link = screen.getByRole('link', { name: /Tesla account/i });
    expect(link).toHaveAttribute('href', '/tesla-account');
    // Internal SPA links must NOT open a new tab and must NOT be external.
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
    expect(link).not.toHaveAccessibleName(/opens in a new tab/i);
  });

  it('opens the setup guide as an external link in a new tab with a safe rel', () => {
    renderPanel();

    const link = screen.getByRole('link', { name: /Fleet Telemetry setup guide/i });
    expect(link).toHaveAttribute('href', '/docs/fleet-telemetry-setup');
    expect(link).toHaveAttribute('target', '_blank');
    // Guard against reverse-tabnabbing (WCAG / security best practice).
    const rel = link.getAttribute('rel') ?? '';
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });

  it('opens the documentation as an external link in a new tab', () => {
    renderPanel();

    const link = screen.getByRole('link', { name: /Documentation/i });
    expect(link).toHaveAttribute('href', '/docs/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('announces to screen readers that external links open a new tab (WCAG G201)', () => {
    renderPanel();

    // The visually-hidden hint is appended only to the external links'
    // accessible names, never to the internal one.
    expect(
      screen.getByRole('link', { name: /Fleet Telemetry setup guide/i }),
    ).toHaveAccessibleName(/opens in a new tab/i);
    expect(
      screen.getByRole('link', { name: /Documentation/i }),
    ).toHaveAccessibleName(/opens in a new tab/i);
    expect(
      screen.getByRole('link', { name: /Tesla account/i }),
    ).not.toHaveAccessibleName(/opens in a new tab/i);
  });

  it('marks every decorative icon as aria-hidden so none pollute the a11y tree', () => {
    const { container } = renderPanel();

    const svgs = Array.from(container.querySelectorAll('svg'));
    // 3 leading IconBox glyphs + 3 trailing affordances + 1 privacy shield.
    expect(svgs).toHaveLength(7);
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));
  });

  it('keeps every link keyboard-focusable with a visible focus ring', () => {
    renderPanel();

    const links = screen.getAllByRole('link');
    links.forEach((link) => {
      expect(link.tagName).toBe('A');
      link.focus();
      expect(link).toHaveFocus();
      // WCAG 2.4.7 — keyboard focus is visibly indicated.
      expect(link.className).toContain('focus-visible:ring-2');
    });
  });

  it('activates the internal link on click without throwing', () => {
    renderPanel();

    const link = screen.getByRole('link', { name: /Tesla account/i });
    // Clicking a router <Link> should be handled by react-router, not a
    // full-page navigation. The assertion is that the href resolves to the
    // internal route and the click is a no-throw interaction.
    fireEvent.click(link);
    expect(link).toHaveAttribute('href', '/tesla-account');
  });

  it('forwards a custom className onto the GlassPanel root', () => {
    const { container } = renderPanel({ className: 'apex-test-class' });
    const root = container.querySelector('.apex-test-class');
    expect(root).not.toBeNull();
    // The default padding utilities are preserved alongside the override.
    expect(root?.className).toContain('p-4');
  });

  it('renders without a className prop (default branch)', () => {
    renderPanel();
    // Still renders the full set of links when no className is supplied.
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });
});
