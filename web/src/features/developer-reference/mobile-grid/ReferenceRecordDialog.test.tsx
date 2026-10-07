import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { ReferenceRecordDialog } from './ReferenceRecordDialog';
import type { MobileRow } from '@/components/ui/mobile-grid-reference';

afterEach(cleanup);
describe('all-field reference detail and action safety', () => {
  const row: MobileRow = {
    key: 'fixture-1', title: 'Human reference title', primary: '0',
    meta: [], details: [{ key: 'note', label: 'Notes', value: 'VeryLongUnbrokenValue'.repeat(40) },
      { key: 'energy_wh', label: 'Energy', value: '0 kWh' },
      { key: 'duration_s', label: 'Duration', value: '—' }],
  };
  it('retains full long values and invokes non-destructive callback only once', () => {
    const onAction = vi.fn();
    render(<ReferenceRecordDialog row={row} actionDisabled onClose={vi.fn()} onAction={onAction} />);
    expect(screen.getByText(row.details[0]?.value ?? '')).toBeInTheDocument();
    expect(screen.getByText('0 kWh')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect reference record' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Remove fixture (confirmation)' })).toBeDisabled();
  });
  it('cannot run a destructive-style callback until explicit confirmation', () => {
    const onAction = vi.fn();
    render(<ReferenceRecordDialog row={row} actionDisabled={false} onClose={vi.fn()} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove fixture (confirmation)' }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm fixture callback' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(expect.stringContaining('No deletion performed'));
  });
});
