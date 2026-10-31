import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { patchMatchMedia } from '@/test/setup';
import { TableToolbar } from './TableToolbar';
import { LayoutCard } from '../layout/layout-reference/LayoutCard';

describe('TableToolbar', () => {
  let media: ReturnType<typeof patchMatchMedia> | undefined;
  afterEach(() => {
    media?.restore();
    media = undefined;
  });

  it('keeps the card-owned mobile More button, search and keyboard recovery in their named slots', async () => {
    media = patchMatchMedia(query => query === '(max-width: 767px)');
    const user = userEvent.setup();
    const csv = vi.fn();
    render(<LayoutCard title="Observed transitions">
      <TableToolbar placement="card" search={{ value: '', onChange: vi.fn(), ariaLabel: 'Search observed transitions' }}
        exports={{ onExportCsv: csv, onExportJson: vi.fn(), description: 'Returned rows only' }} />
    </LayoutCard>);
    const card = screen.getByRole('heading', { name: 'Observed transitions' }).closest('[data-card]')!;
    const header = card.querySelector<HTMLElement>('[data-card-slot="header"]')!;
    const summary = card.querySelector<HTMLElement>('[data-card-slot="summary"]')!;
    const more = within(header).getByRole('button', { name: 'More', exact: true });
    expect(within(summary).getByRole('searchbox', { name: 'Search observed transitions' })).toBeVisible();
    more.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'More', exact: true });
    expect(within(dialog).getByText('Returned rows only')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(more).toHaveFocus();
  });

  it('keeps search visible and moves secondary controls into an accessible More dialog on phones and tablets', async () => {
    media = patchMatchMedia(query => query === '(max-width: 1279px)');
    const user = userEvent.setup();
    const densityChange = vi.fn();
    const exportCsv = vi.fn();
    render(<TableToolbar collapseBelow="xl" search={{ value: '', onChange: vi.fn() }}
      density={{ value: 'compact', onChange: densityChange }}
      exports={{ onExportCsv: exportCsv, onExportJson: vi.fn() }}
      columns={<span>Column settings</span>} />);
    expect(screen.getByRole('searchbox')).toBeVisible();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const more = screen.getByRole('button', { name: 'More', exact: true });
    expect(more).not.toHaveTextContent('More');
    more.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'More', exact: true });
    await user.click(within(dialog).getByRole('radio', { name: 'Comfortable', exact: true }));
    expect(densityChange).toHaveBeenCalledWith('comfortable');
    expect(within(dialog).getByRole('button', { name: 'Export list' })).toBeVisible();
    expect(within(dialog).getByText('Column settings')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Export list' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
    expect(exportCsv).toHaveBeenCalledWith('visible');
    await user.keyboard('{Escape}');
    expect(more).toHaveFocus();
    act(() => media?.fire('(max-width: 1279px)', false));
    expect(screen.queryByRole('button', { name: 'More', exact: true })).toBeNull();
    expect(screen.getByRole('radiogroup')).toBeVisible();
  });

  it('uses the canonical search label when callers omit a label and placeholder', () => {
    render(<TableToolbar search={{ value: '', onChange: vi.fn() }} />);
    expect(screen.getByRole('searchbox', { name: 'Search query' })).toBeInTheDocument();
  });

  it('reuses scoped CSV/JSON actions and selection counts without creating a search', () => {
    const csv = vi.fn();
    const json = vi.fn();
    render(<TableToolbar exports={{ onExportCsv: csv, onExportJson: json, selectedCount: 2, visibleCount: 15 }}
      heading={<span>Evidence</span>} columns={<span>Caller columns</span>} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText('Caller columns')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    expect(screen.getByRole('menuitemradio', { name: 'Selected (2)' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
    expect(csv).toHaveBeenCalledWith('selected');
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Visible (15)' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    expect(json).toHaveBeenCalledWith('visible');
  });

  it('exposes pending controlled search and an honest server-export description', () => {
    render(<TableToolbar search={{ value: 'route', onChange: vi.fn(), pending: true, ariaLabel: 'Search drives' }}
      exports={{ onExportCsv: vi.fn(), onExportJson: vi.fn(), description: 'Every drive in the server range' }} />);
    expect(screen.getByRole('searchbox', { name: 'Search drives' }).closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Filtering…' })).toBeInTheDocument();
    expect(screen.getByText('Every drive in the server range')).toBeInTheDocument();
  });
});
