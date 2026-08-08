/**
 * OrderCard — the per-order tile rendered across the Tesla Orders board.
 *
 * The contract pinned here exercises every branch of the card:
 *   • a fully-populated, upgradable order renders the model, a title-cased
 *     status badge, the order id, an assigned VIN and a formatted delivery date,
 *     plus the "Upgrade available" affordance;
 *   • the raw status is mapped onto the canonical <Badge> variant via
 *     `orderStatusVariant` — DELIVERED→success, IN_PRODUCTION→warning,
 *     CANCELED→danger, unknown→neutral — and READY_FOR_DELIVERY resolves to the
 *     *ready* (info) tone even though it contains "DELIVER", proving the bucket
 *     precedence flows through the card;
 *   • the delivery cell forwards its raw ISO string to the formatter verbatim
 *     and shows an em-dash (never invoking the formatter) when the date is null;
 *   • the VIN shows as a mono value with a truncation title when assigned and a
 *     "Not assigned" placeholder otherwise;
 *   • the upgrade affordance is present only when `is_upgradable`;
 *   • null-safety: an empty model and an empty order_id each degrade to an
 *     em-dash placeholder (never a blank cell), the empty order_id carries no
 *     dangling title tooltip, and the empty model is reflected in the card's
 *     accessible name;
 *   • a11y: the card is a single labelled role="group" and every decorative
 *     lucide glyph is aria-hidden.
 *
 * `useDateFormat` is stubbed so `formatDate` echoes a deterministic, timezone-
 * stable token and we can assert its argument is forwarded unmodified.
 * react-i18next is mocked to echo the English fallback and interpolate
 * `{{token}}` placeholders so the aria-label is deterministic. framer-motion is
 * mocked to a passthrough because the `@/components/ui` barrel this file pulls
 * in ships motion-driven components; the mock keeps module load hermetic even
 * though OrderCard renders no motion itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { TeslaOrder } from '@/api/hooks/useUser';

// Deterministic date formatting: the real useDateFormat threads user settings +
// timezone; stubbing it pins that `formatDate` receives the raw ISO string
// verbatim and lets us assert an exact, timezone-stable delivery cell.
const { formatDate } = vi.hoisted(() => ({
  formatDate: vi.fn((value: unknown) => `fmt:${String(value)}`),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div';
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { OrderCard } from './OrderCard';
import { BADGE_VARIANTS } from '@/components/ui';

/** Build a well-formed order; every field is overridable per case. */
function makeOrder(over: Partial<TeslaOrder> = {}): TeslaOrder {
  return {
    id: 1,
    order_id: 'RN-1001',
    model: 'Model 3',
    status: 'DELIVERED',
    delivery_date: '2026-08-01T00:00:00Z',
    vin: '5YJ3E1EA-TEST',
    referral_code: null,
    is_upgradable: false,
    fetched_at: '2026-07-01T00:00:00Z',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-15T00:00:00Z',
    ...over,
  };
}

function renderCard(over: Partial<TeslaOrder> = {}) {
  return render(<OrderCard order={makeOrder(over)} />);
}

/** The card advertises itself as a single labelled group. */
function card(): HTMLElement {
  return screen.getByRole('group');
}

beforeEach(() => {
  formatDate.mockClear();
});

describe('OrderCard', () => {
  it('renders every facet of a fully-populated, upgradable order', () => {
    renderCard({
      model: 'Model Y',
      status: 'DELIVERED',
      order_id: 'RN-42',
      vin: 'VIN-ABC',
      delivery_date: '2026-09-09T00:00:00Z',
      is_upgradable: true,
    });

    // Model + status badge.
    expect(screen.getByText('Model Y')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    // Definition-list labels.
    expect(screen.getByText('Order ID')).toBeInTheDocument();
    expect(screen.getByText('VIN')).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    // Values.
    expect(screen.getByText('RN-42')).toBeInTheDocument();
    expect(screen.getByText('VIN-ABC')).toBeInTheDocument();
    expect(screen.getByText('fmt:2026-09-09T00:00:00Z')).toBeInTheDocument();
    // Upgrade affordance.
    expect(screen.getByText('Upgrade available')).toBeInTheDocument();
  });

  it('maps each lifecycle status onto its canonical Badge variant and title-cases the label', () => {
    const cases = [
      { status: 'DELIVERED', label: 'Delivered', bg: 'bg-green-100' },
      { status: 'IN_PRODUCTION', label: 'In Production', bg: 'bg-yellow-100' },
      { status: 'CANCELED', label: 'Canceled', bg: 'bg-red-100' },
      // READY_FOR_DELIVERY contains "DELIVER" but READY wins → info, not success.
      { status: 'READY_FOR_DELIVERY', label: 'Ready For Delivery', bg: 'bg-blue-100' },
      { status: 'WEIRD_STATE', label: 'Weird State', bg: BADGE_VARIANTS.neutral },
    ] as const;

    for (const c of cases) {
      const { unmount } = renderCard({ status: c.status });
      const badge = screen.getByText(c.label);
      expect(badge.className).toContain(c.bg);
      unmount();
    }
  });

  it('forwards the raw delivery_date to the formatter verbatim and renders its result', () => {
    renderCard({ delivery_date: '2026-12-31T23:59:00Z' });

    expect(formatDate).toHaveBeenCalledWith('2026-12-31T23:59:00Z');
    expect(screen.getByText('fmt:2026-12-31T23:59:00Z')).toBeInTheDocument();
  });

  it('shows an em-dash and never calls the formatter when there is no delivery date', () => {
    renderCard({ delivery_date: null });

    expect(formatDate).not.toHaveBeenCalled();
    // Model + order id are present, so the only placeholder is the delivery cell.
    const dash = screen.getByText('—');
    expect(dash.tagName).toBe('DD');
  });

  it('renders the VIN as a mono value with a truncation title when assigned', () => {
    renderCard({ vin: '5YJ3-LONG-VIN' });

    const vin = screen.getByText('5YJ3-LONG-VIN');
    expect(vin).toHaveAttribute('title', '5YJ3-LONG-VIN');
    expect(screen.queryByText('Not assigned')).toBeNull();
  });

  it('falls back to a "Not assigned" placeholder when the VIN is missing', () => {
    renderCard({ vin: null });

    expect(screen.getByText('Not assigned')).toBeInTheDocument();
    expect(screen.queryByText('5YJ3E1EA-TEST')).toBeNull();
  });

  it('shows the upgrade affordance only when the order is upgradable', () => {
    const { unmount } = renderCard({ is_upgradable: true });
    expect(screen.getByText('Upgrade available')).toBeInTheDocument();
    unmount();

    renderCard({ is_upgradable: false });
    expect(screen.queryByText('Upgrade available')).toBeNull();
  });

  it('is null-safe: an empty model degrades to a placeholder in the tile and its aria-label', () => {
    renderCard({ model: '', status: 'IN_PRODUCTION' });

    // Order id + delivery are present, so the model span is the only em-dash.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(card()).toHaveAttribute('aria-label', '— order, In Production');
  });

  it('is null-safe: an empty order_id renders a placeholder with no dangling title (no blank cell)', () => {
    renderCard({ order_id: '' });

    const dd = screen.getByText('—');
    expect(dd.tagName).toBe('DD');
    // The placeholder must not carry an empty title tooltip.
    expect(dd).not.toHaveAttribute('title');
  });

  it('exposes a labelled group and hides its decorative icons from assistive tech (a11y)', () => {
    renderCard({ model: 'Model S', status: 'DELIVERED', is_upgradable: true });

    const group = card();
    expect(group).toHaveAttribute('aria-label', 'Model S order, Delivered');
    // Package + Fingerprint + Calendar + Sparkles are all decorative.
    expect(group.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(4);
  });
});
