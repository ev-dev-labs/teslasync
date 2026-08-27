/**
 * useChartExport hook contract.
 * Validates the PNG/SVG/clipboard primitives without invoking the real
 * html2canvas-pro snapshot pipeline (jsdom has no canvas backend).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartExport } from '../useChartExport';

// ── html2canvas-pro mock ──────────────────────────────────────────────
// Returns a fake canvas object with the two methods our hook touches:
// `toDataURL('image/png')` and `toBlob(cb, 'image/png')`.
const fakePngBlob = new Blob(['png-bytes'], { type: 'image/png' });
const html2canvasMock = vi.fn(async () => ({
  toDataURL: vi.fn(() => 'data:image/png;base64,FAKE'),
  toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(fakePngBlob)),
}));

vi.mock('html2canvas-pro', () => ({
  default: html2canvasMock,
}));

// ── Globals: anchor click capture, URL.createObjectURL, clipboard ─────
type ClickedAnchor = {
  download: string;
  href: string;
};
const clicked: ClickedAnchor[] = [];

beforeEach(() => {
  clicked.length = 0;
  html2canvasMock.mockClear();

  // Capture <a> clicks so we can assert what was downloaded.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.href });
  });

  // jsdom doesn't implement these.
  if (!('createObjectURL' in URL)) {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  }
  if (!('revokeObjectURL' in URL)) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  }
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    () => 'blob:mock-url-12345',
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  // Reset clipboard to whatever the next test sets.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'ClipboardItem', {
    configurable: true,
    value: undefined,
  });
});

// ── Helpers ───────────────────────────────────────────────────────────
function attachChartRef(
  ref: React.MutableRefObject<HTMLDivElement | null>,
  withSVG = true,
) {
  const div = document.createElement('div');
  if (withSVG) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '50');
    const rect = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'rect',
    );
    rect.setAttribute('width', '100');
    rect.setAttribute('height', '50');
    rect.setAttribute('fill', '#abcdef');
    svg.appendChild(rect);
    div.appendChild(svg);
  }
  document.body.appendChild(div);
  ref.current = div;
  return div;
}

// ── Tests ─────────────────────────────────────────────────────────────
describe('useChartExport — exportPNG', () => {
  it('snapshots the chart node, invokes toDataURL("image/png"), and triggers an <a> download', async () => {
    const { result } = renderHook(() => useChartExport('battery-degradation'));
    attachChartRef(result.current.chartRef);

    await act(async () => {
      await result.current.exportPNG();
    });

    expect(html2canvasMock).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toMatch(/^battery-degradation-\d{4}-\d{2}-\d{2}\.png$/);
    expect(clicked[0].href).toContain('data:image/png;base64,');
  });

  it('captures the active themed surface and omits marked toolbar controls', async () => {
    const { result } = renderHook(() => useChartExport('themed'));
    const chart = attachChartRef(result.current.chartRef);
    chart.style.backgroundColor = 'rgb(18, 52, 86)';
    const ignored = document.createElement('button');
    ignored.setAttribute('data-html2canvas-ignore', 'true');
    chart.appendChild(ignored);

    await act(async () => {
      await result.current.exportPNG();
    });

    const [, options] = html2canvasMock.mock.calls[0] as [
      HTMLElement,
      { backgroundColor: string; ignoreElements: (element: Element) => boolean },
    ];
    expect(options.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(options.ignoreElements(ignored)).toBe(true);
    expect(options.ignoreElements(chart)).toBe(false);
  });

  it('does nothing when chartRef is null', async () => {
    const { result } = renderHook(() => useChartExport('x'));
    await act(async () => {
      await result.current.exportPNG();
    });
    expect(html2canvasMock).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });

  it('sanitizes special chars in the filename and falls back to "chart" when empty', async () => {
    const { result } = renderHook(() => useChartExport('  ?? !! '));
    attachChartRef(result.current.chartRef);
    await act(async () => {
      await result.current.exportPNG();
    });
    expect(clicked[0].download).toMatch(/^chart-\d{4}-\d{2}-\d{2}\.png$/);
  });
});

describe('useChartExport — exportSVG', () => {
  it('serializes the first child <svg> with the standard XML namespace and downloads as a blob', async () => {
    const { result } = renderHook(() => useChartExport('cells'));
    attachChartRef(result.current.chartRef);

    await act(async () => {
      await result.current.exportSVG();
    });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toMatch(/^cells-\d{4}-\d{2}-\d{2}\.svg$/);

    // The blob passed to createObjectURL should carry the SVG MIME and
    // start with the XML prelude + the standard SVG namespace declaration.
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/svg+xml;charset=utf-8');
    const text = await blob.text();
    expect(text).toContain('<?xml version="1.0"');
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(text).toContain('<rect');
    expect(text).toContain('background-color: rgb(10, 10, 15)');
  });

  it('quietly bails out when there is no child <svg>', async () => {
    const { result } = renderHook(() => useChartExport('no-svg'));
    attachChartRef(result.current.chartRef, false);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await act(async () => {
      await result.current.exportSVG();
    });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });
});

describe('useChartExport — copyToClipboard', () => {
  it('writes the PNG blob via navigator.clipboard.write([ClipboardItem]) and resolves to "copied"', async () => {
    const writeSpy = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: writeSpy },
    });
    // Minimal ClipboardItem polyfill so the production guard recognises it.
    const ClipboardItemCtor = vi.fn(function (
      this: { items: Record<string, Blob> },
      items: Record<string, Blob>,
    ) {
      this.items = items;
    });
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: ClipboardItemCtor,
    });

    const { result } = renderHook(() => useChartExport('clip'));
    attachChartRef(result.current.chartRef);

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.copyToClipboard();
    });

    expect(outcome).toBe('copied');
    expect(ClipboardItemCtor).toHaveBeenCalledWith({ 'image/png': fakePngBlob });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    // No download fallback fired.
    expect(clicked).toHaveLength(0);
  });

  it('falls back to a PNG download (returns "fallback") when ClipboardItem is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: vi.fn() },
    });
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useChartExport('fallback-clip'));
    attachChartRef(result.current.chartRef);

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.copyToClipboard();
    });

    expect(outcome).toBe('fallback');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toMatch(
      /^fallback-clip-\d{4}-\d{2}-\d{2}\.png$/,
    );
  });

  it('falls back to download (returns "fallback") when navigator.clipboard.write rejects', async () => {
    const writeSpy = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: writeSpy },
    });
    const ClipboardItemCtor = vi.fn(function (
      this: { items: Record<string, Blob> },
      items: Record<string, Blob>,
    ) {
      this.items = items;
    });
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: ClipboardItemCtor,
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() => useChartExport('rejected'));
    attachChartRef(result.current.chartRef);

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.copyToClipboard();
    });

    expect(outcome).toBe('fallback');
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('returns "failed" when chartRef is null (nothing captured)', async () => {
    const { result } = renderHook(() => useChartExport('none'));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.copyToClipboard();
    });
    expect(outcome).toBe('failed');
    expect(html2canvasMock).not.toHaveBeenCalled();
  });

  it('returns "failed" when canvas.toBlob yields null', async () => {
    html2canvasMock.mockImplementationOnce(async () => ({
      toDataURL: vi.fn(),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(null)),
    }));

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useChartExport('null-blob'));
    attachChartRef(result.current.chartRef);

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.copyToClipboard();
    });
    expect(outcome).toBe('failed');
    // No further assertions — guard against unrelated logging.
    error.mockRestore();
  });
});
