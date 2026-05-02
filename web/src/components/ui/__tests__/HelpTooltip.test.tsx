import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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
});
