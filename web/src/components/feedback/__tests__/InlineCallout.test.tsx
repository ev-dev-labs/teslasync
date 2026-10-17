import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { AlertTriangle } from 'lucide-react';
import { InlineCallout } from '../InlineCallout';

describe('InlineCallout', () => {
  it('renders body text inside a status role by default', () => {
    render(<InlineCallout variant="info">Hello world</InlineCallout>);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Hello world');
  });

  it('renders the icon when provided', () => {
    render(
      <InlineCallout variant="warning" icon={<AlertTriangle data-testid="icon" />}>
        Anomaly detected
      </InlineCallout>,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders an anchor when action.href is provided', () => {
    render(
      <InlineCallout
        variant="warning"
        action={{ label: 'View', href: '/drives/1' }}
      >
        1 anomaly
      </InlineCallout>,
    );
    const link = screen.getByRole('link');
    expect(link.tagName.toLowerCase()).toBe('a');
    expect(link).toHaveAttribute('href', '/drives/1');
  });

  it('renders a button and fires onClick when action.onClick is provided', () => {
    const onClick = vi.fn();
    render(
      <InlineCallout
        variant="info"
        action={{ label: 'Refresh', onClick }}
      >
        Stale data
      </InlineCallout>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent(/stale data/i);
    expect(btn).toHaveTextContent(/refresh/i);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses different background tints per variant', () => {
    const { rerender } = render(<InlineCallout variant="info">x</InlineCallout>);
    expect(screen.getByRole('status')).toHaveClass('bg-[var(--semantic-info-bg)]');

    rerender(<InlineCallout variant="success">x</InlineCallout>);
    expect(screen.getByRole('status')).toHaveClass('bg-[var(--semantic-success-bg)]');

    rerender(<InlineCallout variant="warning">x</InlineCallout>);
    expect(screen.getByRole('status')).toHaveClass('bg-[var(--semantic-warning-bg)]');

    rerender(<InlineCallout variant="danger">x</InlineCallout>);
    expect(screen.getByRole('status')).toHaveClass('bg-[var(--semantic-danger-bg)]');
  });

  it.each([
    ['warning'],
    ['danger'],
  ] as const)('keeps %s body text readable in both themes', (variant) => {
    render(<InlineCallout variant={variant}>Readable body</InlineCallout>);
    const body = screen.getByText('Readable body');
    expect(body).toHaveClass('text-[var(--text-secondary)]');
    expect(body.className).not.toMatch(/text-(amber|rose)-/);
  });

  it('exposes a testId on the outer node', () => {
    render(
      <InlineCallout variant="info" testId="callout-foo">
        x
      </InlineCallout>,
    );
    expect(screen.getByTestId('callout-foo')).toBeInTheDocument();
  });

  it('prefers native navigation when both action handlers are supplied', () => {
    const onClick = vi.fn();
    render(
      <InlineCallout variant="info" action={{ label: 'View', href: '#details', onClick }}>
        Retained details
      </InlineCallout>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '#details');
    fireEvent.click(link);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('preserves rich long content and localized action labels without truncation', () => {
    const label = 'عرض التفاصيل الكاملة '.repeat(20);
    const body = 'UnbrokenIdentifier'.repeat(40);
    render(
      <div dir="rtl">
        <InlineCallout
          variant="danger"
          className="custom-callout"
          testId="long-callout"
          action={{ label, onClick: vi.fn() }}
        >
          <strong>{body}</strong>
        </InlineCallout>
      </div>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('custom-callout', 'flex-wrap', 'min-w-0', 'h-auto', 'min-h-11');
    expect(screen.getByText(body).parentElement).toHaveClass('break-words');
    expect(screen.getByText(label.trim())).toHaveClass('break-words');
    expect(button.querySelector('svg')).toHaveClass('rtl:rotate-180');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-offset-2', 'motion-reduce:transition-none');
    expect(button.className).not.toMatch(/truncate|line-clamp|text-size-inherit/);
  });

  it('keeps a label-only action noninteractive and caller classes last', () => {
    render(
      <InlineCallout variant="success" className="px-4" action={{ label: 'Complete' }}>
        Saved
      </InlineCallout>,
    );
    expect(screen.getByRole('status')).toHaveClass('px-4');
    expect(screen.getByRole('status')).not.toHaveClass('px-3');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });
});
