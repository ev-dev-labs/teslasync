import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { KindFilterBar } from './KindFilterBar';
import type { ActivityKind } from '@/types/activity';

const translations = vi.hoisted(() => ({
  labels: {} as Record<string, string>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => translations.labels[key] ?? fallback,
  }),
}));

beforeEach(() => {
  translations.labels = {};
});

function ControlledKindFilterBar() {
  const [activeKinds, setActiveKinds] = useState<ActivityKind[]>([]);
  return <KindFilterBar activeKinds={activeKinds} onChange={setActiveKinds} />;
}

describe('KindFilterBar', () => {
  it('marks "All" pressed when no kinds are active', () => {
    render(<KindFilterBar activeKinds={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^all$/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks a kind chip pressed when it is in activeKinds', () => {
    render(<KindFilterBar activeKinds={['drive']} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^drive$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^all$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds a kind to the active set when an inactive chip is clicked', () => {
    const onChange = vi.fn();
    render(<KindFilterBar activeKinds={['drive']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /charging/i }));
    expect(onChange).toHaveBeenCalledWith(['drive', 'charging']);
  });

  it('removes a kind from the active set when an active chip is clicked again', () => {
    const onChange = vi.fn();
    render(<KindFilterBar activeKinds={['drive', 'charging']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^drive$/i }));
    expect(onChange).toHaveBeenCalledWith(['charging']);
  });

  it('clears the filter back to "all" when the All chip is clicked', () => {
    const onChange = vi.fn();
    render(<KindFilterBar activeKinds={['drive', 'alert']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders one chip per known activity kind plus the All chip', () => {
    const kinds: ActivityKind[] = ['drive', 'charging', 'alert', 'software_update', 'annotation'];
    render(<KindFilterBar activeKinds={[]} onChange={vi.fn()} />);
    // 5 kinds + All = 6 buttons in the group.
    expect(screen.getAllByRole('button')).toHaveLength(kinds.length + 1);
  });

  it('adopts wrapping and mobile minimum classes on all six buttons with compact desktop minimums', () => {
    render(<KindFilterBar activeKinds={[]} onChange={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
    for (const button of buttons) {
      expect(button).toHaveClass(
        'h-auto', 'min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0',
        'max-w-full', 'whitespace-normal', 'px-3', 'py-1.5', 'text-sm',
      );
      expect(button).not.toHaveClass('h-9', 'truncate', 'whitespace-nowrap');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).not.toHaveAttribute('tabindex');
      expect(button.lastElementChild).toHaveClass('min-w-0', 'break-words');
    }
    expect(screen.getByRole('group', { name: 'Filter by activity kind' }))
      .toHaveClass('flex', 'flex-wrap', 'gap-1.5');
  });

  it('keeps decorative kind icons hidden and shrink-free inside wrapping labels', () => {
    render(<KindFilterBar activeKinds={[]} onChange={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].querySelector('svg')).toBeNull();
    for (const button of buttons.slice(1)) {
      const icon = button.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveClass('h-3.5', 'w-3.5');
      expect(icon?.parentElement).toHaveClass('inline-flex', 'shrink-0');
    }
  });

  it('returns to the unscoped All state when the last active kind is removed without mutating input', () => {
    const onChange = vi.fn();
    const activeKinds: readonly ActivityKind[] = Object.freeze(['annotation']);
    const { rerender } = render(<KindFilterBar activeKinds={activeKinds} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^annotation$/i }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
    expect(activeKinds).toEqual(['annotation']);
    rerender(<KindFilterBar activeKinds={[]} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /^all$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^annotation$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not collapse an explicit five-kind selection into the empty All filter', () => {
    const onChange = vi.fn();
    const activeKinds: readonly ActivityKind[] = Object.freeze([
      'drive', 'charging', 'alert', 'software_update', 'annotation',
    ]);
    render(<KindFilterBar activeKinds={activeKinds} onChange={onChange} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    for (const button of buttons.slice(1)) {
      expect(button).toHaveAttribute('aria-pressed', 'true');
    }
    fireEvent.click(screen.getByRole('button', { name: /^software update$/i }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['drive', 'charging', 'alert', 'annotation']);
    expect(activeKinds).toEqual(['drive', 'charging', 'alert', 'software_update', 'annotation']);
  });

  it('preserves Tab order, Enter and Space multi-select, All reset and focus after controlled updates', async () => {
    const user = userEvent.setup();
    render(<ControlledKindFilterBar />);
    const buttons = screen.getAllByRole('button');

    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.tab();
    expect(buttons[1]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveFocus();
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    await user.tab();
    await user.keyboard(' ');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[2]).toHaveFocus();
    await user.tab({ shift: true });
    await user.keyboard(' ');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
    await user.tab({ shift: true });
    await user.keyboard('{Enter}');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[0]).toHaveFocus();
    for (const button of buttons.slice(1)) {
      await user.tab();
      expect(button).toHaveFocus();
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('retains localized long RTL labels, stable kind identity, caller classes and focused buttons on rerender', () => {
    const names = [
      'جميع أنواع الأنشطة في النطاق المحدد',
      'القيادة في النطاق الزمني المحدد',
      'جلسات الشحن ضمن النطاق الزمني المحدد',
      'التنبيهات المسجلة في النطاق المحدد',
      'تحديثات برامج السيارة المثبتة والمجدولة',
      'التعليقات التوضيحية ضمن النطاق المحدد',
    ];
    const keys = [
      'all', 'drive', 'charging', 'alert', 'software_update', 'annotation',
    ];
    translations.labels = Object.fromEntries(keys.map((key, index) => [
      `activity.timeline.kindFilter.${key}`, names[index],
    ]));
    translations.labels['activity.timeline.kindFilter.aria'] = 'تصفية حسب نوع النشاط';
    const onChange = vi.fn();
    const { rerender } = render(
      <div dir="rtl">
        <KindFilterBar activeKinds={['software_update']} onChange={onChange} className="mt-2" />
      </div>,
    );
    const buttons = screen.getAllByRole('button');
    names.forEach((name, index) => {
      expect(screen.getByRole('button', { name })).toBe(buttons[index]);
      expect(buttons[index].lastElementChild).toHaveTextContent(name);
    });
    expect(screen.getByRole('group', { name: 'تصفية حسب نوع النشاط' })).toHaveClass('mt-2');
    expect(buttons[4]).toHaveAttribute('aria-pressed', 'true');
    buttons[4].focus();
    fireEvent.click(buttons[1]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['software_update', 'drive']);

    translations.labels = {};
    rerender(
      <div dir="rtl">
        <KindFilterBar activeKinds={['software_update', 'drive']} onChange={onChange} className="mt-2" />
      </div>,
    );
    expect(screen.getByRole('button', { name: /^software update$/i })).toBe(buttons[4]);
    expect(buttons[4]).toHaveFocus();
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[4]).toHaveAttribute('aria-pressed', 'true');
  });
});
