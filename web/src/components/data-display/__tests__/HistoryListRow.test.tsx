import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HistoryListRow } from '../HistoryListRow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      const tpl = fallback ?? '';
      if (!opts) return tpl;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        tpl,
      );
    },
  }),
}));

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('HistoryListRow', () => {
  it('renders primary content', () => {
    wrap(
      <HistoryListRow
        primary={<span>3:42 PM</span>}
        href="/drives/1"
        testId="hlr"
      />,
    );
    expect(screen.getByTestId('hlr')).toHaveTextContent('3:42 PM');
  });

  it('wraps the row in a Router Link when href is set', () => {
    wrap(
      <HistoryListRow
        primary={<span>x</span>}
        href="/drives/42"
        testId="hlr"
      />,
    );
    const link = screen.getByTestId('hlr').querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/drives/42');
  });

  it('renders without a Link when only onClick is provided', () => {
    const onClick = vi.fn();
    wrap(
      <HistoryListRow
        primary={<span>x</span>}
        onClick={onClick}
        testId="hlr"
      />,
    );
    expect(screen.getByTestId('hlr').querySelector('a')).toBeNull();
    fireEvent.click(screen.getByTestId('hlr-panel'));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders the leading badge in a fixed-width column', () => {
    wrap(
      <HistoryListRow
        leading={<span data-testid="badge">B</span>}
        primary={<span>x</span>}
        testId="hlr"
      />,
    );
    expect(screen.getByTestId('badge')).toBeInTheDocument();
  });

  it('renders the route slot when provided', () => {
    wrap(
      <HistoryListRow
        primary={<span>x</span>}
        route={<span data-testid="route">Home → Office</span>}
        testId="hlr"
      />,
    );
    expect(screen.getByTestId('route')).toBeInTheDocument();
  });

  it('renders metric chips when provided', () => {
    wrap(
      <HistoryListRow
        primary={<span>x</span>}
        metrics={
          <>
            <span data-testid="m1">avg 29 mph</span>
            <span data-testid="m2">−1%</span>
          </>
        }
        testId="hlr"
      />,
    );
    expect(screen.getByTestId('m1')).toBeInTheDocument();
    expect(screen.getByTestId('m2')).toBeInTheDocument();
  });

  it('renders the insight slot below metrics', () => {
    wrap(
      <HistoryListRow
        primary={<span>x</span>}
        insight={<span data-testid="insight">⚠ Low efficiency</span>}
        testId="hlr"
      />,
    );
    expect(screen.getByTestId('insight')).toBeInTheDocument();
  });

  it('renders the trailing chevron by default and hides it when hideChevron', () => {
    const { container, rerender } = wrap(
      <HistoryListRow primary={<span>x</span>} testId="hlr" />,
    );
    expect(container.querySelector('.lucide-chevron-right')).not.toBeNull();

    rerender(
      <MemoryRouter>
        <HistoryListRow primary={<span>x</span>} hideChevron testId="hlr" />
      </MemoryRouter>,
    );
    expect(container.querySelector('.lucide-chevron-right')).toBeNull();
  });

  it('renders the checkbox slot and stops click propagation', () => {
    const onCheckboxClick = vi.fn();
    const onRowClick = vi.fn();
    wrap(
      <HistoryListRow
        primary={<span>x</span>}
        checkbox={<span data-testid="cb" onClick={onCheckboxClick}>☐</span>}
        onClick={onRowClick}
        testId="hlr"
      />,
    );
    fireEvent.click(screen.getByTestId('cb'));
    expect(onCheckboxClick).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('renders hover actions and stops click propagation through them', () => {
    const onActionClick = vi.fn();
    const onRowClick = vi.fn();
    wrap(
      <HistoryListRow
        primary={<span>x</span>}
        actions={[
          <button key="a" data-testid="act" onClick={onActionClick}>Eye</button>,
        ]}
        onClick={onRowClick}
        testId="hlr"
      />,
    );
    fireEvent.click(screen.getByTestId('act'));
    expect(onActionClick).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('keeps quick actions outside the navigation link', () => {
    wrap(
      <HistoryListRow
        primary={<span>x</span>}
        actions={[<button key="a">Quick view</button>]}
        href="/drives/42"
        testId="hlr"
      />,
    );

    const row = screen.getByTestId('hlr');
    const link = row.querySelector('a');
    expect(link).not.toContainElement(
      screen.getByRole('button', { name: 'Quick view' }),
    );
  });

  it('applies the selected ring class when selected', () => {
    wrap(
      <HistoryListRow
        primary={<span>x</span>}
        selected
        testId="hlr"
      />,
    );
    expect(screen.getByTestId('hlr-panel').className).toMatch(/ring-cyan-400/);
  });
});
