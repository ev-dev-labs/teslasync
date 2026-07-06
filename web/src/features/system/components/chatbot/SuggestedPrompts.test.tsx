import type { ReactNode } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SuggestedPrompts, getChatSuggestions } from './SuggestedPrompts';

// Deterministic i18n: by default return the inline English fallback so the
// accessible names asserted below are stable regardless of the (uninitialised)
// i18n store. `t` is delegated to a hoisted holder so individual tests can
// swap in a translated / empty implementation to exercise the label branches.
const h = vi.hoisted(() => {
  const defaultT = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return { defaultT, t: defaultT };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => h.t(key, fallback),
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

beforeEach(() => {
  // Reset the translator between tests — a test that installs a bespoke `t`
  // must not leak into the next one.
  h.t = h.defaultT;
});

describe('getChatSuggestions', () => {
  it('returns the four static chips, each with a namespaced key and non-empty default', () => {
    const suggestions = getChatSuggestions();

    expect(suggestions).toHaveLength(4);
    for (const s of suggestions) {
      expect(typeof s.i18nKey).toBe('string');
      expect(s.i18nKey.startsWith('chatbot.suggestion.')).toBe(true);
      expect(typeof s.defaultValue).toBe('string');
      expect(s.defaultValue.trim().length).toBeGreaterThan(0);
    }
  });

  it('uses unique i18n keys so they are safe as React list keys', () => {
    const keys = getChatSuggestions().map((s) => s.i18nKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns a fresh array on each call (no shared mutable module state)', () => {
    const a = getChatSuggestions();
    const b = getChatSuggestions();

    // Different reference each call...
    expect(a).not.toBe(b);
    // ...but structurally identical content.
    expect(a).toEqual(b);
  });
});

describe('SuggestedPrompts', () => {
  it('renders a single labelled list with one button per suggestion', () => {
    render(<SuggestedPrompts onPick={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Suggested prompts' });
    expect(list).toBeInTheDocument();

    const expected = getChatSuggestions().map((s) => s.defaultValue);
    const buttons = within(list).getAllByRole('button');
    expect(buttons).toHaveLength(expected.length);

    for (const label of expected) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('forwards the exact chip text to onPick when a chip is clicked', () => {
    const onPick = vi.fn();
    render(<SuggestedPrompts onPick={onPick} />);

    const [first, second] = getChatSuggestions();

    fireEvent.click(screen.getByRole('button', { name: first.defaultValue }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(first.defaultValue);

    // Each chip carries its own captured text — the second click must not
    // re-send the first chip's value.
    fireEvent.click(screen.getByRole('button', { name: second.defaultValue }));
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick).toHaveBeenLastCalledWith(second.defaultValue);
  });

  it('does not invoke onPick on mount (only on user interaction)', () => {
    const onPick = vi.fn();
    render(<SuggestedPrompts onPick={onPick} />);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('marks every leading sparkle icon decorative so it is not announced', () => {
    const { container } = render(<SuggestedPrompts onPick={vi.fn()} />);

    // One aria-hidden svg per chip; the visible text supplies the name.
    const hiddenIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(hiddenIcons).toHaveLength(getChatSuggestions().length);
  });

  it('prefers a real translation over the English default for label and picked value', () => {
    const [first] = getChatSuggestions();
    h.t = (key: string, fallback?: unknown) =>
      key === first.i18nKey ? 'Que fait ma flotte ?' : h.defaultT(key, fallback);

    const onPick = vi.fn();
    render(<SuggestedPrompts onPick={onPick} />);

    // Default label is gone; the translated one is shown instead.
    expect(screen.queryByRole('button', { name: first.defaultValue })).toBeNull();
    const translatedChip = screen.getByRole('button', { name: 'Que fait ma flotte ?' });

    fireEvent.click(translatedChip);
    expect(onPick).toHaveBeenCalledWith('Que fait ma flotte ?');
  });

  it('falls back to the English default when a translation resolves empty (no nameless chip)', () => {
    // Simulate a shipped-but-empty translation for every suggestion key.
    h.t = (key: string, fallback?: unknown) =>
      key.startsWith('chatbot.suggestion.') ? '   ' : h.defaultT(key, fallback);

    const onPick = vi.fn();
    render(<SuggestedPrompts onPick={onPick} />);

    const first = getChatSuggestions()[0];
    const chip = screen.getByRole('button', { name: first.defaultValue });
    expect(chip).toBeInTheDocument();

    fireEvent.click(chip);
    // The picked value is the non-empty default, never the blank translation.
    expect(onPick).toHaveBeenCalledWith(first.defaultValue);
  });
});
