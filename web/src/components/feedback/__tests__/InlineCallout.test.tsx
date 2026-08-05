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
    expect(screen.getByRole('status').className).toMatch(/cyan/);

    rerender(<InlineCallout variant="success">x</InlineCallout>);
    expect(screen.getByRole('status').className).toMatch(/emerald/);

    rerender(<InlineCallout variant="warning">x</InlineCallout>);
    expect(screen.getByRole('status').className).toMatch(/amber/);

    rerender(<InlineCallout variant="danger">x</InlineCallout>);
    expect(screen.getByRole('status').className).toMatch(/rose/);
  });

  it.each([
    ['warning', 'text-amber-800', 'dark:text-amber-200'],
    ['danger', 'text-rose-800', 'dark:text-rose-200'],
  ] as const)('keeps %s body text readable in both themes', (variant, lightClass, darkClass) => {
    render(<InlineCallout variant={variant}>Readable body</InlineCallout>);
    const body = screen.getByText('Readable body');
    expect(body.className).toContain(lightClass);
    expect(body.className).toContain(darkClass);
  });

  it('exposes a testId on the outer node', () => {
    render(
      <InlineCallout variant="info" testId="callout-foo">
        x
      </InlineCallout>,
    );
    expect(screen.getByTestId('callout-foo')).toBeInTheDocument();
  });
});
