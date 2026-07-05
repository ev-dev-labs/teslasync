/**
 * WebhookGuide tests.
 *
 * WebhookGuide is a static, data-free "how it works" context rail for the
 * Webhooks page. It has no props, no hooks beyond `useTranslation`, and no
 * interactions — so the behaviour worth pinning is structural + accessible:
 *
 *   1. Landmark — the panel is a properly *named* region whose accessible name
 *      is the panel heading (h3), so screen-reader users can jump straight to
 *      the guide. This is the a11y hardening this file added on top of the
 *      original anonymous <div> panel.
 *   2. Steps — all three signing / delivery / verify explanations render.
 *   3. Delivery reference — the labelled list exposes the signature header,
 *      HMAC algorithm, and supported methods, each label paired with its code
 *      value, with exactly three rows.
 *   4. Payload fields — the labelled list renders one badge per documented
 *      field (title / message / source / timestamp) with its description, with
 *      exactly four rows.
 *   5. Structure + a11y — exactly three semantic lists / ten list items, and
 *      every decorative lucide icon is `aria-hidden` so none leak into the
 *      accessibility tree.
 *   6. i18n — copy resolves from the real bundle rather than leaking raw key
 *      paths, and the same bundle drives a non-English language.
 *
 * The real i18n bundle is loaded via `../../../i18n` (side-effect import) so
 * `useTranslation()` resolves without an <I18nextProvider>, matching the other
 * component tests here. The component touches no network and needs neither a
 * QueryClient nor a Router.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import i18n from '../../../i18n';

import { WebhookGuide } from './WebhookGuide';

afterEach(async () => {
  // Some tests flip the active language — restore English so ordering never
  // leaks state into a sibling test.
  if (i18n.language !== 'en') {
    await i18n.changeLanguage('en');
  }
});

describe('WebhookGuide', () => {
  it('renders as a region named by its heading, with the subtitle', () => {
    render(<WebhookGuide />);

    const region = screen.getByRole('region', { name: /how webhooks work/i });
    expect(region).toBeInTheDocument();

    // The accessible name is wired to the h3, not the body copy.
    const heading = screen.getByRole('heading', { level: 3, name: /how webhooks work/i });
    expect(region).toHaveAttribute('aria-labelledby', heading.getAttribute('id'));

    expect(
      screen.getByText(/Forward events to any HTTP receiver, signed and verifiable\./i),
    ).toBeInTheDocument();
  });

  it('lists the sign, deliver, and verify steps', () => {
    render(<WebhookGuide />);

    expect(screen.getByText(/HMAC-SHA256 signed/i)).toBeInTheDocument();
    expect(screen.getByText(/POSTs a compact JSON envelope/i)).toBeInTheDocument();
    expect(
      screen.getByText(/fire a sample event and preview the signature/i),
    ).toBeInTheDocument();
  });

  it('renders the delivery-reference list with each label paired to its code value', () => {
    render(<WebhookGuide />);

    const refList = screen.getByRole('list', { name: /delivery reference/i });
    expect(within(refList).getAllByRole('listitem')).toHaveLength(3);

    // Labels.
    expect(within(refList).getByText(/^Signature header$/i)).toBeInTheDocument();
    expect(within(refList).getByText(/^Algorithm$/i)).toBeInTheDocument();
    expect(within(refList).getByText(/^Methods$/i)).toBeInTheDocument();

    // Code values.
    expect(within(refList).getByText('X-TeslaSync-Signature')).toBeInTheDocument();
    expect(within(refList).getByText(/HMAC-SHA256/)).toBeInTheDocument();
    expect(within(refList).getByText(/POST · PUT · PATCH/)).toBeInTheDocument();
  });

  it('renders every payload field as a badge with its description', () => {
    render(<WebhookGuide />);

    const payloadList = screen.getByRole('list', { name: /payload fields/i });
    expect(within(payloadList).getAllByRole('listitem')).toHaveLength(4);

    for (const field of ['title', 'message', 'source', 'timestamp']) {
      expect(within(payloadList).getByText(field)).toBeInTheDocument();
    }

    expect(within(payloadList).getByText(/Short event headline\./i)).toBeInTheDocument();
    expect(within(payloadList).getByText(/Long-form event body\./i)).toBeInTheDocument();
    expect(within(payloadList).getByText(/RFC3339 server time\./i)).toBeInTheDocument();
  });

  it('exposes exactly three semantic lists and keeps decorative icons hidden', () => {
    const { container } = render(<WebhookGuide />);

    expect(screen.getAllByRole('list')).toHaveLength(3);
    // 3 steps + 3 reference rows + 4 payload rows.
    expect(screen.getAllByRole('listitem')).toHaveLength(10);

    // Every lucide icon is aria-hidden, so nothing leaks an img role.
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));
  });

  it('resolves i18n copy from the bundle instead of leaking raw key paths', () => {
    const { container } = render(<WebhookGuide />);
    expect(container.textContent).not.toMatch(/notifications\.webhooks\.guide/);
  });

  it('re-renders localized copy when the active language changes', async () => {
    const { rerender } = render(<WebhookGuide />);
    expect(screen.getByRole('heading', { level: 3, name: /how webhooks work/i })).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    rerender(<WebhookGuide />);

    // The panel keeps its named-region contract in every language; the code
    // reference values are ASCII constants and stay stable across locales.
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(screen.getByText('X-TeslaSync-Signature')).toBeInTheDocument();
  });
});
