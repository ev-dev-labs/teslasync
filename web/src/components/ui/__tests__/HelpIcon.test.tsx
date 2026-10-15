import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const preferenceState = vi.hoisted(() => ({
  contextualHelp: true,
  translatedBody: undefined as string | undefined,
}));
vi.mock('@/hooks/useProductPreferences', () => ({
  useProductPreferences: () => ({
    preferences: { contextualHelp: preferenceState.contextualHelp },
  }),
}));
vi.unmock('../Tooltip');

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; field?: string } | string) => {
      if (key === 'help.fields.alertStudio.cooldown' && preferenceState.translatedBody !== undefined) {
        return preferenceState.translatedBody;
      }
      if (typeof opts === 'string') return opts || key;
      if (opts && typeof opts === 'object') {
        if (key === 'a11y.helpFor' && opts.field) {
          return `Help for ${opts.field}`;
        }
        if ('defaultValue' in opts && opts.defaultValue) {
          return opts.defaultValue;
        }
      }
      return key;
    },
  }),
}));

import { HelpIcon } from '../HelpIcon';

describe('HelpIcon', () => {
  beforeEach(() => {
    preferenceState.contextualHelp = true;
    preferenceState.translatedBody = undefined;
  });
  afterEach(cleanup);

  it('renders nothing when neither i18nKey nor content is supplied', () => {
    const { container } = render(<HelpIcon />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when i18nKey resolves to an empty string and content is empty', () => {
    const { container } = render(<HelpIcon content="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a focusable <button type="button"> trigger', () => {
    render(<HelpIcon content="Hello" />);
    const trigger = screen.getByRole('button');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
  });

  it('uses a11y.helpFor template when `for` is provided', () => {
    render(<HelpIcon content="x" for="cooldown" />);
    expect(screen.getByRole('button', { name: 'Help for cooldown' })).toBeInTheDocument();
  });

  it('falls back to the generic "More info" label when `for` is omitted', () => {
    render(<HelpIcon content="x" />);
    expect(screen.getByRole('button', { name: 'More info' })).toBeInTheDocument();
  });

  it('honours an explicit ariaLabel override', () => {
    render(<HelpIcon content="x" ariaLabel="Custom help label" />);
    expect(
      screen.getByRole('button', { name: 'Custom help label' }),
    ).toBeInTheDocument();
  });

  it('exposes the help text via role="tooltip" and wires aria-describedby on the trigger', () => {
    render(<HelpIcon content="Cooldown protects against alert spam." for="cooldown" />);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Cooldown protects against alert spam.');
    const trigger = screen.getByRole('button');
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toBe(tooltip.id);
    expect(document.getElementById(tooltip.id)).toBe(tooltip);
    expect(describedBy?.split(/\s+/)).not.toContain('cooldown-help');
  });

  it('translates the i18nKey via the i18n mock and falls back to content', () => {
    render(
      <HelpIcon
        i18nKey="help.fields.alertStudio.cooldown"
        content="Cooldown helper text"
        for="cooldown"
      />,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Cooldown helper text');
  });

  it('blurs the trigger on Escape so the focus-within tooltip dismisses', () => {
    render(<HelpIcon content="x" for="cooldown" />);
    const trigger = screen.getByRole('button');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(document.activeElement).not.toBe(trigger);
  });

  it('exposes data-help-for on the trigger so audits can correlate icons to fields', () => {
    render(<HelpIcon content="x" for="my-field-id" />);
    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('data-help-for')).toBe('my-field-id');
  });

  it.each([
    { forId: undefined, name: 'More info', interaction: 'hover' },
    { forId: undefined, name: 'More info', interaction: 'focus' },
    { forId: 'caller-field', name: 'Help for caller-field', interaction: 'hover' },
    { forId: 'caller-field', name: 'Help for caller-field', interaction: 'focus' },
    { forId: '', name: 'More info', interaction: 'hover' },
    { forId: '', name: 'More info', interaction: 'focus' },
  ])('resolves only the real body with for=$forId on $interaction', ({
    forId, name, interaction,
  }) => {
    render(<HelpIcon for={forId} content="Actual tooltip explanation" />);
    const trigger = screen.getByRole('button', { name });
    if (interaction === 'hover') {
      fireEvent.mouseEnter(trigger);
    } else {
      expect(trigger.tabIndex).toBe(0);
      trigger.focus();
      expect(trigger).toHaveFocus();
    }
    const body = screen.getByRole('tooltip');
    expect(body).toHaveTextContent('Actual tooltip explanation');
    expect(body.id).not.toBe('');
    const tokens = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/);
    expect(tokens).toEqual([body.id]);
    for (const token of tokens) {
      expect(document.getElementById(token)).toBe(body);
    }
    expect(tokens).not.toContain(`${forId ?? ''}-help`);
    if (forId === undefined) {
      expect(trigger).not.toHaveAttribute('data-help-for');
    } else {
      expect(trigger).toHaveAttribute('data-help-for', forId);
    }
    if (interaction === 'focus') {
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(trigger).not.toHaveFocus();
    } else {
      fireEvent.mouseLeave(trigger);
    }
  });

  it.each(['Caller accessible name', ''])(
    'preserves explicit ariaLabel=%j and the caller target on focus and Escape',
    (ariaLabel) => {
      render(<HelpIcon for="caller-target" ariaLabel={ariaLabel} content="Help body" />);
      const trigger = screen.getByRole('button', { name: ariaLabel });
      expect(trigger.tabIndex).toBe(0);
      trigger.focus();
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveAttribute('aria-label', ariaLabel);
      expect(trigger).toHaveAttribute('data-help-for', 'caller-target');
      const body = screen.getByRole('tooltip');
      expect(trigger).toHaveAttribute('aria-describedby', body.id);
      expect(document.getElementById(body.id)).toBe(body);
      expect(document.getElementById('caller-target-help')).toBeNull();
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(trigger).not.toHaveFocus();
      expect(trigger).toHaveAttribute('aria-label', ariaLabel);
      expect(trigger).toHaveAttribute('data-help-for', 'caller-target');
    },
  );

  it('keeps the canonical body identity while caller targets and names change', () => {
    const { rerender } = render(<HelpIcon for="first-target" content="First explanation" />);
    const trigger = screen.getByRole('button', { name: 'Help for first-target' });
    expect(trigger.tabIndex).toBe(0);
    trigger.focus();
    const body = screen.getByRole('tooltip');
    const bodyId = body.id;
    rerender(<HelpIcon for="second-target" content="Second explanation" />);
    expect(screen.getByRole('button', { name: 'Help for second-target' })).toBe(trigger);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('data-help-for', 'second-target');
    expect(trigger).toHaveAttribute('aria-describedby', bodyId);
    expect(screen.getByRole('tooltip')).toBe(body);
    expect(body).toHaveTextContent('Second explanation');
    expect(document.getElementById(bodyId)).toBe(body);
    expect(document.getElementById('first-target-help')).toBeNull();
    expect(document.getElementById('second-target-help')).toBeNull();
  });

  it('does not render help or a tooltip when contextual help is disabled', () => {
    preferenceState.contextualHelp = false;
    const { container } = render(<HelpIcon for="caller-target" content="Help body" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('associates the translated body rather than the supplied fallback', () => {
    preferenceState.translatedBody = 'הסבר מתורגם';
    render(
      <HelpIcon
        for="cooldown"
        i18nKey="help.fields.alertStudio.cooldown"
        content="Fallback cooldown explanation"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Help for cooldown' });
    expect(trigger.tabIndex).toBe(0);
    trigger.focus();
    const body = screen.getByRole('tooltip');
    expect(body).toHaveTextContent('הסבר מתורגם');
    expect(body).not.toHaveTextContent('Fallback cooldown explanation');
    expect(trigger).toHaveAttribute('aria-describedby', body.id);
    expect(document.getElementById(body.id)).toBe(body);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).not.toHaveFocus();
  });
});
