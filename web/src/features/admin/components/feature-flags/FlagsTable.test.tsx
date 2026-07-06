/**
 * FlagsTable — feature-flag registry table contract.
 *
 * Two exported surfaces are pinned here, facet by facet:
 *
 *   `previewValue(value)` — the pure JSON-preview formatter:
 *     - primitives (null / undefined / boolean / number / string) map to
 *       distinct, quote-noise-free previews;
 *     - objects / arrays are JSON-encoded;
 *     - pathological inputs (giant blobs, circular refs, functions, symbols,
 *       bigint) never blow out the cell or throw — they elide or degrade to
 *       an em-dash.
 *
 *   `<FlagsTable/>` — the prop-driven table:
 *     - renders one row per flag with the value preview;
 *     - sorts by key ascending by default and flips to descending on header
 *       click;
 *     - fires onEdit / onAskDelete with the exact row for the row actions;
 *     - shows a loading placeholder vs an empty message depending on `loading`;
 *     - gives every row action a flag-specific, disambiguated accessible name,
 *       hides decorative icons, and advertises the current sort to AT;
 *     - never throws on a malformed (missing-key) row.
 *
 * react-i18next is stubbed to echo each call's default string (interpolating
 * `{{…}}` placeholders) so assertions match the shipped English copy without
 * booting the real i18n backend. Network is never touched — FlagsTable is a
 * pure presentational component.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const vars =
        typeof fallback === 'object' && fallback !== null
          ? (fallback as Record<string, unknown>)
          : opts;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name) =>
        name in vars ? String(vars[name]) : `{{${name}}}`,
      );
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { FlagsTable, previewValue } from './FlagsTable';
import type { FeatureFlagEntry } from '@/types/admin-diagnostics';

afterEach(() => cleanup());

function renderTable(overrides: Partial<React.ComponentProps<typeof FlagsTable>> = {}) {
  const props = {
    rows: [] as FeatureFlagEntry[],
    loading: false,
    onEdit: vi.fn(),
    onAskDelete: vi.fn(),
    ...overrides,
  };
  return { ...render(<FlagsTable {...props} />), props };
}

/** Ordered list of key-column text for every DATA row (header row dropped). */
function renderedKeys(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent?.trim() ?? '');
}

describe('previewValue', () => {
  it('maps primitives, null and undefined to distinct quote-clean previews', () => {
    expect(previewValue(null)).toBe('null');
    expect(previewValue(undefined)).toBe('—');
    expect(previewValue(true)).toBe('true');
    expect(previewValue(false)).toBe('false');
    expect(previewValue(0)).toBe('0');
    expect(previewValue(42)).toBe('42');
    // Strings keep JSON quoting so "42" (string) is distinguishable from 42.
    expect(previewValue('42')).toBe('"42"');
    expect(previewValue('on')).toBe('"on"');
  });

  it('JSON-encodes objects and arrays', () => {
    expect(previewValue({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
    expect(previewValue([1, 2, 3])).toBe('[1,2,3]');
    expect(previewValue({})).toBe('{}');
  });

  it('elides over-long previews (both objects AND strings) to keep the cell compact', () => {
    const bigObject = previewValue({ note: 'x'.repeat(300) });
    expect(bigObject.length).toBeLessThanOrEqual(120);
    expect(bigObject.startsWith('{')).toBe(true);
    expect(bigObject.endsWith('…')).toBe(true);

    // Regression guard: a giant string value used to render un-truncated
    // because the string branch returned early before the length check.
    const bigString = previewValue('y'.repeat(300));
    expect(bigString.length).toBeLessThanOrEqual(120);
    expect(bigString.endsWith('…')).toBe(true);
  });

  it('degrades un-serialisable values to an em-dash instead of throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(previewValue(circular)).toBe('—');
    expect(previewValue(() => 42)).toBe('—');
    expect(previewValue(Symbol('flag'))).toBe('—');
    expect(previewValue(10n)).toBe('—');
    // And it never throws for any of those.
    expect(() => previewValue(circular)).not.toThrow();
  });
});

describe('FlagsTable', () => {
  it('renders one row per flag with its value preview and the three column headers', () => {
    const rows: FeatureFlagEntry[] = [
      { key: 'flag.bool', value: true },
      { key: 'flag.num', value: 42 },
      { key: 'flag.str', value: 'hello' },
      { key: 'flag.obj', value: { tier: 'gold' } },
      { key: 'flag.null', value: null },
    ];
    renderTable({ rows });

    // Header row + five data rows.
    expect(screen.getAllByRole('row')).toHaveLength(6);

    expect(screen.getByRole('columnheader', { name: 'Flag key' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();

    // Every key surfaces.
    expect(screen.getByText('flag.bool')).toBeInTheDocument();
    expect(screen.getByText('flag.obj')).toBeInTheDocument();

    // Value previews render through previewValue.
    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('"hello"')).toBeInTheDocument();
    expect(screen.getByText('{"tier":"gold"}')).toBeInTheDocument();
    expect(screen.getByText('null')).toBeInTheDocument();
  });

  it('sorts by key ascending by default and flips to descending on header click', () => {
    const rows: FeatureFlagEntry[] = [
      { key: 'zebra', value: 1 },
      { key: 'alpha', value: 2 },
      { key: 'mango', value: 3 },
    ];
    renderTable({ rows });

    expect(renderedKeys()).toEqual(['alpha', 'mango', 'zebra']);

    fireEvent.click(screen.getByRole('button', { name: 'Flag key' }));
    expect(renderedKeys()).toEqual(['zebra', 'mango', 'alpha']);
  });

  it('fires onEdit / onAskDelete with the exact clicked row', () => {
    const onEdit = vi.fn();
    const onAskDelete = vi.fn();
    const rows: FeatureFlagEntry[] = [
      { key: 'alpha.flag', value: 1 },
      { key: 'beta.flag', value: { nested: true } },
    ];
    renderTable({ rows, onEdit, onAskDelete });

    fireEvent.click(screen.getByRole('button', { name: 'Edit flag beta.flag' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith({ key: 'beta.flag', value: { nested: true } });

    fireEvent.click(screen.getByRole('button', { name: 'Delete flag alpha.flag' }));
    expect(onAskDelete).toHaveBeenCalledTimes(1);
    expect(onAskDelete).toHaveBeenCalledWith({ key: 'alpha.flag', value: 1 });
    // Deleting must not have also triggered an edit.
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('shows a loading placeholder while loading, then an empty message once settled', () => {
    const { unmount } = renderTable({ rows: [], loading: true });
    expect(screen.getByText('Loading flags…')).toBeInTheDocument();
    expect(
      screen.queryByText('No feature flags are set on this server.'),
    ).not.toBeInTheDocument();
    unmount();

    renderTable({ rows: [], loading: false });
    expect(
      screen.getByText('No feature flags are set on this server.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Loading flags…')).not.toBeInTheDocument();
  });

  it('gives row actions flag-specific accessible names, hides icons, and advertises sort state', () => {
    renderTable({ rows: [{ key: 'ai.enabled', value: true }] });

    const editBtn = screen.getByRole('button', { name: 'Edit flag ai.enabled' });
    const deleteBtn = screen.getByRole('button', { name: 'Delete flag ai.enabled' });
    expect(editBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();
    // Disambiguated names — the two actions never share a generic "Edit".
    expect(editBtn).not.toBe(deleteBtn);

    // Decorative lucide icons are hidden from the accessibility tree.
    expect(editBtn.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(deleteBtn.querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    // The sortable key column tells assistive tech it is currently ascending.
    expect(screen.getByRole('columnheader', { name: 'Flag key' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('never throws when a row is missing its key (null-safe sort + render)', () => {
    const rows: FeatureFlagEntry[] = [
      { key: 'present.key', value: 1 },
      // Malformed row from a stale / partial payload.
      { key: undefined as unknown as string, value: 2 },
    ];
    expect(() => renderTable({ rows })).not.toThrow();
    expect(screen.getByText('present.key')).toBeInTheDocument();
    // Both data rows still render (header + 2).
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});
