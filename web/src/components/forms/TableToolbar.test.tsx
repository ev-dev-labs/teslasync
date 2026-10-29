import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { patchMatchMedia } from '@/test/setup';
import { TableToolbar } from './TableToolbar';

describe('TableToolbar', () => {
  let media: ReturnType<typeof patchMatchMedia> | undefined;
  afterEach(() => {
    media?.restore();
    media = undefined;
  });

  it('keeps search visible and moves secondary controls into an accessible More dialog on phones and tablets', async () => {
    media = patchMatchMedia(query => query === '(max-width: 1279px)');
    const user = userEvent.setup();
    const densityChange = vi.fn();
    render(<TableToolbar collapseBelow="xl" search={{ value: '', onChange: vi.fn() }}
      density={{ value: 'compact', onChange: densityChange }}
      exports={{ onExportCsv: vi.fn(), onExportJson: vi.fn() }}
      columns={<span>Column settings</span>} />);
    expect(screen.getByRole('searchbox')).toBeVisible();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const more = screen.getByRole('button', { name: 'More', exact: true });
    await user.click(more);
    const dialog = screen.getByRole('dialog', { name: 'More', exact: true });
    await user.click(within(dialog).getByRole('radio', { name: 'Comfortable', exact: true }));
    expect(densityChange).toHaveBeenCalledWith('comfortable');
    expect(within(dialog).getByRole('button', { name: 'Export list' })).toBeVisible();
    expect(within(dialog).getByText('Column settings')).toBeVisible();
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
