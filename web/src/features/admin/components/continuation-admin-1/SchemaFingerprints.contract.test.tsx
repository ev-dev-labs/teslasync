import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchemaFingerprints } from './SchemaFingerprints';
import type { SchemaSectionState } from './schemaPresentation';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);
      return text.replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));

const CURRENT_HASH = '0123456789abcdef'.repeat(4);
const EXPECTED_HASH = 'fedcba9876543210'.repeat(4);
const MANUAL_HINT = 'Clipboard unavailable. Select the displayed text and copy it manually.';
const preferences = getFormatterPreferences();
const writeText = vi.fn<(text: string) => Promise<void>>();
const onRetry = vi.fn();
const state: SchemaSectionState = {
  drift: {
    has_drift: true,
    current: { sha256: CURRENT_HASH, table_count: 1234, column_count: 0, index_count: 48 },
    expected: { sha256: EXPECTED_HASH, table_count: 1231, column_count: 0, index_count: 49 },
    table_count_delta: 3,
    column_count_delta: 0,
    index_count_delta: -1,
    expected_generated_at: '2026-01-01T00:00:00Z',
  },
  isLoading: false,
  error: null,
  onRetry,
};

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  onRetry.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('navigator', Object.create(navigator, {
    clipboard: { configurable: true, value: { writeText } },
  }));
  setGlobalLocale('en-US');
  setGlobalPrecision(3);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setGlobalLocale(preferences.locale);
  setGlobalPrecision(preferences.precision);
});

describe('SchemaFingerprints copy and responsive contract', () => {
  it.each([
    { name: 'current', index: 0, hash: CURRENT_HASH },
    { name: 'expected', index: 1, hash: EXPECTED_HASH },
  ])('copies the byte-exact $name hash and preserves the success announcement', async ({ index, hash }) => {
    render(<SchemaFingerprints state={state} />);
    const trigger = screen.getAllByRole('button', { name: 'Copy fingerprint hash' })[index];
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getAllByRole('status')[index]).toHaveTextContent('Copied'));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(hash);
    expect(trigger).toHaveAccessibleName('Copy fingerprint hash');
    expect(screen.getByText(hash, { selector: 'code' }).textContent).toBe(hash);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(MANUAL_HINT)).not.toBeInTheDocument();
  });

  it.each([
    { name: 'current', index: 0, hash: CURRENT_HASH },
    { name: 'expected', index: 1, hash: EXPECTED_HASH },
  ])('shows visible failure and manual recovery only for the rejected $name hash', async ({ index, hash }) => {
    writeText.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    render(<SchemaFingerprints state={state} />);
    const trigger = screen.getAllByRole('button', { name: 'Copy fingerprint hash' })[index];
    fireEvent.click(trigger);
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Failed to copy');
    const card = error.closest('div.mb-3')?.parentElement;
    if (!card) throw new Error('Expected fingerprint card');
    expect(within(card).getByText(MANUAL_HINT)).toBeVisible();
    expect(within(card).getByText(hash, { selector: 'code' })).toHaveClass('select-text', 'break-all');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByRole('status')[index]).toBeEmptyDOMElement();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(hash);
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByText(MANUAL_HINT)).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')[index]).toHaveTextContent('Copied');
    expect(writeText.mock.calls).toEqual([[hash], [hash]]);
  });

  it('clears obsolete failure when refreshed fingerprint data replaces the hash', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    const { rerender } = render(<SchemaFingerprints state={state} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy fingerprint hash' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to copy');
    if (!state.drift) throw new Error('Expected drift fixture');
    const nextHash = 'abcd'.repeat(16);
    rerender(<SchemaFingerprints state={{
      ...state, drift: { ...state.drift, current: { ...state.drift.current, sha256: nextHash } },
    }} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy fingerprint hash' })[0]);
    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Copied'));
    expect(writeText.mock.calls).toEqual([[CURRENT_HASH], [nextHash]]);
    expect(screen.queryByText(CURRENT_HASH)).not.toBeInTheDocument();
  });

  it('keeps native keyboard copy controls, focus and non-submitting button semantics', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const submit = vi.fn();
    render(<form onSubmit={submit}><SchemaFingerprints state={state} /></form>);
    const controls = screen.getAllByRole('button', { name: 'Copy fingerprint hash' });
    await user.tab();
    expect(controls[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Copied'));
    expect(controls[0]).toHaveFocus();
    await user.tab();
    expect(controls[1]).toHaveFocus();
    await user.keyboard(' ');
    await waitFor(() => expect(screen.getAllByRole('status')[1]).toHaveTextContent('Copied'));
    expect(controls[1]).toHaveFocus();
    expect(writeText.mock.calls).toEqual([[CURRENT_HASH], [EXPECTED_HASH]]);
    expect(submit).not.toHaveBeenCalled();
    for (const control of controls) {
      expect(control.tagName).toBe('BUTTON');
      expect(control).toHaveAttribute('type', 'button');
      expect(control).toHaveClass('focus-visible:outline');
      expect(control.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('applies caller-owned 44px classes below md and restores compact desktop classes', () => {
    render(<SchemaFingerprints state={state} />);
    const controls = screen.getAllByRole('button', { name: 'Copy fingerprint hash' });
    expect(controls).toHaveLength(2);
    for (const control of controls) {
      expect(control).toHaveClass('h-11', 'min-h-11', 'min-w-11', 'md:h-9', 'md:min-h-9', 'md:min-w-0');
      expect(control).not.toHaveClass('h-9');
    }
  });

  it('preserves both hashes, integer counts, captured seed date and missing-hash disabling', () => {
    const { rerender } = render(<SchemaFingerprints state={state} />);
    expect(screen.getByRole('heading', { name: 'Schema fingerprints' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Expected (seed)' })).toBeInTheDocument();
    expect(screen.getByText(CURRENT_HASH, { selector: 'code' }).textContent).toBe(CURRENT_HASH);
    expect(screen.getByText(EXPECTED_HASH, { selector: 'code' }).textContent).toBe(EXPECTED_HASH);
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('1,231')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getByText('49')).toBeInTheDocument();
    expect(screen.getByText(/^Captured /)).toBeInTheDocument();
    expect(screen.queryByText('1,234.000')).not.toBeInTheDocument();
    if (!state.drift) throw new Error('Expected drift fixture');
    rerender(<SchemaFingerprints state={{
      ...state, drift: { ...state.drift, current: { ...state.drift.current, sha256: '' } },
    }} />);
    const controls = screen.getAllByRole('button', { name: 'Copy fingerprint hash' });
    expect(controls[0]).toBeDisabled();
    expect(controls[1]).toBeEnabled();
    fireEvent.click(controls[0]);
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByText('—', { selector: 'code' })).toBeInTheDocument();
  });

  it('preserves the section shell through loading, empty refresh and query-error recovery', () => {
    const { rerender } = render(<SchemaFingerprints state={{ ...state, drift: null, isLoading: true }} />);
    expect(screen.getByRole('heading', { name: 'Schema fingerprints' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy fingerprint hash' })).not.toBeInTheDocument();
    expect(screen.queryByText('No fingerprint available')).not.toBeInTheDocument();
    rerender(<SchemaFingerprints state={{ ...state, drift: null }} />);
    expect(screen.getByText('No fingerprint available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<SchemaFingerprints state={{ ...state, error: new Error('offline') }} />);
    expect(screen.getByRole('heading', { name: 'Schema fingerprints' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(2);
    rerender(<SchemaFingerprints state={state} />);
    expect(screen.getAllByRole('button', { name: 'Copy fingerprint hash' })).toHaveLength(2);
    expect(screen.getByText(CURRENT_HASH)).toBeInTheDocument();
  });
});
