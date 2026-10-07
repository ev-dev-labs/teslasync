import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { TableToolbar } from './TableToolbar';

describe('TableToolbar', () => {
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
    expect(screen.getByRole('radio', { name: 'Selected (2)' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
    expect(csv).toHaveBeenCalledWith('selected');
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Visible (15)' }));
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
