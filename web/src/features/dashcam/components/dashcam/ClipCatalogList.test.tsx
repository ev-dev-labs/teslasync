import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipRecord } from '../../lib/types';
import { ClipCatalogList } from './ClipCatalogList';

const { mutate, deletion } = vi.hoisted(() => ({
  mutate: vi.fn(),
  deletion: { error: null as Error | null },
}));

vi.mock('../../hooks/useClipCatalog', () => ({
  useDeleteClip: () => ({ mutate, error: deletion.error }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDuration: (seconds: number | null) => seconds === null ? 'Unknown duration' : `${seconds}s` }),
}));

function clip(id: string, overrides: Partial<ClipRecord> = {}): ClipRecord {
  return {
    id, fileName: `${id}.mp4`, cameraPosition: 'front', cameraRaw: 'front',
    source: 'SentryClips', capturedAtRaw: '2026-10-14T12:30:00', durationSeconds: 60,
    sizeBytes: 100, mimeType: 'video/mp4', blob: new Blob(), eventSidecar: null,
    motion: { status: 'not_run' }, eventCandidates: [], redactions: [],
    vehicleId: null, notes: '', createdAt: '2026-10-14', updatedAt: '2026-10-14',
    ...overrides,
  };
}

beforeEach(() => {
  mutate.mockClear();
  deletion.error = null;
});
afterEach(cleanup);

describe('ClipCatalogList ordinary selectable list', () => {
  it('exposes labeled list items and native pressed buttons, updating selection without a partial listbox', () => {
    const clips = [clip('first'), clip('second')];
    const props = { clips, totalCount: 2, selectedClipId: 'first', onSelect: vi.fn(), onClearFilters: vi.fn() };
    const { rerender } = render(<ClipCatalogList {...props} />);
    const list = screen.getByRole('list', { name: 'Imported clips' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    const first = screen.getByRole('button', { name: /first\.mp4/ });
    const second = screen.getByRole('button', { name: /second\.mp4/ });
    expect(first).toHaveAttribute('type', 'button');
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'false');
    expect(first).not.toHaveAttribute('aria-selected');
    fireEvent.click(second);
    expect(props.onSelect).toHaveBeenCalledWith('second');
    rerender(<ClipCatalogList {...props} selectedClipId="second" />);
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports native Tab, Enter and Space interaction with independently focusable deletion', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ClipCatalogList clips={[clip('first'), clip('second')]} totalCount={2}
      selectedClipId="first" onSelect={onSelect} onClearFilters={vi.fn()} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /first\.mp4/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('first');
    await user.tab();
    expect(screen.getAllByRole('button', { name: 'Delete clip' })[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(mutate).toHaveBeenCalledWith('first');
    expect(onSelect).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole('button', { name: /second\.mp4/ })).toHaveFocus();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenLastCalledWith('second');
  });

  it('preserves populated metadata, unknown fields, event counts and per-clip deletion', () => {
    const onSelect = vi.fn();
    render(<ClipCatalogList clips={[
      clip('first', { eventCandidates: [{ id: 'event', type: 'motion', confidence: 'low', atSeconds: null, basis: ['sampled frames'] }] }),
      clip('second', { cameraPosition: 'unknown', source: 'unknown', capturedAtRaw: null, durationSeconds: null }),
    ]} totalCount={2} selectedClipId={null} onSelect={onSelect} onClearFilters={vi.fn()} />);
    const first = screen.getByRole('button', { name: /first\.mp4/ });
    for (const text of ['Front', 'Sentry', '2026-10-14 12:30:00', '60s']) {
      expect(within(first).getByText(text)).toBeInTheDocument();
    }
    expect(within(first).getByText(/1 event candidate\(s\)/)).toBeInTheDocument();
    const second = screen.getByRole('button', { name: /second\.mp4/ });
    for (const text of ['Unknown camera', 'Unknown source', '—', 'Unknown duration']) {
      expect(within(second).getByText(text)).toBeInTheDocument();
    }
    expect(second).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete clip' })[1]);
    expect(mutate).toHaveBeenCalledWith('second');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('retains clear-filter and unimported empty states', () => {
    const onClearFilters = vi.fn();
    const props = { clips: [], totalCount: 2, selectedClipId: null, onSelect: vi.fn(), onClearFilters };
    const { rerender } = render(<ClipCatalogList {...props} />);
    expect(screen.getByText('No clips match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledOnce();
    rerender(<ClipCatalogList {...props} totalCount={0} />);
    expect(screen.getByText('No clips imported yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('keeps the populated list visible when deletion fails', () => {
    deletion.error = new Error('Clip deletion failed');
    render(<MemoryRouter><ClipCatalogList clips={[clip('first')]} totalCount={1}
      selectedClipId="first" onSelect={vi.fn()} onClearFilters={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('list', { name: 'Imported clips' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
