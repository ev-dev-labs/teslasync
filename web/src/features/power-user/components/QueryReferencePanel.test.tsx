// Behavioural contract for <QueryReferencePanel>.
//
// The panel is a purely presentational, read-only helper shown beside the SQL
// editor. It has no data fetching or query execution, so the surface area under
// test is: the guidance copy (routed through i18n), the four tips list, the
// read-only status callout, the copy-ready SQL example, and the accessibility
// invariants (decorative glyphs hidden, only a copy control, a captioned
// figure for the example).
//
// react-i18next is mocked so `t(key, fallback)` is deterministic: it returns a
// per-test override when present, otherwise the English fallback. This lets us
// prove the component routes its copy through i18n (rather than hardcoding
// English) without depending on the global i18n bundle.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { translations } = vi.hoisted(() => ({
  translations: {} as Record<string, string>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) =>
      translations[key] ?? defaultValue ?? key,
  }),
}));

import { QueryReferencePanel } from './QueryReferencePanel';

// The literal example is intentionally hard-coded in the source (it is SQL
// code, not translatable prose); mirror it here to assert newline fidelity.
const EXPECTED_SQL =
  "SELECT COUNT(*)\nFROM drives\nWHERE started_at >= NOW() - INTERVAL '7 days'";

beforeEach(() => {
  for (const k of Object.keys(translations)) delete translations[k];
});

afterEach(() => {
  cleanup();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe('QueryReferencePanel', () => {
  it('renders the titled read-only surface with every guidance tip', () => {
    render(<QueryReferencePanel />);

    // Titled panel — the FileCode glyph is decorative so the accessible name
    // is just the heading copy.
    expect(
      screen.getByRole('heading', { name: /working with queries/i }),
    ).toBeInTheDocument();

    // The read-only notice is a polite status region, not a bare paragraph.
    expect(screen.getByRole('status')).toHaveTextContent(
      /read-only composing surface/i,
    );

    // All four tips render as a single list.
    expect(screen.getByRole('list')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);

    // Each distinct tip is present (guards against a truncated/duplicated map).
    expect(screen.getByText(/exact column names/i)).toBeInTheDocument();
    expect(screen.getByText(/stored in SI/i)).toBeInTheDocument();
    expect(screen.getByText(/psql, DBeaver/i)).toBeInTheDocument();
    expect(screen.getByText(/Helix enabled/i)).toBeInTheDocument();
  });

  it('presents the copy-ready SQL example inside a captioned figure', () => {
    render(<QueryReferencePanel />);

    const figure = screen.getByRole('figure');
    expect(figure).toBeInTheDocument();

    // The caption is a real <figcaption> associated with the figure.
    const caption = figure.querySelector('figcaption');
    expect(caption).toHaveTextContent('Example');

    // Whitespace-collapsed content check for the query shape…
    expect(figure).toHaveTextContent(/SELECT COUNT\(\*\)/);
    expect(figure).toHaveTextContent(/FROM drives/);
    expect(figure).toHaveTextContent(/INTERVAL '7 days'/);

    // …and the <pre> preserves the literal newlines verbatim.
    const pre = figure.querySelector('pre');
    expect(pre?.textContent).toBe(EXPECTED_SQL);
  });

  it('offers only the example copy action, never query execution, with decorative glyphs hidden from AT', () => {
    const { container } = render(<QueryReferencePanel />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    // The heading icon is decorative and must be hidden from assistive tech.
    const heading = screen.getByRole('heading', {
      name: /working with queries/i,
    });

    expect(heading.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    // Title icon + four bullet markers (+ callout icon wrapper) are all hidden.
    expect(
      container.querySelectorAll('[aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('keeps the complete SQL example selectable after denial and retries the exact payload', async () => {
    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<QueryReferencePanel />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/Select the text manually/)).toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toBe(EXPECTED_SQL);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.queryByText(/Select the text manually/)).toBeNull());
    expect(writeText.mock.calls).toEqual([[EXPECTED_SQL], [EXPECTED_SQL]]);
  });

  it('routes visible copy through i18n so locale overrides win over the English fallback', () => {
    translations['powerSql.info.title'] = 'Trabajando con consultas';
    translations['powerSql.info.readonly'] =
      'Superficie de solo lectura. Nada se ejecuta.';

    render(<QueryReferencePanel />);

    expect(
      screen.getByRole('heading', { name: 'Trabajando con consultas' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Superficie de solo lectura. Nada se ejecuta.',
    );
    // The hardcoded English string must NOT leak when a translation exists.
    expect(screen.queryByText('Working with queries')).not.toBeInTheDocument();
  });
});
