import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipRecord } from '../../lib/types';
import { RedactionEditor } from './RedactionEditor';

const render = (element: ReactElement) => renderView(element, { wrapper: MemoryRouter });

const storage = vi.hoisted(() => ({
  db: { getClip: vi.fn() },
  mutateAsync: vi.fn(),
}));
vi.mock('../../hooks/useDashcamDb', () => ({
  useDashcamDb: () => ({ db: storage.db }),
}));
vi.mock('../../hooks/useClipCatalog', () => ({
  useUpdateClip: () => ({ mutateAsync: storage.mutateAsync }),
}));

function clip(id = 'a'): ClipRecord {
  return {
    id, fileName: `${id}.mp4`, cameraPosition: 'front', cameraRaw: null,
    source: 'SavedClips', capturedAtRaw: null, durationSeconds: 60,
    sizeBytes: 1, mimeType: 'video/mp4', blob: new Blob(), eventSidecar: null,
    motion: { status: 'not_run' }, eventCandidates: [], vehicleId: 1,
    notes: '', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    redactions: [{
      id: 'region', kind: 'face', label: id, x: 0.1, y: 0.2,
      width: 0.3, height: 0.4, createdAt: '2026-01-01',
    }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function edit(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  storage.db = { getClip: vi.fn().mockResolvedValue(clip()) };
  storage.mutateAsync.mockReset();
  storage.mutateAsync.mockImplementation(async (record: ClipRecord) => ({
    ...record, updatedAt: '2026-02-01',
  }));
});
afterEach(cleanup);

describe('redaction draft persistence', () => {
  it('serializes all six fields, preserves normalized coordinates and merges current metadata', async () => {
    const first = deferred<ClipRecord>();
    storage.mutateAsync.mockReturnValueOnce(first.promise);
    const latest = { ...clip(), notes: 'newer notes', motion: { status: 'ok' as const, score: 9 } };
    storage.db.getClip.mockResolvedValue(latest);
    render(<RedactionEditor clip={clip()} />);
    edit('Label', 'privacy');
    await waitFor(() => expect(storage.mutateAsync).toHaveBeenCalledTimes(1));
    edit('Region kind', 'plate');
    edit('X', '0.25');
    edit('Y', '0.45');
    edit('Width', '0.55');
    edit('Height', '0.65');
    expect(storage.mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ ...latest, redactions: [{ ...latest.redactions[0], label: 'privacy' }] }));
    await waitFor(() => expect(storage.mutateAsync).toHaveBeenCalledTimes(2));
    expect(storage.mutateAsync.mock.calls[1][0]).toEqual({
      ...latest,
      redactions: [{ ...latest.redactions[0], kind: 'plate', label: 'privacy', x: 0.25, y: 0.45, width: 0.55, height: 0.65 }],
    });
    expect(screen.getByLabelText('Label')).toHaveValue('privacy');
    expect(screen.getByLabelText('Height')).toHaveValue('0.65');
  });

  it('retains rejected drafts and retries against newly stored metadata', async () => {
    storage.mutateAsync.mockRejectedValueOnce(new Error('disk write failed'));
    render(<RedactionEditor clip={clip()} />);
    edit('Label', 'recover me');
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Label')).toHaveValue('recover me');
    expect(storage.mutateAsync).toHaveBeenCalledTimes(1);
    storage.db.getClip.mockResolvedValue({ ...clip(), notes: 'changed while failed' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(storage.mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(storage.mutateAsync.mock.calls[1][0].notes).toBe('changed while failed');
    expect(screen.getByLabelText('Label')).toHaveValue('recover me');
  });

  it('uses the actual matching successful save result instead of stale props', async () => {
    storage.mutateAsync.mockImplementation(async (record: ClipRecord) => ({
      ...record, updatedAt: '2026-03-01',
      redactions: [{ ...record.redactions[0], label: 'stored result' }],
    }));
    render(<RedactionEditor clip={clip()} />);
    edit('Label', 'submitted');
    await waitFor(() => expect(screen.getByLabelText('Label')).toHaveValue('stored result'));
    expect(storage.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)('ignores stale %s after switching clips and returning', async (completion) => {
    const pending = deferred<ClipRecord>();
    storage.mutateAsync.mockReturnValueOnce(pending.promise);
    const { rerender } = render(<RedactionEditor clip={clip()} />);
    edit('Label', 'old draft');
    await waitFor(() => expect(storage.mutateAsync).toHaveBeenCalledTimes(1));
    rerender(<RedactionEditor clip={clip('b')} />);
    expect(screen.getByLabelText('Label')).toHaveValue('b');
    rerender(<RedactionEditor clip={clip()} />);
    await act(async () => {
      if (completion === 'resolve') pending.resolve({ ...clip(), redactions: [] });
      else pending.reject(new Error('obsolete failure'));
    });
    expect(screen.getByLabelText('Label')).toHaveValue('a');
    expect(screen.queryByText('obsolete failure')).not.toBeInTheDocument();
  });

  it('does not start a write if scope changes while the stored record is being read', async () => {
    const read = deferred<ClipRecord | null>();
    storage.db.getClip.mockReturnValueOnce(read.promise);
    const { rerender } = render(<RedactionEditor clip={clip()} />);
    edit('Label', 'old draft');
    rerender(<RedactionEditor clip={clip('b')} />);
    await act(async () => read.resolve(clip()));
    expect(storage.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Label')).toHaveValue('b');
  });

  it('resets storage scope while pending and ignores the old completion', async () => {
    const pending = deferred<ClipRecord>();
    storage.mutateAsync.mockReturnValueOnce(pending.promise);
    const { rerender } = render(<RedactionEditor clip={clip()} />);
    edit('Label', 'old storage');
    await waitFor(() => expect(storage.mutateAsync).toHaveBeenCalledTimes(1));
    storage.db = { getClip: vi.fn().mockResolvedValue({ ...clip(), notes: 'new storage' }) };
    rerender(<RedactionEditor clip={clip()} />);
    edit('Label', 'new storage draft');
    await waitFor(() => expect(storage.mutateAsync).toHaveBeenCalledTimes(2));
    await act(async () => pending.resolve({ ...clip(), redactions: [] }));
    expect(screen.getByLabelText('Label')).toHaveValue('new storage draft');
    expect(storage.mutateAsync.mock.calls[1][0].notes).toBe('new storage');
  });

  it('keeps add/remove drafts recoverable and never recreates a deleted stored clip', async () => {
    storage.db.getClip.mockResolvedValue(null);
    render(<RedactionEditor clip={clip()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove region' }));
    await screen.findByRole('button', { name: 'Retry' });
    expect(storage.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add region' }));
    expect(screen.getByLabelText('Label')).toHaveValue('Unlabeled region');
    await screen.findByRole('button', { name: 'Retry' });
    expect(storage.mutateAsync).not.toHaveBeenCalled();
  });
});
