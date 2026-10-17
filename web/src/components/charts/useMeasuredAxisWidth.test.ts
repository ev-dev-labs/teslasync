import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measureAxisLabelWidth, useMeasuredAxisWidth } from './useMeasuredAxisWidth';

const context = {
  font: '',
  measureText: vi.fn((label: string) => ({ width: label.length * 8 })),
};
const getContext = vi.fn(() => context);
let canvasDescriptor: PropertyDescriptor | undefined;
let fontsDescriptor: PropertyDescriptor | undefined;
let previousFontFamily: string;

beforeEach(() => {
  canvasDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  previousFontFamily = document.body.style.fontFamily;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: getContext });
  Object.defineProperty(document, 'fonts', { configurable: true, value: undefined });
  document.body.style.fontFamily = 'FleetTest';
  getContext.mockReset().mockReturnValue(context);
  context.measureText.mockReset().mockImplementation(label => ({ width: label.length * 8 }));
});

afterEach(() => {
  cleanup();
  if (canvasDescriptor) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', canvasDescriptor);
  else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
  else Reflect.deleteProperty(document, 'fonts');
  document.body.style.fontFamily = previousFontFamily;
});

describe('measureAxisLabelWidth', () => {
  it('keeps the minimum for an empty axis and pads the full widest label', () => {
    expect(measureAxisLabelWidth([], () => 0)).toBe(35);
    expect(measureAxisLabelWidth(['short', 'long'], label => label === 'long' ? 80.1 : 20)).toBe(93);
    expect(measureAxisLabelWidth(['١٠٠٫٠٠٪'], () => 91.5, 36, 14)).toBe(106);
  });
});

describe('useMeasuredAxisWidth', () => {
  it('uses the rendered font size and inherited family without shortening labels', () => {
    const labels = ['100.00%', '١٠٠٫٠٠٪'];
    const { result } = renderHook(() => useMeasuredAxisWidth({ labels, fontSize: 11 }));
    expect(context.font).toBe('11px FleetTest');
    expect(context.measureText).toHaveBeenCalledWith(labels[1]);
    expect(result.current).toBe(68);
  });

  it('does not create or measure a canvas for a hidden compact axis', () => {
    const { result } = renderHook(() => useMeasuredAxisWidth({
      labels: ['100.00000000%'], fontSize: 10, enabled: false,
    }));
    expect(getContext).not.toHaveBeenCalled();
    expect(result.current).toBe(110);
  });

  it('uses each caller fallback policy and minimum when canvas is unavailable', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true, value: () => null,
    });
    const { result, rerender } = renderHook(
      ({ ratio }) => useMeasuredAxisWidth({
        labels: ['100.00000000%'], fontSize: 10, minWidth: 36, fallbackCharacterRatio: ratio,
      }),
      { initialProps: { ratio: 0.75 } },
    );
    expect(result.current).toBe(110);
    rerender({ ratio: 1 });
    expect(result.current).toBe(142);
  });

  it('remeasures changed localized labels and font sizes', () => {
    const { result, rerender } = renderHook(
      ({ labels, fontSize }) => useMeasuredAxisWidth({ labels, fontSize, minWidth: 36 }),
      { initialProps: { labels: ['1%'], fontSize: 10 } },
    );
    expect(result.current).toBe(36);
    rerender({ labels: ['100.00000000%'], fontSize: 12 });
    expect(result.current).toBe(116);
    expect(context.font).toBe('12px FleetTest');
  });

  it('does not reuse an old narrow measurement when new labels cannot be measured', () => {
    const { result, rerender } = renderHook(
      ({ labels }) => useMeasuredAxisWidth({ labels, fontSize: 10 }),
      { initialProps: { labels: ['1%'] } },
    );
    expect(result.current).toBe(35);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true, value: () => null,
    });
    rerender({ labels: ['100.00000000%'] });
    expect(result.current).toBe(110);
  });

  it('remeasures after fonts are ready and stops a pending font callback after unmount', async () => {
    let ready: () => void = () => {};
    const promise = new Promise<void>(resolve => { ready = resolve; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: promise } });
    const labels = ['100.00%'];
    const { result, unmount } = renderHook(() => useMeasuredAxisWidth({ labels, fontSize: 10 }));
    expect(result.current).toBe(68);
    context.measureText.mockImplementation(label => ({ width: label.length * 10 }));
    await act(async () => { ready(); await promise; });
    expect(result.current).toBe(82);
    unmount();

    let lateReady: () => void = () => {};
    const late = new Promise<void>(resolve => { lateReady = resolve; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: late } });
    const mounted = renderHook(() => useMeasuredAxisWidth({ labels, fontSize: 10 }));
    mounted.unmount();
    context.measureText.mockClear();
    await act(async () => { lateReady(); await late; });
    expect(context.measureText).not.toHaveBeenCalled();
  });
});
