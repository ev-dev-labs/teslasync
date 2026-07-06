/**
 * AdvancedSettings — "Restore confirmation prompts" panel.
 *
 * The panel is backed entirely by the localStorage-based
 * `@/lib/confirmSilence` store (there is no network involved), so these
 * tests drive the *real* library through jsdom's localStorage and assert
 * the full round trip rather than mocking the store:
 *
 *   • useSilenceKeyLabel maps known ids → friendly labels, passes unknown
 *     ids through verbatim (forward-compat branch), and returns a stable
 *     callback across re-renders.
 *   • The panel renders an accessible empty state when nothing is silenced
 *     and hides the "Restore all" affordance.
 *   • Seeding silenced ids renders one labelled row each, plus a
 *     descriptive, disambiguated per-row Restore control (a11y).
 *   • Restoring one id / all ids mutates the store and re-renders the panel.
 *
 * react-i18next is stubbed (as in ResetSection.test.tsx) to return the
 * English default value and to interpolate {{name}}, so assertions read
 * against real user-visible copy. The stub's `t` is a single stable
 * reference so the useCallback-stability assertion is meaningful.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  // Single stable `t` reference so hooks that depend on it (useCallback)
  // don't see a fresh identity every render.
  const t = (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
    const fallback =
      typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
    const opts =
      typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
        ? (fallbackOrOpts as Record<string, unknown>)
        : (maybeOpts as Record<string, unknown> | undefined);
    let result = fallback ?? key;
    if (opts) {
      for (const [k, v] of Object.entries(opts)) {
        result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
      }
    }
    return result;
  };
  const i18n = { language: 'en', changeLanguage: vi.fn() };
  return {
    ...actual,
    useTranslation: () => ({ t, i18n }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import {
  silence,
  listSilenced,
  _STORAGE_KEY_INTERNAL,
} from '@/lib/confirmSilence';
import { AdvancedSettings, useSilenceKeyLabel } from './AdvancedSettings';

beforeEach(() => {
  // The store is localStorage-backed and jsdom persists it within a file,
  // so wipe it to keep each case hermetic.
  localStorage.clear();
});

describe('useSilenceKeyLabel', () => {
  it('maps the known silence keys to friendly labels', () => {
    const { result } = renderHook(() => useSilenceKeyLabel());
    expect(result.current('discard-draft')).toBe('Discard unsaved draft');
    expect(result.current('unsaved-navigation')).toBe(
      'Leave page with unsaved changes',
    );
  });

  it('passes unknown/empty keys through verbatim (forward-compat)', () => {
    const { result } = renderHook(() => useSilenceKeyLabel());
    expect(result.current('remove-widget')).toBe('remove-widget');
    expect(result.current('')).toBe('');
  });

  it('returns a referentially stable callback across re-renders', () => {
    const { result, rerender } = renderHook(() => useSilenceKeyLabel());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('AdvancedSettings — empty state', () => {
  it('renders the panel heading and helper copy', () => {
    render(<AdvancedSettings />);
    expect(
      screen.getByRole('heading', { name: 'Confirmation prompts' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Re-enable .*prompts you previously silenced/i),
    ).toBeInTheDocument();
  });

  it('shows an accessible empty state and hides "Restore all"', () => {
    render(<AdvancedSettings />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/No silenced prompts/i);
    expect(
      screen.queryByRole('button', { name: 'Restore all' }),
    ).not.toBeInTheDocument();
    // Nothing seeded → no list rendered at all.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('AdvancedSettings — with silenced prompts', () => {
  beforeEach(() => {
    silence('discard-draft');
    silence('unsaved-navigation');
  });

  it('renders one labelled row per silenced id plus the "Restore all" action', () => {
    render(<AdvancedSettings />);
    expect(screen.getByText('Discard unsaved draft')).toBeInTheDocument();
    expect(
      screen.getByText('Leave page with unsaved changes'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Restore all' }),
    ).toBeInTheDocument();
    // The empty state must be gone once rows exist.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('gives each per-row control a disambiguated accessible name', () => {
    render(<AdvancedSettings />);
    // Both rows share the visible text "Restore"; the aria-label must name
    // the specific prompt so screen-reader users can tell them apart.
    expect(
      screen.getByRole('button', { name: 'Restore Discard unsaved draft' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Restore Leave page with unsaved changes',
      }),
    ).toBeInTheDocument();
  });

  it('restores a single prompt and removes only that row', () => {
    render(<AdvancedSettings />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Restore Discard unsaved draft' }),
    );
    // Store updated…
    expect(listSilenced()).toEqual(['unsaved-navigation']);
    // …and only that row disappears; the sibling survives.
    expect(screen.queryByText('Discard unsaved draft')).not.toBeInTheDocument();
    expect(
      screen.getByText('Leave page with unsaved changes'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('restores every prompt and falls back to the empty state', () => {
    render(<AdvancedSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore all' }));
    expect(listSilenced()).toEqual([]);
    // clearAllSilenced removes the storage key entirely.
    expect(localStorage.getItem(_STORAGE_KEY_INTERNAL)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/No silenced prompts/i);
    expect(
      screen.queryByRole('button', { name: 'Restore all' }),
    ).not.toBeInTheDocument();
  });

  it('renders unknown/forward-compat ids by their raw id', () => {
    silence('brand-new-prompt');
    render(<AdvancedSettings />);
    // No friendly label exists → the raw id is shown, and its restore
    // control is still uniquely named.
    expect(screen.getByText('brand-new-prompt')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Restore brand-new-prompt' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
