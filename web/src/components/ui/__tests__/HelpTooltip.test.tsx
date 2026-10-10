import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const preferences = vi.hoisted(() => ({ contextualHelp: true }));

vi.mock('@/hooks/useProductPreferences', () => ({
  useProductPreferences: () => ({ preferences }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } | string) => {
      if (typeof opts === 'string') return opts || key;
      if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
        return opts.defaultValue ?? key;
      }
      return key;
    },
  }),
}));

import { HelpTooltip } from '../HelpTooltip';

describe('HelpTooltip', () => {
  beforeEach(() => {
    preferences.contextualHelp = true;
  });

  it('renders nothing when no text or i18nKey is supplied', () => {
    const { container } = render(<HelpTooltip />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a focusable button trigger with an accessible label', () => {
    render(<HelpTooltip text="What is vampire drain?" />);
    const trigger = screen.getByRole('button', { name: 'More info' });
    expect(trigger).toBeInTheDocument();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
  });

  it('exposes the help body via role="tooltip" so screen readers can announce it', () => {
    render(<HelpTooltip text="Idle drain rate" />);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Idle drain rate');
    // Tooltip id is wired to trigger via aria-describedby (Tooltip impl).
    const trigger = screen.getByRole('button', { name: 'More info' });
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy).toBe(tooltip.id);
  });

  it('honours i18nKey + defaultValue for translated copy', () => {
    render(
      <HelpTooltip
        i18nKey="help.vampireDrain.body"
        defaultValue="Phantom drain explanation"
      />,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Phantom drain explanation');
  });

  it('renders an external "Learn more" link with safe rel/target attrs', () => {
    render(
      <HelpTooltip
        text="Body"
        learnMore={{ url: 'https://example.com/docs/x', label: 'Docs' }}
      />,
    );
    const link = screen.getByRole('link', { name: /Docs/i });
    expect(link).toHaveAttribute('href', 'https://example.com/docs/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('respects custom ariaLabel on the trigger', () => {
    render(<HelpTooltip text="x" ariaLabel="More info about cooldown" />);
    expect(
      screen.getByRole('button', { name: 'More info about cooldown' }),
    ).toBeInTheDocument();
  });

  it('respects contextual-help changes without leaving description IDs behind', () => {
    const { container, rerender } = render(<HelpTooltip text="Body" />);
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-describedby', screen.getByRole('tooltip').id,
    );
    preferences.contextualHelp = false;
    rerender(<HelpTooltip text="Body" />);
    expect(container.firstChild).toBeNull();
    preferences.contextualHelp = true;
    rerender(<HelpTooltip text="Body" />);
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-describedby', screen.getByRole('tooltip').id,
    );
  });

  it.each([
    ['xs', 'h-3', 'w-3'],
    ['sm', 'h-3.5', 'w-3.5'],
    ['md', 'h-4', 'w-4'],
  ] as const)('preserves the %s glyph size independently of its target', (size, height, width) => {
    render(<HelpTooltip text="Body" size={size} className="caller-class" />);
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveClass('h-11', 'w-11', 'md:h-6', 'md:w-6', 'caller-class');
    expect(trigger.querySelector('svg')).toHaveClass(height, width, 'shrink-0');
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-offset-2');
  });

  it.each([
    ['top', 'bottom-full'],
    ['bottom', 'top-full'],
    ['left', 'right-full'],
    ['right', 'left-full'],
  ] as const)('preserves %s placement', (placement, sideClass) => {
    render(<HelpTooltip text="Body" placement={placement} />);
    expect(screen.getByRole('tooltip')).toHaveClass(sideClass, 'whitespace-normal', 'break-words');
  });

  it('inherits the inverse tooltip foreground for long localized RTL content and links', () => {
    const body = 'شرح طويل '.repeat(80);
    render(
      <div dir="rtl">
        <HelpTooltip i18nKey="help.long" defaultValue={body} learnMore={{ url: '/docs' }} />
      </div>,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(body.trim());
    expect(tooltip).toHaveClass('text-[var(--text-inverse)]');
    expect(tooltip.querySelector('.text-2xs')).toBeNull();
    expect(tooltip.querySelector('.text-\\[var\\(--text-primary\\)\\]')).toBeNull();
    const link = screen.getByRole('link', { name: 'Learn more' });
    expect(link).toHaveClass('pointer-events-auto', 'underline');
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('preserves empty aria-label overrides, custom-child names and stable description IDs across updates', () => {
    const { rerender } = render(
      <HelpTooltip text="First" ariaLabel=""><span>Custom glyph</span></HelpTooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Custom glyph' });
    const id = screen.getByRole('tooltip').id;
    expect(trigger).toHaveAttribute('aria-label', '');
    expect(trigger).toHaveAccessibleName('Custom glyph');
    expect(trigger).toHaveTextContent('Custom glyph');
    rerender(<HelpTooltip text="Updated" ariaLabel=""><span>Custom glyph</span></HelpTooltip>);
    expect(trigger).toHaveAttribute('aria-label', '');
    expect(trigger).toHaveAccessibleName('Custom glyph');
    expect(trigger).toHaveTextContent('Custom glyph');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Updated');
    expect(screen.getByRole('tooltip').id).toBe(id);
    expect(trigger).toHaveAttribute('aria-describedby', id);
  });

  it('retains focus/touch and hover recovery after Escape through the existing Tooltip', () => {
    render(<HelpTooltip text="Body" />);
    const trigger = screen.getByRole('button');
    const tooltip = screen.getByRole('tooltip');
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(tooltip).toHaveClass('!opacity-0');
    fireEvent.blur(trigger);
    fireEvent.focus(trigger);
    expect(tooltip).not.toHaveClass('!opacity-0');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(tooltip).toHaveClass('!opacity-0');
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(tooltip).not.toHaveClass('!opacity-0');
  });
});
