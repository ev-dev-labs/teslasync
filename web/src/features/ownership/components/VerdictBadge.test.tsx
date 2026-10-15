import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BADGE_VARIANTS, type BadgeProps } from '@/components/ui';
import en from '@/i18n/en.json';
import splitEn from '@/i18n/en/locale-ownership.json';
import { VerdictBadge } from './VerdictBadge';

const { translate } = vi.hoisted(() => ({
  translate: vi.fn<(key: string, fallback: string) => string>(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

// Frozen original 38 roles; the three strength roles are the accepted addendum.
const originalRoles: Record<string, NonNullable<BadgeProps['variant']>> = {
  preferred: 'success', standard: 'info', substandard: 'warning', high: 'danger',
  exact: 'success', probable: 'info', ambiguous: 'warning', unmatched: 'danger',
  duplicate: 'danger', uninvoiced: 'warning', open: 'info', reconciled: 'success',
  disputed: 'warning', settled: 'neutral', trusted: 'success', watch: 'warning',
  unreliable: 'danger', unevaluated: 'neutral', keep: 'success', review: 'warning',
  cancel: 'danger', unknown: 'neutral', too_early: 'info', healthy: 'success',
  active: 'success', monitor: 'info', due_soon: 'warning', expiring_soon: 'warning',
  overdue: 'danger', expired: 'danger', lapsed: 'danger', retired: 'neutral',
  stable: 'success', improving: 'success', degrading: 'danger',
  sufficient: 'success', limited: 'warning', insufficient: 'danger',
};
const roles: Record<string, NonNullable<BadgeProps['variant']>> = {
  ...originalRoles, strong: 'info', moderate: 'neutral', weak: 'warning',
};

function expectTone(badge: Element, tone: NonNullable<BadgeProps['variant']>) {
  for (const token of BADGE_VARIANTS[tone].split(' ')) {
    expect(badge).toHaveClass(token);
  }
}

beforeEach(() => {
  translate.mockReset();
  translate.mockImplementation((_key, fallback) => fallback);
});
afterEach(cleanup);

describe('VerdictBadge canonical labels and preserved roles', () => {
  it('covers exactly the original38 and all41 canonical labels without catalog drift', () => {
    expect(Object.keys(originalRoles)).toHaveLength(38);
    expect(Object.keys(roles)).toHaveLength(41);
    expect(Object.keys(roles).sort()).toEqual(Object.keys(en.ownership.verdict).sort());
    expect(splitEn.ownership.verdict).toEqual(en.ownership.verdict);
    for (const [value, label] of Object.entries(en.ownership.verdict)) {
      expect(label).toBe(value.replace(/_/g, ' '));
    }
  });

  it.each(Object.entries(roles))('preserves %s readable English and role %s', (value, tone) => {
    const { container } = render(<VerdictBadge value={value} />);
    const badge = container.firstElementChild;
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent(value.replace(/_/g, ' '));
    expect(translate).toHaveBeenCalledExactlyOnceWith(
      `ownership.verdict.${value}`, value.replace(/_/g, ' '),
    );
    if (badge) expectTone(badge, tone);
    expect(badge?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it.each(Object.entries(roles))('localizes uppercase %s without changing its role', (value, tone) => {
    const localized = `ترجمة ${value} très longue `.repeat(8);
    translate.mockReturnValue(localized);
    const { container } = render(<VerdictBadge value={value.toUpperCase()} />);
    const badge = container.firstElementChild;
    expect(badge?.textContent).toBe(localized);
    expect(translate).toHaveBeenCalledExactlyOnceWith(
      `ownership.verdict.${value}`, value.replace(/_/g, ' '),
    );
    if (badge) expectTone(badge, tone);
  });
});

describe('VerdictBadge open string and native behavior', () => {
  it.each([null, undefined, ''])('shows em dash for absent value %s', (value) => {
    const { container } = render(<VerdictBadge value={value} />);
    expect(container.firstElementChild).toHaveTextContent('—');
    expect(translate).not.toHaveBeenCalled();
    if (container.firstElementChild) expectTone(container.firstElementChild, 'neutral');
  });

  it.each([
    ['NEW_VERDICT', 'new verdict'],
    [' constructor ', ' constructor '],
    ['constructor', 'constructor'],
    ['toString', 'tostring'],
    ['hasOwnProperty', 'hasownproperty'],
    ['__proto__', '  proto  '],
    ['valueOf', 'valueof'],
    [' STRONG ', ' strong '],
    ['   ', '   '],
  ])('keeps unrecognized %s distinct without trimming or invented lookup', (value, text) => {
    const { container } = render(<VerdictBadge value={value} />);
    expect(container.firstElementChild?.textContent).toBe(text);
    expect(translate).not.toHaveBeenCalled();
    if (container.firstElementChild) expectTone(container.firstElementChild, 'neutral');
  });

  it.each(['strong', 'unknown', 'new_value', '', null, undefined])(
    'preserves custom and empty overrides for %s', (value) => {
      const { container, rerender } = render(<VerdictBadge value={value} label="Custom label" />);
      expect(container.firstElementChild?.textContent).toBe('Custom label');
      rerender(<VerdictBadge value={value} label="" />);
      expect(container.firstElementChild?.textContent).toBe('');
      expect(translate).not.toHaveBeenCalled();
    },
  );

  it('keeps known unknown visibly distinct from absent and unrecognized values', () => {
    translate.mockReturnValue('inconnu');
    const { container, rerender } = render(<VerdictBadge value="unknown" />);
    expect(container.firstElementChild).toHaveTextContent('inconnu');
    rerender(<VerdictBadge value={null} />);
    expect(container.firstElementChild).toHaveTextContent('—');
    rerender(<VerdictBadge value="future_status" />);
    expect(container.firstElementChild).toHaveTextContent('future status');
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('retains native wrapping span, decorative dot, and readable label with dot off', () => {
    const { container, rerender } = render(<VerdictBadge value="weak" />);
    const badge = container.firstElementChild;
    expect(badge?.tagName).toBe('SPAN');
    expect(badge).not.toHaveAttribute('role');
    expect(badge).not.toHaveAttribute('aria-live');
    expect(badge).not.toHaveAttribute('tabindex');
    expect(badge).toHaveClass('min-w-0', 'max-w-full', 'whitespace-normal', 'break-words');
    expect(badge).toHaveClass('forced-colors:border', 'forced-colors:border-[CanvasText]');
    expect(badge?.querySelector('span')).toHaveAttribute('aria-hidden', 'true');
    rerender(<VerdictBadge value="weak" dot={false} />);
    expect(container.firstElementChild?.querySelector('span')).toBeNull();
    expect(container.firstElementChild).toHaveTextContent('weak');
  });
});
