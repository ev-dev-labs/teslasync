/**
 * QuietHoursGuide tests.
 *
 * QuietHoursGuide is a static, data-free "how it works" panel for the Quiet
 * hours page right rail. It takes no props and reads every string through
 * react-i18next, so the coverage here targets the facets that actually matter
 * for a presentational component:
 *
 *   1. structure     — the panel header (heading + subtitle) always renders.
 *   2. content       — all three how-it-works steps render with their copy.
 *   3. branches      — each severity row maps to the correct Badge variant
 *                      (danger/warning/info → red/yellow/blue) and description.
 *   4. a11y          — decorative icons are aria-hidden; the panel is a named
 *                      region; the severity legend's list is tied to its caption.
 *   5. i18n          — copy is translation-driven: an active-language override
 *                      replaces the default, and un-overridden keys fall back to
 *                      the inline English default.
 *
 * The component only depends on `useTranslation`, so a bare render() against the
 * shared i18n instance is enough — no QueryClient / Router / network scaffolding.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import '../../../i18n';
import i18n from '../../../i18n';

import { QuietHoursGuide } from './QuietHoursGuide';

afterEach(async () => {
  cleanup();
  // Guarantee language isolation between tests even if one switched it.
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

describe('QuietHoursGuide', () => {
  // Structure — the panel is never a blank surface: header title + subtitle
  // are always present. The title is the h3 panel heading.
  it('renders the panel heading and subtitle', () => {
    render(<QuietHoursGuide />);
    expect(
      screen.getByRole('heading', { level: 3, name: /how quiet hours work/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/defer non-critical alerts on your own schedule/i),
    ).toBeInTheDocument();
  });

  // Content — all three how-it-works steps render their copy, and the steps
  // list contains exactly three items (no dropped / duplicated rows).
  it('renders all three how-it-works steps in a three-item list', () => {
    render(<QuietHoursGuide />);
    expect(screen.getByText(/each window mutes non-critical notifications/i)).toBeInTheDocument();
    expect(screen.getByText(/severities on the "always allow" list still break through/i)).toBeInTheDocument();
    expect(screen.getByText(/helix can propose a window from your recent history/i)).toBeInTheDocument();

    // The list wrapping the first step should hold precisely three <li>s.
    const stepItem = screen.getByText(/each window mutes non-critical notifications/i).closest('li');
    const stepsList = stepItem?.closest('ul');
    expect(stepsList).not.toBeNull();
    expect(within(stepsList as HTMLElement).getAllByRole('listitem')).toHaveLength(3);
  });

  // Branches — each severity row renders its label with the correct Badge
  // variant colour plus its description. This exercises the variant→class
  // mapping, the one piece of conditional rendering in the component.
  it('maps each severity to the correct Badge variant and description', () => {
    render(<QuietHoursGuide />);

    const critical = screen.getByText('Critical');
    const warning = screen.getByText('Warning');
    const info = screen.getByText('Info');

    // danger / warning / info variants resolve to red / yellow / blue chips.
    expect(critical).toHaveClass('bg-red-100', 'text-red-800');
    expect(warning).toHaveClass('bg-yellow-100', 'text-yellow-800');
    expect(info).toHaveClass('bg-blue-100', 'text-blue-800');

    // Descriptions accompany each severity label.
    expect(screen.getByText(/urgent — usually always allowed/i)).toBeInTheDocument();
    expect(screen.getByText(/notable, non-urgent events/i)).toBeInTheDocument();
    expect(screen.getByText(/routine status updates/i)).toBeInTheDocument();
  });

  // a11y — the four glyphs (header + three steps) are decorative and must be
  // hidden from assistive tech so they are not announced as unlabelled images.
  it('hides all decorative icons from assistive technology', () => {
    const { container } = render(<QuietHoursGuide />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(4);
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));
  });

  // a11y — the whole panel exposes itself as a region landmark named by its
  // heading, giving screen-reader users a jump target for the guide.
  it('exposes the guide as a region labelled by its heading', () => {
    render(<QuietHoursGuide />);
    expect(
      screen.getByRole('region', { name: /how quiet hours work/i }),
    ).toBeInTheDocument();
  });

  // a11y — the severity legend's caption is a non-heading label, so the list
  // is programmatically associated with it via aria-labelledby. The named list
  // must hold exactly the three severity rows.
  it('associates the severity list with its "Severity levels" caption', () => {
    render(<QuietHoursGuide />);
    const list = screen.getByRole('list', { name: /severity levels/i });
    expect(list).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  // i18n — copy is fully translation-driven. When the active language provides
  // an override the panel renders it; keys without an override fall back to the
  // component's inline English default (proving nothing is hardcoded).
  it('renders active-language overrides and falls back to defaults otherwise', async () => {
    i18n.addResourceBundle(
      'zz',
      'translation',
      {
        notifications: {
          quietHours: {
            guide: {
              title: 'ZZ · How quiet hours work',
              severityCritical: 'ZZ · Critical',
            },
          },
        },
      },
      true,
      true,
    );
    try {
      await i18n.changeLanguage('zz');
      const { unmount } = render(<QuietHoursGuide />);

      // Overridden keys render the localized string...
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
        'ZZ · How quiet hours work',
      );
      expect(screen.getByText('ZZ · Critical')).toBeInTheDocument();

      // ...while an un-overridden key still shows the inline English default.
      expect(
        screen.getByText(/defer non-critical alerts on your own schedule/i),
      ).toBeInTheDocument();

      // Unmount before restoring the language so the switch does not trigger
      // an un-acted re-render of the still-mounted component.
      unmount();
    } finally {
      await i18n.changeLanguage('en');
      i18n.removeResourceBundle('zz', 'translation');
    }
  });
});
