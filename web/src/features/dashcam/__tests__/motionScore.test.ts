import { describe, it, expect } from 'vitest';
import { frameDiffScore, classifyMotionScore, computeClipMotionScore, type SampleableVideo } from '../lib/motionScore';

function solidFrame(size: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return data;
}

describe('frameDiffScore', () => {
  it('returns 0 for identical frames', () => {
    const frame = solidFrame(100, 128, 128, 128);
    expect(frameDiffScore(frame, frame)).toBe(0);
  });

  it('returns a larger score for a bigger luminance difference', () => {
    const black = solidFrame(100, 0, 0, 0);
    const white = solidFrame(100, 255, 255, 255);
    const gray = solidFrame(100, 128, 128, 128);
    const blackToWhite = frameDiffScore(black, white);
    const blackToGray = frameDiffScore(black, gray);
    expect(blackToWhite).toBeGreaterThan(blackToGray);
    expect(blackToWhite).toBeCloseTo(1, 1);
  });

  it('throws RangeError on mismatched buffer lengths', () => {
    expect(() => frameDiffScore(solidFrame(10, 0, 0, 0), solidFrame(20, 0, 0, 0))).toThrow(RangeError);
  });

  it('handles empty buffers', () => {
    expect(frameDiffScore(new Uint8ClampedArray(0), new Uint8ClampedArray(0))).toBe(0);
  });
});

describe('classifyMotionScore', () => {
  it('buckets scores into low/medium/high', () => {
    expect(classifyMotionScore(0)).toBe('low');
    expect(classifyMotionScore(0.5)).toBe('high');
  });
});

describe('computeClipMotionScore', () => {
  it('fails explicitly when the clip has no decodable duration', async () => {
    const video: SampleableVideo = {
      duration: NaN,
      videoWidth: 100,
      videoHeight: 100,
      currentTime: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const result = await computeClipMotionScore(video);
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toContain('duration');
    }
  });

  it('fails explicitly when no 2D canvas context is available (real jsdom behavior — no mock)', async () => {
    let time = 0;
    const video: SampleableVideo = {
      duration: 10,
      videoWidth: 320,
      videoHeight: 240,
      get currentTime() {
        return time;
      },
      set currentTime(v: number) {
        time = v;
      },
      addEventListener: (_type, listener) => {
        // Simulate the browser firing 'seeked' asynchronously.
        setTimeout(listener, 0);
      },
      removeEventListener: () => {},
    };
    // No `createCanvas` override — this exercises the real
    // `document.createElement('canvas').getContext('2d')` path, which
    // jsdom (no `canvas` npm package installed) genuinely returns null
    // for. This is a real, non-mocked assertion of the "fail explicitly
    // when browser APIs are unavailable" contract.
    const result = await computeClipMotionScore(video);
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toContain('2D canvas context');
    }
  });

  it('computes an ok score when given a working canvas mock', async () => {
    let time = 0;
    const video: SampleableVideo = {
      duration: 10,
      videoWidth: 320,
      videoHeight: 240,
      get currentTime() {
        return time;
      },
      set currentTime(v: number) {
        time = v;
      },
      addEventListener: (_type, listener) => {
        setTimeout(listener, 0);
      },
      removeEventListener: () => {},
    };
    let frameIndex = 0;
    const result = await computeClipMotionScore(video, {
      sampleCount: 3,
      createCanvas: () => ({
        getContext: () => ({
          drawImage: () => {
            frameIndex += 1;
          },
          getImageData: () => ({ data: solidFrame(50, frameIndex * 40, 0, 0) }),
        }),
      }),
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.samplePairs).toBe(2);
      expect(result.score).toBeGreaterThan(0);
    }
  });
});
