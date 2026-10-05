import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { StatGroup, StatStrip } from './index';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string) => fallback,
}) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'Wh', duration: 'h', power: 'W', precision: 2, locale: 'en-US' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/components/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/ui')>(),
  Tooltip: ({ content, children }: { content: ReactNode; children: ReactNode }) =>
    <span title={String(content)}>{children}</span>,
}));
afterEach(cleanup);
const period = { kind: 'unknown', label: 'Returned sessions', reason: 'No proven complete window' } as const;

describe('compatible domain labels and complete linked context', () => {
  it('keeps source labels/descriptions, explicit units, context, legacy KPI identity and full link focus', () => {
    const { container } = render(<MemoryRouter><StatStrip testId="charging-overview" metrics={[{
      metricId: 'energy', rawValue: 850, label: 'Delivered energy from recorded sessions',
      description: 'Original source description', display: { units: { energy: 'kWh' } },
      href: '/charging', context: '2 recorded sessions',
      comparisonContent: <span>5% vs previous returned sessions; incomplete prior source</span>,
    }]} period={period} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /Delivered energy from recorded sessions: 0.85 kWh/ });
    expect(link).toHaveAccessibleDescription('2 recorded sessions 5% vs previous returned sessions; incomplete prior source');
    expect(link).toHaveAttribute('href', '/charging');
    expect(link.className).toContain('focus-visible:ring-2');
    expect(screen.getByTitle('Original source description')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="charging-overview-kpis"]')).not.toBeNull();
    const ids = link.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
  });
  it('preserves comparison unknown-period and invalid reasons in visible DOM and the linked name', () => {
    render(<MemoryRouter><StatStrip metrics={[{
      metricId: 'count', rawValue: 0, label: 'Sessions', href: '/charging',
      comparison: { metricId: 'percent', rawValue: NaN, label: 'Prior comparison',
        period: { kind: 'unknown', label: 'Prior returned source', reason: 'Prior bounds unverified' } },
    }]} period={period} /></MemoryRouter>);
    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName(/Sessions: 0; Prior comparison: —; Prior returned source; Prior bounds unverified; invalid; Expected a finite numeric measurement/);
    expect(screen.getByText('Prior bounds unverified')).toBeInTheDocument();
    expect(screen.getByText('Expected a finite numeric measurement')).toBeInTheDocument();
  });
  it('omits absent comparison and descriptions rather than inventing a previous period', () => {
    const { container } = render(<StatGroup metrics={[{ metricId: 'status', rawValue: 'Not measured', label: 'Efficiency' }]} period={period} />);
    expect(container.querySelector('[data-stat-delta]')).toBeNull();
    expect(container.querySelector('[data-stat-specialist-comparison]')).toBeNull();
    expect(container.querySelector('[data-stat]')).not.toHaveAttribute('aria-describedby');
    expect(screen.getByText('Not measured')).toBeInTheDocument();
  });
  it('only suppresses a period reason when a visible owning header explicitly supplies it', () => {
    const { container } = render(<><p id="scope">{period.label}; {period.reason}</p>
      <StatGroup metrics={[{ metricId: 'count', rawValue: 0 }]} period={period} periodInHeader periodContextInHeader periodHeaderId="scope" /></>);
    expect(container.querySelector('[data-stat-strip]')).toHaveAttribute('aria-describedby', 'scope');
    expect(screen.getAllByText(/No proven complete window/)).toHaveLength(1);
  });
  it('does not assume that header-label inheritance includes the unknown source reason', () => {
    render(<><p id="label-only">{period.label}</p><StatGroup metrics={[{ metricId: 'count', rawValue: 0 }]}
      period={period} periodInHeader periodHeaderId="label-only" /></>);
    expect(screen.getByText(period.reason)).toBeInTheDocument();
  });
  it('retains secondary facts and actions in empty/retained/error shells', () => {
    const { container } = render(<StatStrip metrics={[]} period={period} retained loading error="Refresh failed"
      secondary="0 home · 0 SC · 0 DC" footer={<a href="/charging?coll=anomalies">Review anomalies</a>}
      emptyContent={<p>No sessions in returned range</p>} />);
    expect(container.querySelector('[data-stat-strip]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('0 home · 0 SC · 0 DC')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review anomalies' })).toHaveAttribute('href', '/charging?coll=anomalies');
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed');
  });
});
