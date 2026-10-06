import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipRecord } from '../../lib/types';
import { ClipPlayerPanel } from './ClipPlayerPanel';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../../hooks/useMotionAnalysis', () => ({
  useMotionAnalysis: () => ({ mutate, isPending: false }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDuration: (seconds: number) => `${seconds}s` }),
}));

function clip(id = 'clip-a'): ClipRecord {
  return {
    id, fileName: `${id}.mp4`, cameraPosition: 'front', cameraRaw: 'front',
    source: 'SavedClips', capturedAtRaw: '2026-10-05T10:00:00',
    durationSeconds: 60, sizeBytes: 1, mimeType: 'video/mp4',
    blob: new Blob([id], { type: 'video/mp4' }), eventSidecar: null,
    motion: { status: 'not_run' }, eventCandidates: [], redactions: [],
    vehicleId: 1, notes: '', createdAt: '', updatedAt: '',
  };
}

beforeEach(() => {
  mutate.mockClear();
  let nextUrl = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:clip-${++nextUrl}`);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('local clip canonical transport preservation', () => {
  it('offers only restart/play/seek and uses video events as playback authority', () => {
    const currentClip = clip();
    const { container } = render(<ClipPlayerPanel clip={currentClip} />);
    const video = container.querySelector('video')!;
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Playback speed/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /keyboard shortcuts/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    fireEvent.play(video);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    video.currentTime = 30;
    fireEvent.timeUpdate(video);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '50');
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(video.currentTime).toBe(0);
    expect(pause).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(video.currentTime).toBe(60);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pause).toHaveBeenCalledOnce();
    fireEvent.pause(video);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    fireEvent.play(video);
    fireEvent.ended(video);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run local motion analysis' }));
    expect(mutate).toHaveBeenCalledWith(currentClip);
  });

  it('releases each owned object URL on clip replacement and unmount', () => {
    const { container, rerender, unmount } = render(<ClipPlayerPanel clip={clip()} />);
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:clip-1');
    fireEvent.play(container.querySelector('video')!);
    rerender(<ClipPlayerPanel clip={clip('clip-b')} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip-1');
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:clip-2');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip-2');
  });

  it('does not fabricate a zero duration and can seek once native metadata arrives', () => {
    const input = clip();
    input.durationSeconds = null;
    const { container } = render(<ClipPlayerPanel clip={input} />);
    const video = container.querySelector('video')!;
    expect(screen.queryByText('0s')).not.toBeInTheDocument();
    Object.defineProperty(video, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(video);
    expect(screen.getByText('90s')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(video.currentTime).toBe(90);
  });
});
