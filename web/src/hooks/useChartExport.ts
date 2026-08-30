import { useCallback, useRef, useState } from 'react';

/**
 * useChartExport — PNG / SVG / clipboard primitives for ChartContainer.
 *
 * Full export surface for `<ChartExportMenu>`, promoted from a
 * single-purpose PNG helper without bypassing the shared snapshot logic.
 *
 * Capture target
 * --------------
 * `chartRef` should be wired to the chart container's outer wrapper. The
 * caller is responsible for marking any toolbar / annotation-button
 * sub-tree with `data-html2canvas-ignore` so the captured image doesn't
 * include the export menu itself, the title-bar action buttons, or the
 * marker row. ChartContainer does this for every chart at the source.
 *
 * SVG export
 * ----------
 * Serializes the FIRST `<svg>` element discovered inside the capture
 * target. Recharts produces a single SVG per chart so this matches the
 * visible visualisation 1:1, but it intentionally drops any HTML overlays
 * (custom legends, footers) — those are still preserved in the PNG /
 * clipboard paths. Callers that render meaningful HTML around the SVG
 * should prefer PNG for sharing.
 *
 * Clipboard
 * ---------
 * `copyToClipboard` resolves to one of:
 *   - `'copied'`   — `navigator.clipboard.write([ClipboardItem])` succeeded.
 *   - `'fallback'` — the Async Clipboard image API isn't available OR the
 *     browser rejected the write (insecure context, permission denied);
 *     the snapshot was instead downloaded as a PNG so the user can attach
 *     it manually.
 *   - `'failed'`   — the snapshot itself failed (html2canvas-pro threw or
 *     `canvas.toBlob` returned null).
 *
 * Reduced motion
 * --------------
 * No animation flashes are introduced during capture; `prefers-reduced-
 * motion` users see the same instant-snapshot behaviour as everyone else.
 */

const CAPTURE_BACKGROUND = '#0a0a0f';

export type ClipboardOutcome = 'copied' | 'fallback' | 'failed';

export interface ChartExportApi {
  /** Wire to the chart container's outer wrapper. */
  chartRef: React.MutableRefObject<HTMLDivElement | null>;
  /** True while a snapshot is in flight (PNG, SVG, or clipboard). */
  exporting: boolean;
  exportPNG: () => Promise<void>;
  exportSVG: () => Promise<void>;
  copyToClipboard: () => Promise<ClipboardOutcome>;
}

function makeFilename(base: string | undefined, ext: string): string {
  const sanitized = (base ?? 'chart')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safe = sanitized || 'chart';
  const date = new Date().toISOString().slice(0, 10);
  return `${safe}-${date}.${ext}`;
}

function captureBackground(node: HTMLElement): string {
  if (typeof window === 'undefined') return CAPTURE_BACKGROUND;

  // html2canvas renders an explicit canvas background instead of compositing
  // through the app shell. Walk to the first opaque themed surface so an
  // exported PNG respects light/dark/custom palettes rather than always
  // becoming dark. The chart DOM already contains masked values, so PNG and
  // clipboard exports preserve the same privacy treatment as the screen.
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    const color = window.getComputedStyle(current).backgroundColor;
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
      return color;
    }
  }
  return CAPTURE_BACKGROUND;
}

async function snapshotToCanvas(node: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas-pro');
  return html2canvas(node, {
    backgroundColor: captureBackground(node),
    scale: 2,
    useCORS: true,
    logging: false,
    // Keep export capture equivalent to the user-visible chart instead of
    // serializing export/fullscreen controls. ChartContainer marks its
    // toolbar; this guard also makes standalone hook consumers safe.
    ignoreElements: (element) =>
      element.getAttribute('data-html2canvas-ignore') === 'true',
  });
}

function downloadHref(href: string, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = href;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    downloadHref(url, filename);
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

function serializeFirstChildSVG(root: HTMLElement): string | null {
  const svg = root.querySelector('svg');
  if (!svg) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  // Recharts SVGs are transparent. Pin the computed chart surface directly
  // on the exported SVG so the downloaded file retains the active theme even
  // outside the TeslaSync stylesheet.
  clone.style.backgroundColor = captureBackground(root);
  const label = root.getAttribute('aria-label');
  if (label && !clone.getAttribute('aria-label')) {
    clone.setAttribute('aria-label', label);
    clone.setAttribute('role', 'img');
  }
  return new XMLSerializer().serializeToString(clone);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type);
  });
}

function getClipboardItemCtor(): typeof ClipboardItem | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
}

export function useChartExport(filename?: string): ChartExportApi {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportPNG = useCallback(async () => {
    if (!chartRef.current || exporting) return;
    setExporting(true);
    try {
      const canvas = await snapshotToCanvas(chartRef.current);
      downloadHref(canvas.toDataURL('image/png'), makeFilename(filename, 'png'));
    } catch (err) {
      console.error('Chart PNG export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [filename, exporting]);

  const exportSVG = useCallback(async () => {
    if (!chartRef.current || exporting) return;
    setExporting(true);
    try {
      const xml = serializeFirstChildSVG(chartRef.current);
      if (!xml) {
        // Some chart kinds (level gauges, tile heatmaps) render via
        // `<canvas>` or pure CSS — there is no SVG to serialize. Bail
        // out quietly so the menu item simply does nothing instead of
        // flashing a confusing toast.
        console.warn('Chart SVG export: no <svg> element inside chart container.');
        return;
      }
      const blob = new Blob(
        ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n', xml],
        { type: 'image/svg+xml;charset=utf-8' },
      );
      downloadBlob(blob, makeFilename(filename, 'svg'));
    } catch (err) {
      console.error('Chart SVG export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [filename, exporting]);

  const copyToClipboard = useCallback(async (): Promise<ClipboardOutcome> => {
    if (!chartRef.current || exporting) return 'failed';
    setExporting(true);
    try {
      const canvas = await snapshotToCanvas(chartRef.current);
      const blob = await canvasToBlob(canvas, 'image/png');
      if (!blob) return 'failed';
      const ClipboardItemCtor = getClipboardItemCtor();
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.write === 'function' &&
        typeof ClipboardItemCtor === 'function'
      ) {
        try {
          await navigator.clipboard.write([
            new ClipboardItemCtor({ 'image/png': blob }),
          ]);
          return 'copied';
        } catch (err) {
          // Browser refused (insecure context, permissions, focus loss).
          // Fall through to the download fallback so the user still
          // gets the image; surfacing 'fallback' so the menu can toast
          // "Clipboard not available — image downloaded instead".
          console.warn('Chart clipboard.write rejected — falling back to download:', err);
          downloadBlob(blob, makeFilename(filename, 'png'));
          return 'fallback';
        }
      }
      downloadBlob(blob, makeFilename(filename, 'png'));
      return 'fallback';
    } catch (err) {
      console.error('Chart clipboard copy failed:', err);
      return 'failed';
    } finally {
      setExporting(false);
    }
  }, [filename, exporting]);

  return { chartRef, exporting, exportPNG, exportSVG, copyToClipboard };
}
