/**
 * useChartExport — native-safe PNG / SVG / clipboard primitives for the chart
 * container.
 *
 * Web parity source: web/src/hooks/useChartExport.ts.
 *
 * On the web this hook rasterizes a chart's DOM wrapper with `html2canvas-pro`
 * and offers three image-export paths (PNG download, first-`<svg>`
 * serialization, Async-Clipboard image write with a download fallback). React
 * Native has none of those browser primitives — no DOM / `<canvas>` rasterizer,
 * no `<svg>` DOM tree to serialize, no `Blob` / `URL.createObjectURL` /
 * `<a download>` save-as, and no Async Clipboard image API — so this port keeps
 * the exact public surface (`chartRef`, `exporting`, `exportPNG`, `exportSVG`,
 * `copyToClipboard`, `ClipboardOutcome`) while routing every capture path
 * through an explicit, deterministic "unavailable" seam documented by
 * `nativeChartExportCapabilities` and `ChartExportUnavailableError`. A future
 * platform adapter (e.g. react-native-view-shot + Share / Clipboard) drops in
 * at `snapshotChart` / `downloadChartText` without changing the hook contract.
 *
 * Capture target
 * --------------
 * `chartRef` is wired to the chart container's outer `View` — the native analog
 * of the web wrapper div. The caller is still responsible for keeping export
 * affordances out of the captured sub-tree once a real native capture adapter
 * exists; ChartContainer owns that at the source on web.
 *
 * SVG export
 * ----------
 * Web serializes the FIRST `<svg>` element inside the capture target. Native
 * charts are not DOM `<svg>` trees, so `serializeChartSvg` returns `null` and
 * `exportSVG` bails quietly — exactly the web hook's "no `<svg>` element"
 * branch — instead of surfacing a confusing error.
 *
 * Clipboard
 * ---------
 * `copyToClipboard` preserves the web `ClipboardOutcome` union:
 *   - `'copied'`   — a native clipboard-image write succeeded (reserved for the
 *     future capture adapter; never returned today).
 *   - `'fallback'` — image captured but clipboard write unavailable, so it was
 *     saved / shared instead (reserved for the future adapter).
 *   - `'failed'`   — the snapshot itself is unavailable. This is the honest
 *     native outcome today: with no rasterizer there is no image to copy, which
 *     maps to the web "snapshot failed" branch.
 *
 * Reduced motion
 * --------------
 * No animation is introduced during (attempted) capture, matching the web
 * instant-snapshot behaviour for `prefers-reduced-motion` users.
 *
 * No DOM modules, browser HTML elements, Recharts, Leaflet, html2canvas, or old
 * web UI components are imported here.
 */
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { View } from 'react-native';

const CAPTURE_BACKGROUND = '#0a0a0f';

export type ClipboardOutcome = 'copied' | 'fallback' | 'failed';

/** Native chart capture target — the chart container's outer `View`. */
export type ChartCaptureTarget = View;

export interface ChartExportApi {
  /** Wire to the chart container's outer wrapper `View`. */
  chartRef: MutableRefObject<ChartCaptureTarget | null>;
  /** True while a snapshot is in flight (PNG, SVG, or clipboard). */
  exporting: boolean;
  exportPNG: () => Promise<void>;
  exportSVG: () => Promise<void>;
  copyToClipboard: () => Promise<ClipboardOutcome>;
}

/**
 * Capability descriptor for the native chart-export seam. Mirrors the explicit
 * "unavailable" pattern used by other web-parity ports so callers can branch on
 * what the platform can actually do instead of discovering it via a thrown
 * error.
 */
export const nativeChartExportCapabilities = {
  pngExportAvailable: false,
  svgExportAvailable: false,
  clipboardImageAvailable: false,
  unavailableReason:
    'React Native parity has no html2canvas-pro DOM rasterizer, <canvas>, <svg> DOM to serialize, Blob/URL.createObjectURL/<a download> save-as, or Async Clipboard image API; chart image export needs a platform capture/share adapter (e.g. react-native-view-shot + Share/Clipboard).',
} as const;

/**
 * Options the web path passes to html2canvas-pro, preserved as the config a
 * native capture adapter would receive once one is wired in.
 */
export interface NativeCaptureOptions {
  backgroundColor: string;
  scale: number;
  format: 'png';
}

const NATIVE_CAPTURE_OPTIONS: NativeCaptureOptions = {
  backgroundColor: CAPTURE_BACKGROUND,
  scale: 2,
  format: 'png',
};

/** Resolved native snapshot descriptor — the analog of the web `<canvas>`. */
export interface NativeChartImage {
  filename: string;
  mimeType: 'image/png';
}

/**
 * Thrown by every native capture path. Carries the filename the web hook would
 * have downloaded plus the capture options, so a future platform adapter (or a
 * diagnostic toast) has the full intended context.
 */
export class ChartExportUnavailableError extends Error {
  readonly intendedFilename: string;
  readonly captureOptions: NativeCaptureOptions;

  constructor(intendedFilename: string, captureOptions: NativeCaptureOptions) {
    super(nativeChartExportCapabilities.unavailableReason);
    this.name = 'ChartExportUnavailableError';
    this.intendedFilename = intendedFilename;
    this.captureOptions = captureOptions;
  }
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

/**
 * Native analog of the web `snapshotToCanvas` (html2canvas-pro). With no DOM
 * rasterizer or `<canvas>` on React Native the snapshot is explicitly
 * unavailable; the intended filename + capture options are threaded into the
 * error so a future react-native-view-shot adapter can replace just this body.
 * Typed to resolve a `NativeChartImage` (like web's `Promise<HTMLCanvasElement>`)
 * so callers keep their normal post-snapshot control flow.
 */
function snapshotChart(
  _target: ChartCaptureTarget,
  intendedFilename: string,
): Promise<NativeChartImage> {
  throw new ChartExportUnavailableError(
    intendedFilename,
    NATIVE_CAPTURE_OPTIONS,
  );
}

/**
 * Native analog of the web `downloadBlob` / `downloadHref` anchor download.
 * React Native has no `Blob`, `URL.createObjectURL`, or `<a download>`, so the
 * save / share is explicitly unavailable until a platform adapter is wired in.
 */
function downloadChartText(
  _content: string,
  intendedFilename: string,
): Promise<void> {
  throw new ChartExportUnavailableError(
    intendedFilename,
    NATIVE_CAPTURE_OPTIONS,
  );
}

/**
 * Native analog of the web `serializeFirstChildSVG`. React Native charts are
 * not DOM `<svg>` trees, so there is nothing to serialize — return `null`,
 * exactly like the web hook's "no `<svg>` element inside the container" branch.
 */
function serializeChartSvg(_target: ChartCaptureTarget): string | null {
  return null;
}

export function useChartExport(filename?: string): ChartExportApi {
  const chartRef = useRef<ChartCaptureTarget | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportPNG = useCallback(async () => {
    if (!chartRef.current || exporting) {
      return;
    }
    setExporting(true);
    try {
      await snapshotChart(chartRef.current, makeFilename(filename, 'png'));
    } catch (err) {
      console.warn('Chart PNG export unavailable on native:', err);
    } finally {
      setExporting(false);
    }
  }, [filename, exporting]);

  const exportSVG = useCallback(async () => {
    if (!chartRef.current || exporting) {
      return;
    }
    setExporting(true);
    try {
      const xml = serializeChartSvg(chartRef.current);
      if (!xml) {
        // Native charts render no serializable <svg> tree (see
        // serializeChartSvg), so bail out quietly — mirroring the web hook's
        // behaviour when a chart kind has no <svg> — instead of flashing a
        // confusing error.
        console.warn(
          'Chart SVG export: no serializable <svg> tree inside native chart container.',
        );
        return;
      }
      await downloadChartText(xml, makeFilename(filename, 'svg'));
    } catch (err) {
      console.warn('Chart SVG export unavailable on native:', err);
    } finally {
      setExporting(false);
    }
  }, [filename, exporting]);

  const copyToClipboard = useCallback(async (): Promise<ClipboardOutcome> => {
    if (!chartRef.current || exporting) {
      return 'failed';
    }
    setExporting(true);
    try {
      await snapshotChart(chartRef.current, makeFilename(filename, 'png'));
      // Reached only once a native capture adapter exists: with a real image we
      // would attempt a native clipboard-image write here and return 'copied',
      // falling back to a save / share ('fallback') if the write is refused.
      return 'copied';
    } catch (err) {
      // No native rasterizer means no image to copy: the snapshot itself is
      // unavailable, which maps to the web 'failed' branch (snapshot failed)
      // rather than 'fallback' (image captured, clipboard refused).
      console.warn('Chart clipboard copy unavailable on native:', err);
      return 'failed';
    } finally {
      setExporting(false);
    }
  }, [filename, exporting]);

  return { chartRef, exporting, exportPNG, exportSVG, copyToClipboard };
}
