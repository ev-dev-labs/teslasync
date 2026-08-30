/**
 * FsdPeriodControl — WAI-ARIA radiogroup keyboard contract.
 *
 * The period control re-scopes the whole page, so its keyboard behaviour is
 * functional, not cosmetic: a keyboard operator must be able to reach it in one
 * Tab, move with the arrow keys, and jump with Home/End.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (opts && typeof opts === 'object' ? opts : undefined) as
          | Record<string, unknown>
          | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { FsdPeriodControl } from '../FsdPeriodControl';
import type { FsdPeriodDays } from '@/types/fsd';

const onChange = vi.fn();

function renderControl(value: FsdPeriodDays = 30, disabled = false) {
  return render(<FsdPeriodControl value={value} onChange={onChange} disabled={disabled} />);
}

function radios() {
  return screen.getAllByRole('radio');
}

function radioFor(days: number) {
  return screen.getByRole('radio', { name: `Last ${days} days` });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FsdPeriodControl', () => {
  it('renders the four supported presets inside one radiogroup', () => {
    renderControl();

    const group = screen.getByRole('radiogroup', { name: 'Analysis period' });
    expect(group).toBeInTheDocument();
    expect(radios().map((r) => r.textContent)).toEqual(['7d', '30d', '90d', '365d']);
    expect(radioFor(30)).toHaveAttribute('aria-checked', 'true');
  });

  it('exposes exactly one tabbable radio (roving tabIndex)', () => {
    renderControl(90);

    const tabbable = radios().filter((r) => r.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName('Last 90 days');
    for (const radio of radios()) {
      if (radio !== tabbable[0]) expect(radio).toHaveAttribute('tabindex', '-1');
    }
  });

  it('selects on click', () => {
    renderControl();
    fireEvent.click(radioFor(365));
    expect(onChange).toHaveBeenCalledWith(365);
  });

  it.each([
    ['ArrowRight', 30, 90],
    ['ArrowDown', 30, 90],
    ['ArrowLeft', 30, 7],
    ['ArrowUp', 30, 7],
  ])('%s moves selection from %sd to %sd and follows with focus', (key, from, want) => {
    renderControl(from as FsdPeriodDays);
    const origin = radioFor(from);
    origin.focus();

    fireEvent.keyDown(origin, { key });

    expect(onChange).toHaveBeenCalledWith(want);
    expect(radioFor(want)).toHaveFocus();
  });

  it('wraps around at both ends', () => {
    const { unmount } = renderControl(365);
    fireEvent.keyDown(radioFor(365), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(7);
    unmount();

    onChange.mockClear();
    renderControl(7);
    fireEvent.keyDown(radioFor(7), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith(365);
  });

  it('jumps to the ends with Home and End', () => {
    const { unmount } = renderControl(90);
    fireEvent.keyDown(radioFor(90), { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith(7);
    expect(radioFor(7)).toHaveFocus();
    unmount();

    onChange.mockClear();
    renderControl(30);
    fireEvent.keyDown(radioFor(30), { key: 'End' });
    expect(onChange).toHaveBeenCalledWith(365);
    expect(radioFor(365)).toHaveFocus();
  });

  it('ignores unrelated keys so typing never hijacks the group', () => {
    renderControl();
    const origin = radioFor(30);
    for (const key of ['a', 'Tab', 'Escape', 'PageDown']) {
      fireEvent.keyDown(origin, { key });
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is inert while disabled', () => {
    renderControl(30, true);

    for (const radio of radios()) {
      expect(radio).toBeDisabled();
    }
    fireEvent.keyDown(radioFor(30), { key: 'ArrowRight' });
    fireEvent.click(radioFor(90));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps every control above the 44px touch-target floor', () => {
    renderControl();
    for (const radio of radios()) {
      expect(radio.className).toContain('min-h-11');
    }
  });
});
