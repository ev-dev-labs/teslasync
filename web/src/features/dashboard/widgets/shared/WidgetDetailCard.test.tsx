/**
 * WidgetDetailCard contract + hardening tests.
 *
 * WidgetDetailCard is a pure presentational tile primitive: it projects a list
 * of `DetailEntry` label/value rows (each optionally carrying a status badge and
 * a monospace flag) into an accessible description list, and falls back to an
 * accessible empty state when there is nothing to show. Its whole shape is a
 * function of three inputs — the `entries` array, the `compact` flag, and the
 * `emptyMessage`/`emptyIcon` empty-state overrides.
 *
 * The suite locks, facet by facet:
 *   1. Empty state: the default i18n copy + `role="status"`, the custom message
 *      + icon overrides, and — critically — the null-safety guard where a nullish
 *      `entries` (undefined/null slipping through a loosely-typed call site) must
 *      degrade to the empty state instead of throwing on `.length`.
 *   2. Populated rows: every label + value renders inside a semantic
 *      `<dl>/<dt>/<dd>` structure (one term + one definition per entry).
 *   3. Value coalescing: a `null` value renders the em-dash placeholder while a
 *      `0` value is preserved verbatim (the classic `??` vs `||` correctness bug).
 *   4. Badges: the badge text renders and the DetailEntry→Badge variant remap is
 *      honoured end-to-end (`error`→danger palette, `success`→success palette),
 *      and an entry without a badge renders none.
 *   5. Compact mode: the row list is capped at the first four entries; the full
 *      view renders them all.
 *   6. Presentation details: the `mono` flag applies the monospace class and only
 *      the inter-row separators (n-1 of them) carry the divider border.
 *
 * i18n is stubbed to echo the English fallback so every copy assertion is real.
 * The component touches no network and no query client, so none is wired up.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

// i18n passthrough: honour the English fallback so every copy assertion is real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { WidgetDetailCard, type DetailEntry } from './WidgetDetailCard';

/** Build a typed entry with sensible defaults so cases stay terse. */
function entry(overrides: Partial<DetailEntry> & { label: string }): DetailEntry {
  return { value: 'value', ...overrides };
}

afterEach(() => {
  cleanup();
});

// ── Empty state ──────────────────────────────────────────────────────────────

describe('WidgetDetailCard — empty state', () => {
  it('renders the accessible default empty state when there are no entries', () => {
    const { container } = render(<WidgetDetailCard entries={[]} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No details available')).toBeInTheDocument();
    // No detail-list chrome when empty.
    expect(container.querySelector('dl')).toBeNull();
  });

  it('honours a custom empty message and icon over the default', () => {
    render(
      <WidgetDetailCard
        entries={[]}
        emptyMessage="Nothing linked yet"
        emptyIcon={<svg data-testid="empty-icon" />}
      />,
    );

    expect(screen.getByText('Nothing linked yet')).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    // The default copy must NOT leak through once an override is supplied.
    expect(screen.queryByText('No details available')).toBeNull();
  });

  it('null-safety: a nullish entries array degrades to the empty state, never throws', () => {
    // Guards a loosely-typed call site handing us `undefined`/`null` from
    // optional query data before `.length`/`.slice` can blow up.
    expect(() =>
      render(<WidgetDetailCard entries={undefined as unknown as DetailEntry[]} />),
    ).not.toThrow();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No details available')).toBeInTheDocument();

    cleanup();

    render(<WidgetDetailCard entries={null as unknown as DetailEntry[]} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ── Populated rows + a11y structure ──────────────────────────────────────────

describe('WidgetDetailCard — populated rows', () => {
  it('renders every label/value as a semantic term/definition pair', () => {
    const entries: DetailEntry[] = [
      entry({ label: 'Model', value: 'Model 3' }),
      entry({ label: 'Trim', value: 'Performance' }),
      entry({ label: 'Paint', value: 'Deep Blue' }),
    ];

    const { container } = render(<WidgetDetailCard entries={entries} />);

    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Model 3')).toBeInTheDocument();
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByText('Deep Blue')).toBeInTheDocument();

    // Semantic description list: one <dl>, one <dt> + one <dd> per entry.
    expect(container.querySelector('dl')).not.toBeNull();
    expect(container.querySelectorAll('dt')).toHaveLength(3);
    expect(container.querySelectorAll('dd')).toHaveLength(3);
  });
});

// ── Value coalescing (?? vs ||) ──────────────────────────────────────────────

describe('WidgetDetailCard — value coalescing', () => {
  it('renders an em dash for null but preserves a literal 0', () => {
    const entries: DetailEntry[] = [
      entry({ label: 'Missing', value: null }),
      entry({ label: 'Zero', value: 0 }),
      entry({ label: 'Text', value: 'hi' }),
    ];

    render(<WidgetDetailCard entries={entries} />);

    // null → placeholder; 0 must survive (would become '—' under a `||` bug).
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
    // Exactly one em dash — only the null-valued row uses it.
    expect(screen.getAllByText('—')).toHaveLength(1);
  });
});

// ── Badges + variant remap ───────────────────────────────────────────────────

describe('WidgetDetailCard — badges', () => {
  it('remaps DetailEntry badge variants onto the Badge palette', () => {
    const entries: DetailEntry[] = [
      entry({ label: 'Fault', value: 'Overheat', badge: { text: 'Critical', variant: 'error' } }),
      entry({ label: 'Health', value: 'Nominal', badge: { text: 'Good', variant: 'success' } }),
    ];

    render(<WidgetDetailCard entries={entries} />);

    // `error` must resolve to the danger palette, `success` to the success one.
    expect(screen.getByText('Critical').className).toContain('bg-red-100');
    expect(screen.getByText('Good').className).toContain('bg-green-100');
  });

  it('renders no badge when an entry omits one', () => {
    const { container } = render(
      <WidgetDetailCard entries={[entry({ label: 'Plain', value: 'x' })]} />,
    );

    // The rounded-full pill is the Badge's signature class.
    expect(container.querySelector('.rounded-full')).toBeNull();
  });
});

// ── Compact mode ─────────────────────────────────────────────────────────────

describe('WidgetDetailCard — compact mode', () => {
  const six: DetailEntry[] = Array.from({ length: 6 }, (_, i) =>
    entry({ label: `Row ${i + 1}`, value: i + 1 }),
  );

  it('caps the list at the first four entries when compact', () => {
    const { container } = render(<WidgetDetailCard entries={six} compact />);

    expect(container.querySelectorAll('dt')).toHaveLength(4);
    expect(screen.getByText('Row 4')).toBeInTheDocument();
    expect(screen.queryByText('Row 5')).toBeNull();
    expect(screen.queryByText('Row 6')).toBeNull();
  });

  it('renders every entry when not compact', () => {
    const { container } = render(<WidgetDetailCard entries={six} />);

    expect(container.querySelectorAll('dt')).toHaveLength(6);
    expect(screen.getByText('Row 6')).toBeInTheDocument();
  });
});

// ── Presentation details ─────────────────────────────────────────────────────

describe('WidgetDetailCard — presentation', () => {
  it('applies the monospace class only to entries flagged mono', () => {
    render(
      <WidgetDetailCard
        entries={[
          entry({ label: 'Firmware', value: '2024.44.25', mono: true }),
          entry({ label: 'Name', value: 'My Tesla' }),
        ]}
      />,
    );

    expect(screen.getByText('2024.44.25').className).toContain('font-mono');
    expect(screen.getByText('My Tesla').className).not.toContain('font-mono');
  });

  it('draws a divider between rows but not after the last one', () => {
    const { container } = render(
      <WidgetDetailCard
        entries={[
          entry({ label: 'A', value: 1 }),
          entry({ label: 'B', value: 2 }),
          entry({ label: 'C', value: 3 }),
        ]}
      />,
    );

    // n-1 separators for n rows: the final row omits the bottom border.
    expect(container.querySelectorAll('.border-b')).toHaveLength(2);

    // The last row (containing "C") carries no divider border.
    const lastRow = within(screen.getByText('C').closest('div') as HTMLElement);
    expect(lastRow.getByText('3')).toBeInTheDocument();
    expect((screen.getByText('C').closest('div') as HTMLElement).className).not.toContain('border-b');
  });
});
