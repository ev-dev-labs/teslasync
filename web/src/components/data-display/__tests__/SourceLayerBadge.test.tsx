import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SourceLayerBadge } from '../SourceLayerBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('SourceLayerBadge', () => {
  it('makes populated source details named and keyboard-focusable', async () => {
    const user = userEvent.setup();
    render(<SourceLayerBadge source="log" ageMs={500} showLabel />);
    const trigger = screen.getByRole('button', { name: 'Log' });
    const tooltip = screen.getByRole('tooltip');

    await user.tab();

    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
    expect(trigger).toHaveAccessibleDescription(/Replayed from signal_log \(durable history\)\. \(age: 500(?:\.0+)? ms\)/);
    expect(trigger).toHaveClass('min-h-11', 'min-w-11');
    expect(tooltip).toHaveClass('group-focus-within/tip:opacity-100', 'whitespace-normal');

    await user.keyboard('{Escape}');
    expect(tooltip).toHaveClass('!opacity-0');
    expect(trigger).toHaveFocus();
  });

  it('focuses the named badge on tap using the existing tooltip', () => {
    render(<SourceLayerBadge source="stale" ageMs={500} />);
    const trigger = screen.getByRole('button', { name: 'Stale' });

    fireEvent.click(trigger);

    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleDescription(/Past 2-min window\. Source layer unknown\. \(age: 500(?:\.0+)? ms\)/);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    trigger.blur();
    expect(trigger).not.toHaveFocus();
  });

  it('names missing source details without changing the visible missing value', () => {
    render(<SourceLayerBadge source={null} />);
    expect(screen.getByRole('button', { name: 'Unknown' })).toHaveAccessibleDescription('Source layer unknown.');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('describes the legacy l1 code as freshness, not an attested L1 read', () => {
    render(<SourceLayerBadge source="l1" />);
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    const badge = screen.getByTestId('source-layer-badge');
    expect(badge.className).toContain('text-[var(--text-secondary)]');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Fresh. Source layer unknown.');
    expect(screen.queryByText('L1')).not.toBeInTheDocument();
  });

  it('describes the legacy l2 code as unknown age without inferring Redis', () => {
    render(<SourceLayerBadge source="l2" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('age: Unknown. Source layer unknown.');
    expect(screen.queryByText('L2')).not.toBeInTheDocument();
  });

  it('renders an authored Log label when source="log"', () => {
    render(<SourceLayerBadge source="log" />);
    expect(screen.getByText('Log')).toBeInTheDocument();
    expect(screen.getByTestId('source-layer-badge')).not.toHaveClass('uppercase', 'capitalize');
  });

  it('renders an authored Stale warning when source="stale"', () => {
    render(<SourceLayerBadge source="stale" />);
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByTestId('source-layer-badge').className).toContain('text-[var(--semantic-warning)]');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Past 2-min window. Source layer unknown.');
  });

  it('falls back to em-dash when source is null', () => {
    render(<SourceLayerBadge source={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('exposes the source via data-source for query-by-attribute', () => {
    render(<SourceLayerBadge source="L1" />);
    expect(screen.getByTestId('source-layer-badge').getAttribute('data-source')).toBe('l1');
  });

  it('preserves populated value age without turning it into read-layer evidence', () => {
    render(<SourceLayerBadge source="l1" ageMs={500} showLabel />);
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Source layer unknown.');
    expect(screen.getByRole('tooltip')).toHaveTextContent('500');
  });
});
