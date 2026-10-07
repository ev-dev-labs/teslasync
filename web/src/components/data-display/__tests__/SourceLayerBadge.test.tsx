import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SourceLayerBadge } from '../SourceLayerBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('SourceLayerBadge', () => {
  it('renders an L1 badge when source="l1"', () => {
    render(<SourceLayerBadge source="l1" />);
    expect(screen.getByText('L1')).toBeInTheDocument();
    const badge = screen.getByTestId('source-layer-badge');
    expect(badge.className).toContain('text-emerald-200');
  });

  it('renders an L2 badge when source="l2"', () => {
    render(<SourceLayerBadge source="l2" />);
    expect(screen.getByText('L2')).toBeInTheDocument();
    expect(screen.getByTestId('source-layer-badge').className).toContain('text-blue-200');
  });

  it('renders LOG label when source="log"', () => {
    render(<SourceLayerBadge source="log" />);
    expect(screen.getByText('LOG')).toBeInTheDocument();
  });

  it('renders a STALE warning when source="stale"', () => {
    render(<SourceLayerBadge source="stale" />);
    expect(screen.getByText('STALE')).toBeInTheDocument();
    expect(screen.getByTestId('source-layer-badge').className).toContain('text-amber-200');
  });

  it('falls back to em-dash when source is null', () => {
    render(<SourceLayerBadge source={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('exposes the source via data-source for query-by-attribute', () => {
    render(<SourceLayerBadge source="L1" />);
    expect(screen.getByTestId('source-layer-badge').getAttribute('data-source')).toBe('l1');
  });
});
