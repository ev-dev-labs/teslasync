import { describe, it, expect } from 'vitest';
import { probeVideoDuration, type VideoDurationProbe } from '../lib/clipMetadata';

describe('probeVideoDuration', () => {
  it('resolves the duration once the mocked element fires loadedmetadata', async () => {
    let probe: VideoDurationProbe | null = null;
    const promise = probeVideoDuration('blob:fake', {
      createElement: () => {
        probe = { src: '', preload: '', duration: 42.5, onloadedmetadata: null, onerror: null };
        return probe;
      },
    });
    // Simulate the browser firing the event once `src` is assigned.
    await Promise.resolve();
    probe?.onloadedmetadata?.();
    await expect(promise).resolves.toBe(42.5);
  });

  it('resolves null (never rejects) when the element fires an error', async () => {
    let probe: VideoDurationProbe | null = null;
    const promise = probeVideoDuration('blob:fake', {
      createElement: () => {
        probe = { src: '', preload: '', duration: 0, onloadedmetadata: null, onerror: null };
        return probe;
      },
    });
    await Promise.resolve();
    probe?.onerror?.();
    await expect(promise).resolves.toBeNull();
  });

  it('resolves null on timeout instead of hanging forever', async () => {
    const promise = probeVideoDuration('blob:fake', {
      timeoutMs: 5,
      createElement: () => ({ src: '', preload: '', duration: 0, onloadedmetadata: null, onerror: null }),
    });
    await expect(promise).resolves.toBeNull();
  });

  it('resolves null for a non-finite or zero duration', async () => {
    let probe: VideoDurationProbe | null = null;
    const promise = probeVideoDuration('blob:fake', {
      createElement: () => {
        probe = { src: '', preload: '', duration: 0, onloadedmetadata: null, onerror: null };
        return probe;
      },
    });
    await Promise.resolve();
    probe?.onloadedmetadata?.();
    await expect(promise).resolves.toBeNull();
  });
});
