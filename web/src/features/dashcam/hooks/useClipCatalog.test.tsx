import { createElement, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDashcamDb } from '../lib/db/memoryAdapter';
import { defaultDashcamSettings, type ClipRecord } from '../lib/types';
import { buildClipId } from '../lib/clipParsing';
import { dashcamKeys, useClipCatalog, useImportClips } from './useClipCatalog';

const mocks = vi.hoisted(() => ({
  db: { listClips: vi.fn(), putClip: vi.fn() },
  success: vi.fn(),
  error: vi.fn(),
  probe: vi.fn(),
}));
vi.mock('./useDashcamDb', () => ({ useDashcamDb: () => ({ db: mocks.db }) }));
vi.mock('@/api/hooks/_toastHelpers', () => ({
  useMutationToast: () => ({ success: mocks.success, error: mocks.error }),
}));
vi.mock('../lib/clipMetadata', () => ({ probeVideoDuration: mocks.probe }));

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function input() {
  return {
    files: ['front', 'back', 'left_repeater'].map((camera) =>
      new File(['video'], `2026-10-14_10-00-00-${camera}.mp4`, {
        type: 'video/mp4', lastModified: 123,
      })),
    sidecarFile: null,
    vehicleId: null,
    settings: defaultDashcamSettings(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  const db = createMemoryDashcamDb();
  mocks.db.listClips.mockImplementation(() => db.listClips());
  mocks.db.putClip.mockImplementation((clip: ClipRecord) => db.putClip(clip));
  mocks.probe.mockResolvedValue(0);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:test');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('local clip catalog', () => {
  it('keeps active loading distinct from confirmed empty data', async () => {
    const read = deferred<ClipRecord[]>();
    mocks.db.listClips.mockReturnValue(read.promise);
    const { wrapper } = setup();
    const { result } = renderHook(useClipCatalog, { wrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    await act(async () => { read.resolve([]); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('does not manufacture an empty catalog while paused without data', () => {
    onlineManager.setOnline(false);
    const { wrapper } = setup();
    const { result } = renderHook(useClipCatalog, { wrapper });
    expect(result.current.fetchStatus).toBe('paused');
    expect(result.current.isPending).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mocks.db.listClips).not.toHaveBeenCalled();
  });

  it('imports a measured zero and reports only a fully successful batch as success', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({
      catalog: useClipCatalog(), importer: useImportClips(),
    }), { wrapper });
    await waitFor(() => expect(result.current.catalog.data).toEqual([]));
    const batch = input();
    await act(async () => { await result.current.importer.mutateAsync(batch); });
    await waitFor(() => expect(result.current.catalog.data).toHaveLength(3));
    expect(result.current.catalog.data?.map((clip) => clip.durationSeconds)).toEqual([0, 0, 0]);
    expect(mocks.success).toHaveBeenCalledWith(
      'dashcam.import.success', '{{count}} clip(s) imported locally', { count: 3 },
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('retains the committed prefix through refresh failure and recovers without changing IDs', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({
      catalog: useClipCatalog(), importer: useImportClips(),
    }), { wrapper });
    await waitFor(() => expect(result.current.catalog.data).toEqual([]));
    const batch = input();
    const writeFailure = new Error('second write failed');
    const refreshFailure = new Error('catalog refresh failed');
    mocks.db.putClip.mockImplementationOnce(async () => {}).mockRejectedValueOnce(writeFailure);
    mocks.db.listClips.mockRejectedValue(refreshFailure);
    const files = [...batch.files];
    await act(async () => {
      await expect(result.current.importer.mutateAsync(batch)).rejects.toBe(writeFailure);
    });
    await waitFor(() => expect(result.current.catalog.error).toBe(refreshFailure));
    const committed = result.current.catalog.data?.[0];
    expect(committed?.id).toBe(buildClipId(files[0].name, files[0].size, files[0].lastModified));
    expect(result.current.catalog.data).toHaveLength(1);
    expect(result.current.importer.isError).toBe(true);
    expect(result.current.importer.error).toBe(writeFailure);
    expect(batch.files).toEqual(files);
    expect(mocks.db.putClip).toHaveBeenCalledTimes(2);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(writeFailure, 'dashcam.import.error', 'Failed to import clips');
    mocks.db.listClips.mockResolvedValue([committed]);
    await act(async () => { await result.current.catalog.refetch(); });
    await waitFor(() => expect(result.current.catalog.isSuccess).toBe(true));
    expect(result.current.catalog.data).toEqual([committed]);
    expect(result.current.importer.error).toBe(writeFailure);
  });

  it('does not replace an unread catalog with a success-shaped partial list', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(useImportClips, { wrapper });
    const failure = new Error('second write failed');
    mocks.db.putClip.mockImplementationOnce(async () => {}).mockRejectedValueOnce(failure);
    await act(async () => {
      await expect(result.current.mutateAsync(input())).rejects.toBe(failure);
    });
    expect(client.getQueryData(dashcamKeys.clips)).toBeUndefined();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('reconciles earlier writes when building a later record fails', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(dashcamKeys.clips, []);
    const { result } = renderHook(useImportClips, { wrapper });
    const failure = new Error('metadata probe failed');
    mocks.probe.mockResolvedValueOnce(0).mockRejectedValueOnce(failure);
    await act(async () => {
      await expect(result.current.mutateAsync(input())).rejects.toBe(failure);
    });
    expect(client.getQueryData(dashcamKeys.clips)).toHaveLength(1);
    expect(mocks.db.putClip).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('does not invalidate or change the catalog when no write committed', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(dashcamKeys.clips, []);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(useImportClips, { wrapper });
    const failure = new Error('first write failed');
    mocks.db.putClip.mockRejectedValueOnce(failure);
    await act(async () => {
      await expect(result.current.mutateAsync(input())).rejects.toBe(failure);
    });
    expect(client.getQueryData(dashcamKeys.clips)).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
    expect(mocks.db.putClip).toHaveBeenCalledOnce();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('preserves existing clips and replaces matching IDs rather than duplicating retry writes', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(useImportClips, { wrapper });
    const batch = input();
    let original: ClipRecord[] = [];
    await act(async () => { original = await result.current.mutateAsync(batch); });
    client.setQueryData(dashcamKeys.clips, original);
    mocks.success.mockClear();
    mocks.db.putClip.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('retry failed'));
    await act(async () => {
      await expect(result.current.mutateAsync(batch)).rejects.toThrow('retry failed');
    });
    const cached = client.getQueryData<ClipRecord[]>(dashcamKeys.clips);
    expect(cached).toHaveLength(3);
    expect(new Set(cached?.map((clip) => clip.id))).toEqual(new Set(original.map((clip) => clip.id)));
    expect(cached?.find((clip) => clip.id === original[2].id)).toEqual(original[2]);
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
