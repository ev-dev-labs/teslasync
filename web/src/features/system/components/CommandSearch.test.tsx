/**
 * CommandSearch — behaviour, accessibility, and null-safety coverage.
 *
 * The file exports a single controlled component (`CommandSearch`) that wraps
 * the shared <Input> as the search box for the vehicle command palette. These
 * specs cover:
 *
 *   1. Accessibility — the control exposes an explicit `searchbox` role with an
 *      accessible name (fixes the a11y-audit finding for the previously
 *      icon-only, unlabelled field), and the decorative magnifier icon is
 *      hidden from assistive technology.
 *   2. Placeholder — the translated placeholder renders verbatim.
 *   3. Controlled value — the `value` prop is reflected exactly, and a stray
 *      null/undefined degrades to an empty string (the `?? ''` guard) so the
 *      input never flips from controlled to uncontrolled.
 *   4. onChange wiring — typing forwards the raw string (not the DOM event),
 *      clearing forwards '', and nothing fires on the initial render.
 *
 * `react-i18next` is pinned to return the developer fallback string so the
 * accessible name / placeholder resolve deterministically without loading a
 * namespace. Interactions use `fireEvent` — the repo convention
 * (`@testing-library/user-event` is not a dependency). Network is never
 * touched: the component takes plain props and reaches no hooks/clients.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CommandSearch } from './CommandSearch';

// i18n → return the developer fallback (second arg) so both the placeholder
// and the aria-label resolve to concrete, assertable strings.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

function renderSearch(props: { value?: string; onChange?: (value: string) => void } = {}) {
  const onChange = props.onChange ?? vi.fn();
  const value = props.value ?? '';
  const utils = render(<CommandSearch value={value} onChange={onChange} />);
  return { ...utils, onChange };
}

describe('CommandSearch', () => {
  it('renders an accessible search box with a name, type, and placeholder', () => {
    renderSearch();

    const box = screen.getByRole('searchbox', { name: 'Search commands' });
    expect(box).toBeInTheDocument();
    expect(box).toHaveAttribute('type', 'search');
    expect(box).toHaveAttribute('placeholder', 'Search commands...');
  });

  it('hides the decorative magnifier icon from assistive technology', () => {
    const { container } = renderSearch();

    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('reflects the controlled value verbatim', () => {
    renderSearch({ value: 'honk' });

    expect(screen.getByRole('searchbox')).toHaveValue('honk');
  });

  it('forwards the raw typed string (not the DOM event) to onChange', () => {
    const { onChange } = renderSearch({ value: '' });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'flash' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('flash');
  });

  it('forwards an empty string when the field is cleared', () => {
    const { onChange } = renderSearch({ value: 'wake' });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('does not call onChange on the initial render', () => {
    const { onChange } = renderSearch({ value: 'idle' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('degrades a null/undefined value to a controlled empty string', () => {
    // Callers are typed to pass a string, but the defensive `?? ''` keeps the
    // input controlled (no React uncontrolled→controlled warning) if a stray
    // undefined ever slips through.
    render(<CommandSearch value={undefined as unknown as string} onChange={vi.fn()} />);

    expect(screen.getByRole('searchbox')).toHaveValue('');
  });
});
